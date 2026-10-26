/**
 * Review workspace model – the edits: every change the review screen makes to a report (paragraph text, structured
 * answers, a value from the clinic's details, consent, approval, an amended version). Every edit is immutable and
 * bumps `updatedAt`. The validators (core/validation) re-run on the result in the screen; nothing here decides
 * whether a report can be approved.
 *
 * Pure, no React. Split out of review-model.ts by W0.4 (bh2 module split, pure move; review-model.ts re-exports it).
 * Owner: WC (review roles and provenance) – docs/bh2-ownership.json.
 */
import { formatUkDate, nowIso } from "../../../core/dates";
import { isSectionAnswered } from "../../../core/forms";
import {
  actsAsApprover,
  answerSet,
  approverEntryLost,
  approverRefOf,
  boxContentSha,
  isClinicianBox,
  isClinicianGap,
  isPersonParagraph,
  mayApprove,
  paragraphResidue,
  pendingProposal,
  personOrigin,
  residueSentences,
  sameMember,
  sentenceSha,
  voidDecisionsNotBy,
  VOIDED_ADOPTION_SHA,
  type BoxContext,
} from "../../../core/provenance";
import { controllerSnapshotOf, isReleaseModel } from "../../../core/issue-state";
import { appendActivity } from "../../../core/report-factory";
import { splitSentences } from "../../../core/text/sentences";
import type { Actor, Paragraph, PhraseAcceptance, Report, ReportFlag, ReportSection, SectionDisposition, SectionDispositionKind, SignReceipt } from "../../../core/types";

/* ------------------------------------------------------------------------------------------------
 * Edits (immutable; each bumps updatedAt)
 * ----------------------------------------------------------------------------------------------*/

function touch(report: Report, sections: ReportSection[], now?: Date): Report {
  return { ...report, sections, updatedAt: nowIso(now) };
}

function settleStatus(section: ReportSection): ReportSection["status"] {
  if (isSectionAnswered(section)) return section.status === "drafted" ? "drafted" : "complete";
  return section.status === "pending" ? "pending" : "needs_input";
}

function mapSection(report: Report, key: string, fn: (s: ReportSection) => ReportSection): ReportSection[] {
  return report.sections.map((s) => {
    if (s.key !== key) return s;
    const next = fn(s);
    return next === s ? s : { ...next, status: settleStatus(next) };
  });
}

/**
 * Change a paragraph's text. AI text becomes "edited" (its first wording is kept in `originalText`, so
 * it can be reverted); typing it back exactly reverts it to "ai". A changed paragraph loses any
 * acknowledgement reason (the clinician re-acknowledges the new wording). From-records text is locked.
 */
export function editParagraph(report: Report, key: string, paragraphId: string, text: string, now?: Date): Report {
  let changed = false;
  const sections = mapSection(report, key, (s) => {
    const paragraphs = s.paragraphs.map((p): Paragraph => {
      if (p.id !== paragraphId || p.text === text || p.origin === "from_records") return p;
      changed = true;
      const next: Paragraph = { ...p, text };
      delete next.ackReason;
      if (p.origin === "ai") {
        next.origin = "edited";
        next.originalText = p.originalText ?? p.text;
      } else if (p.origin === "edited" && p.originalText !== undefined && text === p.originalText) {
        next.origin = "ai";
      }
      return next;
    });
    return changed ? { ...s, paragraphs } : s;
  });
  return changed ? touch(report, sections, now) : report;
}

/** Put an edited paragraph back to the AI's wording. */
export function revertParagraph(report: Report, key: string, paragraphId: string, now?: Date): Report {
  let changed = false;
  const sections = mapSection(report, key, (s) => {
    const paragraphs = s.paragraphs.map((p): Paragraph => {
      if (p.id !== paragraphId || p.origin !== "edited" || p.originalText === undefined) return p;
      changed = true;
      const next: Paragraph = { ...p, text: p.originalText, origin: "ai" };
      delete next.ackReason;
      return next;
    });
    return changed ? { ...s, paragraphs } : s;
  });
  return changed ? touch(report, sections, now) : report;
}

/**
 * Fix round 1 (B0-4): change a value filled from the clinic's own details on this report only (another of the clinic's
 * sites treated the patient). The value filled by code becomes the person's own entry ("Entered by staff", editable,
 * printed instead of the setting); the activity log says what it was. Only a section filled from the records, and only
 * while it still holds the value filled by code.
 */
export function overrideRecordValue(report: Report, key: string, actor: string, now?: Date): Report {
  const section = report.sections.find((s) => s.key === key);
  if (!section || section.kind !== "from_records" || section.paragraphs.length === 0 || !section.paragraphs.every((p) => p.origin === "from_records")) return report;
  const was = section.paragraphs.map((p) => p.text).join(", ");
  const sections = mapSection(report, key, (s) => ({
    ...s,
    paragraphs: [{ id: nextClinicianParagraphId(s), text: s.paragraphs.map((p) => p.text).join("\n"), sourceIds: [], origin: "clinician" }],
  }));
  return appendActivity(touch(report, sections, now), { actor, action: "edited", detail: `${key}: “${section.title}” changed for this report only (was “${was}” from the Clinic details) – entered by staff.` }, now);
}

/** The ID the next clinician paragraph of this section gets ("F-14-c1", "F-14-c2"…). */
export function nextClinicianParagraphId(section: Pick<ReportSection, "key" | "paragraphs">): string {
  let n = section.paragraphs.length + 1;
  const taken = new Set(section.paragraphs.map((p) => p.id));
  while (taken.has(`${section.key}-c${n}`)) n += 1;
  return `${section.key}-c${n}`;
}

/**
 * A new paragraph written by the clinician (origin "clinician", no citations needed).
 *
 * Safety amendment (C-REV-2 stop-gap, release/bh-trial-2): written by staff (`opts.byStaff`) in a box that is not filled
 * from the records, it is origin "edited" – checked like edited text (citation, figures, opinion wording, voice) – never
 * the clinician's own words. A value staff type into a records box (a staff entry) stays as before ("Entered by staff").
 * Workstream WC replaces this with origin "staff" and the approver's adoption.
 */
export function addClinicianParagraph(report: Report, key: string, text = "", now?: Date, opts: { byStaff?: boolean } = {}): { report: Report; paragraphId: string } {
  const section = report.sections.find((s) => s.key === key);
  if (!section) return { report, paragraphId: "" };
  const paragraphId = nextClinicianParagraphId(section);
  const origin: Paragraph["origin"] = opts.byStaff && section.kind !== "from_records" ? "edited" : "clinician";
  const sections = mapSection(report, key, (s) => ({
    ...s,
    paragraphs: [...s.paragraphs, { id: paragraphId, text, sourceIds: [], origin }],
  }));
  return { report: touch(report, sections, now), paragraphId };
}

/** The most drafted paragraphs a box keeps as tombstones (core/schemas.ts DraftTombstoneSchema). */
const MAX_TOMBSTONES = 500;

/**
 * Remove a paragraph (not from-records text). WC design 6: a DRAFTED paragraph (origin "ai", or edited drafted text)
 * removed by a person (`opts.by`) is kept as a tombstone of its drafted wording, never printed, so a delete-then-add
 * or a paste back still reads as drafted text (core/provenance.ts draftedSentences).
 */
export function removeParagraph(report: Report, key: string, paragraphId: string, now?: Date, opts: { by?: Actor } = {}): Report {
  let changed = false;
  const at = nowIso(now);
  const sections = mapSection(report, key, (s) => {
    let removed: Paragraph | null = null;
    const paragraphs = s.paragraphs.filter((p) => {
      const drop = p.id === paragraphId && p.origin !== "from_records";
      if (drop) {
        changed = true;
        removed = p;
      }
      return !drop;
    });
    if (!changed) return s;
    const gone = removed as Paragraph | null;
    const drafted = gone && (gone.origin === "ai" || (gone.origin === "edited" && gone.originalText !== undefined));
    if (!gone || !drafted || !opts.by) return { ...s, paragraphs };
    const tombstone = { paragraphId: gone.id, text: gone.originalText ?? gone.text, sourceIds: gone.sourceIds, by: opts.by, at };
    return { ...s, paragraphs, tombstones: [...(s.tombstones ?? []), tombstone].slice(-MAX_TOMBSTONES) };
  });
  return changed ? touch(report, sections, now) : report;
}

function answerDisplay(value: string | boolean | null | Array<Record<string, string>>, kind: string): string {
  if (Array.isArray(value)) return `${value.length} row${value.length === 1 ? "" : "s"}`;
  if (value === null || value === "") return "blank";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return kind === "date" ? formatUkDate(value) : value;
}

/**
 * Set a structured answer (yes/no, tick box, choice, date, number). The change is recorded in the
 * activity log ("answer_set", detail starting "<key>:"), which is how the screen shows it as edited.
 */
export function setStructuredAnswer(
  report: Report,
  key: string,
  value: string | boolean | null,
  actor: string | Actor,
  now?: Date,
): Report {
  const section = report.sections.find((s) => s.key === key);
  if (!section?.answer || section.answer.kind === "text") return report;
  const before = section.answer.value;
  if (before === value) return report;
  const kind = section.answer.kind;
  // WC design 7: who set it is stamped on the box (Section.answerBy) – the labels read the stamp, never the log.
  const by = stampOf(actor);
  const sections = mapSection(report, key, (s) => {
    const next: ReportSection = { ...s, answer: { kind, value } };
    if (value === null || value === "" || !by) delete next.answerBy;
    else next.answerBy = by;
    return next;
  });
  const name = typeof actor === "string" ? actor : actor.name;
  return appendActivity(touch(report, sections, now), {
    actor: name,
    action: "answer_set",
    detail: `${key}: answer to “${section.title}” set to ${answerDisplay(value, kind)} (was ${answerDisplay(before, kind)}).`,
  }, now);
}

/** The stamp for a person: their Actor, or – where only a name is known – that name as a clinician of unknown id. */
export function stampOf(actor: string | Actor | null | undefined): Actor | null {
  if (!actor) return null;
  if (typeof actor !== "string") return actor.name.trim() && actor.memberId ? actor : null;
  const name = actor.trim();
  return name ? { memberId: "unknown", name, role: "clinician", canSign: false } : null;
}

/**
 * Fix wave 3: record the patient's consent to share the report on a report built from UPLOADED notes (there is no
 * clinic system inside ClinForms to record it in). The record's consent is set, with the date it was given (not in
 * the future), and who recorded it stays in the report's activity. A report from a clinic system or an approved
 * report is returned unchanged.
 */
export function recordConsent(report: Report, givenOn: string, actor: string, now?: Date): Report {
  const at = nowIso(now);
  if (report.status === "signed" || report.bundleSnapshot.source.connectorId !== "file-import") return report;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(givenOn) || givenOn > at.slice(0, 10) || !actor.trim()) return report;
  const bundleSnapshot = { ...report.bundleSnapshot, consent: { disclosureConsentRecorded: true, date: givenOn } };
  return appendActivity(
    { ...report, bundleSnapshot, updatedAt: at },
    { actor, action: "consent_recorded", detail: `Recorded the patient's consent to share the report, given on ${formatUkDate(givenOn)} (the uploaded notes did not record it).` },
    now,
  );
}

/** Whether a report may have its consent recorded in the Studio (built from uploaded notes, not approved, none recorded). */
export function canRecordConsent(report: Report): boolean {
  return report.status !== "signed" && report.bundleSnapshot.source.connectorId === "file-import" && !report.bundleSnapshot.consent.disclosureConsentRecorded;
}

/** The report after a successful POST /sign: locked, with its receipt and the server's flags. */
export function markApproved(
  sent: Report,
  receipt: SignReceipt,
  flags: ReportFlag[],
  opts: { isForm: boolean; now?: Date; prefill?: boolean; plain?: boolean },
): Report {
  const at = nowIso(opts.now);
  // plain (a clinic's Studio, fix wave 2): the same facts without "server-signed receipt" / "fingerprint".
  const proof = opts.plain
    ? `Approval check code ${receipt.contentSha256.slice(0, 12)}…`
    : `Server-signed receipt over content fingerprint ${receipt.contentSha256.slice(0, 12)}…`;
  return appendActivity(
    { ...sent, flags, receipt, status: "signed", updatedAt: at },
    {
      actor: receipt.signer.name,
      action: opts.isForm ? "approved" : "signed",
      detail: `${opts.prefill ? "Prefill checked and approved (nobody at the clinic signs this form)" : opts.isForm ? "Approved" : "Signed"} by ${receipt.signer.name} (HCPC ${receipt.signer.hcpc}). ${proof}`,
    },
    opts.now,
  );
}

/**
 * A new version of an approved report for an amendment (a referrer's query or a factual correction):
 * same content, status draft, no receipt, a fresh ID; the activity says which approval it supersedes.
 * The original stays as it was approved.
 */
export function createAmendedVersion(approved: Report, actor: string, newId: string, now?: Date): Report {
  const at = nowIso(now);
  const version = (approved.version ?? 1) + 1;
  const base: Report = { ...approved, id: newId, status: "draft", createdAt: at, updatedAt: at, version, amends: { reportId: approved.id, version: approved.version ?? 1, approvedAt: approved.receipt?.signedAt ?? at } };
  delete base.receipt;
  return appendActivity(
    { ...base, activity: approved.activity.slice() },
    {
      actor,
      action: "amendment_started",
      detail: `Amended version ${version} started from version ${approved.version ?? 1} (approved ${approved.receipt ? formatUkDate(approved.receipt.signedAt.slice(0, 10)) : "earlier"} by ${approved.receipt?.signer.name ?? "the clinician"}). The earlier approval is superseded once this version is approved; it needs approving again.`,
    },
    now,
  );
}

/* ------------------------------------------------------------------------------------------------
 * The approving clinician's decisions (bh2 WC designs 1, 4, 5, 6) – each refuses anyone else (returns the report
 * unchanged), stamps who decided and when, and writes one activity entry.
 * ----------------------------------------------------------------------------------------------*/

function sectionOf(report: Report, key: string): ReportSection | undefined {
  return report.sections.find((s) => s.key === key);
}

/** Replace one section (no status recomputation: these decisions never change what the box answers). */
function withSection(report: Report, key: string, fn: (s: ReportSection) => ReportSection): ReportSection[] {
  return report.sections.map((s) => (s.key === key ? fn(s) : s));
}

/**
 * "Adopt" (WC design 5): the approver takes what someone else entered in a clinician box as their own decision, with
 * one audited click. The person's paragraphs become the approver's own words ("clinician"; who typed them stays in
 * `by`) – except a paragraph that still holds drafted residue, which stays drafted text; Section.adoptedBy records
 * the adoption with the SHA-256 of the box's answer and paragraphs, so any later change by someone else voids it;
 * the box's open gaps are settled by the approver (reopened if the answer is removed again). Never in bulk.
 */
export function adoptBox(report: Report, key: string, actor: Actor, ctx: BoxContext = {}, now?: Date): Report {
  const section = sectionOf(report, key);
  if (!section || !report.approver || !actsAsApprover(actor, report)) return report;
  const proposal = pendingProposal(report, section, ctx);
  if (!proposal) return report;
  const at = nowIso(now);
  const paragraphs = section.paragraphs.map((p): Paragraph => {
    if (!isPersonParagraph(p) || (p.by && sameMember(p.by, report.approver))) return p;
    if (paragraphResidue(section, p).length > 0) return p;
    return { ...p, origin: "clinician" };
  });
  const adopted: ReportSection = { ...section, paragraphs };
  adopted.adoptedBy = { by: actor, at, contentSha: boxContentSha(adopted) };
  const what = proposal.names ? `the answer entered by ${proposal.names}` : `the answer as changed since ${actor.name} last confirmed it`;
  const text = `Adopted by ${actor.name}: ${what}.`;
  const gaps = report.gaps.map((g) => (g.sectionKey === key && !g.resolution ? { ...g, resolution: { kind: "resolved" as const, text, at, byAnswer: true, by: actor } } : g));
  return appendActivity(
    { ...report, sections: withSection(report, key, () => adopted), gaps, updatedAt: at },
    { actor: actor.name, action: "adopted", detail: `${key}: adopted ${what.replace(/^the answer/, `the answer to “${section.title}”`)}.` },
    now,
  );
}

/** The drafted residue that stops "These are my own words" on a paragraph (sentences), or [] when nothing does. */
export function ownWordsBlockers(section: ReportSection, paragraph: Paragraph): string[] {
  const spans = paragraphResidue(section, paragraph);
  return spans.length ? residueSentences(paragraph.text, spans) : [];
}

/**
 * "These are my own words" (WC design 6): the approver records a paragraph they rewrote as their own words – origin
 * "clinician", Paragraph.ownWords {by, at} (hashed), audited. Refused while drafted residue remains (a drafted
 * sentence kept, pasted back or changed by a word or a mark: ownWordsBlockers – "Split it out" moves it into its own
 * drafted paragraph first), and never offered to anyone but the approver.
 */
export function markOwnWords(report: Report, key: string, paragraphId: string, actor: Actor, now?: Date): Report {
  const section = sectionOf(report, key);
  const p = section?.paragraphs.find((x) => x.id === paragraphId);
  if (!section || !p || !actsAsApprover(actor, report) || !p.text.trim()) return report;
  if (p.origin !== "edited" && p.origin !== "clinician" && p.origin !== "staff") return report;
  if (ownWordsBlockers(section, p).length > 0) return report;
  const at = nowIso(now);
  const next: Paragraph = { ...p, origin: "clinician", by: actor, ownWords: { by: actor, at } };
  return appendActivity(
    { ...report, sections: withSection(report, key, (s) => ({ ...s, paragraphs: s.paragraphs.map((x) => (x.id === paragraphId ? next : x)) })), updatedAt: at },
    { actor: actor.name, action: "own_words", detail: `${key}: recorded a paragraph of “${section.title}” as ${actor.name}'s own words.` },
    now,
  );
}

/**
 * "Split it out" (WC design 6): the drafted sentences kept in a person's paragraph move into a paragraph of their own,
 * as drafted text (origin "ai", checked as such), so the rest can be recorded as the approver's own words. Nothing
 * happens when the whole paragraph is drafted residue (revert it instead) or none of it is.
 */
export function splitOutResidue(report: Report, key: string, paragraphId: string, actor: Actor, now?: Date): Report {
  const section = sectionOf(report, key);
  const p = section?.paragraphs.find((x) => x.id === paragraphId);
  if (!section || !p || !actsAsApprover(actor, report) || p.origin === "ai" || p.origin === "from_records") return report;
  const kept = ownWordsBlockers(section, p);
  if (kept.length === 0) return report;
  const rest = splitSentences(p.text, "prose")
    .filter((sp) => kept.indexOf(sp.text) < 0)
    .map((sp) => sp.text)
    .join(" ")
    .trim();
  if (!rest) return report;
  const drafted = kept.join(" ");
  const ids = new Set(section.paragraphs.map((x) => x.id));
  let n = 1;
  while (ids.has(`${p.id}-d${n}`)) n += 1;
  const residue: Paragraph = { id: `${p.id}-d${n}`, text: drafted, sourceIds: p.sourceIds, origin: "ai", originalText: drafted, ...(p.basis ? { basis: p.basis } : {}) };
  const at = nowIso(now);
  const own: Paragraph = { ...p, text: rest, by: actor };
  delete own.ackReason;
  delete own.ownWords;
  return appendActivity(
    {
      ...report,
      sections: mapSection(report, key, (s) => ({ ...s, paragraphs: s.paragraphs.flatMap((x) => (x.id === paragraphId ? [own, residue] : [x])) })),
      updatedAt: at,
    },
    { actor: actor.name, action: "edited", detail: `${key}: moved the drafted sentence${kept.length === 1 ? "" : "s"} kept in a paragraph of “${section.title}” into a drafted paragraph of ${kept.length === 1 ? "its" : "their"} own.` },
    now,
  );
}

export interface NoteWordsInput {
  /** The check the acceptance answers (a flag code such as OPINION_LANGUAGE). */
  check: string;
  /** The drafted phrase accepted. */
  phrase: string;
  /** The drafted sentence it is accepted in (the acceptance covers exactly that sentence). */
  sentence: string;
  /** The approver's own note that records it. */
  noteId?: string;
  reason?: string;
}

/** The notes a paragraph cites that the approver wrote. */
function approverNotesCited(report: Report, p: Paragraph): string[] {
  const approver = report.approver;
  if (!approver) return [];
  return p.sourceIds.filter((id) => {
    const note = report.bundleSnapshot.notes.find((n) => n.id === id);
    return Boolean(note && (note.author.hcpc && approver.hcpc ? note.author.hcpc.replace(/\s+/g, "").toUpperCase() === approver.hcpc.replace(/\s+/g, "").toUpperCase() : note.author.name === approver.name));
  });
}

/**
 * "Accept as the note's words" (Khuram 26/10, WB design 5, WC design 4): the approver – only the approver – accepts,
 * one phrase at a time, a drafted phrase in a sentence their OWN cited note records. Recorded in Section.accepted
 * {check, phrase, sentenceSha, noteId, by, at} (hashed, audited); a changed sentence is no longer covered. Which
 * phrases may be accepted (a work-status or return line the note records) is the opinion check's rule (WB): it
 * honours an acceptance only there. One phrase per click (Khuram 26/10): `input` names it; absent, the paragraph's one
 * open OPINION_LANGUAGE phrase is accepted only when there is exactly one – never several at once.
 */
export function acceptNoteWords(report: Report, key: string, paragraphId: string, actor: Actor, input?: NoteWordsInput | null, now?: Date): Report {
  const section = sectionOf(report, key);
  const p = section?.paragraphs.find((x) => x.id === paragraphId);
  if (!section || !p || !report.approver || !actsAsApprover(actor, report) || p.origin === "from_records") return report;
  const own = approverNotesCited(report, p);
  if (own.length === 0) return report;
  const open = report.flags.filter((f) => f.paragraphId === paragraphId && f.code === "OPINION_LANGUAGE" && !f.acknowledged && f.evidence);
  if (!input && open.length !== 1) return report;
  const wanted: NoteWordsInput[] = input
    ? [input]
    : open.map((f) => {
        const sentence = splitSentences(p.text, "prose").find((sp) => sp.text.toLowerCase().includes((f.evidence ?? "").toLowerCase()))?.text ?? "";
        return { check: f.code, phrase: f.evidence ?? "", sentence, noteId: own[0] };
      });
  const at = nowIso(now);
  const accepted: PhraseAcceptance[] = [...(section.accepted ?? [])];
  for (const w of wanted) {
    if (!w.sentence || !w.phrase || !p.text.includes(w.sentence) || !w.sentence.toLowerCase().includes(w.phrase.toLowerCase())) continue;
    if (w.noteId && own.indexOf(w.noteId) < 0) continue;
    const sha = sentenceSha(w.sentence);
    if (accepted.some((a) => a.check === w.check && a.phrase === w.phrase && a.sentenceSha === sha)) continue;
    accepted.push({ check: w.check, phrase: w.phrase, sentenceSha: sha, ...(w.noteId ? { noteId: w.noteId } : {}), by: actor, at, ...(w.reason ? { reason: w.reason } : {}) });
  }
  if (accepted.length === (section.accepted ?? []).length) return report;
  const added = accepted.slice((section.accepted ?? []).length);
  return appendActivity(
    { ...report, sections: withSection(report, key, (s) => ({ ...s, accepted })), updatedAt: at },
    { actor: actor.name, action: "note_words_accepted", detail: `${key}: accepted ${added.map((a) => `“${a.phrase}”`).join(", ")} as the words of ${actor.name}'s own note ${added[0].noteId ?? ""}`.trim() + "." },
    now,
  );
}

/**
 * A person's decision about a box (WC design 4; read by the issue state, WA1): not applicable, applies anyway, or left
 * blank. On a clinician box only the approver decides, and "applies anyway" is always the approver's. Not applicable
 * settles the box's open gaps (by this decision, reopened when it is cleared); `kind` null clears the decision.
 */
export function setDisposition(report: Report, key: string, kind: SectionDispositionKind | null, actor: Actor, opts: { reason?: string; ctx?: BoxContext; now?: Date } = {}): Report {
  const section = sectionOf(report, key);
  if (!section || section.kind === "declaration") return report;
  const clinician = isClinicianBox(report, section, opts.ctx);
  if ((clinician || kind === "applies_anyway") && !actsAsApprover(actor, report)) return report;
  if (kind === null && section.disposition && (clinician || section.disposition.kind === "applies_anyway") && !actsAsApprover(actor, report)) return report;
  const at = nowIso(opts.now);
  if (kind === null) {
    const was = section.disposition;
    if (!was) return report;
    const sections = withSection(report, key, (s) => {
      const next = { ...s };
      delete next.disposition;
      return next;
    });
    // Gaps this decision settled open again.
    const gaps = report.gaps.map((g) => {
      if (g.sectionKey !== key || !g.resolution || g.resolution.at !== was.at || !sameMember(g.resolution.by, was.by)) return g;
      const open = { ...g };
      delete open.resolution;
      return open;
    });
    return appendActivity({ ...report, sections, gaps, updatedAt: at }, { actor: actor.name, action: "disposition_cleared", detail: `${key}: cancelled the decision about “${section.title}”.` }, opts.now);
  }
  if (section.disposition?.kind === kind) return report;
  const reason = opts.reason?.trim();
  // bh2-rc1 (WA1 x WC): the controlling answers as WA1's issue state reads them (core/issue-state.ts
  // controllerSnapshotOf) – a text box's text included – so a decision about a box read from a text controller (Dell's
  // "task still limited" rows) is not taken as changed the moment it is made.
  const controllers = controllerSnapshotOf(report.sections, key, { release: isReleaseModel(report) });
  const disposition: SectionDisposition = { kind, by: actor, at, ...(reason ? { reason } : {}), ...(controllers.length ? { controllerSnapshot: controllers } : {}) };
  const words = kind === "not_applicable" ? "does not apply" : kind === "applies_anyway" ? "applies although the answer before it rules it out" : "is left blank on purpose";
  const gaps =
    kind === "not_applicable"
      ? report.gaps.map((g) => (g.sectionKey === key && !g.resolution ? { ...g, resolution: { kind: "resolved" as const, text: `Not applicable – decided by ${actor.name}${reason ? `: ${reason}` : ""}.`, at, by: actor } } : g))
      : report.gaps;
  return appendActivity(
    { ...report, sections: withSection(report, key, (s) => ({ ...s, disposition })), gaps, updatedAt: at },
    { actor: actor.name, action: "disposition_set", detail: `${key}: “${section.title}” ${words}${reason ? ` – ${reason}` : ""}.` },
    opts.now,
  );
}

/**
 * "Take over as approver" (WC design 1): a member who may approve becomes the report's approving clinician
 * (Report.approver, hashed; Report.approverTakeovers records from, to and when). The previous approver's decisions
 * are void – their acceptances, adoptions, acknowledgements, own-words records and approver-only dispositions – and
 * what they wrote becomes a proposal the new approver adopts or rewrites; their settled clinician gaps open again. The
 * validators then run with the new owner.
 */
export function takeOverApprover(report: Report, actor: Actor, now?: Date): Report {
  if (report.status === "signed" || !mayApprove(actor)) return report;
  const to = approverRefOf(actor);
  if (!to || (report.approver && sameMember(report.approver, to))) return report;
  const at = nowIso(now);
  const from = report.approver ?? null;
  const { sections, gaps, flags } = voidDecisionsNotBy(report, (by) => Boolean(by && sameMember(by, to)));
  const takeovers = from ? [...(report.approverTakeovers ?? []), { from, to, at }].slice(-50) : report.approverTakeovers;
  const next: Report = { ...report, sections, gaps, flags, approver: to, updatedAt: at, ...(takeovers ? { approverTakeovers: takeovers } : {}) };
  return appendActivity(
    next,
    {
      actor: actor.name,
      action: "approver_taken_over",
      detail: from ? `${actor.name} took over as the approving clinician from ${from.name}; ${from.name}'s decisions on this report need ${actor.name}'s own.` : `${actor.name} is now the approving clinician.`,
    },
    now,
  );
}

/** Who may take each approver-only decision on this report, in words ("Only Sarah Reid, the approving clinician, can …"). */
export function approverOnlyLine(report: Pick<Report, "approver">, what: string): string {
  return report.approver ? `Only ${report.approver.name}, the approving clinician, can ${what}.` : `Only a clinician who may approve can ${what}.`;
}

/** The review's label for a proposal ("Entered by Pat Morgan (staff) – …", "Changed since Sarah Reid last confirmed it – …"). */
export function proposalLabel(report: Report, section: ReportSection, ctx: BoxContext = {}): string | null {
  const p = pendingProposal(report, section, ctx);
  return p ? `${p.summary} – the approving physio must adopt it` : null;
}


/* ------------------------------------------------------------------------------------------------
 * After every person's action (use-review-state.ts reviewReducer): the provenance the server checks (WC design 2)
 * ----------------------------------------------------------------------------------------------*/

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function changedParagraph(p: Paragraph, before: Paragraph | undefined): boolean {
  return !before || p.text !== before.text || p.origin !== before.origin || !sameJson(p.sourceIds, before.sourceIds);
}

function resolutionCore(r: Report["gaps"][number]["resolution"]): unknown {
  if (!r) return null;
  const { by: _by, ...rest } = r;
  return rest;
}

/**
 * The origin of every paragraph a person wrote or changed in this step (core/provenance.ts personOrigin): only the
 * approver's own new words become "clinician"; drafted text a person changed stays "edited"; a value typed into a
 * record box is the approver's ("clinician") or someone else's ("staff").
 */
export function withPersonOrigins(before: Report, after: Report, actor: Actor): Report {
  let touched = false;
  const sections = after.sections.map((s) => {
    const was = before.sections.find((x) => x.key === s.key);
    let changed = false;
    const paragraphs = s.paragraphs.map((p) => {
      const b = was?.paragraphs.find((x) => x.id === p.id);
      if (!changedParagraph(p, b) || p.origin === "ai" || p.origin === "from_records") return p;
      const origin = personOrigin({ report: after, section: s, paragraph: p, before: b, actor });
      if (origin === p.origin) return p;
      changed = true;
      return { ...p, origin };
    });
    if (!changed) return s;
    touched = true;
    return { ...s, paragraphs };
  });
  return touched ? { ...after, sections } : after;
}

/**
 * Stamp who made each change of this step (WC design 2): a person's paragraph written or changed (Paragraph.by; a
 * paragraph turned back into drafted text loses its stamps; changed text loses "my own words"), a structured answer
 * (Section.answerBy), a gap resolution and a flag acknowledgement (`by`). Decisions an action stamped itself keep their stamp.
 */
export function stampDecisions(before: Report, after: Report, actor: Actor): Report {
  const by = stampOf(actor);
  if (!by) return after;
  const sections = after.sections.map((s) => {
    const was = before.sections.find((x) => x.key === s.key);
    let next = s;
    const paragraphs = s.paragraphs.map((p) => {
      const b = was?.paragraphs.find((x) => x.id === p.id);
      if (!changedParagraph(p, b)) return p;
      const q: Paragraph = { ...p };
      if (q.origin === "ai" || q.origin === "from_records") {
        delete q.by;
        delete q.ownWords;
        return q;
      }
      q.by = by;
      if (b && q.text !== b.text && q.ownWords && sameJson(q.ownWords, b.ownWords)) delete q.ownWords;
      // A paragraph's acknowledgement reason covered its content as it was – its words, citations and drafted wording,
      // as the store compares them (api/handlers/store-reports.ts paragraphContent; harden-WC, check2-WC minor 7):
      // changed content is acknowledged again.
      const contentChanged = Boolean(b) && (q.text !== b!.text || !sameJson(q.sourceIds, b!.sourceIds) || !sameJson(q.originalText ?? null, b!.originalText ?? null) || !sameJson(q.basis ?? null, b!.basis ?? null));
      if (contentChanged && q.ackReason !== undefined && q.ackReason === b!.ackReason) delete q.ackReason;
      return q;
    });
    if (paragraphs.some((p, i) => p !== s.paragraphs[i])) next = { ...next, paragraphs };
    if (was && !sameJson(s.answer, was.answer)) {
      const a = s.answer;
      const set = a && a.kind !== "text" && a.value !== null && a.value !== "";
      if (set && !sameMember(s.answerBy, by)) next = { ...next, answerBy: by };
      else if (!set && next.answerBy) {
        next = { ...next };
        delete next.answerBy;
      }
    }
    return next;
  });
  const gaps = after.gaps.map((g) => {
    if (!g.resolution) return g;
    const b = before.gaps.find((x) => x.id === g.id);
    if (b && sameJson(resolutionCore(g.resolution), resolutionCore(b.resolution))) return g;
    if (g.resolution.by && b?.resolution?.by !== g.resolution.by && g.resolution.by.memberId === by.memberId) return g;
    return { ...g, resolution: { ...g.resolution, by } };
  });
  // Words someone changed: the acknowledgements others made of their checks covered them as they were (check-WC: one
  // member's acknowledgement never vouches for another's later words) – the acknowledger looks again.
  const rewritten = new Set<string>();
  for (const s of after.sections) {
    const was = before.sections.find((x) => x.key === s.key);
    for (const p of s.paragraphs) {
      const b = was?.paragraphs.find((x) => x.id === p.id);
      if (b && (p.text !== b.text || !sameJson(p.sourceIds, b.sourceIds))) rewritten.add(p.id);
    }
  }
  const flags = after.flags.map((f) => {
    if (!f.acknowledged) return f;
    const b = before.flags.find((x) => x.id === f.id);
    if (b?.acknowledged && b.acknowledged.reason === f.acknowledged.reason && b.acknowledged.at === f.acknowledged.at) {
      if (f.paragraphId && rewritten.has(f.paragraphId) && f.acknowledged.by && !sameMember(f.acknowledged.by, by)) {
        const open = { ...f };
        delete open.acknowledged;
        return open;
      }
      return f;
    }
    return { ...f, acknowledged: { ...f.acknowledged, by } };
  });
  return { ...after, sections, gaps, flags };
}

/**
 * A decision this person may not take is undone (WC design 4) – whichever helper made it: a clinician gap settled by
 * someone other than the approver (a gap the conditions settle follows the answers and stays), a flag acknowledged
 * against its policy (core/validation/acknowledge.ts), "my own words", an adoption or an acceptance stamped by anyone
 * but the approver, an approver-only decision about a box, and a change of approver other than a takeover.
 */
export function enforceDecisionRoles(before: Report, after: Report, actor: Actor, canAck: (flag: ReportFlag, report: Report, actor: Actor) => boolean): Report {
  // A takeover in this step makes the actor the approver (the approver change itself is checked below).
  const approver = actsAsApprover(actor, before) || (Boolean(after.approver) && sameMember(after.approver, actor));
  const gaps = after.gaps.map((g) => {
    const b = before.gaps.find((x) => x.id === g.id);
    if (sameJson(resolutionCore(g.resolution), resolutionCore(b?.resolution))) return g;
    if (approver || g.resolution?.notApplicable || !isClinicianGap(after, g)) return g;
    // Someone else's resolution of a clinician gap is not theirs to make.
    if (!b) return g;
    return b;
  });
  const reverted = new Set<string>();
  const flags = after.flags.map((f) => {
    const b = before.flags.find((x) => x.id === f.id);
    if (!f.acknowledged || (b?.acknowledged && b.acknowledged.reason === f.acknowledged.reason)) return f;
    if (canAck(b ?? f, before, actor)) return f;
    if (f.paragraphId) reverted.add(f.paragraphId);
    return b ?? (() => {
      const open = { ...f };
      delete open.acknowledged;
      return open;
    })();
  });
  const sections = after.sections.map((s) => {
    const was = before.sections.find((x) => x.key === s.key);
    let next = s;
    if (!approver) {
      if (!sameJson(s.adoptedBy, was?.adoptedBy) && s.adoptedBy && (!was?.adoptedBy || !sameJson(s.adoptedBy.by, was.adoptedBy.by))) {
        next = { ...next };
        if (was?.adoptedBy) next.adoptedBy = was.adoptedBy;
        else delete next.adoptedBy;
      }
      if (!sameJson(s.accepted, was?.accepted)) {
        next = { ...next };
        if (was?.accepted) next.accepted = was.accepted;
        else delete next.accepted;
      }
      const d = s.disposition;
      if (!sameJson(d, was?.disposition) && (d?.kind === "applies_anyway" || was?.disposition?.kind === "applies_anyway" || isClinicianBox(before, s))) {
        next = { ...next };
        if (was?.disposition) next.disposition = was.disposition;
        else delete next.disposition;
      }
    }
    const paragraphs = next.paragraphs.map((p) => {
      const b = was?.paragraphs.find((x) => x.id === p.id);
      let q = p;
      if (!approver && p.ownWords && !sameJson(p.ownWords, b?.ownWords)) {
        q = { ...q };
        if (b?.ownWords) q.ownWords = b.ownWords;
        else delete q.ownWords;
        if (q.origin === "clinician" && b?.origin !== "clinician") q.origin = b?.origin ?? "edited";
      }
      if (reverted.has(p.id) && p.ackReason !== b?.ackReason) {
        q = { ...q };
        if (b?.ackReason) q.ackReason = b.ackReason;
        else delete q.ackReason;
      }
      return q;
    });
    if (paragraphs.some((p, i) => p !== next.paragraphs[i])) next = { ...next, paragraphs };
    return next;
  });
  let next: Report = { ...after, gaps, flags, sections };
  // The approver changes only through "Take over as approver" (takeOverApprover records it).
  if (!sameJson(after.approver, before.approver) && !sameMember(after.approver, actor)) {
    next = { ...next };
    if (before.approver) next.approver = before.approver;
    else delete next.approver;
    if (before.approverTakeovers) next.approverTakeovers = before.approverTakeovers;
    else delete next.approverTakeovers;
  }
  return next;
}

/**
 * The approver's adoption follows the box (WC design 5): their own later change keeps it current (its contentSha is
 * renewed) while it covered the box before that change; anyone else's change voids it (contentSha
 * VOIDED_ADOPTION_SHA – kept, never matching again), so the box reads "changed since … last confirmed it" and waits for
 * the approver's Adopt, also when it is changed back (problem E1: a removal leaves no one's stamp behind, the voided
 * adoption is what shows it). A stale or voided adoption is renewed only by the approver's own "Adopt".
 */
export function maintainAdoptions(before: Report, after: Report, actor: Actor): Report {
  let touched = false;
  const sections = after.sections.map((s) => {
    if (!s.adoptedBy) return s;
    const sha = boxContentSha(s);
    if (sha === s.adoptedBy.contentSha) return s;
    const was = before.sections.find((x) => x.key === s.key);
    if (!was || boxContentSha(was) === sha) return s;
    const wasCurrent = Boolean(was.adoptedBy && sameJson(was.adoptedBy, s.adoptedBy) && was.adoptedBy.contentSha === boxContentSha(was));
    const approversOwn = after.approver && actsAsApprover(actor, after) && sameMember(s.adoptedBy.by, actor);
    if (wasCurrent && approversOwn) {
      touched = true;
      return { ...s, adoptedBy: { ...s.adoptedBy, contentSha: sha } };
    }
    if (approversOwn || s.adoptedBy.contentSha === VOIDED_ADOPTION_SHA) return s;
    touched = true;
    return { ...s, adoptedBy: { ...s.adoptedBy, contentSha: VOIDED_ADOPTION_SHA } };
  });
  return touched ? { ...after, sections } : after;
}

/**
 * The approver's own entry confirms the box (WC design 5, problem E1): when the approving clinician changes a clinician
 * box – writes, edits, removes, answers – or settles one of its gaps, and the box then holds nothing anyone else entered
 * that they have not adopted, the box is recorded as theirs as it now stands (Section.adoptedBy, no extra click and no
 * log line: it is their own entry). Anyone else's later change – adding, rewriting or removing – leaves that stale, so
 * it waits for them again. A box with a stale adoption, or with someone else's entry in it, is confirmed only by
 * "Adopt".
 */
export function confirmByApprover(before: Report, after: Report, actor: Actor, ctx: BoxContext = {}): Report {
  if (!after.approver || after.status === "signed" || !actsAsApprover(actor, after)) return after;
  const settledNow = new Set(
    after.gaps
      .filter((g) => g.resolution && !g.resolution.notApplicable && sameMember(g.resolution.by, actor) && !sameJson(g.resolution, before.gaps.find((x) => x.id === g.id)?.resolution))
      .map((g) => g.sectionKey),
  );
  let touched = false;
  const sections = after.sections.map((s) => {
    if (s.adoptedBy) return s;
    const was = before.sections.find((x) => x.key === s.key);
    const sha = boxContentSha(s);
    if (was && boxContentSha(was) === sha && !settledNow.has(s.key)) return s;
    const holds = s.paragraphs.some((p) => p.text.trim() !== "") || answerSet(s.answer);
    if (!holds || !isClinicianBox(after, s, ctx) || pendingProposal(after, s, ctx)) return s;
    touched = true;
    return { ...s, adoptedBy: { by: actor, at: after.updatedAt, contentSha: sha } };
  });
  return touched ? { ...after, sections } : after;
}

/**
 * Refuse a step by someone other than the approver that would take away what the approver confirmed in a clinician
 * box without the box reading as a proposal (core/provenance.ts approverEntryLost – the store refuses the same change):
 * the report is returned as it was before the step, log included. The review's own edits always leave a trace (a
 * stamp, or the approver's adoption voided), so this only matters for a box confirmed before the review recorded
 * adoptions.
 */
export function keepApproverEntries(before: Report, after: Report, actor: Actor, ctx: BoxContext = {}): Report {
  if (!after.approver || actsAsApprover(actor, after)) return after;
  return after.sections.some((s) => approverEntryLost(before, after, s.key, ctx)) ? before : after;
}
