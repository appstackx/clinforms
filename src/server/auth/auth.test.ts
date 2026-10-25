/**
 * Identity flows on node:sqlite and PGlite (Postgres), plus the generated migration 0002 is complete: Better
 * Auth finds nothing left to create on either dialect. The D1 runs are in workers/data-gateway/test.
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { getMigrations } from "better-auth/db/migration";
import { getAuthTables } from "better-auth/db";
import { createPgliteTestDb, createSqliteTestDb, type TestDb } from "../db/testing/databases";
import { setEmailProviderForTests, type EmailMessage } from "../email";
import { createAuth } from "./create-auth";
import { listPendingInvitations } from "./membership";
import { AUTH_DATE_COLUMNS } from "./pg-dates";
import { createClinic } from "./platform";
import { defineAuthSuite } from "./testing/auth-suite";
import { CookieJar } from "./testing/cookie-jar";
import { parseOtpAuthUri, totp } from "./testing/totp";

const SECRET = "auth-test-secret-".padEnd(48, "t");
const BASE = { kind: "static" as const, url: "http://localhost:3000" };

describe("migration 0002 is exactly what Better Auth needs", () => {
  it("SQLite: no table or column left to create", async () => {
    const t = createSqliteTestDb();
    const auth = createAuth({ db: t.db, dialect: "sqlite", secret: SECRET, baseUrl: BASE });
    const plan = await getMigrations(auth.options);
    assert.deepEqual(plan.toBeCreated.map((x) => x.table), []);
    assert.deepEqual(plan.toBeAdded.map((x) => x.table), []);
    assert.deepEqual(plan.schemaProblems, []);
    await t.close();
  });
  it("Postgres: no table or column left to create", async () => {
    const t = await createPgliteTestDb();
    const auth = createAuth({ db: t.db, dialect: "postgres", secret: SECRET, baseUrl: BASE });
    const plan = await getMigrations(auth.options);
    assert.deepEqual(plan.toBeCreated.map((x) => x.table), []);
    assert.deepEqual(plan.toBeAdded.map((x) => x.table), []);
    assert.deepEqual(plan.schemaProblems, []);
    await t.close();
  });
  it("the Postgres date plugin knows every date column of Better Auth's tables", () => {
    const t = createSqliteTestDb();
    const auth = createAuth({ db: t.db, dialect: "sqlite", secret: SECRET, baseUrl: BASE });
    const dates = new Set<string>();
    for (const table of Object.values(getAuthTables(auth.options))) {
      for (const [key, field] of Object.entries(table.fields)) if (field.type === "date") dates.add(field.fieldName ?? key);
    }
    assert.deepEqual(Array.from(dates).sort(), Array.from(AUTH_DATE_COLUMNS).sort());
    void t.close();
  });
});

defineAuthSuite("SQLite (node:sqlite)", async () => {
  const t = createSqliteTestDb();
  return { db: t.db, dialect: "sqlite", close: t.close };
});

defineAuthSuite("Postgres (PGlite, production type parsers)", async () => {
  const t = await createPgliteTestDb();
  return { db: t.db, dialect: "postgres", close: t.close };
});

/**
 * Test run 24/10/2026: an invitation sent at 19:10 BST, the day before the clocks went back, said "expires 31 October
 * 2026 at 18:10 (UK time)". Every invitation now expires at the same UK clock time a week later – the owner's (the
 * platform's createClinic) and a member's (Better Auth, through the beforeCreateInvitation hook) – and the emails say so.
 * The clock is held at the sending time for the whole flow, so sessions and codes stay consistent.
 */
async function invitationExpiryAcrossTheClockChange(open: () => Promise<TestDb>, dialect: "sqlite" | "postgres"): Promise<void> {
  const PASSWORD = "correct horse battery staple";
  const t = await open();
  const sent: EmailMessage[] = [];
  setEmailProviderForTests({
    name: "none",
    async send(message) {
      sent.push(message);
      return { status: "not_sent", provider: "none" };
    },
  });
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-24T18:10:00.000Z") }); // 19:10 BST
  try {
    const auth = createAuth({ db: t.db, dialect, secret: SECRET, baseUrl: BASE, rateLimit: false });
    const clinic = await createClinic(t.db, { name: "Larch Physio (fictional)", slug: "larch-test", ownerEmail: "owner@larch.example", appOrigin: BASE.url, linkSecret: SECRET });
    assert.equal(clinic.invitationExpiresAt, "2026-10-31T19:10:00.000Z");
    assert.match(sent.at(-1)?.text ?? "", /expires on 31 October 2026 at 19:10 \(UK time\)/);

    const jar = new CookieJar();
    jar.absorb((await auth.api.signUpEmail({ body: { email: "owner@larch.example", password: PASSWORD, name: "Lee Owner" }, returnHeaders: true })).headers);
    jar.absorb((await auth.api.acceptInvitation({ body: { invitationId: clinic.invitationId }, headers: jar.headers(), returnHeaders: true })).headers);
    const setup = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: jar.headers() });
    assert.ok(setup.method === "totp");
    const otp = parseOtpAuthUri(setup.totpURI);
    jar.absorb((await auth.api.verifyTOTP({ body: { code: totp(otp) }, headers: jar.headers(), returnHeaders: true })).headers);

    const invitation = await auth.api.createInvitation({ body: { email: "physio@larch.example", role: "clinician" }, headers: jar.headers() });
    assert.equal(new Date(invitation.expiresAt).toISOString(), "2026-10-31T19:10:00.000Z");
    const pending = await listPendingInvitations(t.db, clinic.organizationId);
    assert.deepEqual(
      pending.map((p) => [p.email, new Date(p.expiresAt).toISOString()]),
      [["physio@larch.example", "2026-10-31T19:10:00.000Z"]],
      "Settings → Members shows the stored expiry",
    );
    const email = sent.at(-1);
    assert.equal(email?.kind, "invitation");
    assert.match(email?.text ?? "", /expires on 31 October 2026 at 19:10 \(UK time\)/);
  } finally {
    mock.timers.reset();
    setEmailProviderForTests(null);
    await t.close();
  }
}

describe("invitations expire at the same UK clock time a week later, across the clocks change", () => {
  it("SQLite", () => invitationExpiryAcrossTheClockChange(async () => createSqliteTestDb(), "sqlite"));
  it("Postgres (PGlite)", () => invitationExpiryAcrossTheClockChange(createPgliteTestDb, "postgres"));
});
