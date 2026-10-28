/** Plain-English labels of the records screens (UK English, neutral wording). Pure. */
import type { AuthorisationState, AuthorisationView } from "../core/authorisations";
import type { CaseStatus, PayerType, ReferrerKind } from "../core/types";

export const PAYER_TYPE_LABELS: Readonly<Record<PayerType, string>> = {
  self_pay: "Self-pay",
  insurer: "Insurer",
  mlc: "Medico-legal company",
  solicitor: "Solicitor",
  employer: "Employer",
  other: "Other payer",
};

export const CASE_STATUS_LABELS: Readonly<Record<CaseStatus, string>> = {
  open: "Open",
  discharged: "Discharged",
  closed: "Closed",
};

export const REFERRER_KIND_LABELS: Readonly<Record<ReferrerKind, string>> = {
  gp: "GP",
  consultant: "Consultant",
  insurer: "Insurer",
  mlc: "Medico-legal company",
  solicitor: "Solicitor",
  employer: "Employer",
  case_manager: "Case manager",
  self: "Self-referral",
  other: "Other",
};

/** Which directory entries can pay for a case of each payer type. */
export const PAYER_KINDS: Readonly<Record<PayerType, readonly ReferrerKind[]>> = {
  self_pay: [],
  insurer: ["insurer"],
  mlc: ["mlc", "case_manager"],
  solicitor: ["solicitor"],
  employer: ["employer", "case_manager"],
  other: ["other", "case_manager", "insurer", "mlc", "solicitor", "employer"],
};

export const AUTHORISATION_STATE_LABELS: Readonly<Record<AuthorisationState, string>> = {
  active: "In use",
  not_started: "Not started yet",
  expired: "Expired",
  exhausted: "Used up",
  cancelled: "Cancelled",
};

/** "3 of 6 sessions left", "£120.00 of £300.00 left" … */
export function authorisationRemaining(view: AuthorisationView, a: { sessionsAuthorised: number | null; valueAuthorisedPence: number | null }, money: (p: number) => string): string[] {
  const out: string[] = [];
  if (a.sessionsAuthorised !== null && view.sessionsLeft !== null) out.push(`${view.sessionsLeft} of ${a.sessionsAuthorised} session${a.sessionsAuthorised === 1 ? "" : "s"} left`);
  if (a.valueAuthorisedPence !== null && view.valueLeftPence !== null) out.push(`${money(view.valueLeftPence)} of ${money(a.valueAuthorisedPence)} left`);
  if (out.length === 0) out.push("No session or value limit");
  return out;
}

export function authorisationWarnings(view: AuthorisationView): string[] {
  return view.warnings.map((w) =>
    w === "expires_soon" ? (view.daysToExpiry === 0 ? "Expires today" : `Expires in ${view.daysToExpiry} day${view.daysToExpiry === 1 ? "" : "s"}`) : w === "few_sessions_left" ? (view.sessionsLeft === 0 ? "No sessions left" : "1 session left") : "Little value left",
  );
}

const AMEND_WORDS: Record<string, string> = { addendum: "Addendum", correction: "Correction", entered_in_error: "Marked as entered in error" };
const MEASURE_WORDS: Record<string, string> = { ndi: "NDI", odi: "ODI", nprs: "NPRS", psfs: "PSFS", quickdash: "QuickDASH" };

/** A short description of a records audit row's detail for the patient's history (ids are never shown). */
export function describeRecordsDetail(action: string, detail: Record<string, unknown> | null | undefined): string | null {
  if (!detail || typeof detail !== "object") return null;
  switch (action) {
    case "pms.note.amend":
      return AMEND_WORDS[String(detail.kind)] ?? null;
    case "pms.note.create":
      return typeof detail.noteType === "string" ? ({ initial: "Initial assessment", follow_up: "Follow-up", discharge: "Discharge", general: "General note" } as Record<string, string>)[detail.noteType] ?? null : null;
    case "pms.note.save":
      return typeof detail.sections === "number" ? `${detail.sections} section${detail.sections === 1 ? "" : "s"} written` : null;
    case "pms.outcome.record":
      return MEASURE_WORDS[String(detail.measure)] ?? null;
    case "pms.patient.export":
      return detail.format === "pdf" ? "PDF copy" : detail.format === "json" ? "Data file (JSON)" : null;
    case "pms.patient.update":
      return Array.isArray(detail.fields) ? `${detail.fields.length} field${detail.fields.length === 1 ? "" : "s"} changed` : null;
    case "pms.patient.status":
      return detail.status === "active" ? "Made active" : detail.status === "archived" ? "Archived" : detail.status === "deceased" ? "Death recorded" : null;
    case "pms.patient.legal_hold":
      return detail.hold === true ? "Put on hold" : detail.hold === false ? "Hold taken off" : null;
    case "pms.patient.anonymise":
      return typeof detail.notes === "number" ? `${detail.notes} notes, ${detail.outcomes ?? 0} measures, ${detail.attachments ?? 0} files` : null;
    case "pms.attachment.upload":
      return typeof detail.type === "string" ? detail.type.toUpperCase() : null;
    default:
      return null;
  }
}
