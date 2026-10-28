/**
 * The portal module's M9b staff services on node:sqlite and PGlite (guarded – every statement names tenant_id):
 * "Share with the patient" from the record's attachments (PORTAL-004), a form completed in the clinic on a clinic
 * device and verified by staff with their password (FORM-007), and the sealed copy's PDF with the screen's
 * visibility rules. Permissions per role; who and when recorded; the audit rows.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { testCipher } from "../../db/testing/databases";
import { listAudit } from "../../repos/audit";
import type { RepoContext } from "../../repos/context";
import { createPatient, getPatient } from "../../repos/pms/patients";
import { getIntakeResponse, createIntakeTemplate, requestIntakeForm } from "../../repos/pms/portal/intake";
import { getBookingSettings, updateBookingSettings } from "../../repos/pms/portal/settings";
import { putAttachment } from "../../repos/pms/records/attachments";
import { createGuardedPgliteDb, createGuardedSqliteDb, unscopedStatements, type GuardedDb } from "../../repos/pms/testing/guarded-db";
import { STARTER_FORMS } from "../../../modules/pms/portal/starters";
import type { ClinicActor } from "../actor";
import { testActor } from "../records/access";
import { endHandoffFor, handoffStaffViewFor, startHandoffFor, verifyHandoffFor, type PasswordCheck } from "./clinic-device";
import { deviceState, submitOnDevice } from "./device-flow";
import { signedCopyPdfFor, signedVia } from "./signed-copy";
import { patientResponseFor } from "./staff";
import { attachmentSharesFor, shareAttachmentFor, withdrawShareFor } from "./staff-shares";
import type { PmsRole } from "../../../modules/pms/core/permissions";

const A = "riverside-polish";
const B = "harbour-polish";

function suite(label: string, factory: () => Promise<GuardedDb>) {
  describe(`portal staff services (M9b) on ${label}`, () => {
    let g: GuardedDb;
    let ctx: RepoContext;
    let clock = Date.parse("2026-11-03T10:00:00.000Z");
    const now = () => new Date(clock++);
    const ids: Record<string, string> = {};
    const actor = (role: PmsRole, userId: string, name: string, tenantId = A): ClinicActor =>
      ({ ...testActor(ctx, tenantId, role, { userId, name }), organizationId: `org_${tenantId}`, clinicName: "Riverside Physiotherapy (fictional)", sessionId: `sess_${userId}`, permissions: [] }) as unknown as ClinicActor;
    let clinician: ClinicActor;
    let reception: ClinicActor;
    let admin: ClinicActor;
    let otherClinic: ClinicActor;
    const passwordOk: PasswordCheck = async () => "ok";
    const passwordWrong: PasswordCheck = async () => "wrong";

    before(async () => {
      g = await factory();
      ctx = { db: g.db, cipher: testCipher(), now };
      const at = new Date(clock).toISOString();
      for (const [slug, name] of [
        [A, "Riverside Physiotherapy (fictional)"],
        [B, "Harbour Clinic (fictional)"],
      ]) {
        await ctx.db.insertInto("organization").values({ id: `org_${slug}`, name, slug, logo: null, createdAt: at, metadata: null }).execute();
      }
      for (const [id, name, role] of [
        ["user_clin_01", "Priya Shah", "clinician"],
        ["user_rec_01", "Jess Taylor", "staff"],
        ["user_adm_01", "Alex Admin", "admin"],
      ]) {
        await ctx.db.insertInto("user").values({ id, name, email: `${id}@example.com`, emailVerified: true, image: null, createdAt: at, updatedAt: at, twoFactorEnabled: true }).execute();
        await ctx.db.insertInto("member").values({ id: `mem_${id}`, organizationId: `org_${A}`, userId: id, role, createdAt: at }).execute();
      }
      clinician = actor("clinician", "user_clin_01", "Priya Shah");
      reception = actor("staff", "user_rec_01", "Jess Taylor");
      admin = actor("admin", "user_adm_01", "Alex Admin");
      otherClinic = actor("clinician", "user_clin_b", "Other Clinic", B);
      const s = await getBookingSettings(ctx, A);
      await updateBookingSettings(ctx, A, s.rev, { portal: true, onlineBooking: true }, clinician.actor);
      ids.pat = (await createPatient(ctx, A, { firstName: "Robin", lastName: "Fixture", dateOfBirth: "1979-06-01", email: "robin.fixture@example.com" }, clinician.actor)).id;
      ids.patB = (await createPatient(ctx, B, { firstName: "Robin", lastName: "Other", dateOfBirth: "1979-06-01" }, otherClinic.actor)).id;
      const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("fictional letter ".repeat(30))]);
      ids.file = (await putAttachment(ctx, A, { patientId: ids.pat, bytes: pdf, fileName: "Robin Fixture letter.pdf" }, clinician.actor)).id;
      for (const st of STARTER_FORMS) ids[`form_${st.key}`] = (await createIntakeTemplate(ctx, A, { name: st.name, kind: st.kind, sendWhen: "manual", requiresSignature: st.requiresSignature, signatureStatement: st.signatureStatement, setsTreatmentConsent: st.setsTreatmentConsent, definition: st.definition }, clinician.actor)).id;
    });
    after(async () => g.close());

    it("Share with the patient: clinicians only (not reception, not without clinical.write); who and when; withdraw", async () => {
      assert.equal(await attachmentSharesFor(reception, ids.pat), null, "reception never sees attachments or their shares");
      assert.deepEqual(await shareAttachmentFor(reception, ids.pat, ids.file, { title: "Letter", notify: false }), { ok: false, error: "You do not have permission to do that." });
      const adminView = await attachmentSharesFor(admin, ids.pat);
      assert.equal(adminView?.canShare, false, "admins see attachments but do not add or share them by default");
      assert.equal((await shareAttachmentFor(admin, ids.pat, ids.file, { title: "Letter", notify: false })).ok, false);
      const r = await shareAttachmentFor(clinician, ids.pat, ids.file, { title: "Your letter", message: "As we discussed.", notify: false });
      assert.ok(r.ok, JSON.stringify(r));
      if (!r.ok) return;
      const view = await attachmentSharesFor(clinician, ids.pat);
      const rows = view?.byAttachment[ids.file] ?? [];
      assert.equal(rows.length, 1);
      assert.equal(rows[0].sharedBy, "Priya Shah");
      assert.match(rows[0].sharedAt, /\d{2}:\d{2}/);
      assert.equal((await shareAttachmentFor(otherClinic, ids.pat, ids.file, { title: "Cross", notify: false })).ok, false, "never another clinic's file");
      assert.equal((await withdrawShareFor(reception, ids.pat, r.value.shareId)).ok, false);
      assert.equal((await withdrawShareFor(clinician, ids.pat, r.value.shareId)).ok, true);
      assert.equal((await withdrawShareFor(clinician, ids.pat, r.value.shareId)).ok, false, "already withdrawn");
      assert.ok((await attachmentSharesFor(clinician, ids.pat))?.byAttachment[ids.file][0].withdrawnAt);
    });

    it("a form completed on a clinic device: only that copy, then staff verify with THEIR password", async () => {
      const copy = (await requestIntakeForm(ctx, A, { templateId: ids.form_consent, patientId: ids.pat }, reception.actor)).response;
      const started = await startHandoffFor(reception, ids.pat, copy.id);
      assert.ok(started.ok, JSON.stringify(started));
      if (!started.ok) return;
      assert.equal(started.value.path, `/clinics/${A}/device`);
      assert.equal(started.value.cookiePath, started.value.path, "the device's cookie is limited to the device page");
      const device = await deviceState(ctx, A, started.value.secret);
      assert.equal(device.state, "open");
      if (device.state !== "open") return;
      const form = new FormData();
      for (const k of ["consent_treatment", "consent_records", "cancellations"]) form.set(`q_${k}`, "on");
      form.set("q_share_gp", "no");
      form.set("signature", "Robin Fixture");
      assert.deepEqual(await submitOnDevice(ctx, A, started.value.secret, device.response.rev, form), { ok: true });
      const handoffId = device.handoff.id;
      assert.equal((await handoffStaffViewFor(otherClinic, handoffId)).ok, false, "another clinic cannot open it");
      assert.deepEqual(await verifyHandoffFor(reception, handoffId, "", passwordOk), { ok: false, error: "Enter your password to confirm." });
      assert.deepEqual(await verifyHandoffFor(reception, handoffId, "nope", passwordWrong), { ok: false, error: "That password is not right." });
      assert.equal((await getPatient(ctx, A, ids.pat))?.consentTreatment, false);
      const before = await patientResponseFor(reception, ids.pat, copy.id);
      assert.ok(before.ok && before.value.inClinic?.state === "completed" && /waiting for a member of staff/.test(before.value.inClinic.words));
      const v = await verifyHandoffFor(reception, handoffId, "the-right-one", passwordOk);
      assert.ok(v.ok, JSON.stringify(v));
      assert.equal((await verifyHandoffFor(reception, handoffId, "the-right-one", passwordOk)).ok, false, "verified once");
      assert.equal((await getPatient(ctx, A, ids.pat))?.consentTreatment, true, "consent recorded once a member verified it");
      const after = await patientResponseFor(reception, ids.pat, copy.id);
      assert.ok(after.ok);
      if (!after.ok) return;
      assert.match(after.value.inClinic?.words ?? "", /^Completed in the clinic, verified by Jess Taylor on /);
      assert.match(signedVia(after.value.response.trust, after.value.inClinic?.words ?? null), /verified by Jess Taylor/);
      assert.equal((await deviceState(ctx, A, started.value.secret)).state, "finished");
      const audit = await listAudit(ctx, A, { limit: 500 });
      const verify = audit.filter((e) => e.action === "pms.intake_response.verify" && e.targetId === copy.id);
      assert.deepEqual([verify.length, verify[0]?.userId], [1, "user_rec_01"]);
      // Outcome questionnaires stay in the portal; a hand-off can be ended.
      const second = (await requestIntakeForm(ctx, A, { templateId: ids.form_health, patientId: ids.pat }, reception.actor)).response;
      const s2 = await startHandoffFor(reception, ids.pat, second.id);
      assert.ok(s2.ok);
      if (!s2.ok) return;
      const st = await deviceState(ctx, A, s2.value.secret);
      assert.ok(st.state === "open");
      if (st.state !== "open") return;
      assert.equal((await endHandoffFor(reception, st.handoff.id)).ok, true);
      assert.equal((await deviceState(ctx, A, s2.value.secret)).state, "finished");
      assert.equal((await getIntakeResponse(ctx, A, second.id))?.status, "requested", "ending a hand-off leaves the copy waiting");
      assert.equal((await startHandoffFor(reception, ids.pat, copy.id)).ok, false, "a completed copy cannot be handed out again");
    });

    it("the sealed copy's PDF: a real PDF, health answers only with clinical.view, recorded in the trail", async () => {
      const copy = (await requestIntakeForm(ctx, A, { templateId: ids.form_health, patientId: ids.pat }, reception.actor)).response;
      const started = await startHandoffFor(reception, ids.pat, copy.id);
      assert.ok(started.ok);
      if (!started.ok) return;
      const st = await deviceState(ctx, A, started.value.secret);
      if (st.state !== "open") return assert.fail("open");
      const form = new FormData();
      for (const f of st.response.form.fields) {
        if (f.type === "heading" || !f.required) continue;
        if (f.type === "yes_no") form.set(`q_${f.id}`, "no");
        else if (f.type === "choice" || f.type === "multi") form.append(`q_${f.id}`, f.options![0]);
        else if (f.type === "consent") form.set(`q_${f.id}`, "on");
        else if (f.type === "date") form.set(`q_${f.id}`, "2026-10-01");
        else form.set(`q_${f.id}`, "Fictional sore shoulder");
      }
      const sent = await submitOnDevice(ctx, A, started.value.secret, st.response.rev, form);
      assert.ok(sent.ok, JSON.stringify(sent));
      const forClinician = await signedCopyPdfFor(clinician, ids.pat, copy.id);
      const forReception = await signedCopyPdfFor(reception, ids.pat, copy.id);
      assert.ok(forClinician && forReception);
      for (const pdf of [forClinician!, forReception!]) assert.equal(Buffer.from(pdf.bytes.slice(0, 5)).toString(), "%PDF-");
      assert.match(forClinician!.fileName, /signed-copy\.pdf$/);
      const rec = await patientResponseFor(reception, ids.pat, copy.id);
      const cli = await patientResponseFor(clinician, ids.pat, copy.id);
      assert.ok(rec.ok && cli.ok);
      if (!rec.ok || !cli.ok) return;
      assert.ok(rec.value.hiddenCount > 0, "the health questionnaire has clinical questions");
      assert.equal(cli.value.hiddenCount, 0);
      assert.equal(await signedCopyPdfFor(otherClinic, ids.pat, copy.id), null);
      const waiting = (await requestIntakeForm(ctx, A, { templateId: ids.form_consent, patientId: ids.pat }, reception.actor)).response;
      assert.equal(await signedCopyPdfFor(clinician, ids.pat, waiting.id), null, "only a completed copy");
      const audit = await listAudit(ctx, A, { limit: 500 });
      const pdfRows = audit.filter((e) => e.action === "pms.intake_response.pdf" && e.targetId === copy.id);
      assert.equal(pdfRows.length, 2);
      assert.deepEqual(pdfRows.map((e) => e.detail?.hiddenAnswers).sort(), [0, rec.value.hiddenCount].sort());
      assert.ok(!JSON.stringify(audit.map((e) => e.detail)).includes("shoulder"));
    });

    it("tenant-scope guard: every clinic-system statement named tenant_id", () => {
      assert.deepEqual(unscopedStatements(g.log.statements), []);
    });
  });
}

suite("SQLite (node:sqlite)", async () => createGuardedSqliteDb());
suite("Postgres (PGlite)", () => createGuardedPgliteDb());
