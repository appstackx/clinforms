/**
 * The D1 → Postgres copy (tested SQLite → PGlite: the gateway source reads the same rows as SQLite) and the
 * pure parts of the Supabase provisioning script.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import type { DataCipher } from "../../src/server/crypto/envelope";
import type { Database } from "../../src/server/db/schema";
import { createSqliteTestDb, testCipher, type TestDb } from "../../src/server/db/testing/databases";
import { createPglite, pgliteMigrationClient } from "../../src/server/db/testing/pglite";
import { applyPostgresMigrations } from "../../src/server/db/migrations";
import type { RepoContext } from "../../src/server/repos/context";
import { appendAudit, listAudit } from "../../src/server/repos/audit";
import { upsertClinicProfile, getClinicProfile } from "../../src/server/repos/clinic-profile";
import { getFormFile, putFormFile, FILE_CHUNK_BYTES } from "../../src/server/repos/form-files";
import { createForm, getForm } from "../../src/server/repos/forms";
import { createPartnerKey, verifyPartnerKey } from "../../src/server/repos/partner-keys";
import { hitRateLimit } from "../../src/server/repos/rate-limits";
import { createReport, getReport, listReports } from "../../src/server/repos/reports";
import { copyDatabase, sqliteSource } from "./copy-d1-to-postgres";
import { createProjectBody, planRequests, poolerUrl, scrubConnectionString } from "./provision-supabase";

describe("copy D1/SQLite → Postgres", () => {
  let source: TestDb & { sqlite: import("../../src/server/db/dialects/sqlite-local").SqliteDatabaseLike };
  let pglite: PGlite;
  let target: Kysely<Database>;
  let cipher: DataCipher;
  let src: RepoContext;
  let fileSha = "";
  let partnerKey = "";
  const fileBytes = randomBytes(FILE_CHUNK_BYTES + 777);

  before(async () => {
    source = createSqliteTestDb();
    cipher = testCipher();
    src = { db: source.db, cipher };
    await upsertClinicProfile(src, "clinic-a", { organizationId: "org_a", displayName: "Riverside Physiotherapy (fictional)", draftingEnabled: true });
    await createForm(src, "clinic-a", { id: "f1", fileSha256: "c".repeat(64), status: "confirmed", title: "T", kind: "pdf", payload: { a: 1 } });
    for (let i = 0; i < 250; i++) {
      await createReport(src, "clinic-a", { id: `r-${String(i).padStart(3, "0")}`, status: "draft", templateId: "t", payload: { i } });
    }
    fileSha = (await putFormFile(src, "clinic-a", { bytes: fileBytes, fileName: "f.pdf", mimeType: "application/pdf" })).sha256;
    await appendAudit(src, "clinic-a", { action: "report.sign", targetId: "r-001" });
    partnerKey = (await createPartnerKey(src, "clinic-a", { name: "PMS" })).key;
    await hitRateLimit(src, "k", 60_000);
    pglite = await createPglite();
    await applyPostgresMigrations(pgliteMigrationClient(pglite));
    target = new Kysely<Database>({ dialect: new PGliteDialect({ pglite }) });
  });
  after(async () => {
    await source?.close();
    await target?.destroy();
  });

  it("dry run reads and summarises without writing", async () => {
    const result = await copyDatabase(sqliteSource(source.sqlite), pgliteMigrationClient(pglite), { dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.tables.find((t) => t.table === "reports")?.rows, 250);
    assert.equal(result.tables.find((t) => t.table === "form_file_chunks")?.rows, 2);
    const n = await pglite.query<{ n: number }>("select count(*)::int as n from reports");
    assert.equal(n.rows[0].n, 0);
  });

  it("copies every table in FK order, verifies counts + checksums, and the data stays readable", async () => {
    const lines: string[] = [];
    const result = await copyDatabase(sqliteSource(source.sqlite), pgliteMigrationClient(pglite), { log: (l) => lines.push(l) });
    assert.equal(result.dryRun, false);
    assert.ok(lines.some((l) => l.startsWith("verified reports")));
    const dst: RepoContext = { db: target, cipher };
    // ciphertext copied as-is still decrypts (same keys, same AAD), files verify, keys verify
    assert.deepEqual((await getForm(dst, "clinic-a", "f1"))?.payload, { a: 1 });
    assert.deepEqual((await getReport(dst, "clinic-a", "r-123"))?.payload, { i: 123 });
    assert.equal((await listReports(dst, "clinic-a", { limit: 1000, withPayload: false })).length, 250);
    assert.ok((await getFormFile(dst, "clinic-a", fileSha))?.bytes.equals(fileBytes));
    assert.equal((await getClinicProfile(dst, "clinic-a"))?.draftingEnabled, true);
    assert.equal((await listAudit(dst, "clinic-a")).length, 1);
    assert.ok(await verifyPartnerKey(dst, "clinic-a", partnerKey));
  });

  it("refuses to copy into a non-empty target", async () => {
    await assert.rejects(copyDatabase(sqliteSource(source.sqlite), pgliteMigrationClient(pglite)), /not empty/);
  });
});

describe("Supabase provisioning helpers", () => {
  it("uses organization_slug and region_selection eu-west-2", () => {
    assert.deepEqual(createProjectBody("clinforms-prod", "my-org", "pw"), {
      name: "clinforms-prod",
      organization_slug: "my-org",
      db_pass: "pw",
      region_selection: { type: "specific", code: "eu-west-2" },
    });
  });
  it("never shows the password in the plan or the printed connection strings", () => {
    const plan = JSON.stringify(planRequests("clinforms-prod", "my-org"));
    assert.ok(plan.includes("never printed"));
    const url = poolerUrl({ db_user: "postgres.abcdefghijklmnopqrst", db_host: "aws-0-eu-west-2.pooler.supabase.com", db_port: 6543, db_name: "postgres" }, "s3cr3t/+pw");
    assert.ok(url.includes(encodeURIComponent("s3cr3t/+pw")));
    const shown = scrubConnectionString(url);
    assert.equal(shown, "postgresql://postgres.abcdefghijklmnopqrst:[YOUR-PASSWORD]@aws-0-eu-west-2.pooler.supabase.com:6543/postgres");
    assert.equal(scrubConnectionString("postgres://user@host/db"), "postgres://user@host/db");
  });
});

describe("copy D1/SQLite → Postgres with Better Auth's tables (sign-in still works on the copy)", () => {
  it("copies accounts, two-step secrets, clinics and memberships; the same secret signs in on Postgres", async () => {
    const { createAuth } = await import("../../src/server/auth/create-auth");
    const { createClinic } = await import("../../src/server/auth/platform");
    const { CookieJar } = await import("../../src/server/auth/testing/cookie-jar");
    const { parseOtpAuthUri, totp } = await import("../../src/server/auth/testing/totp");
    const { setEmailProviderForTests } = await import("../../src/server/email");
    setEmailProviderForTests({ name: "none", send: async () => ({ status: "not_sent", provider: "none" }) });
    const secret = "copy-test-secret-".padEnd(48, "c");
    const base = { kind: "static" as const, url: "http://localhost:3000" };
    const password = "copy test long password";
    const src = createSqliteTestDb();
    const pglite = await createPglite();
    await applyPostgresMigrations(pgliteMigrationClient(pglite));
    const dst = new Kysely<Database>({ dialect: new PGliteDialect({ pglite }) });
    try {
      const sqliteAuth = createAuth({ db: src.db, dialect: "sqlite", secret, baseUrl: base, rateLimit: false });
      const clinic = await createClinic(src.db, { name: "Copy Clinic (fictional)", slug: "copy-clinic", ownerEmail: "owner@copy.example", appOrigin: base.url });
      const jar = new CookieJar();
      jar.absorb((await sqliteAuth.api.signUpEmail({ body: { email: "owner@copy.example", password, name: "Owner" }, returnHeaders: true })).headers);
      jar.absorb((await sqliteAuth.api.acceptInvitation({ body: { invitationId: clinic.invitationId }, headers: jar.headers(), returnHeaders: true })).headers);
      const enabled = (await sqliteAuth.api.enableTwoFactor({ body: { password }, headers: jar.headers() })) as { totpURI: string };
      const otp = parseOtpAuthUri(enabled.totpURI);
      await sqliteAuth.api.verifyTOTP({ body: { code: totp(otp) }, headers: jar.headers() });

      const result = await copyDatabase(sqliteSource(src.sqlite), pgliteMigrationClient(pglite));
      for (const table of ["user", "account", "twoFactor", "organization", "member", "invitation"]) {
        assert.ok((result.tables.find((t) => t.table === table)?.rows ?? 0) > 0, `${table} copied`);
      }
      const pgAuth = createAuth({ db: dst, dialect: "postgres", secret, baseUrl: base, rateLimit: false });
      const signIn = new CookieJar();
      const res = await pgAuth.api.signInEmail({ body: { email: "owner@copy.example", password }, returnHeaders: true });
      signIn.absorb(res.headers);
      assert.equal((res.response as { twoFactorRedirect?: boolean }).twoFactorRedirect, true);
      signIn.absorb((await pgAuth.api.verifyTOTP({ body: { code: totp(otp) }, headers: signIn.headers(), returnHeaders: true })).headers);
      const session = await pgAuth.api.getSession({ headers: signIn.headers() });
      assert.equal(session?.user.twoFactorEnabled, true);
      assert.equal((session?.session as { activeOrganizationId?: string }).activeOrganizationId, clinic.organizationId);
    } finally {
      setEmailProviderForTests(null);
      await src.close();
      await dst.destroy();
    }
  });
});
