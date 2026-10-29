/**
 * M10 security review – regression tests (one describe per finding; the finding's id leads its name). Each test
 * failed on feat/clinic-system 842bb02 before its fix. node:sqlite only (the service rules do not depend on the
 * database; the module suites run on every database).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { testCipher } from "../db/testing/databases";
import type { RepoContext } from "../repos/context";
import { createPatient } from "../repos/pms/patients";
import { setEntitlement } from "../repos/pms/entitlements";
import { listMessages, getMessage, recordSendOutcomes } from "../repos/pms/comms/messages";
import { ensurePortalAccount } from "../repos/pms/portal/accounts";
import { createGuardedSqliteDb, type GuardedDb } from "../repos/pms/testing/guarded-db";
import { HIDDEN_LINK, hasSecretLink, redactSecretLinks } from "../../modules/pms/comms/secret-links";
import { messageDetailFor, outboxFor, patientMessagesFor } from "./comms/views";
import { retryMessageFor } from "./comms/writes";
import { clearTestOutbox, testOutbox } from "./comms/providers/test";
import { sendSignInLink } from "./portal/portal-auth";
import { clinicalAccessFrom } from "./native-report-access";
import { TRIAL_ENDED_MESSAGE, referrerFormsFor, startReferrerFormFor, type ReferrerFormDeps } from "./integration/referrer-forms";
import { createCase } from "../repos/pms/cases";
import { createSite } from "../repos/pms/directory";
import { loadBookingOptions } from "./diary/reads";
import type { DiaryCaller } from "./diary/caller";
import { SITE_SCOPED_MESSAGE, listImportsFor, startImportFor } from "./integration/import-service";
import type { ClinicProfile } from "../../modules/medreport/api/deps";
import { saveRolePermissions } from "../repos/pms/access";
import { readOnlyReason, roleGridRefusal, saveRolesFor } from "./access-screens";
import { lockOf } from "../../modules/pms/core/permissions";
import { testActor, type RecordsActor, type Result } from "./records/access";

const A = "riverside-a";
const OWNER = { userId: "user_owner", sessionId: "sess_owner" };
const TOKEN_RUN = /[A-Za-z0-9_-]{43}/;

function value<T>(r: Result<T>): T {
  if (!r.ok) assert.fail(`expected ok, got ${r.code}: ${r.error}`);
  return r.value;
}

/** Runs `fn` with env values set, then puts them back. */
async function withEnv<T>(values: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  Object.assign(process.env, values);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("M10 security", () => {
  let g: GuardedDb;
  let ctx: RepoContext;
  let clock = Date.parse("2026-10-28T10:30:00.000Z");
  const now = () => new Date(clock++);
  const ids: Record<string, string> = {};
  let reception: RecordsActor;
  let owner: RecordsActor;

  before(async () => {
    g = createGuardedSqliteDb();
    ctx = { db: g.db, cipher: testCipher(), now };
    await setEntitlement(ctx, A, "clinic", { status: "trial" }, OWNER);
    ids.megan = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-22", email: "megan.hart@example.com", phoneMobile: "07700 900101" }, OWNER)).id;
    reception = testActor(ctx, A, "staff", { userId: "user_reception", name: "Jess Taylor (fictional)" });
    owner = testActor(ctx, A, "owner", { userId: "user_owner", name: "Helen Ward (fictional)" });
  });
  after(async () => {
    await g?.close();
  });

  describe("C1: no staff view returns a portal sign-in secret", () => {
    it("the provider gets the link; the message log, the outbox, the record and View never do; Retry is refused", async () => {
      clearTestOutbox();
      const account = await ensurePortalAccount(ctx, A, ids.megan, OWNER);
      const sent = await withEnv({ CLINIC_EMAIL_PROVIDER: "test" }, () => sendSignInLink(ctx, A, account.id, ids.megan, now(), 72 * 3_600_000, "https://clinic.example.com", OWNER, "/clinics/riverside-a/portal/forms/frm_1"));
      assert.equal(sent, true);
      const email = testOutbox.email.at(-1);
      const token = email ? /\/portal\/link\/([A-Za-z0-9_-]{43})/.exec(email.text)?.[1] : undefined;
      assert.ok(token, "the patient's email carries the link");
      assert.ok(email?.html.includes(token as string));

      const [summary] = await listMessages(ctx, A, { patientId: ids.megan, kind: "portal_link", limit: 5 });
      const stored = await getMessage(ctx, A, summary.id);
      assert.ok(stored && !stored.body.includes(token as string) && stored.body.includes(HIDDEN_LINK), "the stored copy hides the link");
      const raw = JSON.stringify(await g.db.selectFrom("pms_messages").selectAll().execute());
      assert.ok(!raw.includes(token as string), "not even encrypted: the secret is not in the table");

      for (const who of [reception, owner]) {
        const detail = JSON.stringify(value(await messageDetailFor(who, summary.id)));
        assert.ok(!TOKEN_RUN.test(detail.replace(/msg_[0-9A-Z]{26}|pat_[0-9A-Z]{26}/g, "")), `${who.name}: View has no 43-character token`);
        assert.ok(detail.includes(HIDDEN_LINK));
        assert.ok(!JSON.stringify(value(await outboxFor(who))).includes(token as string));
        assert.ok(!JSON.stringify(value(await patientMessagesFor(who, ids.megan))).includes(token as string));
      }

      // A failed sign-in email is not sent again (its stored copy has no link) and offers no Retry.
      await recordSendOutcomes(ctx, A, [{ id: summary.id, outcome: { status: "failed", errorCode: "test_bounced" } }], OWNER);
      const rows = value(await outboxFor(reception));
      assert.equal(rows.find((r) => r.messageId === summary.id)?.canRetry, false);
      const retry = await withEnv({ CLINIC_EMAIL_PROVIDER: "test" }, () => retryMessageFor(reception, summary.id));
      assert.equal(retry.ok, false);
    });

    it("copies written before the fix are hidden when shown", () => {
      const old = "Sign in: https://clinic.example.com/clinics/riverside-a/portal/link/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde?next=%2Fx\n--\nfooter";
      const shown = redactSecretLinks(old);
      assert.ok(!hasSecretLink(shown) && !TOKEN_RUN.test(shown) && shown.includes(HIDDEN_LINK) && shown.endsWith("footer"));
      assert.ok(!TOKEN_RUN.test(redactSecretLinks("Manage: /clinics/riverside-a/booking/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde")));
      assert.equal(redactSecretLinks("Stop emails: https://x.example/api/clinic-messages/unsubscribe?t=v1.a.b"), "Stop emails: https://x.example/api/clinic-messages/unsubscribe?t=v1.a.b", "other links unchanged");
    });
  });

  describe("H4: no self-escalation through the role grid", () => {
    const screen = (role: "owner" | "admin" | "clinician" | "staff", exceptions: Record<string, boolean> = {}) => {
      const a = testActor(ctx, A, role, { userId: `user_${role}_mgr`, name: `${role} (fictional)` }, { exceptions });
      return { ...a, role, organizationId: "org_a" };
    };
    it("'Manage members and permissions' is locked off for clinicians and reception, whatever the clinic grants", async () => {
      assert.deepEqual(lockOf("clinician", "settings.members")?.value, false);
      assert.deepEqual(lockOf("staff", "settings.members")?.value, false);
      assert.equal(lockOf("admin", "settings.members"), null);
      assert.equal(screen("clinician", { "settings.members": true }).can("settings.members"), false);
      const r = await saveRolePermissions(ctx, A, [{ role: "clinician", permission: "settings.members", allowed: true }], OWNER);
      assert.equal(r.ok, false, "the grid refuses the locked cell");
    });
    it("an administrator cannot change the administrators' row; the owner can; another role's row is fine", async () => {
      const admin = screen("admin");
      const own = await saveRolesFor(admin, [{ role: "admin", permission: "reports.export", allowed: true }]);
      assert.equal(own.ok, false);
      assert.equal(!own.ok && own.code, "forbidden");
      assert.equal(admin.can("reports.export"), false, "unchanged");
      assert.equal((await saveRolesFor(admin, [{ role: "clinician", permission: "reports.export", allowed: true }])).ok, true);
      assert.equal((await saveRolesFor(screen("owner"), [{ role: "admin", permission: "reports.export", allowed: true }])).ok, true);
      assert.equal(roleGridRefusal({ role: "clinician" }, [{ role: "admin" }]) !== null, true, "a non-admin manager never changes administrators");
    });
    it("a manager who is not an administrator cannot edit an administrator's own access", () => {
      const adminMember = { memberId: "m1", userId: "user_x", name: "X", email: "x@example.com", role: "admin" as const, twoStep: true };
      assert.notEqual(readOnlyReason({ userId: "user_c", role: "clinician" }, adminMember), null);
      assert.equal(readOnlyReason({ userId: "user_a", role: "admin" }, adminMember), null);
      assert.equal(readOnlyReason({ userId: "user_o", role: "owner" }, adminMember), null);
    });
  });

  describe("M1: the native launch keeps ClinForms' trial-ended rule", () => {
    it("trial ended → no button (with the reason) and no launch, nothing written; trial running → as before", async () => {
      const kase = await createCase(ctx, A, { patientId: ids.megan, title: "Neck pain (fictional)", openedOn: "2026-10-01" }, OWNER);
      const ended: ReferrerFormDeps = { packageOn: async () => true, clinicProfile: async () => ({ trial: { state: "ended" } }) as unknown as ClinicProfile };
      const running: ReferrerFormDeps = { packageOn: async () => true, clinicProfile: async () => ({ trial: { state: "active" } }) as unknown as ClinicProfile };
      const clin = testActor(ctx, A, "clinician", { userId: "user_clin", name: "Sarah Reid (fictional)" });
      const panel = await referrerFormsFor(clin, ids.megan, kase.id, ended);
      assert.ok(panel.ok);
      assert.deepEqual(panel.ok && [panel.value.canStart, panel.value.cannotStartReason], [false, TRIAL_ENDED_MESSAGE]);
      const start = await startReferrerFormFor(clin, { patientId: ids.megan, caseId: kase.id, formId: "frm_any", consentRecorded: true }, ended);
      assert.deepEqual(start, { ok: false, code: "forbidden", error: TRIAL_ENDED_MESSAGE });
      assert.equal((await g.db.selectFrom("pms_form_requests").select("id").where("tenant_id", "=", A).execute()).length, 0, "no request recorded");
      const open = await referrerFormsFor(clin, ids.megan, kase.id, running);
      assert.ok(open.ok && open.value.canStart && open.value.cannotStartReason === null);
      const notBlocked = await startReferrerFormFor(clin, { patientId: ids.megan, caseId: kase.id, formId: "frm_any", consentRecorded: true }, running);
      assert.equal(!notBlocked.ok && notBlocked.code, "invalid", "goes on to the form check");
    });
  });

  describe("L2: the booking form's options respect the member's sites", () => {
    it("a patient outside the sites gives nothing; cases at other sites are left out", async () => {
      const siteA = (await createSite(ctx, A, { name: "Bletchley (fictional)" }, OWNER)).id;
      const siteB = (await createSite(ctx, A, { name: "Towcester (fictional)" }, OWNER)).id;
      const onlyB = (await createPatient(ctx, A, { firstName: "Ola", lastName: "Bee", dateOfBirth: "1980-02-02" }, OWNER)).id;
      const both = (await createPatient(ctx, A, { firstName: "Abe", lastName: "Both", dateOfBirth: "1981-03-03" }, OWNER)).id;
      await createCase(ctx, A, { patientId: onlyB, title: "B only (fictional)", openedOn: "2026-10-01", siteId: siteB }, OWNER);
      const atA = await createCase(ctx, A, { patientId: both, title: "At A (fictional)", openedOn: "2026-10-01", siteId: siteA }, OWNER);
      await createCase(ctx, A, { patientId: both, title: "At B (fictional)", openedOn: "2026-10-01", siteId: siteB }, OWNER);
      const reception = testActor(ctx, A, "staff", { userId: "user_rec_a", name: "Jess (fictional)" });
      const scoped: DiaryCaller = { tenantId: A, actor: reception.actor, can: reception.can, ctx, siteIds: new Set([siteA]) };
      const everywhere: DiaryCaller = { ...scoped, siteIds: null };
      const hidden = await loadBookingOptions(scoped, onlyB);
      assert.deepEqual(hidden.ok && hidden.data, { cases: [], authorisations: [] });
      const mine = await loadBookingOptions(scoped, both);
      assert.deepEqual(mine.ok && mine.data.cases.map((c) => c.id), [atA.id]);
      const all = await loadBookingOptions(everywhere, both);
      assert.equal(all.ok && all.data.cases.length, 2, "every site: both cases");
    });
  });

  describe("M2: imports only for members who see every site", () => {
    it("a site-limited member with settings.import is refused by every import function", async () => {
      const admin = testActor(ctx, A, "admin", { userId: "user_admin_imp", name: "Admin (fictional)" }, { siteIds: ["site_x"] });
      const r = await listImportsFor(admin);
      assert.deepEqual(r, { ok: false, code: "forbidden", error: SITE_SCOPED_MESSAGE });
      assert.equal((await startImportFor(admin, { kind: "patients", fileName: "p.csv" } as never)).ok, false);
      const full = testActor(ctx, A, "admin", { userId: "user_admin_imp2", name: "Admin (fictional)" });
      assert.equal((await listImportsFor(full)).ok, true);
    });
  });

  describe("H2: the host's rule reads the member's clinic-system access", () => {
    it("clinician yes; reception no; a clinician whose clinical.view the clinic switched off no", async () => {
      const read = clinicalAccessFrom(() => ({ db: g.db }));
      assert.equal(await read(A, "user_clin", "clinician"), true);
      assert.equal(await read(A, "user_rec", "staff"), false);
      assert.equal((await saveRolePermissions(ctx, A, [{ role: "clinician", permission: "clinical.view", allowed: false }], OWNER)).ok, true);
      assert.equal(await read(A, "user_clin", "clinician"), false);
      assert.equal((await saveRolePermissions(ctx, A, [{ role: "clinician", permission: "clinical.view", allowed: true }], OWNER)).ok, true);
    });
  });
});
