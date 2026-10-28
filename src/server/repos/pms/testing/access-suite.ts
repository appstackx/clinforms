/**
 * TESTS ONLY: configurable access (migration 0103) – repositories (src/server/repos/pms/access.ts) and the shared
 * read (src/server/pms/access.ts) – run unchanged on node:sqlite and PGlite (../access-repos.test.ts) and on D1
 * through the gateway (workers/data-gateway/test/pms-access-stack.test.ts). Two clinics throughout. Covers: role
 * overrides and member exceptions in the right order, the locks refused AND audited, locks winning even over rows
 * written past the repository, reception never reaching clinical content whatever is stored, site scope (works at ∪
 * can see) for patients and the diary's patient search, revisions, history without patient data, the tenant guard.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../db/schema";
import { testCipher } from "../../../db/testing/databases";
import { resolveMemberAccess } from "../../../pms/access";
import { amendNoteFor, getNoteFor, listNotesFor, saveNoteFor, startNoteFor, unsignedNotesFor } from "../../../pms/records/notes-service";
import { outcomesFor } from "../../../pms/records/outcomes-service";
import { listFilesFor } from "../../../pms/records/attachments-service";
import { getPatientDetails, searchPatientsFor } from "../../../pms/records/patients-service";
import { getCaseDetails } from "../../../pms/records/cases-service";
import type { RecordsActor } from "../../../pms/records/access";
import { listAudit } from "../../audit";
import { RepoInputError, type RepoContext } from "../../context";
import { getMemberAccess, listAccessChanges, listMemberAccess, listRoleOverrides, saveMemberAccess, saveRolePermissions, setMemberActive } from "../access";
import { createCase } from "../cases";
import { createPractitioner, createService, createSite } from "../directory";
import { bookAppointment } from "../diary/appointments";
import { createPatient, searchPatients } from "../patients";
import type { QueryLog } from "./guarded-db";
import { unscopedStatements } from "./guarded-db";

export interface AccessSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-a";
const B = "harbour-b";
const OWNER = { userId: "user_owner_helen", sessionId: "sess_owner" };
const OTHER = { userId: "user_other_b", sessionId: "sess_b" };
const JESS = "user_reception_jess";
const PRIYA = "user_clinician_priya";

export function defineAccessSuite(label: string, factory: () => Promise<AccessSuiteDb>): void {
  describe(`configurable access on ${label}`, () => {
    let suite: AccessSuiteDb;
    let ctx: RepoContext;
    let clock = Date.parse("2026-10-26T08:00:00.000Z");
    const ids: Record<string, string> = {};

    /** A records actor from the REAL effective read (as the app's actor builds it). */
    async function actorOf(role: string, userId: string, tenantId = A): Promise<RecordsActor> {
      const access = await resolveMemberAccess(ctx, tenantId, userId, role);
      return { tenantId, userId, name: userId, email: `${userId}@example.com`, role, can: access.can, siteIds: access.siteIds, actor: { userId, sessionId: `sess_${userId}` }, repo: () => ctx };
    }

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => new Date((clock += 1000)) };
      ids.harbour = (await createSite(ctx, A, { name: "Harbour Road (fictional)" }, OWNER)).id;
      ids.kingsmead = (await createSite(ctx, A, { name: "Kingsmead (fictional)" }, OWNER)).id;
      ids.elm = (await createSite(ctx, A, { name: "Elm Park (fictional)" }, OWNER)).id;
      ids.otherSite = (await createSite(ctx, B, { name: "Other clinic site (fictional)" }, OTHER)).id;
      ids.megan = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", importRef: "sim-pat-001" }, OWNER)).id;
      ids.daniel = (await createPatient(ctx, A, { firstName: "Daniel", lastName: "Hartley" }, OWNER)).id;
      ids.amir = (await createPatient(ctx, A, { firstName: "Amir", lastName: "Hartwell" }, OWNER)).id;
      ids.nadia = (await createPatient(ctx, A, { firstName: "Nadia", lastName: "Harte" }, OWNER)).id;
      // Megan: a case at Harbour Road. Daniel: a case at Elm Park. Amir: an appointment at Kingsmead. Nadia: nothing yet.
      ids.meganCase = (await createCase(ctx, A, { patientId: ids.megan, title: "Neck", openedOn: "2026-10-01", siteId: ids.harbour, referralReason: "Whiplash after a collision (fictional)" }, OWNER)).id;
      await createCase(ctx, A, { patientId: ids.daniel, title: "Knee", openedOn: "2026-10-01", siteId: ids.elm }, OWNER);
      const svc = (await createService(ctx, A, { name: "Follow-up", durationMinutes: 30 }, OWNER)).id;
      const prac = (await createPractitioner(ctx, A, { displayName: "Priya Shah (fictional)", registrationNumber: "PH-DEMO-01", userId: PRIYA }, OWNER)).id;
      const booked = await bookAppointment(ctx, A, { patientId: ids.amir, serviceId: svc, practitionerId: prac, siteId: ids.kingsmead, date: "2026-11-02", startTime: "09:00" }, OWNER);
      assert.ok(booked.ok);
    });
    after(async () => {
      await suite?.close();
    });

    it("defaults: nothing stored = the role's defaults, every site, active", async () => {
      const jess = await resolveMemberAccess(ctx, A, JESS, "staff");
      assert.equal(jess.active, true);
      assert.equal(jess.siteIds, null);
      assert.equal(jess.can("billing.refund"), false);
      assert.equal(jess.can("diary.rota"), true);
      assert.equal(jess.can("clinical.view"), false);
      assert.deepEqual(await getMemberAccess(ctx, A, JESS), { userId: JESS, active: true, allSites: true, sites: [], exceptions: {}, rev: 0, updatedAt: null, updatedBy: null });
      assert.deepEqual(await listRoleOverrides(ctx, A), []);
    });

    it("role grid: overrides apply to everyone with the role, back-to-default drops the row; history and audit", async () => {
      const r = await saveRolePermissions(ctx, A, [
        { role: "staff", permission: "billing.refund", allowed: true },
        { role: "clinician", permission: "reports.own", allowed: true }, // already the default: nothing to save
        { role: "admin", permission: "reports.export", allowed: true },
      ], OWNER);
      assert.deepEqual(r, { ok: true, changed: 2, rev: 0 });
      assert.deepEqual((await listRoleOverrides(ctx, A)).map((o) => `${o.role}:${o.permission}:${o.allowed}`), ["admin:reports.export:true", "staff:billing.refund:true"]);
      assert.equal((await resolveMemberAccess(ctx, A, JESS, "staff")).can("billing.refund"), true);
      assert.equal((await resolveMemberAccess(ctx, A, "user_admin_x", "admin")).can("patients.export"), true, "the old id follows its permission");
      assert.equal((await resolveMemberAccess(ctx, B, "user_b", "staff")).can("billing.refund"), false, "another clinic keeps the defaults");
      // Back to the default: the row goes.
      assert.equal((await saveRolePermissions(ctx, A, [{ role: "admin", permission: "reports.export", allowed: false }], OWNER)).ok, true);
      assert.deepEqual((await listRoleOverrides(ctx, A)).map((o) => o.permission), ["billing.refund"]);
      const history = await listAccessChanges(ctx, A, { kind: "role" });
      assert.equal(history.length, 2);
      assert.deepEqual(history[0].items, [{ type: "role_permission", role: "admin", permission: "reports.export", from: true, to: false }]);
      assert.equal(history[0].byUserId, OWNER.userId);
      const audit = await listAudit(ctx, A, { action: "pms.access.roles_update" });
      assert.equal(audit.length, 2);
      assert.deepEqual(await listAccessChanges(ctx, B), [], "nothing in another clinic");
    });

    it("locked cells: the whole request is refused, nothing is stored, the refusal is audited", async () => {
      const before = await listRoleOverrides(ctx, A);
      for (const cell of [
        { role: "staff", permission: "clinical.view", allowed: true },
        { role: "staff", permission: "messages.letters", allowed: true },
        { role: "owner", permission: "billing.void", allowed: false },
        { role: "admin", permission: "settings.owner", allowed: true },
      ] as const) {
        const r = await saveRolePermissions(ctx, A, [{ role: "staff", permission: "billing.void", allowed: true }, cell], OWNER);
        assert.equal(r.ok, false, `${cell.role}:${cell.permission}`);
        assert.equal(!r.ok && r.reason, "locked");
      }
      assert.deepEqual(await listRoleOverrides(ctx, A), before, "not even the unlocked cell of the same request");
      const refused = await listAudit(ctx, A, { action: "pms.access.refused" });
      assert.equal(refused.length, 4);
      assert.deepEqual(refused.map((e) => e.targetType), ["pms_access", "pms_access", "pms_access", "pms_access"]);
      await assert.rejects(saveRolePermissions(ctx, A, [{ role: "staff", permission: "no.such" as never, allowed: true }], OWNER), RepoInputError);
    });

    it("member exceptions: added and removed for one person, relative to the clinic's role; revisions", async () => {
      const r = await saveMemberAccess(
        ctx,
        A,
        JESS,
        "staff",
        { exceptions: { "diary.override": true, "billing.refund": false, "diary.book": true }, allSites: false, sites: [{ siteId: ids.harbour, worksAt: true, canSee: false }, { siteId: ids.kingsmead, worksAt: false, canSee: true }] },
        0,
        OWNER,
      );
      assert.deepEqual(r, { ok: true, changed: 3, rev: 1 });
      const stored = await getMemberAccess(ctx, A, JESS);
      assert.deepEqual(stored.exceptions, { "billing.refund": false, "diary.override": true }, "equal-to-role ones are dropped");
      assert.deepEqual(stored.sites.map((s) => [s.siteId === ids.harbour ? "harbour" : "kingsmead", s.worksAt, s.canSee]).sort(), [["harbour", true, true], ["kingsmead", false, true]], "works at ⇒ can see");
      const jess = await resolveMemberAccess(ctx, A, JESS, "staff");
      assert.deepEqual([jess.can("diary.override"), jess.can("billing.refund"), jess.can("billing.pay")], [true, false, true], "exception → role override → default");
      // A stale form is refused; the current one saves.
      const stale = await saveMemberAccess(ctx, A, JESS, "staff", { exceptions: {}, allSites: true, sites: [] }, 0, OWNER);
      assert.deepEqual(stale, { ok: false, reason: "conflict", currentRev: 1 });
      const history = await listAccessChanges(ctx, A, { subjectUserId: JESS });
      assert.equal(history.length, 1);
      assert.deepEqual(history[0].items.map((i) => i.type).sort(), ["exception", "exception", "sites"]);
      assert.ok(!JSON.stringify(history).includes("Megan"), "no patient data");
      assert.equal(await getMemberAccess(ctx, B, JESS).then((m) => m.rev), 0, "another clinic: nothing stored");
      await assert.rejects(
        saveMemberAccess(ctx, A, PRIYA, "clinician", { exceptions: {}, allSites: false, sites: [{ siteId: ids.otherSite, worksAt: true, canSee: true }] }, 0, OWNER),
        (err: unknown) => err instanceof RepoInputError && /site does not exist/.test(err.message),
        "another clinic's site is refused",
      );
      assert.equal((await getMemberAccess(ctx, A, PRIYA)).rev, 0, "nothing of the refused batch was written");
    });

    it("reception can never get clinical rights: refused, audited – and stored rows cannot grant them either", async () => {
      const auditBefore = (await listAudit(ctx, A, { action: "pms.access.refused" })).length;
      const accessBefore = await getMemberAccess(ctx, A, JESS);
      const r = await saveMemberAccess(ctx, A, JESS, "staff", { exceptions: { "clinical.view": true, "clinical.write": true, "clinical.amend": true, "messages.letters": true }, allSites: true, sites: [] }, accessBefore.rev, OWNER);
      assert.equal(!r.ok && r.reason, "locked");
      assert.deepEqual(!r.ok && r.reason === "locked" && r.locked.sort(), ["clinical.amend", "clinical.view", "clinical.write", "messages.letters"]);
      assert.deepEqual(await getMemberAccess(ctx, A, JESS), accessBefore, "nothing changed");
      assert.equal((await listAudit(ctx, A, { action: "pms.access.refused" })).length, auditBefore + 1);
      // Rows written past the repository (a bad import, a hand edit) still cannot unlock anything.
      const at = new Date(clock).toISOString();
      for (const permission of ["clinical.view", "clinical.write", "clinical.amend", "messages.letters"]) {
        await suite.db.insertInto("pms_member_permissions").values({ tenant_id: A, user_id: JESS, permission, allowed: 1, updated_by: null, updated_at: at }).execute();
        await suite.db.insertInto("pms_role_permissions").values({ tenant_id: A, role: "staff", permission, allowed: 1, updated_by: null, updated_at: at }).execute();
      }
      const jess = await actorOf("staff", JESS);
      for (const p of ["clinical.view", "clinical.write", "clinical.amend", "messages.letters", "clinical.edit", "clinical.sign"] as const) assert.equal(jess.can(p), false, p);
      // A clinician writes a note; every clinical service refuses reception before reading anything.
      const priya = await actorOf("clinician", PRIYA);
      const draft = await startNoteFor(priya, ids.megan, { templateId: "builtin-follow-up-soap", seenOn: "2026-10-23" });
      assert.ok(draft.ok);
      const noteId = draft.ok ? draft.value.id : "";
      assert.ok((await saveNoteFor(priya, ids.megan, noteId, { expectedRev: 1, sections: { objective: "Neck rotation reduced (fictional)" }, sign: true })).ok);
      const auditCount = (await listAudit(ctx, A, { limit: 500 })).length;
      for (const [what, call] of [
        ["list notes", () => listNotesFor(jess, ids.megan)],
        ["read note", () => getNoteFor(jess, ids.megan, noteId)],
        ["start note", () => startNoteFor(jess, ids.megan, { templateId: "builtin-follow-up-soap", seenOn: "2026-10-24" })],
        ["amend", () => amendNoteFor(jess, ids.megan, noteId, { kind: "addendum", text: "reception text" })],
        ["unsigned", () => unsignedNotesFor(jess)],
        ["outcomes", () => outcomesFor(jess, ids.megan)],
        ["files", () => listFilesFor(jess, ids.megan)],
      ] as const) {
        const res = await call();
        assert.equal(res.ok, false, what);
        assert.equal(!res.ok && res.code, "forbidden", what);
      }
      assert.equal((await listAudit(ctx, A, { limit: 500 })).length, auditCount, "refusals read and write nothing");
      // Clean up the rows written past the repository (they never had any effect).
      for (const t of ["pms_member_permissions", "pms_role_permissions"] as const) {
        await suite.db.deleteFrom(t).where("tenant_id", "=", A).where("permission", "in", ["clinical.view", "clinical.write", "clinical.amend", "messages.letters"]).execute();
      }
    });

    it("amending: a clinician only their own signed notes; the owner anyone's", async () => {
      const priya = await actorOf("clinician", PRIYA);
      const tom = await actorOf("clinician", "user_clinician_tom");
      const owner = await actorOf("owner", OWNER.userId);
      const notes = await listNotesFor(priya, ids.megan);
      const signed = notes.ok ? notes.value.find((n) => n.status === "signed") : undefined;
      assert.ok(signed);
      assert.equal((await amendNoteFor(tom, ids.megan, signed.id, { kind: "addendum", text: "Not mine (fictional)" })).ok, false);
      assert.equal((await amendNoteFor(priya, ids.megan, signed.id, { kind: "addendum", text: "Own addendum (fictional)" })).ok, true);
      assert.equal((await amendNoteFor(owner, ids.megan, signed.id, { kind: "addendum", text: "Owner addendum (fictional)" })).ok, true);
    });

    it("referral reason: shown with 'See referral reason and case notes', hidden without it", async () => {
      const owner = await actorOf("owner", OWNER.userId);
      const withIt = await getCaseDetails(owner, ids.megan, ids.meganCase);
      assert.equal(withIt.ok && withIt.value.case.referralReason, "Whiplash after a collision (fictional)");
      await saveRolePermissions(ctx, A, [{ role: "staff", permission: "patients.referral", allowed: false }], OWNER);
      const reception = await actorOf("staff", "user_reception_other");
      const without = await getCaseDetails(reception, ids.megan, ids.meganCase);
      assert.equal(without.ok && without.value.case.referralReason, null);
      await saveRolePermissions(ctx, A, [{ role: "staff", permission: "patients.referral", allowed: true }], OWNER);
    });

    it("site scope: works at ∪ can see; patients by their cases and appointments; unlinked patients for everyone", async () => {
      const jess = await actorOf("staff", JESS); // works at Harbour Road, can see Kingsmead
      assert.deepEqual(Array.from(jess.siteIds ?? []).sort(), [ids.harbour, ids.kingsmead].sort());
      const found = await searchPatientsFor(jess, { q: "Har" });
      const names = found.ok ? found.value.map((p) => p.firstName).sort() : [];
      assert.deepEqual(names, ["Amir", "Megan", "Nadia"], "Daniel is only seen at Elm Park");
      assert.equal((await getPatientDetails(jess, ids.daniel)).ok, false, "outside the scope answers like 'no such patient'");
      assert.equal(!(await getPatientDetails(jess, ids.daniel)).ok && (await getPatientDetails(jess, ids.daniel) as { code: string }).code, "not_found");
      assert.equal((await getPatientDetails(jess, ids.amir)).ok, true, "an appointment at Kingsmead");
      const all = await searchPatients(ctx, A, { q: "Har", siteIds: null });
      assert.equal(all.length, 4, "no scope = every patient");
      // An admin can be limited too; the owner never.
      await saveMemberAccess(ctx, A, "user_admin_lim", "admin", { exceptions: {}, allSites: false, sites: [{ siteId: ids.elm, worksAt: false, canSee: true }] }, 0, OWNER);
      const admin = await actorOf("admin", "user_admin_lim");
      const adminFound = await searchPatientsFor(admin, { q: "Har" });
      assert.deepEqual(adminFound.ok ? adminFound.value.map((p) => p.firstName).sort() : [], ["Daniel", "Nadia"]);
      await saveMemberAccess(ctx, A, OWNER.userId, "owner", { exceptions: {}, allSites: false, sites: [{ siteId: ids.elm, worksAt: true, canSee: true }] }, 0, OWNER);
      assert.equal((await actorOf("owner", OWNER.userId)).siteIds, null, "the owner always sees every site");
      // "Can see all sites" lifts the limit.
      const rev = (await getMemberAccess(ctx, A, JESS)).rev;
      const lifted = await saveMemberAccess(ctx, A, JESS, "staff", { exceptions: { "diary.override": true }, allSites: true, sites: [{ siteId: ids.harbour, worksAt: true, canSee: true }] }, rev, OWNER);
      assert.equal(lifted.ok, true, JSON.stringify(lifted));
      assert.equal((await actorOf("staff", JESS)).siteIds, null);
    });

    it("deactivate: no permissions at all, not even the clinic area; reactivate restores them", async () => {
      assert.deepEqual(await setMemberActive(ctx, A, PRIYA, "clinician", false, OWNER), { changed: true });
      const off = await resolveMemberAccess(ctx, A, PRIYA, "clinician");
      assert.deepEqual([off.active, off.permissions.size, off.can("clinic.view")], [false, 0, false]);
      assert.deepEqual(await setMemberActive(ctx, A, PRIYA, "clinician", false, OWNER), { changed: false });
      await setMemberActive(ctx, A, PRIYA, "clinician", true, OWNER);
      assert.equal((await resolveMemberAccess(ctx, A, PRIYA, "clinician")).can("clinical.write"), true);
      assert.equal((await listAudit(ctx, A, { action: "pms.access.member_deactivate" })).length, 1);
      assert.equal((await listMemberAccess(ctx, A)).length >= 3, true);
    });

    it("tenant-scope guard: every clinic-system statement named tenant_id", () => {
      if (!suite.log) return;
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
