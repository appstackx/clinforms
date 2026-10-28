/**
 * TESTS ONLY: the records module's repository suite (templates, notes with sign and lock and amendments, outcome
 * measures, attached files, history, subject access, anonymisation), run unchanged on node:sqlite and PGlite
 * (../records-repos.test.ts) and on D1 through the gateway (workers/data-gateway/test/pms-records-stack.test.ts).
 * Two clinics throughout: nothing of clinic B is ever readable or changeable from clinic A. With a query log, it
 * ends with the tenant-scope guard (every clinic-system statement names tenant_id).
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../../db/schema";
import { testCipher } from "../../../../db/testing/databases";
import { listAudit } from "../../../audit";
import { RepoInputError, type RepoContext } from "../../../context";
import { createCase, createAuthorisation, getCase, getAuthorisation } from "../../cases";
import { createPractitioner } from "../../directory";
import { createPatient, getPatient, setPatientLegalHold, touchPatientLastSeen } from "../../patients";
import type { QueryLog } from "../../testing/guarded-db";
import { unscopedStatements } from "../../testing/guarded-db";
import { anonymiseEligibility, anonymisePatient, getAnonymisation } from "../anonymise";
import { ATTACHMENT_CHUNK_BYTES, getAttachmentFile, getPatientAttachments, listAttachmentsForPatient, putAttachment, recordAttachmentDownload, withdrawAttachment } from "../attachments";
import { listPatientHistory } from "../history";
import { findPossibleDuplicates } from "../duplicates";
import {
  addAmendment,
  countUnsignedNotesByAuthor,
  createNoteDraft,
  discardNoteDraft,
  getNote,
  isLockedError,
  lastSignedNoteDate,
  listDraftsByAuthor,
  listNotesForPatient,
  listUnsignedNotes,
  noteFingerprint,
  recordNoteView,
  saveNoteDraft,
  signNote,
} from "../notes";
import { bulkRecordOutcomes, getOutcome, listOutcomesForPatient, markOutcomeInError, recordOutcome } from "../outcomes";
import { collectSubjectAccess } from "../subject-access";
import { addClinicalFlag, endClinicalFlag, getPatientExtras, getPronounsFor, listClinicalFlags, savePatientPronouns } from "../patient-extras";
import { getRecordsSettings, saveRecordsSettings } from "../settings";
import { copyNoteTemplate, createNoteTemplate, getNoteTemplate, listNoteTemplates, setNoteTemplateActive, updateNoteTemplate } from "../templates";

export interface RecordsSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-a";
const B = "harbour-b";
const SARAH = { userId: "user_sarah_01", sessionId: "sess_01" };
const TOM = { userId: "user_tom_02", sessionId: "sess_02" };
const OTHER_CLINIC = { userId: "user_other_clinic", sessionId: "sess_b" };
const SARAH_AUTHOR = { name: "Sarah Reid", registration: "PH-DEMO-01" };

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(promise, (err: unknown) => err instanceof RepoInputError && pattern.test(err.message));
}

/** A small file that is a PDF by its first bytes, `size` long. */
function pdfBytes(size: number): Buffer {
  const head = Buffer.from("%PDF-1.7\n");
  return Buffer.concat([head, randomBytes(Math.max(0, size - head.length))]);
}

export function defineRecordsRepoSuite(label: string, factory: () => Promise<RecordsSuiteDb>): void {
  describe(`records module repositories on ${label}`, () => {
    let suite: RecordsSuiteDb;
    let ctx: RepoContext;
    let clock = Date.parse("2026-10-24T09:00:00.000Z");
    const tick = (ms = 1000) => {
      clock += ms;
    };
    const ids: Record<string, string> = {};

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => new Date(clock) };
      const megan = await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-22", importRef: "sim-pat-001" }, SARAH);
      const daniel = await createPatient(ctx, A, { firstName: "Daniel", lastName: "Brooks", dateOfBirth: "1980-01-19" }, SARAH);
      const other = await createPatient(ctx, B, { firstName: "Megan", lastName: "Hart" }, OTHER_CLINIC);
      ids.megan = megan.id;
      ids.daniel = daniel.id;
      ids.otherPatient = other.id;
      ids.case = (await createCase(ctx, A, { patientId: megan.id, title: "Neck pain after a road traffic accident", openedOn: "2026-03-18", referralReason: "Whiplash after a rear-end collision", claimReference: "MMR/2291" }, SARAH)).id;
      ids.danielCase = (await createCase(ctx, A, { patientId: daniel.id, title: "Lower back", openedOn: "2026-10-01" }, SARAH)).id;
      ids.otherCase = (await createCase(ctx, B, { patientId: other.id, title: "Other clinic", openedOn: "2026-10-01" }, OTHER_CLINIC)).id;
      ids.prac = (await createPractitioner(ctx, A, { displayName: "Sarah Reid", registrationNumber: "PH-DEMO-01", userId: SARAH.userId }, SARAH)).id;
    });
    after(async () => {
      await suite?.close();
    });

    it("templates: built-in ones for every clinic, the clinic's own per clinic, revisions", async () => {
      const builtins = await listNoteTemplates(ctx, A);
      assert.deepEqual(
        builtins.map((t) => t.id),
        ["builtin-initial-soap", "builtin-follow-up-soap", "builtin-discharge"],
      );
      const t = await createNoteTemplate(
        ctx,
        A,
        { name: "Knee review (fictional)", noteType: "follow_up", sections: [{ key: "subjective", label: "Subjective" }, { key: "knee_tests", label: "Knee tests", hint: "Lachman, McMurray" }], basedOn: "builtin-follow-up-soap" },
        SARAH,
      );
      ids.template = t.id;
      assert.equal(t.sections[1].kind, "text");
      await rejects(createNoteTemplate(ctx, A, { name: "Knee review (fictional)", noteType: "general", sections: [{ key: "a", label: "A" }] }, SARAH), /already exists/);
      assert.ok(await createNoteTemplate(ctx, B, { name: "Knee review (fictional)", noteType: "general", sections: [{ key: "a", label: "A" }] }, OTHER_CLINIC), "same name in another clinic");
      assert.equal(await getNoteTemplate(ctx, B, t.id), null, "another clinic cannot read it");
      assert.equal((await listNoteTemplates(ctx, A)).length, 4);
      const saved = await updateNoteTemplate(ctx, A, t.id, 1, { bodyChart: true }, SARAH);
      assert.ok(saved.ok);
      const again = await getNoteTemplate(ctx, A, t.id);
      assert.deepEqual([again?.bodyChart, again?.name, again?.active], [true, "Knee review (fictional)", true], "a patch changes only what it names");
      assert.deepEqual(await updateNoteTemplate(ctx, A, t.id, 1, { name: "Stale" }, SARAH), { ok: false, reason: "conflict", currentRev: 2 });
      assert.deepEqual(await updateNoteTemplate(ctx, B, t.id, 2, { name: "Cross" }, OTHER_CLINIC), { ok: false, reason: "not_found" });
      await rejects(updateNoteTemplate(ctx, A, "builtin-discharge", 1, { name: "x" }, SARAH), /Built-in/);
    });

    it("notes: a draft only its author changes, encrypted, never another clinic's", async () => {
      tick();
      const draft = await createNoteDraft(ctx, A, { patientId: ids.megan, caseId: ids.case, templateId: "builtin-initial-soap", seenOn: "2026-10-24", practitionerId: ids.prac }, SARAH_AUTHOR, SARAH);
      ids.note = draft.id;
      assert.deepEqual([draft.status, draft.rev, draft.noteType, draft.authorName], ["draft", 1, "initial", "Sarah Reid"]);
      await rejects(createNoteDraft(ctx, A, { patientId: ids.megan, caseId: ids.danielCase, templateId: "builtin-initial-soap", seenOn: "2026-10-24" }, SARAH_AUTHOR, SARAH), /same patient/);
      await rejects(createNoteDraft(ctx, B, { patientId: ids.megan, templateId: "builtin-initial-soap", seenOn: "2026-10-24" }, { name: "X" }, OTHER_CLINIC), /does not exist in this clinic/);
      await rejects(createNoteDraft(ctx, A, { patientId: ids.megan, templateId: "builtin-nope", seenOn: "2026-10-24" }, SARAH_AUTHOR, SARAH), /template/);
      const chart = { markers: [{ view: "front" as const, x: 48.26, y: 14.1, kind: "pain" as const, intensity: 6, label: "Right side of the neck" }] };
      const saved = await saveNoteDraft(
        ctx,
        A,
        draft.id,
        1,
        { sections: { subjective: "Neck pain since the collision", objective: "Reduced rotation to the right", smuggled: "not in the template" }, bodyChart: chart },
        SARAH,
      );
      assert.deepEqual(saved.ok ? saved.rev : saved, 2);
      await rejects(saveNoteDraft(ctx, A, draft.id, 2, { sections: { objective: "Tom's words" } }, TOM), /Only the note's author/);
      assert.deepEqual(await saveNoteDraft(ctx, A, draft.id, 1, { sections: { objective: "stale" } }, SARAH), { ok: false, reason: "conflict", currentRev: 2 });
      assert.deepEqual(await saveNoteDraft(ctx, B, draft.id, 2, { sections: { objective: "x" } }, OTHER_CLINIC), { ok: false, reason: "not_found" });
      const note = await getNote(ctx, A, draft.id);
      assert.deepEqual(note?.sections, { subjective: "Neck pain since the collision", objective: "Reduced rotation to the right" });
      assert.deepEqual(note?.bodyChart?.markers[0], { view: "front", x: 48.3, y: 14.1, kind: "pain", intensity: 6, label: "Right side of the neck" });
      assert.equal(await getNote(ctx, B, draft.id), null, "another clinic cannot read it");
      const raw = await ctx.db.selectFrom("pms_clinical_notes").select(["sections_enc", "body_chart_enc"]).where("tenant_id", "=", A).where("id", "=", draft.id).executeTakeFirstOrThrow();
      assert.ok(raw.sections_enc?.startsWith("v1.") && !raw.sections_enc.includes("collision"), "no plaintext in the row");
      assert.ok(raw.body_chart_enc && !raw.body_chart_enc.includes("neck"));
      const list = await listNotesForPatient(ctx, A, ids.megan);
      assert.deepEqual(list.map((n) => n.id), [draft.id]);
      assert.equal("sections" in list[0], false, "lists never decrypt");
      assert.deepEqual((await listDraftsByAuthor(ctx, A, SARAH.userId)).map((n) => n.id), [draft.id]);
      assert.equal((await listNotesForPatient(ctx, B, ids.megan)).length, 0);
    });

    it("notes: signing locks the content (repository and database), with a fingerprint", async () => {
      tick();
      await rejects(signNote(ctx, A, ids.note, 2, { name: "Tom Ellis" }, TOM), /Only the note's author/);
      const empty = await createNoteDraft(ctx, A, { patientId: ids.daniel, templateId: "builtin-follow-up-soap", seenOn: "2026-10-24" }, SARAH_AUTHOR, SARAH);
      await rejects(signNote(ctx, A, empty.id, 1, SARAH_AUTHOR, SARAH), /Write the note/);
      const future = await createNoteDraft(ctx, A, { patientId: ids.daniel, templateId: "builtin-follow-up-soap", seenOn: "2026-10-30" }, SARAH_AUTHOR, SARAH);
      await saveNoteDraft(ctx, A, future.id, 1, { sections: { subjective: "x" } }, SARAH);
      await rejects(signNote(ctx, A, future.id, 2, SARAH_AUTHOR, SARAH), /future/);
      assert.deepEqual(await signNote(ctx, A, ids.note, 1, SARAH_AUTHOR, SARAH), { ok: false, reason: "conflict", currentRev: 2 }, "sign what the author last saw");
      const signed = await signNote(ctx, A, ids.note, 2, SARAH_AUTHOR, SARAH);
      assert.ok(signed.ok);
      const note = await getNote(ctx, A, ids.note);
      assert.equal(note?.status, "signed");
      assert.equal(note?.signedByName, "Sarah Reid");
      assert.equal(note?.signedRegistration, "PH-DEMO-01");
      assert.equal(note?.signedAt, new Date(clock).toISOString());
      assert.equal(note?.contentHash, noteFingerprint("builtin-initial-soap", "2026-10-24", note!.sections, note!.bodyChart));
      await rejects(saveNoteDraft(ctx, A, ids.note, 3, { sections: { objective: "changed after signing" } }, SARAH), /signed and locked/);
      await rejects(discardNoteDraft(ctx, A, ids.note, 3, SARAH), /Only a draft/);
      // Even straight SQL cannot change a signed note's content (migration 0121 trigger).
      await assert.rejects(
        ctx.db.updateTable("pms_clinical_notes").set({ sections_enc: null }).where("tenant_id", "=", A).where("id", "=", ids.note).execute(),
        (err: unknown) => isLockedError(err),
      );
      await assert.rejects(
        ctx.db.updateTable("pms_clinical_notes").set({ status: "draft" }).where("tenant_id", "=", A).where("id", "=", ids.note).execute(),
        (err: unknown) => isLockedError(err),
      );
      // A ciphertext moved to another note no longer decrypts (AAD = clinic, table.column, row id).
      const raw = await ctx.db.selectFrom("pms_clinical_notes").select("sections_enc").where("tenant_id", "=", A).where("id", "=", ids.note).executeTakeFirstOrThrow();
      await ctx.db.updateTable("pms_clinical_notes").set({ sections_enc: raw.sections_enc }).where("tenant_id", "=", A).where("id", "=", empty.id).execute();
      await assert.rejects(getNote(ctx, A, empty.id), /Decryption failed/);
      await ctx.db.updateTable("pms_clinical_notes").set({ sections_enc: null }).where("tenant_id", "=", A).where("id", "=", empty.id).execute();
      assert.equal(await lastSignedNoteDate(ctx, A, ids.megan), "2026-10-24");
      assert.equal(await lastSignedNoteDate(ctx, A, ids.daniel), null);
      const discarded = await discardNoteDraft(ctx, A, empty.id, 1, SARAH);
      assert.ok(discarded.ok);
      assert.deepEqual((await listNotesForPatient(ctx, A, ids.daniel)).map((n) => n.id), [future.id], "discarded drafts are hidden…");
      assert.equal((await listNotesForPatient(ctx, A, ids.daniel, { includeDiscarded: true })).length, 2, "…and kept");
      await recordNoteView(ctx, A, ids.note, TOM);
    });

    it("amendments: addendum, correction, entered in error – locked, shown with the note", async () => {
      tick();
      await rejects(addAmendment(ctx, A, ids.note, { kind: "correction", text: "Left", reason: "Side" }, { name: "Tom Ellis" }, TOM), /Amendment/);
      await rejects(addAmendment(ctx, A, ids.note, { kind: "correction", sectionKey: "not_there", text: "Left", reason: "Side" }, { name: "Tom Ellis" }, TOM), /not part of this note/);
      const add = await addAmendment(ctx, A, ids.note, { kind: "addendum", text: "Patient phoned: headaches eased." }, { name: "Tom Ellis", registration: "PH-DEMO-02" }, TOM);
      assert.equal(add.authorRegistration, "PH-DEMO-02");
      tick();
      await addAmendment(ctx, A, ids.note, { kind: "correction", sectionKey: "objective", text: "Reduced rotation to the LEFT", reason: "Side recorded wrongly" }, SARAH_AUTHOR, SARAH);
      const draftNote = (await listNotesForPatient(ctx, A, ids.daniel))[0];
      await rejects(addAmendment(ctx, A, draftNote.id, { kind: "addendum", text: "x" }, SARAH_AUTHOR, SARAH), /Only a signed note/);
      await rejects(addAmendment(ctx, B, ids.note, { kind: "addendum", text: "x" }, { name: "X" }, OTHER_CLINIC), /does not exist in this clinic/);
      const note = await getNote(ctx, A, ids.note);
      assert.deepEqual(note?.amendments.map((a) => [a.kind, a.text, a.reason]), [
        ["addendum", "Patient phoned: headaches eased.", null],
        ["correction", "Reduced rotation to the LEFT", "Side recorded wrongly"],
      ]);
      assert.equal(note?.sections.objective, "Reduced rotation to the right", "the original stays as signed");
      assert.equal(note?.amendmentCount, 2);
      const raw = await ctx.db.selectFrom("pms_note_amendments").select(["id", "text_enc"]).where("tenant_id", "=", A).where("note_id", "=", ids.note).execute();
      assert.ok(raw.every((r) => !String(r.text_enc).includes("rotation")));
      await assert.rejects(
        ctx.db.updateTable("pms_note_amendments").set({ text_enc: null }).where("tenant_id", "=", A).where("id", "=", raw[0].id).execute(),
        (err: unknown) => isLockedError(err),
        "an amendment cannot change",
      );
      // Marking a whole note as entered in error (a second note, signed for the purpose).
      const wrong = await createNoteDraft(ctx, A, { patientId: ids.megan, templateId: "builtin-follow-up-soap", seenOn: "2026-10-24" }, SARAH_AUTHOR, SARAH);
      await saveNoteDraft(ctx, A, wrong.id, 1, { sections: { subjective: "Meant for another patient" } }, SARAH);
      await signNote(ctx, A, wrong.id, 2, SARAH_AUTHOR, SARAH);
      await addAmendment(ctx, A, wrong.id, { kind: "entered_in_error", text: "", reason: "Written in the wrong record" }, SARAH_AUTHOR, SARAH);
      const marked = await getNote(ctx, A, wrong.id);
      assert.equal(marked?.enteredInError, true);
      assert.equal(marked?.sections.subjective, "Meant for another patient", "still readable");
      await rejects(addAmendment(ctx, A, wrong.id, { kind: "entered_in_error", text: "", reason: "Again" }, SARAH_AUTHOR, SARAH), /already marked/);
    });

    it("outcome measures: scored by the repository, answers encrypted, errors kept but left out", async () => {
      tick();
      const ndi = await recordOutcome(
        ctx,
        A,
        { patientId: ids.megan, caseId: ids.case, noteId: ids.note, measure: "ndi", takenOn: "2026-10-24", answers: { items: { s1: 3, s2: 2, s3: 3, s4: 2, s5: 3, s6: 2, s7: 2, s8: 2, s9: 2, s10: 1 } } },
        SARAH,
      );
      ids.ndi = ndi.id;
      assert.deepEqual([ndi.scoreTenths, ndi.band, ndi.answered], [440, "Moderate", 10]);
      const psfs = await recordOutcome(
        ctx,
        A,
        { patientId: ids.megan, measure: "psfs", takenOn: "2026-10-20", answers: { items: { a1: 3, a2: 4, a3: 6 }, activities: { a1: "Turning to reverse the car", a2: "Reading for an hour", a3: "Sleeping through" } } },
        SARAH,
      );
      assert.equal(psfs.scoreTenths, 43);
      const raw = await ctx.db.selectFrom("pms_outcome_measures").select("answers_enc").where("tenant_id", "=", A).where("id", "=", psfs.id).executeTakeFirstOrThrow();
      assert.ok(!String(raw.answers_enc).includes("reverse"), "the activities are encrypted");
      assert.equal((await getOutcome(ctx, A, psfs.id))?.answers?.activities?.a1, "Turning to reverse the car");
      await rejects(recordOutcome(ctx, A, { patientId: ids.megan, measure: "nprs", takenOn: "2026-10-25", answers: { items: { pain: 4 } } }, SARAH), /future/);
      await rejects(recordOutcome(ctx, A, { patientId: ids.megan, measure: "nprs", takenOn: "2026-10-24", answers: { items: { pain: 14 } } }, SARAH), /0 to 10/);
      await rejects(recordOutcome(ctx, A, { patientId: ids.daniel, noteId: ids.note, measure: "nprs", takenOn: "2026-10-24", answers: { items: { pain: 4 } } }, SARAH), /same patient/);
      await rejects(recordOutcome(ctx, B, { patientId: ids.megan, measure: "nprs", takenOn: "2026-10-24", answers: { items: { pain: 4 } } }, OTHER_CLINIC), /does not exist/);
      const bulk = await bulkRecordOutcomes(
        ctx,
        A,
        [3, 5, 7].map((pain, i) => ({ patientId: ids.daniel, measure: "nprs" as const, takenOn: `2026-10-0${i + 1}`, answers: { items: { pain } } })),
        SARAH,
        { source: "test" },
      );
      assert.equal(bulk.length, 3);
      assert.deepEqual((await listOutcomesForPatient(ctx, A, ids.daniel)).map((o) => o.scoreTenths), [30, 50, 70]);
      assert.equal(await markOutcomeInError(ctx, A, bulk[1], "Wrong patient's sheet", SARAH), true);
      assert.equal(await markOutcomeInError(ctx, A, bulk[1], "again", SARAH), false);
      assert.equal(await markOutcomeInError(ctx, B, bulk[0], "cross", OTHER_CLINIC), false, "another clinic changes nothing");
      assert.deepEqual((await listOutcomesForPatient(ctx, A, ids.daniel)).map((o) => o.scoreTenths), [30, 70]);
      assert.equal((await listOutcomesForPatient(ctx, A, ids.daniel, { includeErrors: true })).length, 3);
      assert.equal((await getOutcome(ctx, A, bulk[1]))?.errorReason, "Wrong patient's sheet");
      assert.equal(await getOutcome(ctx, B, ids.ndi), null);
    });

    it("files: checked by their bytes, encrypted in pieces, verified on the way out, withdrawn never deleted", async () => {
      tick();
      const big = pdfBytes(ATTACHMENT_CHUNK_BYTES * 3 + 1234); // 4 pieces: two batches
      const meta = await putAttachment(ctx, A, { patientId: ids.megan, noteId: ids.note, bytes: big, fileName: "Megan Hart MRI report.pdf", description: "MRI cervical spine (fictional)" }, SARAH);
      ids.file = meta.id;
      assert.deepEqual([meta.type, meta.chunkCount, meta.sizeBytes], ["pdf", 4, big.length]);
      const file = await getAttachmentFile(ctx, A, meta.id);
      assert.ok(file && file.bytes.equals(big), "the same bytes come back");
      assert.equal(file?.details.fileName, "Megan Hart MRI report.pdf");
      const rawMeta = await ctx.db.selectFrom("pms_attachments").select(["file_name_enc", "description_enc"]).where("tenant_id", "=", A).where("id", "=", meta.id).executeTakeFirstOrThrow();
      assert.ok(!String(rawMeta.file_name_enc).includes("Megan") && !String(rawMeta.description_enc).includes("MRI"), "name and description encrypted");
      const chunks = await ctx.db.selectFrom("pms_attachment_chunks").select(["id", "data_enc"]).where("tenant_id", "=", A).where("attachment_id", "=", meta.id).orderBy("idx").execute();
      assert.equal(chunks.length, 4);
      assert.ok(chunks.every((c) => c.data_enc?.startsWith("v1.")));
      assert.equal(await getAttachmentFile(ctx, B, meta.id), null, "another clinic cannot read it");
      // A piece swapped with another one no longer decrypts.
      await ctx.db.updateTable("pms_attachment_chunks").set({ data_enc: chunks[0].data_enc }).where("tenant_id", "=", A).where("id", "=", chunks[1].id).execute();
      await assert.rejects(getAttachmentFile(ctx, A, meta.id), /Decryption failed/);
      await ctx.db.updateTable("pms_attachment_chunks").set({ data_enc: chunks[1].data_enc }).where("tenant_id", "=", A).where("id", "=", chunks[1].id).execute();
      assert.ok((await getAttachmentFile(ctx, A, meta.id))?.bytes.equals(big));
      await rejects(putAttachment(ctx, A, { patientId: ids.megan, bytes: Buffer.from("<html><script>"), fileName: "x.pdf" }, SARAH), /Only PDF/);
      await rejects(putAttachment(ctx, A, { patientId: ids.megan, bytes: pdfBytes(4_000_001), fileName: "big.pdf" }, SARAH), /larger than/);
      await rejects(putAttachment(ctx, A, { patientId: ids.daniel, noteId: ids.note, bytes: pdfBytes(100), fileName: "x.pdf" }, SARAH), /same patient/);
      await rejects(putAttachment(ctx, B, { patientId: ids.megan, bytes: pdfBytes(100), fileName: "x.pdf" }, OTHER_CLINIC), /does not exist/);
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
      const pic = await putAttachment(ctx, A, { patientId: ids.megan, bytes: png, fileName: "exercise sheet.pdf" }, SARAH);
      assert.equal(pic.type, "png");
      assert.equal((await getPatientAttachments(ctx, A, ids.megan)).find((a) => a.id === pic.id)?.fileName, "exercise sheet.png", "the extension follows the contents");
      assert.equal(await withdrawAttachment(ctx, A, pic.id, "Uploaded twice", SARAH), true);
      assert.equal(await withdrawAttachment(ctx, B, meta.id, "cross", OTHER_CLINIC), false);
      assert.equal((await listAttachmentsForPatient(ctx, A, ids.megan)).some((a) => a.id === pic.id), false, "withdrawn files are hidden…");
      assert.equal((await listAttachmentsForPatient(ctx, A, ids.megan, { includeWithdrawn: true })).some((a) => a.id === pic.id), true, "…and kept");
      assert.ok(await getAttachmentFile(ctx, A, pic.id), "a withdrawn file is still stored");
      await recordAttachmentDownload(ctx, A, meta.id, TOM);
      assert.equal(createHash("sha256").update(big).digest("hex"), meta.sha256);
    });

    it("history: the audit rows about this patient's record only, newest first", async () => {
      const rows = await listPatientHistory(ctx, A, ids.megan);
      const actions = rows.map((r) => r.action);
      for (const a of ["pms.patient.create", "pms.case.create", "pms.note.create", "pms.note.save", "pms.note.sign", "pms.note.amend", "pms.note.view", "pms.outcome.record", "pms.attachment.upload", "pms.attachment.download", "pms.attachment.withdraw"]) {
        assert.ok(actions.includes(a), a);
      }
      assert.ok(!actions.includes("pms.note_template.create"), "nothing about other records");
      assert.ok(rows.every((r) => r.tenantId === A));
      for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].id > rows[i].id, "newest first");
      assert.equal((await listPatientHistory(ctx, B, ids.megan)).length, 0, "another clinic sees nothing");
      assert.ok(!(await listPatientHistory(ctx, A, ids.daniel)).some((r) => r.targetId === ids.note));
    });

    it("subject access: everything about the patient, decrypted", async () => {
      const data = await collectSubjectAccess(ctx, A, ids.megan);
      assert.ok(data);
      assert.equal(data.patient.firstName, "Megan");
      assert.equal(data.cases[0].referralReason, "Whiplash after a rear-end collision");
      assert.ok(data.notes.some((n) => n.sections.subjective === "Neck pain since the collision" && n.amendments.length === 2));
      assert.ok(data.outcomes.some((o) => o.answers?.activities?.a2 === "Reading for an hour"));
      assert.equal(data.attachments.length, 2, "withdrawn files are listed too");
      assert.equal(data.names.practitioners[ids.prac], "Sarah Reid (PH-DEMO-01)");
      assert.equal(await collectSubjectAccess(ctx, B, ids.megan), null);
    });

    it("same-batch audit: a refused or stale change leaves no audit row; a done one leaves exactly one", async () => {
      tick();
      const count = async (action: string, targetId: string) => (await listAudit(ctx, A, { limit: 500 })).filter((e) => e.action === action && e.targetId === targetId).length;
      const draft = await createNoteDraft(ctx, A, { patientId: ids.daniel, templateId: "builtin-follow-up-soap", seenOn: "2026-10-20", appointmentId: "appt_01JB0000000000000000000001" }, SARAH_AUTHOR, SARAH);
      assert.equal(draft.appointmentId, "appt_01JB0000000000000000000001");
      assert.deepEqual((await listNotesForPatient(ctx, A, ids.daniel, { appointmentId: "appt_01JB0000000000000000000001" })).map((n) => n.id), [draft.id]);
      assert.equal((await getNote(ctx, A, draft.id))?.template.version, 1, "the note keeps the template's version");
      assert.equal(await count("pms.note.save", draft.id), 0);
      assert.deepEqual(await saveNoteDraft(ctx, A, draft.id, 7, { sections: { subjective: "stale" } }, SARAH), { ok: false, reason: "conflict", currentRev: 1 });
      await rejects(saveNoteDraft(ctx, A, draft.id, 1, { sections: { subjective: "not mine" } }, TOM), /Only the note's author/);
      assert.equal(await count("pms.note.save", draft.id), 0, "no audit row for a change that did not happen");
      assert.ok((await saveNoteDraft(ctx, A, draft.id, 1, { sections: { subjective: "Better this week" } }, SARAH)).ok);
      assert.equal(await count("pms.note.save", draft.id), 1);
      tick();
      assert.deepEqual(await discardNoteDraft(ctx, A, draft.id, 1, SARAH), { ok: false, reason: "conflict", currentRev: 2 });
      await rejects(discardNoteDraft(ctx, A, draft.id, 0, SARAH), /expectedRev/);
      assert.equal(await count("pms.note.discard", draft.id), 0);
      assert.equal(await markOutcomeInError(ctx, A, ids.ndi, "Duplicate entry", SARAH), true);
      assert.equal(await count("pms.outcome.error", ids.ndi), 1);
      assert.equal(await markOutcomeInError(ctx, A, ids.ndi, "again", SARAH), false);
      assert.equal(await count("pms.outcome.error", ids.ndi), 1, "the second marking changed nothing and left no row");
      ids.unsignedDraft = draft.id;
    });

    it("unsigned notes: per author and for the whole clinic, overdue by consultation date", async () => {
      const all = await listUnsignedNotes(ctx, A);
      assert.ok(all.length >= 2 && all.every((n) => n.status === "draft"));
      for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].seenOn <= all[i].seenOn, "oldest consultation first");
      assert.ok(all.every((n) => !("sections" in n)), "nothing decrypted");
      assert.deepEqual((await listUnsignedNotes(ctx, A, { authorUserId: TOM.userId })).length, 0);
      const overdue = await listUnsignedNotes(ctx, A, { authorUserId: SARAH.userId, seenOnOrBefore: "2026-10-21" });
      assert.ok(overdue.some((n) => n.id === ids.unsignedDraft) && overdue.every((n) => n.seenOn <= "2026-10-21"));
      const counts = await countUnsignedNotesByAuthor(ctx, A, { overdueOnOrBefore: "2026-10-21" });
      const sarah = counts.find((c) => c.authorUserId === SARAH.userId);
      assert.ok(sarah && sarah.drafts === all.filter((n) => n.authorUserId === SARAH.userId).length && sarah.overdue === overdue.length && sarah.authorName === "Sarah Reid");
      assert.deepEqual(await listUnsignedNotes(ctx, B), [], "another clinic sees none of them");
      assert.deepEqual(await countUnsignedNotesByAuthor(ctx, B, { overdueOnOrBefore: "2026-10-21" }), []);
      await rejects(listUnsignedNotes(ctx, A, { seenOnOrBefore: "21/10/2026" }), /date/);
    });

    it("note settings: defaults, revision-checked saves, per clinic", async () => {
      assert.deepEqual(await getRecordsSettings(ctx, A), { unsignedNoteDays: 1, rev: 0, updatedAt: null });
      const first = await saveRecordsSettings(ctx, A, 0, { unsignedNoteDays: 5 }, SARAH);
      assert.ok(first.ok && first.rev === 1);
      assert.deepEqual(await saveRecordsSettings(ctx, A, 0, { unsignedNoteDays: 6 }, SARAH), { ok: false, reason: "conflict", currentRev: 1 });
      assert.ok((await saveRecordsSettings(ctx, A, 1, { unsignedNoteDays: 7 }, SARAH)).ok);
      assert.deepEqual(await saveRecordsSettings(ctx, A, 1, { unsignedNoteDays: 8 }, SARAH), { ok: false, reason: "conflict", currentRev: 2 });
      await rejects(saveRecordsSettings(ctx, A, 2, { unsignedNoteDays: 0 }, SARAH), /At least 1/);
      assert.equal((await getRecordsSettings(ctx, A)).unsignedNoteDays, 7);
      assert.equal((await getRecordsSettings(ctx, B)).unsignedNoteDays, 1, "another clinic keeps its own");
    });

    it("templates: copy, change (new version, old notes keep theirs), retire and bring back", async () => {
      tick();
      const copy = await copyNoteTemplate(ctx, A, "builtin-discharge", "Discharge (clinic)", SARAH);
      assert.deepEqual([copy.builtin, copy.rev, copy.sections.length], [false, 1, 5]);
      const note = await createNoteDraft(ctx, A, { patientId: ids.daniel, templateId: copy.id, seenOn: "2026-10-23" }, SARAH_AUTHOR, SARAH);
      const changed = await updateNoteTemplate(ctx, A, copy.id, 1, { sections: [{ key: "reason", label: "Why discharged" }] }, SARAH);
      assert.ok(changed.ok && changed.rev === 2);
      const kept = await getNote(ctx, A, note.id);
      assert.deepEqual([kept?.template.version, kept?.template.sections.length], [1, 5], "the note keeps the version it was started from");
      const retired = await setNoteTemplateActive(ctx, A, copy.id, 2, false, SARAH);
      assert.ok(retired.ok);
      assert.ok(!(await listNoteTemplates(ctx, A)).some((t) => t.id === copy.id), "retired templates are not offered");
      assert.ok((await listNoteTemplates(ctx, A, { includeInactive: true })).some((t) => t.id === copy.id), "…but kept");
      await rejects(createNoteDraft(ctx, A, { patientId: ids.daniel, templateId: copy.id, seenOn: "2026-10-23" }, SARAH_AUTHOR, SARAH), /in use/);
      assert.ok((await setNoteTemplateActive(ctx, A, copy.id, 3, true, SARAH)).ok);
      const actions = (await listAudit(ctx, A, { limit: 500 })).filter((e) => e.targetId === copy.id).map((e) => e.action);
      for (const a of ["pms.note_template.create", "pms.note_template.update", "pms.note_template.retire", "pms.note_template.restore"]) assert.ok(actions.includes(a), a);
      assert.deepEqual(await setNoteTemplateActive(ctx, B, copy.id, 4, false, OTHER_CLINIC), { ok: false, reason: "not_found" });
      await rejects(copyNoteTemplate(ctx, B, copy.id, "Stolen", OTHER_CLINIC), /does not exist/);
    });

    it("possible duplicates: same last name and birth date, email or phone – this clinic only", async () => {
      const lucy = await createPatient(ctx, A, { firstName: "Lucy", lastName: "O'Neill", dateOfBirth: "1988-05-04", email: "lucy.oneill@example.com", phoneMobile: "07700 900123" }, SARAH);
      await createPatient(ctx, B, { firstName: "Lucy", lastName: "O'Neill", dateOfBirth: "1988-05-04" }, OTHER_CLINIC);
      const byName = await findPossibleDuplicates(ctx, A, { firstName: "Lucie", lastName: "O'Neill", dateOfBirth: "1988-05-04" });
      assert.deepEqual(byName.map((d) => [d.patient.id, d.reasons]), [[lucy.id, ["name_and_birth_date"]]]);
      assert.deepEqual((await findPossibleDuplicates(ctx, A, { lastName: "Someone", email: "LUCY.ONEILL@example.com" }))[0]?.reasons, ["email"]);
      assert.deepEqual((await findPossibleDuplicates(ctx, A, { lastName: "Someone", phones: ["+44 7700 900123"] }))[0]?.reasons, ["phone"]);
      assert.deepEqual(await findPossibleDuplicates(ctx, A, { lastName: "Smith", dateOfBirth: "1988-05-04" }), [], "same birth date, other name: no match");
      assert.deepEqual(await findPossibleDuplicates(ctx, A, { lastName: "O'Neill", dateOfBirth: "1988-05-04" }, { excludeId: lucy.id }), []);
      assert.deepEqual(await findPossibleDuplicates(ctx, A, { firstName: "Lucy", lastName: "O'Neill" }), [], "a name alone is not enough");
      assert.equal((await findPossibleDuplicates(ctx, B, { lastName: "O'Neill", dateOfBirth: "1988-05-04" })).length, 1, "the other clinic finds only its own");
    });

    it("pronouns and clinical flags (0125): revisioned, encrypted flags, ended not deleted, per clinic", async () => {
      tick();
      assert.deepEqual(await getPatientExtras(ctx, A, ids.megan), { pronouns: null, rev: 0 });
      const first = await savePatientPronouns(ctx, A, ids.megan, 0, "  she/her ", SARAH);
      assert.ok(first.ok && first.rev === 1);
      assert.deepEqual(await savePatientPronouns(ctx, A, ids.megan, 0, "they/them", SARAH), { ok: false, reason: "conflict", currentRev: 1 });
      tick();
      assert.ok((await savePatientPronouns(ctx, A, ids.megan, 1, "she/they", SARAH)).ok);
      assert.deepEqual(await getPatientExtras(ctx, A, ids.megan), { pronouns: "she/they", rev: 2 });
      assert.deepEqual(Array.from((await getPronounsFor(ctx, A, [ids.megan, ids.daniel])).entries()), [[ids.megan, "she/they"]]);
      await rejects(savePatientPronouns(ctx, B, ids.megan, 0, "x", OTHER_CLINIC), /does not exist/);
      assert.deepEqual(await getPatientExtras(ctx, B, ids.megan), { pronouns: null, rev: 0 }, "another clinic reads nothing");
      await rejects(savePatientPronouns(ctx, A, ids.megan, 2, "x".repeat(41), SARAH), /40/);

      const flag = await addClinicalFlag(ctx, A, ids.megan, { text: "  On   anticoagulants " }, SARAH);
      assert.deepEqual([flag.text, flag.status, flag.rev], ["On anticoagulants", "active", 1]);
      const row = await ctx.db.selectFrom("pms_clinical_flags").selectAll().where("tenant_id", "=", A).where("id", "=", flag.id).executeTakeFirstOrThrow();
      assert.ok(row.flag_enc && !row.flag_enc.includes("anticoagulants"), "encrypted at rest");
      // A ciphertext moved to another row does not decrypt there.
      const second = await addClinicalFlag(ctx, A, ids.megan, { text: "Pacemaker fitted" }, SARAH);
      await ctx.db.updateTable("pms_clinical_flags").set({ flag_enc: row.flag_enc }).where("tenant_id", "=", A).where("id", "=", second.id).execute();
      await assert.rejects(listClinicalFlags(ctx, A, ids.megan));
      await ctx.db.updateTable("pms_clinical_flags").set({ flag_enc: null }).where("tenant_id", "=", A).where("id", "=", second.id).execute();
      await rejects(addClinicalFlag(ctx, B, ids.megan, { text: "x" }, OTHER_CLINIC), /does not exist/);
      await rejects(addClinicalFlag(ctx, A, ids.megan, { text: "   " }, SARAH), /Write the flag/);
      assert.deepEqual(await listClinicalFlags(ctx, B, ids.megan), [], "another clinic reads none");
      assert.deepEqual(await endClinicalFlag(ctx, B, flag.id, 1, OTHER_CLINIC), { ok: false, reason: "not_found" });
      tick();
      const ended = await endClinicalFlag(ctx, A, second.id, 1, SARAH);
      assert.ok(ended.ok && ended.rev === 2);
      await rejects(endClinicalFlag(ctx, A, second.id, 2, SARAH), /already ended/);
      assert.deepEqual((await listClinicalFlags(ctx, A, ids.megan)).map((f) => f.text), ["On anticoagulants"]);
      assert.deepEqual((await listClinicalFlags(ctx, A, ids.megan, { includeEnded: true })).map((f) => f.status), ["active", "ended"], "kept, never deleted");
      const data = await collectSubjectAccess(ctx, A, ids.megan);
      assert.deepEqual([data?.pronouns, data?.clinicalFlags.length], ["she/they", 2], "in the subject-access copy");
      const history = (await listPatientHistory(ctx, A, ids.megan)).map((e) => e.action);
      for (const code of ["pms.patient_extras.update", "pms.clinical_flag.add", "pms.clinical_flag.end"]) assert.ok(history.includes(code), code);
    });

    it("anonymising: refused before the record-keeping period or on hold; afterwards removes identity and free text", async () => {
      tick();
      const early = await anonymiseEligibility(ctx, A, ids.megan);
      assert.ok(early && !early.check.allowed && early.check.reason === "too_early");
      await rejects(anonymisePatient(ctx, A, ids.megan, { confirmNumber: 1, reviewed: true }, SARAH), /record-keeping period has not ended/);
      // A fictional patient last treated in 2016.
      const old = await createPatient(ctx, A, { firstName: "Alan", lastName: "Whitfield", dateOfBirth: "1950-04-02", phoneMobile: "07700 900777", email: "alan.whitfield@example.com", alerts: "Pacemaker" }, SARAH);
      ids.old = old.id;
      const oldCase = await createCase(ctx, A, { patientId: old.id, title: "Left shoulder", openedOn: "2015-09-01", status: "closed", closedOn: "2016-02-01", referralReason: "Frozen shoulder", membershipNumber: "NW-9", claimReference: "CLM-1" }, SARAH);
      await createAuthorisation(ctx, A, { caseId: oldCase.id, code: "NW-AUTH-77", sessionsAuthorised: 6, notes: "Phoned through" }, SARAH);
      await touchPatientLastSeen(ctx, A, old.id, "2016-02-01");
      const savedClock = clock;
      clock = Date.parse("2016-01-10T10:00:00.000Z");
      const n = await createNoteDraft(ctx, A, { patientId: old.id, caseId: oldCase.id, templateId: "builtin-discharge", seenOn: "2016-01-10" }, SARAH_AUTHOR, SARAH);
      await saveNoteDraft(ctx, A, n.id, 1, { sections: { reason: "Goals met, Alan back to golf" } }, SARAH);
      await signNote(ctx, A, n.id, 2, SARAH_AUTHOR, SARAH);
      await addAmendment(ctx, A, n.id, { kind: "addendum", text: "Letter sent to Dr Patel" }, SARAH_AUTHOR, SARAH);
      await recordOutcome(ctx, A, { patientId: old.id, measure: "psfs", takenOn: "2016-01-10", answers: { items: { a1: 8, a2: 9, a3: 9 }, activities: { a1: "Golf swing", a2: "Reaching up", a3: "Dressing" } } }, SARAH);
      clock = savedClock;
      const file = await putAttachment(ctx, A, { patientId: old.id, bytes: pdfBytes(5000), fileName: "Alan Whitfield discharge.pdf" }, SARAH);
      await addClinicalFlag(ctx, A, old.id, { text: "Pacemaker fitted" }, SARAH);
      await savePatientPronouns(ctx, A, old.id, 0, "he/him", SARAH);
      await setPatientLegalHold(ctx, A, old.id, true, SARAH);
      await rejects(anonymisePatient(ctx, A, old.id, { confirmNumber: old.patientNumber, reviewed: true }, SARAH), /on hold/);
      await setPatientLegalHold(ctx, A, old.id, false, SARAH);
      await rejects(anonymisePatient(ctx, A, old.id, { confirmNumber: old.patientNumber + 1, reviewed: true }, SARAH), /patient's number/);
      await rejects(anonymisePatient(ctx, B, old.id, { confirmNumber: old.patientNumber, reviewed: true }, OTHER_CLINIC), /does not exist/);
      const ok = await anonymiseEligibility(ctx, A, old.id);
      assert.ok(ok?.check.allowed && ok.lastTreatmentOn === "2016-02-01");

      const counts = await anonymisePatient(ctx, A, old.id, { confirmNumber: old.patientNumber, reviewed: false }, SARAH);
      assert.deepEqual(counts, { notes: 1, amendments: 1, outcomes: 1, attachments: 1, cases: 1, authorisations: 1 });
      const p = await getPatient(ctx, A, old.id);
      assert.deepEqual([p?.firstName, p?.lastName, p?.dateOfBirth, p?.phoneMobile, p?.email, p?.alerts, p?.status], ["Anonymised", `patient ${old.patientNumber}`, null, null, null, null, "archived"]);
      const note = await getNote(ctx, A, n.id);
      assert.deepEqual([note?.status, note?.sections, note?.amendments[0].text, note?.signedByName], ["signed", {}, null, "Sarah Reid"], "who signed what stays; the text goes");
      assert.ok(note?.anonymisedAt);
      const c = await getCase(ctx, A, oldCase.id);
      assert.deepEqual([c?.referralReason, c?.membershipNumber, c?.claimReference, c?.title], [null, null, null, "Left shoulder"]);
      const auth = (await getAuthorisation(ctx, A, (await ctx.db.selectFrom("pms_authorisations").select("id").where("tenant_id", "=", A).where("patient_id", "=", old.id).executeTakeFirstOrThrow()).id))!;
      assert.deepEqual([auth.code, auth.notes], ["ANON-1", null]);
      const outcome = (await listOutcomesForPatient(ctx, A, old.id))[0];
      assert.equal(outcome.scoreTenths, 87, "scores stay for the figures");
      assert.equal((await getOutcome(ctx, A, outcome.id))?.answers, null);
      assert.equal(await getAttachmentFile(ctx, A, file.id), null, "the file's bytes are gone");
      assert.equal((await getAnonymisation(ctx, A, old.id))?.status, "done");
      assert.deepEqual((await listClinicalFlags(ctx, A, old.id, { includeEnded: true })).map((f) => [f.text, f.status]), [[null, "ended"]], "the flag's words go");
      assert.equal((await getPatientExtras(ctx, A, old.id)).pronouns, null);
      await rejects(anonymisePatient(ctx, A, old.id, { confirmNumber: old.patientNumber, reviewed: true }, SARAH), /already been anonymised/);
      await rejects(createNoteDraft(ctx, A, { patientId: old.id, templateId: "builtin-follow-up-soap", seenOn: "2026-10-24" }, SARAH_AUTHOR, SARAH), /anonymised/);
      const dump = JSON.stringify(await ctx.db.selectFrom("pms_patients").selectAll().where("tenant_id", "=", A).where("id", "=", old.id).execute());
      for (const s of ["Alan", "Whitfield", "1950", "900777", "example.com"]) assert.ok(!dump.includes(s), s);
    });

    it("every write was audited under its own clinic, with ids and counts only", async () => {
      const a = await listAudit(ctx, A, { limit: 500 });
      const codes = new Set(a.map((e) => e.action));
      for (const code of [
        "pms.note_template.create",
        "pms.note_template.update",
        "pms.note.create",
        "pms.note.save",
        "pms.note.sign",
        "pms.note.discard",
        "pms.note.amend",
        "pms.note.view",
        "pms.outcome.record",
        "pms.outcome.bulk_create",
        "pms.outcome.error",
        "pms.attachment.upload",
        "pms.attachment.download",
        "pms.attachment.withdraw",
        "pms.patient.anonymise",
        "pms.note_template.retire",
        "pms.note_template.restore",
        "pms.records_settings.update",
        "pms.patient_extras.update",
        "pms.clinical_flag.add",
        "pms.clinical_flag.end",
      ]) {
        assert.ok(codes.has(code), code);
      }
      const text = JSON.stringify(a);
      for (const secret of ["collision", "rotation", "headaches", "Reading for an hour", "MRI", "Megan Hart MRI", "Golf", "Pacemaker", "Uploaded twice", "Wrong patient's sheet", "anticoagulants", "she/they"]) assert.ok(!text.includes(secret), secret);
      const b = await listAudit(ctx, B, { limit: 500 });
      assert.ok(b.every((e) => e.userId === OTHER_CLINIC.userId), "the other clinic's trail holds only its own writes");
    });

    it("tenant-scope guard: every clinic-system statement named tenant_id", () => {
      if (!suite.log) return;
      assert.ok(suite.log.statements.length > 100, `recorded ${suite.log.statements.length} statements`);
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
