/**
 * Data checks: problems in the SOURCE RECORD (not the draft), shown on the data preview and as
 * DATA_CHECK flags. Pure; runs on the server and in the browser.
 *
 * Each code appears at most once per bundle (several affected items are listed in one check), so
 * flag IDs derived from the code stay stable. Order: blocking first, then warnings, then info.
 *
 * Owner: integration agent. Signature is final.
 */
import { formatUkDate } from "../dates";
import { authorKey, notesByAuthor } from "../computed-facts";
import type { DataCheck, DataCheckSeverity, EpisodeBundle, Note } from "../types";

/**
 * Wording that shows a note records the patient's health BEFORE the incident (including a negative
 * history such as "no previous neck problems"). Deliberately specific: "continue previous programme"
 * or "more than before the accident" must not count.
 */
const PRE_INCIDENT_HISTORY_PATTERNS: RegExp[] = [
  /\bPMH\b/i,
  /\bpast (?:medical )?history\b/i,
  /\bmedical history\b/i,
  /\bprevious(?:ly)? (?:history|episodes?|injur(?:y|ies)|problems?|symptoms?|treatment|surgery|operations?|neck|back|shoulder|knee|hip|ankle|wrist|elbow|spinal|lumbar|cervical|whiplash|accidents?|RTAs?|conditions?|complaints?|pain)\b/i,
  /\bprior (?:history|episodes?|injur(?:y|ies)|problems?|symptoms?|treatment|surgery|neck|back|shoulder|conditions?|complaints?|pain|to (?:the|this) (?:accident|incident|injury))\b/i,
  /\bpre-?(?:accident|incident|injury|existing)\b/i,
  /\bno (?:relevant |significant )?(?:history|hx)\b/i,
  /\bnil (?:relevant|significant|of note|PMH)\b/i,
  /\b(?:asymptomatic|symptom-free|pain-free|fully fit) (?:before|prior to) (?:the|this) (?:accident|incident|injury)\b/i,
];

/** Wording in a later note that explains a missed appointment. */
const DNA_EXPLAINED_PATTERN =
  /\b(?:DNA|did not attend|didn't attend|failed to attend|non-attendance|missed (?:the |her |his |their |last |previous )?(?:appointment|session|visit))\b/i;

const SEVERITY_ORDER: Record<DataCheckSeverity, number> = { blocking: 0, warning: 1, info: 2 };

/**
 * Run every data check on a bundle. Checks (DataCheckCode):
 * - NO_PRE_INCIDENT_HISTORY (warning): no note records pre-incident/past history.
 * - DNA_WITHOUT_REASON (warning): DNA appointment(s) with no reason and no later note explaining
 *   them; relatedIds = appointment IDs.
 * - EPISODE_STILL_OPEN (info) / NO_DISCHARGE_NOTE (warning, discharged episode without one).
 * - SINGLE_TIMEPOINT_OUTCOME (warning): outcome series with one point; relatedIds = series IDs.
 * - CONSENT_NOT_RECORDED (blocking): disclosure consent not recorded.
 * - INCIDENT_DATE_MISSING (warning): incident without a date, or no incident on a solicitor/insurer referral.
 * - MULTIPLE_CLINICIANS (info): notes by more than one clinician (signer reminded to distinguish
 *   their own knowledge); relatedIds = note IDs not written by the first author.
 */
export function runDataChecks(bundle: EpisodeBundle): DataCheck[] {
  const checks: DataCheck[] = [];
  const notes = bundle.notes.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // CONSENT_NOT_RECORDED
  if (!bundle.consent.disclosureConsentRecorded) {
    checks.push({
      code: "CONSENT_NOT_RECORDED",
      severity: "blocking",
      // Fix wave 3: uploaded notes have no clinic system inside ClinForms – the consent is recorded on the report
      // (review screen: "Record consent"), by a member who may approve.
      message:
        bundle.source.connectorId === "file-import"
          ? "The uploaded notes do not show the patient's consent to share their records with the instructing party. Once the patient has consented, record it here (Record consent) before the report is approved."
          : "The record does not show the patient's consent to disclose their records to the instructing party. Record consent in the clinic system before the report is released.",
      relatedIds: [],
    });
  }

  // NO_PRE_INCIDENT_HISTORY
  if (notes.length > 0 && !notes.some(recordsPreIncidentHistory)) {
    const initial = notes.filter((n) => n.type === "initial_assessment").map((n) => n.id);
    checks.push({
      code: "NO_PRE_INCIDENT_HISTORY",
      severity: "warning",
      message: `No note records the patient's health before the ${incidentWord(bundle)} (past medical history, previous episodes, or "no previous problems"). Instructing parties expect it; ask the treating clinician or state that it was not recorded.`,
      relatedIds: initial.length ? initial : [notes[0].id],
    });
  }

  // DNA_WITHOUT_REASON
  const unexplained = bundle.appointments
    .filter((a) => a.status === "DNA" && !a.reason?.trim())
    .filter((a) => !notes.some((n) => n.date >= a.date && DNA_EXPLAINED_PATTERN.test(noteText(n))))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (unexplained.length) {
    const list = unexplained.map((a) => `${formatUkDate(a.date)} (${a.id})`).join(", ");
    checks.push({
      code: "DNA_WITHOUT_REASON",
      severity: "warning",
      message:
        unexplained.length === 1
          ? `Missed appointment on ${list} with no reason recorded, and no later note explains it. The report will state the non-attendance without a reason; ask the clinician if one is known.`
          : `${unexplained.length} missed appointments with no reason recorded and no later note explaining them: ${list}.`,
      relatedIds: unexplained.map((a) => a.id),
    });
  }

  // EPISODE_STILL_OPEN / NO_DISCHARGE_NOTE
  const dischargeNotes = notes.filter((n) => n.type === "discharge");
  if (bundle.episodeStatus === "open") {
    checks.push({
      code: "EPISODE_STILL_OPEN",
      severity: "info",
      message:
        "The episode of care is still open: the report will describe treatment to date, and current status may change.",
      relatedIds: [],
    });
  } else if (dischargeNotes.length === 0) {
    checks.push({
      code: "NO_DISCHARGE_NOTE",
      severity: "warning",
      message:
        "The episode is marked as discharged, but there is no discharge note, so the status at discharge is not recorded.",
      relatedIds: notes.length ? [notes[notes.length - 1].id] : [],
    });
  }

  // SINGLE_TIMEPOINT_OUTCOME
  const single = bundle.outcomeMeasures.filter((s) => s.points.length === 1);
  if (single.length) {
    const names = single.map((s) => `${s.instrument} (${formatUkDate(s.points[0].date)})`).join(", ");
    checks.push({
      code: "SINGLE_TIMEPOINT_OUTCOME",
      severity: "warning",
      message: `Outcome measure recorded at one time point only, so no change can be shown: ${names}.`,
      relatedIds: single.map((s) => s.id),
    });
  }

  // INCIDENT_DATE_MISSING
  if (bundle.incident && !bundle.incident.date) {
    checks.push({
      code: "INCIDENT_DATE_MISSING",
      severity: "warning",
      message: "The incident is recorded without a date. The report needs the date of the accident or injury.",
      relatedIds: [],
    });
  } else if (!bundle.incident && (bundle.referral.type === "solicitor" || bundle.referral.type === "insurer")) {
    checks.push({
      code: "INCIDENT_DATE_MISSING",
      severity: "warning",
      message: "No incident (date and mechanism) is recorded on the referral, which a medico-legal report needs.",
      relatedIds: [],
    });
  }

  // MULTIPLE_CLINICIANS
  const authors = notesByAuthor(notes);
  if (authors.length > 1) {
    const first = authors[0];
    const firstKey = authorKey(first);
    checks.push({
      code: "MULTIPLE_CLINICIANS",
      severity: "info",
      message: `Notes were written by ${authors.length} clinicians (${authors
        .map((a) => `${a.name}: ${a.noteIds.length}`)
        .join(", ")}). When signing, make clear which findings are your own and which come from colleagues' notes.`,
      relatedIds: notes.filter((n) => authorKey(n.author) !== firstKey).map((n) => n.id),
    });
  }

  return checks
    .map((c, i) => ({ c, i }))
    .sort((a, b) => SEVERITY_ORDER[a.c.severity] - SEVERITY_ORDER[b.c.severity] || a.i - b.i)
    .map(({ c }) => c);
}

function noteText(n: Note): string {
  return [n.subjective, n.objective, n.assessment, n.plan, n.freeText ?? ""].join("\n");
}

function recordsPreIncidentHistory(n: Note): boolean {
  if (n.pastMedicalHistory?.trim() || n.socialHistory?.trim()) return true;
  const text = noteText(n);
  return PRE_INCIDENT_HISTORY_PATTERNS.some((re) => re.test(text));
}

function incidentWord(bundle: EpisodeBundle): string {
  switch (bundle.incident?.type) {
    case "road_traffic_accident":
      return "accident";
    case "workplace":
    case "slip_trip_fall":
    case "sport":
      return "injury";
    default:
      return "incident";
  }
}
