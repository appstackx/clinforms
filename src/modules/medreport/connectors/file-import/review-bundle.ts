import "server-only";

/**
 * A NotesReview that staff confirmed (./review-contract.ts) → the EpisodeBundle, built exactly as for any
 * other import: the review becomes an ImportDocument (./format.ts) and goes through the same mapper
 * (./parser.ts bundleFromImportDocument → connectors/tm3-sim/mapper.ts), so notes get N-001… in date and time
 * order, clinicians are listed once each and computed facts behave identically.
 *
 * - Only included entries with a date are used; an included entry without a date or a clinician is an issue
 *   (the Studio blocks confirming until staff fix them).
 * - A note's text is the entry's body exactly as written. Lines labelled S:/O:/A:/P: (or Subjective: …
 *   Plan:, PMH:, SH:) fill those fields, carrying on until the next label; text before the first label is
 *   kept as the note's other text. An entry with no text under its heading keeps the heading as its text.
 * - With an attendance record, an entry's status becomes an appointment (an attended one is linked to its
 *   note); a missed or cancelled appointment without text is an appointment only.
 * - Outcome scores keep their date (or their entry's date) and are linked to the entry's note on that date.
 * - What the import format has no field for is added afterwards: a medico-legal company or "other" as the
 *   instructing party, the insurer's membership and authorisation numbers, who referred the patient and the
 *   GP practice (never sent to the drafting service).
 *
 * Owner: integration agent.
 */
import type { EpisodeBundle, InstructingPartyType, TenantId } from "../../core/types";
import type { ImportDocument } from "./format";
import { bundleFromImportDocument, type ImportIssue, type ImportStats } from "./parser";
import {
  NOTES_REVIEW_FIELD_LABELS,
  NOTES_REVIEW_REQUIRED,
  type NotesReview,
  type NotesReviewEntry,
} from "./review-contract";

export interface ReviewBundleCounts extends ImportStats {
  /** Outcome scores in the bundle. */
  scores: number;
  /** Entries staff left out (or without a date). */
  leftOut: number;
  /** Registration fields found in the notes / filled in when confirmed. */
  detectedFields: number;
  filledFields: number;
}

export type ReviewBundleResult =
  | { ok: true; bundle: EpisodeBundle; warnings: ImportIssue[]; counts: ReviewBundleCounts }
  | { ok: false; issues: ImportIssue[] };

type SoapField = "subjective" | "objective" | "assessment" | "plan" | "past_medical_history" | "social_history" | "free_text";

/** One-letter labels need a colon ("S: …"); words take a colon or a spaced dash ("Plan – …"). */
const SOAP_LABEL =
  /^\s*(?:\*\*)?(?:(S|O|A|P)\s*:|(Subjective|Objective|Assessment|Plan|PMH|Past medical history|SH|Social history)\s*(?:\*\*)?\s*(?::|\s[-–]\s))(?:\*\*)?[ \t]?(.*)$/i;

function soapField(label: string): SoapField {
  const l = label.toLowerCase();
  if (l === "s" || l === "subjective") return "subjective";
  if (l === "o" || l === "objective") return "objective";
  if (l === "a" || l === "assessment") return "assessment";
  if (l === "p" || l === "plan") return "plan";
  if (l === "pmh" || l === "past medical history") return "past_medical_history";
  return "social_history";
}

/** A note's text split into its labelled sections, every line kept as written. */
export function splitNoteText(body: string): Record<SoapField, string> {
  const fields: Record<SoapField, string[]> = {
    subjective: [],
    objective: [],
    assessment: [],
    plan: [],
    past_medical_history: [],
    social_history: [],
    free_text: [],
  };
  let current: SoapField = "free_text";
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const m = SOAP_LABEL.exec(line);
    if (m) {
      current = soapField(m[1] ?? m[2]);
      if (m[3].trim()) fields[current].push(m[3].replace(/\s+$/, ""));
      continue;
    }
    if (line.trim() || fields[current].length) fields[current].push(line.replace(/\s+$/, ""));
  }
  const join = (f: SoapField) => fields[f].join("\n").replace(/^\n+|\n+$/g, "");
  return {
    subjective: join("subjective"),
    objective: join("objective"),
    assessment: join("assessment"),
    plan: join("plan"),
    past_medical_history: join("past_medical_history"),
    social_history: join("social_history"),
    free_text: join("free_text"),
  };
}

function incidentType(text: string): NonNullable<ImportDocument["episode"]["incident"]>["incident_type"] {
  const s = text.toLowerCase();
  if (/road|rta|traffic|collision|vehicle|car\b/.test(s)) return "road_traffic_accident";
  if (/work/.test(s)) return "workplace";
  if (/slip|trip|fall/.test(s)) return "slip_trip_fall";
  if (/sport/.test(s)) return "sport";
  return "other";
}

/** The mapper knows the clinic-system referral types; the others are set on the bundle afterwards. */
const WIRE_REFERRAL_TYPE: Record<InstructingPartyType, ImportDocument["episode"]["referral"]["source_type"]> = {
  solicitor: "solicitor",
  employer: "employer",
  insurer: "insurer",
  case_manager: "case_manager",
  mlc: "solicitor",
  other: "solicitor",
};

const NOT_RECORDED = "Not recorded";

export function bundleFromReview(review: NotesReview, opts: { tenantId: TenantId; now?: Date }): ReviewBundleResult {
  const reg = review.registration;
  const issues: ImportIssue[] = [];
  for (const field of NOTES_REVIEW_REQUIRED) {
    if (!String(reg[field]).trim()) {
      issues.push({ where: NOTES_REVIEW_FIELD_LABELS[field], message: `Enter the ${field === "instructingPartyType" ? "type of who the form is for" : NOTES_REVIEW_FIELD_LABELS[field].toLowerCase()}.` });
    }
  }
  const included = review.entries.filter((e) => e.include);
  for (const e of included) {
    const where = `${e.key} (${e.where})`;
    if (!e.date) issues.push({ where, message: "Give this entry a date, or leave it out." });
    if (!e.clinicianName.trim()) issues.push({ where, message: "Choose the clinician for this entry." });
    if (review.attendance && e.status && !e.time) issues.push({ where, message: "Add the time of this appointment." });
  }
  if (!included.length) issues.push({ where: "Notes", message: "Include at least one dated note." });
  if (issues.length) return { ok: false, issues };

  const used = included.filter((e) => e.date);
  const noteIdOf = new Map<string, string>();
  const notes: ImportDocument["notes"] = [];
  const appointments: ImportDocument["appointments"] = [];
  const author = (e: NotesReviewEntry) => ({ name: e.clinicianName.trim(), hcpc: e.clinicianHcpc.trim() || NOT_RECORDED, role: null });

  for (const e of used) {
    const status = review.attendance && e.status ? e.status : null;
    const hasText = e.body.trim() !== "";
    const makeNote = hasText || !status;
    const noteId = `note-${e.key}`;
    if (makeNote) {
      const text = splitNoteText(hasText ? e.body : e.heading);
      noteIdOf.set(e.key, noteId);
      notes.push({
        id: noteId,
        note_date: e.date,
        note_time: e.time || null,
        note_type: e.type,
        author: author(e),
        subjective: text.subjective,
        objective: text.objective,
        assessment: text.assessment,
        plan: text.plan,
        free_text: text.free_text || null,
        past_medical_history: text.past_medical_history || null,
        social_history: text.social_history || null,
        appointment_id: status === "ATT" ? `appt-${e.key}` : null,
      });
    }
    if (status) {
      appointments.push({
        id: `appt-${e.key}`,
        date: e.date,
        start_time: e.time,
        duration_minutes: null,
        status,
        status_reason: status !== "ATT" && e.reason.trim() ? e.reason.trim() : null,
        clinician: author(e),
        note_id: status === "ATT" && makeNote ? noteId : null,
      });
    }
  }
  if (!notes.length) return { ok: false, issues: [{ where: "Notes", message: "Include at least one entry with note text." }] };

  // Outcome scores: the entry's date unless written with their own; linked to the entry's note on that day.
  const entryByKey = new Map(review.entries.map((e) => [e.key, e] as const));
  const series = new Map<string, Array<{ date: string; value: number; note_id: string | null }>>();
  for (const o of review.outcomes) {
    const e = entryByKey.get(o.entryKey);
    if (!e || !e.include || !e.date) continue;
    const date = o.date || e.date;
    const list = series.get(o.instrument) ?? [];
    if (list.some((p) => p.date === date)) continue;
    list.push({ date, value: o.value, note_id: date === e.date ? (noteIdOf.get(e.key) ?? null) : null });
    series.set(o.instrument, list);
  }

  const partyType = reg.instructingPartyType as InstructingPartyType;
  const addressLine = reg.address.trim();
  const doc: ImportDocument = {
    patient: {
      id: "notes-patient",
      title: reg.title.trim() || null,
      first_name: reg.firstName.trim(),
      last_name: reg.lastName.trim(),
      date_of_birth: reg.dob,
      sex: reg.sex || "not_recorded",
      address: addressLine || reg.postcode.trim() ? { line1: addressLine, line2: null, town: null, postcode: reg.postcode.trim() || null } : null,
      phone: reg.phone.trim() || null,
      email: reg.email.trim() || null,
      occupation: reg.occupation.trim() || null,
      employer_name: reg.employer.trim() || null,
    },
    episode: {
      id: "notes-episode",
      title: null,
      status: notes.some((n) => n.note_type === "discharge") ? "discharged" : "open",
      referral: {
        source_type: WIRE_REFERRAL_TYPE[partyType],
        organisation_name: reg.instructingPartyName.trim(),
        reference: reg.reference.trim() || null,
        contact_name: null,
        address: null,
        referral_date: null,
        reason: null,
      },
      incident:
        reg.incidentDate || reg.incidentMechanism.trim()
          ? { date: reg.incidentDate || null, mechanism: reg.incidentMechanism.trim(), incident_type: incidentType(reg.incidentMechanism) }
          : null,
      consent: { disclosure_consent_recorded: reg.consent === "yes", recorded_on: reg.consent === "yes" && reg.consentDate ? reg.consentDate : null },
      primary_clinician: null,
    },
    notes,
    appointments,
    outcome_measures: Array.from(series.entries()).map(([instrument, scores]) => ({
      instrument: instrument as ImportDocument["outcome_measures"][number]["instrument"],
      scores: scores.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    })),
  };

  const label = review.fileName?.trim() || (review.format === "text" ? "Pasted notes" : "Uploaded notes");
  const result = bundleFromImportDocument(doc, {
    tenantId: opts.tenantId,
    now: opts.now,
    label,
    patch: (b) => {
      const referral: EpisodeBundle["referral"] = { ...b.referral, type: partyType };
      if (reg.insurerName.trim()) referral.insurerName = reg.insurerName.trim();
      if (reg.membershipNumber.trim()) referral.membershipNumber = reg.membershipNumber.trim();
      if (reg.authorisationNumber.trim()) referral.authorisationNumber = reg.authorisationNumber.trim();
      if (reg.referredBy.trim()) referral.referredBy = reg.referredBy.trim();
      const registration: EpisodeBundle["registration"] = { ...b.registration };
      if (reg.gpPractice.trim()) registration.gpPractice = reg.gpPractice.trim();
      return { ...b, referral, registration };
    },
  });
  if (!result.ok) return { ok: false, issues: result.issues };
  const filled = (Object.keys(reg) as Array<keyof typeof reg>).filter((k) => String(reg[k]).trim() !== "").length;
  return {
    ok: true,
    bundle: result.bundle,
    warnings: result.warnings,
    counts: {
      ...result.stats,
      scores: result.bundle.outcomeMeasures.reduce((n, m) => n + m.points.length, 0),
      leftOut: review.entries.length - used.length,
      detectedFields: review.detected.length,
      filledFields: filled,
    },
  };
}
