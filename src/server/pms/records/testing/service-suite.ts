/**
 * TESTS ONLY: the records module's server layer (src/server/pms/records/*-service.ts) – what the screens' actions and
 * routes call – run unchanged on node:sqlite and PGlite (../records-service.test.ts) and on D1 through the gateway
 * (workers/data-gateway/test/pms-records-stack.test.ts). Actors are built per role with the real permission matrix
 * (core/permissions.ts). Proves, among the rest:
 *
 *   - reception (staff) can never read or write clinical note content – by any service a screen can call (notes,
 *     amendments, body chart, outcome answers, files, the unsigned list, the template editor, the export), by the
 *     lists they may see (case page, history), or by an error message; refusals are identical whether the record
 *     exists or not and leave no audit row;
 *   - another clinic sees nothing; links in a request must be the patient's own;
 *   - the subject-access copy (PDF and JSON) holds everything about the one patient and nothing about anyone else.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../db/schema";
import { testCipher } from "../../../db/testing/databases";
import { loadPdfjs, pdfjsDocumentParams } from "../../../../modules/medreport/forms/pdfjs";
import { listAudit } from "../../../repos/audit";
import type { RepoContext } from "../../../repos/context";
import { createCase } from "../../../repos/pms/cases";
import { createPractitioner } from "../../../repos/pms/directory";
import { createPatient } from "../../../repos/pms/patients";
import { createReferrer } from "../../../repos/pms/referrers";
import { setPmsDemoFlag } from "../../../repos/pms/settings";
import type { QueryLog } from "../../../repos/pms/testing/guarded-db";
import { unscopedStatements } from "../../../repos/pms/testing/guarded-db";
import { FORBIDDEN_MESSAGE, ERROR_MESSAGE, REGISTRATION_NEEDED_MESSAGE, testActor, type RecordsActor, type Result } from "../access";
import { downloadFileFor, listFilesFor, uploadFileFor, withdrawFileFor } from "../attachments-service";
import { addAuthorisationFor, caseReferralsFor, getCaseDetails, listCasesFor, openCaseFor, updateCaseFor } from "../cases-service";
import { subjectAccessExportFor } from "../export-service";
import { patientHistoryFor } from "../history-service";
import { amendNoteFor, changeNoteTemplateFor, discardNoteFor, getNoteFor, lastNoteForCopyFor, listNotesFor, saveNoteFor, signNoteFor, startNoteFor, templatesForNewNote, unsignedNotesFor } from "../notes-service";
import { addClinicalFlagFor, clinicalFlagsFor, endClinicalFlagFor, patientExtrasFor, savePronounsFor } from "../flags-service";
import { patientCsvFor, patientListFor } from "../patient-list-service";
import { DEFAULT_PATIENT_FILTERS } from "../../../../modules/pms/records/patient-list";
import { getOutcomeFor, markOutcomeInErrorFor, outcomesFor, recordOutcomeFor } from "../outcomes-service";
import { anonymiseEligibilityFor, anonymisePatientFor, getPatientDetails, registerPatientFor, searchPatientsFor, setLegalHoldFor, updatePatientFor } from "../patients-service";
import { copyTemplateFor, createTemplateFor, listTemplatesFor, recordsSettingsFor, saveRecordsSettingsFor, setTemplateRetiredFor, updateTemplateFor } from "../templates-service";

export interface ServiceSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-a";
const B = "harbour-b";
const NO_SUCH = "note_01JB00000000000000000000ZZ";

/** Words that appear only in clinical content (note text, amendments, body chart, outcome answers, file names). */
const CLINICAL_WORDS = ["Neck pain since the collision", "rotation to the right", "headaches eased", "Right side of the neck", "Turning to reverse", "MRI cervical", "Megan Hart MRI report", "Side recorded wrongly"];

function value<T>(r: Result<T>): T {
  if (!r.ok) assert.fail(`expected ok, got ${r.code}: ${r.error}`);
  return r.value;
}

function pdfBytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set(Buffer.from("%PDF-1.7\n"));
  for (let i = 9; i < size; i++) out[i] = (i * 31) & 0xff;
  return out;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfjsDocumentParams(bytes));
  try {
    const doc = await task.promise;
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return parts.join(" ");
  } finally {
    await task.destroy();
  }
}

const squash = (s: string) => s.replace(/\s+/g, "");

export function defineRecordsServiceSuite(label: string, factory: () => Promise<ServiceSuiteDb>): void {
  describe(`records module server layer on ${label}`, () => {
    let suite: ServiceSuiteDb;
    let ctx: RepoContext;
    const clock = Date.parse("2026-10-24T09:00:00.000Z");
    let owner: RecordsActor;
    let sarah: RecordsActor;
    let tom: RecordsActor;
    let staff: RecordsActor;
    let otherClinician: RecordsActor;
    const ids: Record<string, string> = {};

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => new Date(clock) };
      owner = testActor(ctx, A, "owner", { userId: "user_owner_dell", name: "Dell Baines (fictional)" });
      sarah = testActor(ctx, A, "clinician", { userId: "user_sarah_01", name: "Sarah Reid" });
      tom = testActor(ctx, A, "clinician", { userId: "user_tom_02", name: "Tom Ellis" });
      staff = testActor(ctx, A, "staff", { userId: "user_reception_03", name: "Priya Shah" });
      otherClinician = testActor(ctx, B, "clinician", { userId: "user_other_b", name: "Other Clinic" });
      await setPmsDemoFlag(ctx, A, true, owner.actor);
      ids.prac = (await createPractitioner(ctx, A, { displayName: "Sarah Reid", registrationNumber: "PH-DEMO-01", userId: sarah.userId }, owner.actor)).id;
      ids.insurer = (await createReferrer(ctx, A, { kind: "insurer", name: "Northwell Health (fictional)" }, owner.actor)).id;
      ids.gp = (await createReferrer(ctx, A, { kind: "gp", name: "Dr Patel (fictional)" }, owner.actor)).id;
      ids.megan = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-22", phoneMobile: "07700 900101", email: "megan.hart@example.com", alerts: "Latex allergy", importRef: "sim-pat-001" }, owner.actor)).id;
      ids.daniel = (await createPatient(ctx, A, { firstName: "Daniel", lastName: "Brooks", dateOfBirth: "1980-01-19", alerts: "Daniel's own alert" }, owner.actor)).id;
      ids.otherPatient = (await createPatient(ctx, B, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-22" }, otherClinician.actor)).id;
    });
    after(async () => {
      await suite?.close();
    });

    it("cases: reception opens a case with an insurer; the payer account must fit the payer type", async () => {
      const bad = await openCaseFor(staff, ids.megan, { title: "Neck", openedOn: "2026-10-01", payerType: "insurer", payerReferrerId: ids.gp });
      assert.deepEqual([bad.ok, !bad.ok && bad.code, !bad.ok && Object.keys(bad.fieldErrors ?? {})], [false, "invalid", ["payerReferrerId"]]);
      const selfPay = await openCaseFor(staff, ids.megan, { title: "Neck", openedOn: "2026-10-01", payerType: "self_pay", payerReferrerId: ids.insurer });
      assert.equal(!selfPay.ok && selfPay.code, "invalid");
      const c = value(
        await openCaseFor(staff, ids.megan, {
          title: "Neck pain after a road traffic accident",
          openedOn: "2026-10-01",
          payerType: "insurer",
          payerReferrerId: ids.insurer,
          membershipNumber: "NW-123456",
          referrerId: ids.gp,
          practitionerId: ids.prac,
          referralReason: "Whiplash after a rear-end collision on 28/09",
        }),
      );
      ids.case = c.id;
      ids.danielCase = value(await openCaseFor(staff, ids.daniel, { title: "Lower back", openedOn: "2026-10-01" })).id;
      value(await addAuthorisationFor(staff, ids.megan, ids.case, { code: "NW-AUTH-77", sessionsAuthorised: 6, referrerId: ids.insurer }));
      const wrongPatient = await addAuthorisationFor(staff, ids.daniel, ids.case, { code: "X", sessionsAuthorised: 1 });
      assert.equal(!wrongPatient.ok && wrongPatient.code, "not_found", "a case is reached only through its own patient");
      assert.equal(!(await updateCaseFor(staff, ids.megan, ids.case, 1, { payerType: "solicitor" })).ok, true, "changing the type re-checks the payer account");
      assert.ok(value(await updateCaseFor(staff, ids.megan, ids.case, 1, { claimReference: "CLM-1" })).rev === 2);
      assert.equal(value(await listCasesFor(staff, ids.megan)).length, 1);
      const cross = await getCaseDetails(otherClinician, ids.megan, ids.case);
      assert.equal(!cross.ok && cross.code, "not_found", "another clinic finds nothing");
    });

    it("notes: a clinician starts from a template, saves, signs (locked, fingerprint), amends; the original stays", async () => {
      const templates = value(await templatesForNewNote(sarah));
      assert.deepEqual(templates.slice(0, 3).map((t) => t.id), ["builtin-initial-soap", "builtin-follow-up-soap", "builtin-discharge"]);
      const wrongCase = await startNoteFor(sarah, ids.megan, { templateId: "builtin-initial-soap", seenOn: "2026-10-22", caseId: ids.danielCase });
      assert.equal(!wrongCase.ok && wrongCase.code, "invalid");
      const draft = value(await startNoteFor(sarah, ids.megan, { templateId: "builtin-initial-soap", seenOn: "2026-10-22", caseId: ids.case }));
      ids.note = draft.id;
      const chart = { markers: [{ view: "front" as const, x: 40, y: 10, kind: "pain" as const, intensity: 6, label: "Right side of the neck" }] };
      const saved = value(
        await saveNoteFor(sarah, ids.megan, draft.id, {
          expectedRev: 1,
          sections: { subjective: "Neck pain since the collision", objective: "Reduced rotation to the right", plan: "Mobilisations, home exercises" },
          bodyChart: chart,
        }),
      );
      assert.deepEqual(saved, { rev: 2, signed: false });
      const notMine = await saveNoteFor(tom, ids.megan, draft.id, { expectedRev: 2, sections: { objective: "Tom" } });
      assert.equal(!notMine.ok && notMine.code, "invalid");
      const stale = await saveNoteFor(sarah, ids.megan, draft.id, { expectedRev: 1, sections: {} });
      assert.deepEqual([!stale.ok && stale.code, !stale.ok && stale.rev], ["conflict", 2]);
      const signed = value(await saveNoteFor(sarah, ids.megan, draft.id, { expectedRev: 2, sections: { subjective: "Neck pain since the collision", objective: "Reduced rotation to the right", plan: "Mobilisations, home exercises" }, bodyChart: chart, sign: true }));
      assert.equal(signed.signed, true);
      const view = value(await getNoteFor(sarah, ids.megan, draft.id));
      assert.equal(view.note.status, "signed");
      assert.match(view.note.contentHash ?? "", /^[0-9a-f]{64}$/);
      assert.deepEqual([view.editable, view.signable, view.amendable], [false, false, true]);
      const locked = await saveNoteFor(sarah, ids.megan, draft.id, { expectedRev: 3, sections: { objective: "changed" } });
      assert.equal(!locked.ok && locked.code, "invalid");
      assert.match(!locked.ok ? locked.error : "", /signed and locked/);
      // Roles design round 2: clinicians amend only their own signed notes; the owner may amend anyone's.
      const tomAmend = await amendNoteFor(tom, ids.megan, draft.id, { kind: "addendum", text: "Tom's addendum" });
      assert.equal(!tomAmend.ok && tomAmend.code, "forbidden", "another clinician's note");
      assert.equal(value(await getNoteFor(tom, ids.megan, draft.id)).amendable, false);
      // Khuram, 28/10/2026: amending (like signing) needs a registration number on the member's practitioner profile.
      const ownerNoReg = await amendNoteFor(owner, ids.megan, draft.id, { kind: "addendum", text: "Patient phoned: headaches eased." });
      assert.deepEqual(ownerNoReg, { ok: false, code: "registration", error: REGISTRATION_NEEDED_MESSAGE });
      assert.equal(value(await getNoteFor(owner, ids.megan, draft.id)).note.amendmentCount, 0, "nothing was added");
      await createPractitioner(ctx, A, { displayName: "Dell Baines (fictional)", registrationNumber: "PH-DEMO-09", userId: owner.userId }, owner.actor);
      value(await amendNoteFor(owner, ids.megan, draft.id, { kind: "addendum", text: "Patient phoned: headaches eased." }));
      const badAmend = await amendNoteFor(sarah, ids.megan, draft.id, { kind: "correction", text: "x" });
      assert.deepEqual(!badAmend.ok && Object.keys(badAmend.fieldErrors ?? {}).sort(), ["reason", "sectionKey"]);
      value(await amendNoteFor(sarah, ids.megan, draft.id, { kind: "correction", sectionKey: "objective", text: "Reduced rotation to the LEFT", reason: "Side recorded wrongly" }));
      const after = value(await getNoteFor(sarah, ids.megan, draft.id)).note;
      assert.equal(after.sections.objective, "Reduced rotation to the right", "the signed original is kept");
      assert.deepEqual(after.amendments.map((a) => a.kind), ["addendum", "correction"]);
      // An empty draft: saved, not signed – the answer says so and carries the new revision.
      const empty = value(await startNoteFor(sarah, ids.daniel, { templateId: "builtin-follow-up-soap", seenOn: "2026-10-23" }));
      const half = await saveNoteFor(sarah, ids.daniel, empty.id, { expectedRev: 1, sections: {}, sign: true });
      assert.deepEqual([!half.ok && half.rev, !half.ok && /saved, but the note is not signed/.test(half.error)], [2, true]);
      ids.danielDraft = empty.id;
      // Drafts for the unsigned list: one old (overdue), one recent.
      ids.oldDraft = value(await startNoteFor(sarah, ids.megan, { templateId: "builtin-follow-up-soap", seenOn: "2026-10-15", caseId: ids.case })).id;
      ids.tomDraft = value(await startNoteFor(tom, ids.daniel, { templateId: "builtin-follow-up-soap", seenOn: "2026-10-24" })).id;
      // Signing without a registration number (Tom has no practitioner profile): the draft is saved, never signed.
      const tomSign = await saveNoteFor(tom, ids.daniel, ids.tomDraft, { expectedRev: 1, sections: { subjective: "Back stiff in the mornings (fictional)" }, sign: true });
      assert.deepEqual([!tomSign.ok && tomSign.code, !tomSign.ok && tomSign.rev], ["registration", 2]);
      assert.equal(!tomSign.ok && tomSign.error, `Your changes are saved, but the note is not signed: ${REGISTRATION_NEEDED_MESSAGE}`);
      assert.match(REGISTRATION_NEEDED_MESSAGE, /^Add your registration number to sign notes\./);
      assert.deepEqual(await signNoteFor(tom, ids.daniel, ids.tomDraft, 2), { ok: false, code: "registration", error: REGISTRATION_NEEDED_MESSAGE });
      const tomView = value(await getNoteFor(tom, ids.daniel, ids.tomDraft));
      assert.deepEqual([tomView.note.status, tomView.note.rev, tomView.note.sections.subjective], ["draft", 2, "Back stiff in the mornings (fictional)"]);
      const tossed = value(await startNoteFor(sarah, ids.daniel, { templateId: "builtin-discharge", seenOn: "2026-10-24" }));
      assert.equal(value(await discardNoteFor(sarah, ids.daniel, tossed.id, 1)).rev, 2);
      assert.deepEqual(value(await listNotesFor(sarah, ids.megan)).map((n) => n.id).sort(), [ids.note, ids.oldDraft].sort());
    });

    it("outcomes over time, scored on the server; files encrypted, verified, withdrawn not deleted", async () => {
      value(await recordOutcomeFor(sarah, ids.megan, { measure: "nprs", takenOn: "2026-10-01", answers: { items: { pain: 7 } }, caseId: ids.case }));
      value(await recordOutcomeFor(sarah, ids.megan, { measure: "nprs", takenOn: "2026-10-22", answers: { items: { pain: 3 } }, caseId: ids.case, noteId: ids.note }));
      const psfs = value(await recordOutcomeFor(sarah, ids.megan, { measure: "psfs", takenOn: "2026-10-22", answers: { items: { a1: 3, a2: 4, a3: 6 }, activities: { a1: "Turning to reverse the car", a2: "Reading for an hour", a3: "Sleeping through" } } }));
      ids.psfs = psfs.id;
      const wrongNote = await recordOutcomeFor(sarah, ids.daniel, { measure: "nprs", takenOn: "2026-10-22", answers: { items: { pain: 3 } }, noteId: ids.note });
      assert.equal(!wrongNote.ok && wrongNote.code, "invalid");
      const out = await recordOutcomeFor(sarah, ids.megan, { measure: "nprs", takenOn: "2026-10-22", answers: { items: { pain: 11 } } });
      assert.equal(!out.ok && out.code, "invalid");
      const view = value(await outcomesFor(sarah, ids.megan));
      const nprs = view.series.find((s) => s.measure === "nprs");
      assert.deepEqual([nprs?.points.length, nprs?.first.scoreTenths, nprs?.latest.scoreTenths, nprs?.change.direction], [2, 70, 30, "better"]);
      assert.equal(value(await getOutcomeFor(sarah, ids.megan, psfs.id)).answers?.activities?.a1, "Turning to reverse the car");
      assert.equal(value(await markOutcomeInErrorFor(sarah, ids.megan, psfs.id, "Recorded twice")).changed, true);
      assert.equal(value(await outcomesFor(sarah, ids.megan)).series.some((s) => s.measure === "psfs"), false, "errors are left out of the charts");
      assert.equal(value(await outcomesFor(sarah, ids.megan, { includeErrors: true })).scores.length, 3);

      const file = value(await uploadFileFor(sarah, ids.megan, { bytes: pdfBytes(70_000), fileName: "Megan Hart MRI report.pdf", description: "MRI cervical spine (fictional)", noteId: ids.note }));
      ids.file = file.id;
      const html = await uploadFileFor(sarah, ids.megan, { bytes: new TextEncoder().encode("<html><script>alert(1)</script>"), fileName: "x.pdf" });
      assert.equal(!html.ok && html.code, "invalid");
      const big = await uploadFileFor(sarah, ids.megan, { bytes: pdfBytes(4_000_001), fileName: "big.pdf" });
      assert.equal(!big.ok && big.error, "The file is larger than 4 MB.");
      const otherNote = await uploadFileFor(sarah, ids.daniel, { bytes: pdfBytes(100), fileName: "x.pdf", noteId: ids.note });
      assert.equal(!otherNote.ok && otherNote.code, "invalid");
      const down = value(await downloadFileFor(sarah, ids.megan, file.id));
      assert.deepEqual([down.fileName, down.mimeType, down.bytes.byteLength], ["Megan Hart MRI report.pdf", "application/pdf", 70_000]);
      assert.equal(!(await downloadFileFor(sarah, ids.daniel, file.id)).ok, true, "a file is reached only through its own patient");
      const dup = value(await uploadFileFor(sarah, ids.megan, { bytes: pdfBytes(200), fileName: "duplicate.pdf" }));
      assert.equal(value(await withdrawFileFor(sarah, ids.megan, dup.id, "Uploaded twice")).changed, true);
      assert.equal((await downloadFileFor(sarah, ids.megan, dup.id)).ok, false, "a withdrawn file is not downloadable for clinicians…");
      assert.equal((await downloadFileFor(owner, ids.megan, dup.id)).ok, true, "…but is for the export holder (subject access)");
      assert.equal(value(await listFilesFor(sarah, ids.megan)).length, 1);
      assert.equal(value(await listFilesFor(sarah, ids.megan, { includeWithdrawn: true })).length, 2);
    });

    it("unsigned notes: a clinician sees their own; the owner sees every author's; overdue after N days (per clinic)", async () => {
      assert.equal(value(await unsignedNotesFor(sarah)).days, 1, "default: overdue after 24 hours (design round 2)");
      assert.equal(value(await saveRecordsSettingsFor(owner, 0, { unsignedNoteDays: 3 })).rev, 1);
      const mine = value(await unsignedNotesFor(sarah));
      assert.equal(mine.scope, "mine");
      assert.deepEqual(mine.notes.map((n) => n.id).sort(), [ids.danielDraft, ids.oldDraft].sort());
      assert.deepEqual([mine.days, mine.cutoff], [3, "2026-10-21"]);
      const old = mine.notes.find((n) => n.id === ids.oldDraft);
      assert.deepEqual([old?.overdue, old?.daysSinceSeen, old?.patient?.lastName], [true, 9, "Hart"]);
      assert.equal(mine.notes.find((n) => n.id === ids.danielDraft)?.overdue, false);
      assert.ok(mine.notes.every((n) => !("sections" in n)), "the list never decrypts");
      const all = await unsignedNotesFor(sarah, { scope: "all" });
      assert.equal(!all.ok && all.code, "forbidden", "a clinician sees only their own");
      const clinic = value(await unsignedNotesFor(owner, { scope: "all" }));
      assert.deepEqual(clinic.counts.map((c) => [c.authorName, c.drafts, c.overdue]), [
        ["Sarah Reid", 2, 1],
        ["Tom Ellis", 1, 0],
      ]);
      assert.equal(value(await unsignedNotesFor(owner, { scope: "all", overdueOnly: true })).notes.length, 1);
      assert.equal(value(await saveRecordsSettingsFor(owner, 1, { unsignedNoteDays: 1 })).rev, 2);
      assert.equal(value(await recordsSettingsFor(sarah)).unsignedNoteDays, 1);
      const sooner = value(await unsignedNotesFor(sarah));
      assert.equal(sooner.notes.find((n) => n.id === ids.danielDraft)?.overdue, true, "seen 23/10: overdue after 1 day");
      assert.equal(value(await unsignedNotesFor(owner, { scope: "all" })).notes.find((n) => n.id === ids.tomDraft)?.overdue, false, "seen today: not overdue");
      assert.deepEqual(value(await unsignedNotesFor(otherClinician)).notes, [], "another clinic sees none");
    });

    it("template editor: owner creates, copies, versions, retires; nobody else may", async () => {
      const t = value(await createTemplateFor(owner, { name: "Knee review (fictional)", noteType: "follow_up", sections: [{ label: "Subjective" }, { label: "Knee tests", hint: "Lachman, McMurray" }, { label: "Plan & treatment" }] }));
      assert.deepEqual(t.sections.map((s) => s.key), ["subjective", "knee_tests", "plan_treatment"]);
      const note = value(await startNoteFor(sarah, ids.daniel, { templateId: t.id, seenOn: "2026-10-24" }));
      assert.equal(value(await updateTemplateFor(owner, t.id, 1, { sections: [...t.sections, { label: "Outcome" }] })).rev, 2);
      assert.equal(value(await getNoteFor(sarah, ids.daniel, note.id)).note.template.sections.length, 3, "the note keeps version 1");
      assert.equal(value(await setTemplateRetiredFor(owner, t.id, 2, true)).rev, 3);
      assert.ok(!value(await templatesForNewNote(sarah)).some((x) => x.id === t.id));
      assert.ok(value(await listTemplatesFor(owner)).some((x) => x.id === t.id && !x.active));
      const copy = value(await copyTemplateFor(owner, "builtin-initial-soap", "Initial (clinic)"));
      assert.equal(copy.sections.length, 6);
      const builtin = await updateTemplateFor(owner, "builtin-discharge", 1, { name: "x" });
      assert.equal(!builtin.ok && builtin.code, "invalid");
      for (const who of [sarah, staff]) {
        for (const r of [
          await createTemplateFor(who, { name: "x", noteType: "general", sections: [{ label: "A" }] }),
          await copyTemplateFor(who, "builtin-discharge", "y"),
          await updateTemplateFor(who, t.id, 3, { name: "z" }),
          await setTemplateRetiredFor(who, t.id, 3, false),
          await listTemplatesFor(who),
          await saveRecordsSettingsFor(who, 1, { unsignedNoteDays: 9 }),
        ]) {
          assert.deepEqual(r, { ok: false, code: "forbidden", error: FORBIDDEN_MESSAGE });
        }
      }
    });

    it("STAFF (reception) can never reach clinical content: every clinical service refuses before reading", async () => {
      const auditBefore = (await listAudit(ctx, A, { limit: 500 })).length;
      const refused = { ok: false, code: "forbidden", error: FORBIDDEN_MESSAGE };
      const attempts: [string, () => Promise<Result<unknown>>][] = [];
      for (const noteId of [ids.note, NO_SUCH]) {
        attempts.push(
          [`listNotes`, () => listNotesFor(staff, ids.megan)],
          [`getNote ${noteId}`, () => getNoteFor(staff, ids.megan, noteId)],
          [`startNote`, () => startNoteFor(staff, ids.megan, { templateId: "builtin-follow-up-soap", seenOn: "2026-10-24" })],
          [`saveNote ${noteId}`, () => saveNoteFor(staff, ids.megan, noteId, { expectedRev: 1, sections: { objective: "reception text" } })],
          [`saveNote+sign ${noteId}`, () => saveNoteFor(staff, ids.megan, noteId, { expectedRev: 1, sections: {}, sign: true })],
          [`signNote ${noteId}`, () => signNoteFor(staff, ids.megan, noteId, 1)],
          [`discardNote ${noteId}`, () => discardNoteFor(staff, ids.megan, noteId, 1)],
          [`amendNote ${noteId}`, () => amendNoteFor(staff, ids.megan, noteId, { kind: "addendum", text: "reception addendum" })],
          [`templatesForNewNote`, () => templatesForNewNote(staff)],
          [`unsigned mine`, () => unsignedNotesFor(staff)],
          [`unsigned all`, () => unsignedNotesFor(staff, { scope: "all" })],
          [`outcomes`, () => outcomesFor(staff, ids.megan)],
          [`getOutcome`, () => getOutcomeFor(staff, ids.megan, ids.psfs)],
          [`recordOutcome`, () => recordOutcomeFor(staff, ids.megan, { measure: "nprs", takenOn: "2026-10-24", answers: { items: { pain: 2 } } })],
          [`markOutcomeInError`, () => markOutcomeInErrorFor(staff, ids.megan, ids.psfs, "x")],
          [`listFiles`, () => listFilesFor(staff, ids.megan, { includeWithdrawn: true })],
          [`downloadFile`, () => downloadFileFor(staff, ids.megan, ids.file)],
          [`uploadFile`, () => uploadFileFor(staff, ids.megan, { bytes: pdfBytes(100), fileName: "x.pdf" })],
          [`withdrawFile`, () => withdrawFileFor(staff, ids.megan, ids.file, "x")],
          [`export pdf`, () => subjectAccessExportFor(staff, ids.megan, "pdf", { clinicName: "Riverside Physiotherapy (fictional)" })],
          [`export json`, () => subjectAccessExportFor(staff, ids.megan, "json", { clinicName: "Riverside Physiotherapy (fictional)" })],
          [`anonymise check`, () => anonymiseEligibilityFor(staff, ids.megan)],
          [`anonymise`, () => anonymisePatientFor(staff, ids.megan, { confirmNumber: 1, reviewed: true })],
          [`legal hold`, () => setLegalHoldFor(staff, ids.megan, true)],
        );
      }
      for (const [name, run] of attempts) assert.deepEqual(await run(), refused, name);
      // The same answer whether the note exists or not – a refusal reveals nothing.
      assert.deepEqual(await getNoteFor(staff, ids.megan, ids.note), await getNoteFor(staff, ids.megan, NO_SUCH));
      assert.equal((await listAudit(ctx, A, { limit: 500 })).length, auditBefore, "refusals read and write nothing (no 'note opened' row)");
      const note = value(await getNoteFor(sarah, ids.megan, ids.note)).note;
      assert.equal(note.amendments.length, 2, "nothing reception tried was written");
      assert.ok(!JSON.stringify(note).includes("reception"));
    });

    it("STAFF sees the non-clinical record – and no clinical content leaks through it (lists, case page, history)", async () => {
      const visible: unknown[] = [];
      visible.push(value(await searchPatientsFor(staff, { q: "Hart" })));
      const details = value(await getPatientDetails(staff, ids.megan));
      assert.equal(details.patient.alerts, "Latex allergy", "alerts are for the whole team (diary, reception)");
      visible.push(details);
      const c = value(await getCaseDetails(staff, ids.megan, ids.case));
      assert.equal(c.notes, null, "the case page lists notes only for clinical.view (null, not an empty list)");
      assert.equal(c.authorisations.length, 1);
      visible.push(c);
      const history = value(await patientHistoryFor(staff, ids.megan));
      const clinicalRows = history.filter((h) => ["pms_note", "pms_outcome", "pms_attachment"].includes(h.targetType ?? ""));
      assert.ok(clinicalRows.length > 5 && clinicalRows.every((h) => h.detail === null), "clinical rows keep what and when, without their details");
      assert.ok(history.some((h) => h.action === "pms.note.sign"));
      visible.push(history);
      const text = JSON.stringify(visible);
      for (const w of CLINICAL_WORDS) assert.ok(!text.includes(w), `staff-visible data holds "${w}"`);
      assert.ok(!/"(noteType|sections|kind|measure|sectionKey|markers)"/.test(text), "no clinical detail fields");
      // A clinician gets the same rows with their details.
      const full = value(await patientHistoryFor(sarah, ids.megan));
      assert.ok(full.some((h) => h.action === "pms.note.amend" && (h.detail as { kind?: string } | null)?.kind === "correction"));
      assert.equal(value(await getCaseDetails(sarah, ids.megan, ids.case)).notes?.length, 2);
    });

    it("referral reason and case notes: reception sees them by default (patients.referral); switched off, never", async () => {
      // Khuram, 28/10/2026: "See referral reason and case notes" is on for reception by default; the owner can switch it off.
      const reason = "Whiplash after a rear-end collision on 28/09";
      assert.equal(value(await getCaseDetails(staff, ids.megan, ids.case)).case.referralReason, reason);
      assert.deepEqual(value(await caseReferralsFor(staff, ids.megan)).find((r) => r.caseId === ids.case)?.referralReason, reason);
      // Off for the role (Roles and permissions) or for one member (Member access): masked, refused, not writable.
      const offForRole = testActor(ctx, A, "staff", { userId: "user_reception_03", name: "Priya Shah" }, { roleOverrides: { "patients.referral": false } });
      const offForMember = testActor(ctx, A, "staff", { userId: "user_reception_04", name: "Jess Taylor" }, { exceptions: { "patients.referral": false } });
      for (const rec of [offForRole, offForMember]) {
        const c = value(await getCaseDetails(rec, ids.megan, ids.case)).case;
        assert.deepEqual([c.referralReason, c.notes], [null, null]);
        assert.deepEqual(await caseReferralsFor(rec, ids.megan), { ok: false, code: "forbidden", error: FORBIDDEN_MESSAGE });
        assert.equal((await updateCaseFor(rec, ids.megan, ids.case, c.rev, { referralReason: "overwritten" })).ok, false);
        assert.ok(!JSON.stringify(value(await listCasesFor(rec, ids.megan))).includes(reason));
      }
      assert.equal(value(await getCaseDetails(sarah, ids.megan, ids.case)).case.referralReason, reason, "unchanged");
    });

    it("pronouns, clinical flags (never reception), the patient list and its CSV, template change, copy from the last note", async () => {
      const refused = { ok: false, code: "forbidden", error: FORBIDDEN_MESSAGE };
      // Pronouns: part of the demographics – reception records them.
      assert.equal(value(await savePronounsFor(staff, ids.megan, 0, "she/her")).rev, 1);
      assert.deepEqual(value(await patientExtrasFor(staff, ids.megan)), { pronouns: "she/her", rev: 1 });
      assert.equal(!(await savePronounsFor(staff, ids.megan, 0, "they/them")).ok, true, "a stale form is refused");
      assert.equal((await patientExtrasFor(otherClinician, ids.megan) as { code?: string }).code, "not_found");
      // Clinical flags: clinicians, owners and administrators only.
      const flag = value(await addClinicalFlagFor(sarah, ids.megan, "On anticoagulants"));
      assert.deepEqual(value(await clinicalFlagsFor(owner, ids.megan)).map((f) => f.text), ["On anticoagulants"]);
      for (const r of [await clinicalFlagsFor(staff, ids.megan), await addClinicalFlagFor(staff, ids.megan, "reception flag"), await endClinicalFlagFor(staff, ids.megan, flag.id, 1)]) assert.deepEqual(r, refused);
      assert.equal((await endClinicalFlagFor(sarah, ids.daniel, flag.id, 1) as { code?: string }).code, "not_found", "a flag is reached only through its own patient");
      assert.equal((await addClinicalFlagFor(sarah, ids.megan, "  ") as { code?: string }).code, "invalid");
      assert.equal(value(await endClinicalFlagFor(sarah, ids.megan, flag.id, 1)).rev, 2);
      assert.deepEqual(value(await clinicalFlagsFor(sarah, ids.megan)), []);
      value(await addClinicalFlagFor(sarah, ids.megan, "On anticoagulants"));

      // The patient list: filters answered by the shared record and the diary; nothing decrypted.
      const all = value(await patientListFor(staff, { ...DEFAULT_PATIENT_FILTERS }));
      const hart = all.rows.find((r) => r.id === ids.megan);
      assert.ok(hart && hart.hasAlerts && hart.openCase?.title === "Neck pain after a road traffic accident" && hart.openCase.payerName === "Northwell Health (fictional)");
      assert.equal(hart?.age, 34);
      assert.ok(!JSON.stringify(all).includes("Latex") && !JSON.stringify(all).includes("anticoagulants") && !JSON.stringify(all).includes("Whiplash"), "the list never decrypts");
      const ids2 = (f: Partial<typeof DEFAULT_PATIENT_FILTERS>) => patientListFor(staff, { ...DEFAULT_PATIENT_FILTERS, ...f }).then((r) => value(r).rows.map((x) => x.id));
      assert.deepEqual(await ids2({ payer: "insurer" }), [ids.megan]);
      assert.deepEqual(await ids2({ practitionerId: ids.prac }), [ids.megan]);
      assert.deepEqual(await ids2({ q: "22/11/1991" }), [ids.megan]);
      assert.deepEqual(await ids2({ q: "hart megan" }), [ids.megan]);
      assert.equal((await ids2({ noFuture: true })).length, all.total, "no appointments in this suite: nobody has a future one");
      assert.deepEqual(await ids2({ seenToday: true }), []);
      const asc = await ids2({});
      assert.deepEqual(await ids2({ sort: "desc" }), [...asc].reverse());
      assert.ok(!(await ids2({}).then((x) => x)).includes(ids.otherPatient));
      assert.ok(!value(await patientListFor(otherClinician, { ...DEFAULT_PATIENT_FILTERS })).rows.some((r) => r.id === ids.megan), "another clinic lists only its own");
      // CSV: owners and administrators only; audited with counts.
      assert.deepEqual(await patientCsvFor(staff, DEFAULT_PATIENT_FILTERS), refused);
      assert.deepEqual(await patientCsvFor(sarah, DEFAULT_PATIENT_FILTERS), refused);
      const csv = value(await patientCsvFor(owner, { ...DEFAULT_PATIENT_FILTERS, payer: "insurer" }));
      assert.equal(csv.count, 1);
      const [header, first] = csv.csv.split("\r\n");
      assert.ok(header.startsWith("Patient number,Title,First name,Last name") && first.includes("Hart") && first.includes("22/11/1991") && first.includes("Northwell Health (fictional)"));
      assert.ok(!csv.csv.includes("Latex"));
      const exported = (await listAudit(ctx, A, { limit: 500 })).find((e) => e.action === "pms.patients.export");
      assert.deepEqual(exported?.detail, { count: 1, filters: ["payer"] });

      // Template change of a draft keeps the text of the sections both templates share.
      const d = value(await startNoteFor(sarah, ids.daniel, { templateId: "builtin-follow-up-soap", seenOn: "2026-10-24" }));
      value(await saveNoteFor(sarah, ids.daniel, d.id, { expectedRev: 1, sections: { subjective: "Better this week", objective: "Full range" } }));
      assert.equal((await changeNoteTemplateFor(tom, ids.daniel, d.id, 2, "builtin-initial-soap") as { code?: string }).code, "invalid", "only the author");
      assert.deepEqual(await changeNoteTemplateFor(staff, ids.daniel, d.id, 2, "builtin-initial-soap"), refused);
      assert.equal(value(await changeNoteTemplateFor(sarah, ids.daniel, d.id, 2, "builtin-initial-soap")).rev, 3);
      const changed = value(await getNoteFor(sarah, ids.daniel, d.id)).note;
      assert.deepEqual([changed.templateId, changed.noteType, changed.sections], ["builtin-initial-soap", "initial", { subjective: "Better this week", objective: "Full range" }]);
      assert.equal((await changeNoteTemplateFor(sarah, ids.daniel, d.id, 2, "builtin-discharge") as { code?: string }).code, "conflict");
      value(await discardNoteFor(sarah, ids.daniel, d.id, 3));
      // Copy from the last note: the latest signed note, its opening recorded.
      const copy = value(await lastNoteForCopyFor(sarah, ids.megan));
      assert.ok(copy && copy.noteId === ids.note && copy.sections.objective === "Reduced rotation to the right");
      assert.equal(value(await lastNoteForCopyFor(sarah, ids.megan, ids.note)), null, "none other than this one");
      assert.deepEqual(await lastNoteForCopyFor(staff, ids.megan), refused);
    });

    it("errors are plain: no database message, no patient data", async () => {
      // A ciphertext moved to another row no longer decrypts: the answer is the generic message only.
      const raw = await ctx.db.selectFrom("pms_clinical_notes").select("sections_enc").where("tenant_id", "=", A).where("id", "=", ids.note).executeTakeFirstOrThrow();
      await ctx.db.updateTable("pms_clinical_notes").set({ sections_enc: raw.sections_enc }).where("tenant_id", "=", A).where("id", "=", ids.tomDraft).execute();
      const broken = await getNoteFor(tom, ids.daniel, ids.tomDraft);
      assert.deepEqual(broken, { ok: false, code: "error", error: ERROR_MESSAGE });
      await ctx.db.updateTable("pms_clinical_notes").set({ sections_enc: null }).where("tenant_id", "=", A).where("id", "=", ids.tomDraft).execute();
      const invalid = await saveNoteFor(sarah, ids.megan, ids.oldDraft, { expectedRev: 1, sections: { subjective: "x".repeat(20_001) } });
      assert.equal(!invalid.ok && invalid.code, "invalid");
      assert.ok(!JSON.stringify(invalid).includes("xxxxxxxx"), "the refused text is not echoed back");
    });

    it("tenancy: a member of another clinic reaches nothing of this clinic", async () => {
      for (const r of [
        await getPatientDetails(otherClinician, ids.megan),
        await listNotesFor(otherClinician, ids.megan),
        await getNoteFor(otherClinician, ids.megan, ids.note),
        await outcomesFor(otherClinician, ids.megan),
        await listFilesFor(otherClinician, ids.megan),
        await downloadFileFor(otherClinician, ids.megan, ids.file),
        await patientHistoryFor(otherClinician, ids.megan),
        await amendNoteFor(otherClinician, ids.megan, ids.note, { kind: "addendum", text: "cross-clinic" }),
      ]) {
        assert.deepEqual(r, { ok: false, code: "not_found", error: "This record no longer exists in this clinic." });
      }
      // …and asking with the other clinic's patient id but this clinic's note id finds nothing either.
      assert.equal((await getNoteFor(sarah, ids.otherPatient, ids.note)).ok, false);
    });

    it("register: possible duplicates are answered first; registering anyway needs the member's confirmation", async () => {
      const probe = { firstName: "Meg", lastName: "Hart", dateOfBirth: "1991-11-22" };
      const first = value(await registerPatientFor(staff, probe));
      assert.equal(first.kind, "possible_duplicates");
      assert.deepEqual(first.kind === "possible_duplicates" ? first.duplicates.map((d) => [d.patient.id, d.reasons]) : [], [[ids.megan, ["name_and_birth_date"]]]);
      const created = value(await registerPatientFor(staff, probe, { confirmNotDuplicate: true }));
      assert.equal(created.kind, "created");
      const bad = await registerPatientFor(staff, { firstName: "", lastName: "X", email: "not-an-email" });
      assert.ok(!bad.ok && bad.code === "invalid" && bad.fieldErrors && "firstName" in bad.fieldErrors);
      assert.equal((await registerPatientFor(otherClinician, { firstName: "Lone", lastName: "Patient" })).ok, true);
      const p = value(await getPatientDetails(staff, ids.daniel)).patient;
      assert.equal(value(await updatePatientFor(staff, ids.daniel, p.rev, { phoneMobile: "07700 900222" })).rev, p.rev + 1);
      const stale = await updatePatientFor(staff, ids.daniel, p.rev, { phoneMobile: "07700 900333" });
      assert.equal(!stale.ok && stale.code, "conflict");
    });

    it("subject access: owner-only; the PDF and JSON hold everything about this patient and nothing about anyone else", async () => {
      for (const who of [sarah, tom, staff]) assert.equal((await subjectAccessExportFor(who, ids.megan, "pdf", { clinicName: "x" })).ok, false);
      const clinicName = "Riverside Physiotherapy (fictional)";
      const json = value(await subjectAccessExportFor(owner, ids.megan, "json", { clinicName }));
      const pdf = value(await subjectAccessExportFor(owner, ids.megan, "pdf", { clinicName }));
      assert.equal(json.mimeType, "application/json");
      assert.match(json.fileName, /^subject-access-\d+-2026-10-24\.json$/);
      assert.equal(pdf.mimeType, "application/pdf");
      assert.equal(Buffer.from(pdf.bytes.subarray(0, 5)).toString(), "%PDF-");
      const data = JSON.parse(new TextDecoder().decode(json.bytes));
      const text = await pdfText(pdf.bytes);
      const out = process.env.RECORDS_SAR_OUT;
      if (out) {
        fs.mkdirSync(out, { recursive: true });
        fs.writeFileSync(path.join(out, pdf.fileName), pdf.bytes);
        fs.writeFileSync(path.join(out, json.fileName), json.bytes);
        fs.writeFileSync(path.join(out, `${pdf.fileName}.txt`), text);
      }
      // Complete: identity, contacts, consent, alerts; case + payer + referral; authorisation; every note section,
      // the body chart, both amendments with reasons, the signature; outcome scores and answers (incl. the one in
      // error); both files (incl. the withdrawn one); the history.
      const expected = [
        "Megan",
        "Hart",
        "22/11/1991",
        "07700 900101",
        "megan.hart@example.com",
        "Latex allergy",
        "Neck pain after a road traffic accident",
        "Northwell Health (fictional)",
        "NW-123456",
        "CLM-1",
        "Dr Patel (fictional)",
        "Whiplash after a rear-end collision on 28/09",
        "NW-AUTH-77",
        "Neck pain since the collision",
        "Reduced rotation to the right",
        "Mobilisations, home exercises",
        "Right side of the neck",
        "Patient phoned: headaches eased.",
        "Reduced rotation to the LEFT",
        "Side recorded wrongly",
        "Sarah Reid",
        "PH-DEMO-01",
        "Turning to reverse the car",
        "Recorded twice",
        "Megan Hart MRI report.pdf",
        "MRI cervical spine (fictional)",
        "duplicate.pdf",
        "Uploaded twice",
        "Clinical note signed and locked",
        "Demonstration clinic",
        clinicName,
      ];
      const missingPdf = expected.filter((s) => !squash(text).includes(squash(s)));
      assert.deepEqual(missingPdf, [], "everything is in the PDF");
      const jsonText = JSON.stringify(data);
      const pdfOnly = new Set(["Demonstration clinic", "22/11/1991"]);
      const missingJson = [...expected.filter((s) => !pdfOnly.has(s)), "1991-11-22"].filter((s) => !jsonText.includes(s));
      assert.deepEqual(missingJson, [], "everything is in the JSON");
      assert.equal(data.clinicalNotes.length, 2, "both of Megan's notes (signed + draft)");
      assert.equal(data.outcomeMeasures.length, 3);
      assert.equal(data.attachedFiles.length, 2);
      assert.equal(data.clinic.demonstration, true);
      // Nobody else: not Daniel (same clinic), not the other clinic's Megan, no internal clinic id.
      for (const other of ["Daniel", "Brooks", "Daniel's own alert", "Lower back", ids.daniel, ids.otherPatient, B, A]) {
        assert.ok(!text.includes(other), `PDF holds ${other}`);
        assert.ok(!jsonText.includes(other), `JSON holds ${other}`);
      }
      const exports = (await listAudit(ctx, A, { limit: 500 })).filter((e) => e.action === "pms.patient.export");
      assert.deepEqual(exports.map((e) => [e.targetId, (e.detail as { format?: string }).format]).sort(), [
        [ids.megan, "json"],
        [ids.megan, "pdf"],
      ]);
      assert.ok(!JSON.stringify(exports).includes("Megan"), "the audit row holds ids and counts only");
    });

    it("audit: every write by the services was audited under its own clinic, with no patient data", async () => {
      const rows = await listAudit(ctx, A, { limit: 500 });
      const text = JSON.stringify(rows);
      for (const w of [...CLINICAL_WORDS, "Megan", "Latex", "Whiplash", "Recorded twice", "Uploaded twice"]) assert.ok(!text.includes(w), w);
      assert.ok(rows.every((r) => r.tenantId === A));
      assert.ok(!rows.some((r) => r.userId === staff.userId && /^pms\.(note|outcome|attachment)\./.test(r.action)), "nothing clinical was ever written by reception");
    });

    it("tenant-scope guard: every clinic-system statement named tenant_id", () => {
      if (!suite.log) return;
      assert.ok(suite.log.statements.length > 100);
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
