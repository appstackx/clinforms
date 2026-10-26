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
import { appendActivity } from "../../../core/report-factory";
import type { Paragraph, Report, ReportFlag, ReportSection, SignReceipt } from "../../../core/types";

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

/** Remove a paragraph (not from-records text). */
export function removeParagraph(report: Report, key: string, paragraphId: string, now?: Date): Report {
  let changed = false;
  const sections = mapSection(report, key, (s) => {
    const paragraphs = s.paragraphs.filter((p) => {
      const drop = p.id === paragraphId && p.origin !== "from_records";
      if (drop) changed = true;
      return !drop;
    });
    return changed ? { ...s, paragraphs } : s;
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
  actor: string,
  now?: Date,
): Report {
  const section = report.sections.find((s) => s.key === key);
  if (!section?.answer || section.answer.kind === "text") return report;
  const before = section.answer.value;
  if (before === value) return report;
  const kind = section.answer.kind;
  const sections = mapSection(report, key, (s) => ({ ...s, answer: { kind, value } }));
  return appendActivity(touch(report, sections, now), {
    actor,
    action: "answer_set",
    detail: `${key}: answer to “${section.title}” set to ${answerDisplay(value, kind)} (was ${answerDisplay(before, kind)}).`,
  }, now);
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
