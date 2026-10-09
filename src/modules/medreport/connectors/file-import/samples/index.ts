/**
 * Downloadable sample exports for the file-import connector, all describing the same FICTIONAL case
 * (Priya Nair, ./priya-nair.ts) in our three import formats. The Studio offers them as
 * "Download sample export"; tests check that each one parses.
 *
 * BROWSER-SAFE plain strings (no "server-only"): import from the Studio with a normal import.
 *
 *   import { SAMPLE_IMPORT_FILES } from "@/modules/medreport/connectors/file-import/samples";
 *   const file = SAMPLE_IMPORT_FILES.csv;   // { fileName, mimeType, format, content, label }
 *   const blob = new Blob([file.content], { type: file.mimeType });
 *
 * Owner: integration agent.
 */
import { PRODUCT } from "../../../config.public";
import { CSV_REQUIRED_COLUMNS, type ImportDocument } from "../format";
import { PRIYA_NAIR_IMPORT } from "./priya-nair";
import { PRIYA_NAIR_NOTES_PDF_BASE64 } from "./generated/priya-nair-notes.pdf.b64";

export { PRIYA_NAIR_IMPORT } from "./priya-nair";

export interface SampleImportFile {
  format: "json" | "csv" | "text";
  label: string;
  fileName: string;
  mimeType: string;
  content: string;
}

const toUk = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/* ------------------------------------------------------------------------------------------------
 * JSON
 * ----------------------------------------------------------------------------------------------*/

export function buildSampleJson(doc: ImportDocument = PRIYA_NAIR_IMPORT): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/* ------------------------------------------------------------------------------------------------
 * CSV
 * ----------------------------------------------------------------------------------------------*/

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildSampleCsv(doc: ImportDocument = PRIYA_NAIR_IMPORT): string {
  const { patient, episode } = doc;
  const meta: Array<[string, string | null | undefined]> = [
    ["patient.id", patient.id],
    ["patient.title", patient.title],
    ["patient.first_name", patient.first_name],
    ["patient.last_name", patient.last_name],
    ["patient.date_of_birth", toUk(patient.date_of_birth)],
    ["patient.sex", patient.sex],
    ["patient.occupation", patient.occupation],
    ["patient.employer_name", patient.employer_name],
    ["episode.id", episode.id],
    ["episode.title", episode.title],
    ["episode.status", episode.status],
    ["referral.type", episode.referral.source_type],
    ["referral.name", episode.referral.organisation_name],
    ["referral.reference", episode.referral.reference],
    ["referral.contact_name", episode.referral.contact_name],
    ["referral.address", episode.referral.address],
    ["referral.date", toUk(episode.referral.referral_date)],
    ["referral.reason", episode.referral.reason],
    ["incident.date", toUk(episode.incident?.date)],
    ["incident.type", episode.incident?.incident_type],
    ["incident.mechanism", episode.incident?.mechanism],
    ["consent.recorded", episode.consent.disclosure_consent_recorded ? "yes" : "no"],
    ["consent.date", toUk(episode.consent.recorded_on)],
  ];
  const lines = [
    `# ${PRODUCT.name} import – CSV v1. Fictional data only.`,
    "# One row per note or appointment. Dates DD/MM/YYYY. Status: ATT, DNA, LCN, CNC or BOOKED.",
    ...meta.filter(([, v]) => v).map(([k, v]) => `# ${k}: ${String(v).replace(/[\r\n]+/g, " ")}`),
  ];

  const instruments = doc.outcome_measures.map((m) => m.instrument);
  const header = [
    "date",
    "time",
    ...CSV_REQUIRED_COLUMNS.filter((c) => c !== "date"),
    "status",
    "reason",
    "past_medical_history",
    "social_history",
  ].concat(instruments);
  lines.push(header.join(","));

  const notesById = new Map(doc.notes.map((n) => [n.id ?? "", n]));
  const scoreFor = (instrument: string, date: string, noteId: string | null | undefined): string => {
    const series = doc.outcome_measures.find((m) => m.instrument === instrument);
    const point = series?.scores.find((s) => (noteId && s.note_id ? s.note_id === noteId : s.date === date));
    return point ? String(point.value) : "";
  };

  const appointments = doc.appointments.slice().sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
  for (const a of appointments) {
    const note = a.note_id ? notesById.get(a.note_id) : undefined;
    const author = note?.author ?? a.clinician;
    const row: Record<string, string> = {
      date: toUk(a.date),
      time: a.start_time,
      type: note?.note_type ?? "",
      author: author?.name ?? "",
      hcpc: author?.hcpc ?? "",
      subjective: note?.subjective ?? "",
      objective: note?.objective ?? "",
      assessment: note?.assessment ?? "",
      plan: note?.plan ?? "",
      status: a.status,
      reason: a.status_reason ?? "",
      past_medical_history: note?.past_medical_history ?? "",
      social_history: note?.social_history ?? "",
    };
    for (const instrument of instruments) row[instrument] = note ? scoreFor(instrument, a.date, note.id) : "";
    lines.push(header.map((h) => csvCell(row[h])).join(","));
  }
  // UTF-8 BOM so Excel shows "–", "°" and "→" correctly; the parser strips it.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/* ------------------------------------------------------------------------------------------------
 * Pasted notes (text)
 * ----------------------------------------------------------------------------------------------*/

const NOTE_TYPE_HEADINGS: Record<string, string> = {
  initial_assessment: "Initial assessment",
  follow_up: "Follow-up",
  discharge: "Discharge",
  telephone: "Telephone",
  other: "Note",
};

export function buildSampleText(doc: ImportDocument = PRIYA_NAIR_IMPORT): string {
  const { patient, episode } = doc;
  const header: Array<[string, string | null | undefined]> = [
    ["Patient", `${patient.first_name} ${patient.last_name}`],
    ["Date of birth", toUk(patient.date_of_birth)],
    ["Sex", patient.sex],
    ["Occupation", patient.occupation],
    ["Instructing party", episode.referral.organisation_name],
    ["Instructing party type", episode.referral.source_type],
    ["Reference", episode.referral.reference],
    ["Incident date", toUk(episode.incident?.date)],
    ["Incident type", episode.incident?.incident_type],
    ["Incident", episode.incident?.mechanism],
    ["Consent", episode.consent.disclosure_consent_recorded ? `yes (${toUk(episode.consent.recorded_on)})` : "no"],
    ["Episode status", episode.status],
    ["Title", episode.title],
  ];
  const lines = header.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);

  const notes = doc.notes.slice().sort((a, b) => (a.note_date + (a.note_time ?? "")).localeCompare(b.note_date + (b.note_time ?? "")));
  for (const n of notes) {
    lines.push("");
    lines.push(
      `${toUk(n.note_date)}${n.note_time ? ` ${n.note_time}` : ""} – ${NOTE_TYPE_HEADINGS[n.note_type]} – ${n.author.name} (${n.author.hcpc})`,
    );
    lines.push(`S: ${n.subjective}`);
    lines.push(`O: ${n.objective}`);
    lines.push(`A: ${n.assessment}`);
    lines.push(`P: ${n.plan}`);
    if (n.past_medical_history) lines.push(`PMH: ${n.past_medical_history}`);
    if (n.social_history) lines.push(`SH: ${n.social_history}`);
  }
  return `${lines.join("\n")}\n`;
}

/* ------------------------------------------------------------------------------------------------
 * The files offered for download
 * ----------------------------------------------------------------------------------------------*/

export const SAMPLE_IMPORT_FILES: Record<"json" | "csv" | "text", SampleImportFile> = {
  json: {
    format: "json",
    label: "Sample export (JSON)",
    fileName: "appstackx-sample-export-priya-nair.json",
    mimeType: "application/json",
    content: buildSampleJson(),
  },
  csv: {
    format: "csv",
    label: "Sample export (CSV)",
    fileName: "appstackx-sample-export-priya-nair.csv",
    mimeType: "text/csv",
    content: buildSampleCsv(),
  },
  text: {
    format: "text",
    label: "Sample pasted notes",
    fileName: "appstackx-sample-notes-priya-nair.txt",
    mimeType: "text/plain",
    content: buildSampleText(),
  },
};

/** The same fictional case printed as a clinical notes report PDF (scripts/medreport/build-notes-pdf.ts). */
export const SAMPLE_PRINTED_NOTES_PDF = {
  label: "Sample printed notes (PDF)",
  fileName: "appstackx-sample-printed-notes-priya-nair.pdf",
  mimeType: "application/pdf",
  base64: PRIYA_NAIR_NOTES_PDF_BASE64,
} as const;

export const SAMPLE_IMPORT_JSON = SAMPLE_IMPORT_FILES.json.content;
export const SAMPLE_IMPORT_CSV = SAMPLE_IMPORT_FILES.csv.content;
export const SAMPLE_IMPORT_TEXT = SAMPLE_IMPORT_FILES.text.content;
