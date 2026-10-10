import "server-only";

/**
 * Parses an ImportPayload (json | csv | text) in OUR documented import format (./format.ts) into an
 * EpisodeBundle, with plain-English issues a clinic administrator can act on ("line 7: the time
 * '9.3' is not a 24-hour time like 09:30").
 *
 * All three formats are first normalised to an ImportDocument (the wire-like JSON shape), then run
 * through the same mapper as the simulated TM3 connector, so citable IDs (N-001… in date/time order,
 * A-001…, OM-<instrument>) behave identically. The bundle's source is then set to
 * { connectorId: "file-import", simulated: false, label: <file name or "Pasted notes"> }.
 *
 * Pure apart from the clock (`now`, injectable for tests). Never logs content.
 *
 * Owner: integration agent.
 */
import { EpisodeBundleSchema } from "../../core/schemas";
import { isValidIsoDate } from "../../core/dates";
import type { EpisodeBundle, ImportPayload, TenantId } from "../../core/types";
import { mapSimEpisodeToBundle, type SimEpisodeData } from "../tm3-sim/mapper";
import type { SimAppointment, SimClinician, SimEpisode, SimNote, SimOutcomeMeasure, SimPatient } from "../tm3-sim/wire";
import { ConnectorError } from "../types";
import {
  CSV_METADATA_KEYS,
  CSV_REQUIRED_COLUMNS,
  IMPORT_FORMAT_ID,
  INSTRUMENT_DEFAULTS,
  ImportDocumentSchema,
  MAX_IMPORT_CHARS,
  MAX_IMPORT_NOTES,
  MAX_IMPORT_ROWS,
  type ImportDocument,
} from "./format";

export interface ImportIssue {
  /** e.g. "notes[3].note_date", "line 12, column 'time'" or "file" */
  where: string;
  message: string;
}

export interface ImportStats {
  notes: number;
  appointments: number;
  outcomeSeries: number;
  clinicians: number;
}

export type ImportResult =
  | { ok: true; bundle: EpisodeBundle; warnings: ImportIssue[]; stats: ImportStats }
  | { ok: false; issues: ImportIssue[] };

/** Thrown by the file-import connector; the handler turns it into 422 IMPORT_INVALID with `issues`. */
export class ImportError extends ConnectorError {
  readonly issues: ImportIssue[];

  constructor(issues: ImportIssue[]) {
    super("INVALID_DATA", issues.length === 1 ? issues[0].message : `The import has ${issues.length} problems.`);
    this.name = "ImportError";
    this.issues = issues;
  }
}

type Instrument = keyof typeof INSTRUMENT_DEFAULTS;
const INSTRUMENTS = Object.keys(INSTRUMENT_DEFAULTS) as Instrument[];
const MAX_ISSUES = 50;

export function parseImport(payload: ImportPayload, opts: { tenantId: TenantId; now?: Date }): ImportResult {
  const content = payload.content.replace(/^﻿/, "");
  if (content.length > MAX_IMPORT_CHARS) {
    return fail([{ where: "file", message: `The file is too large (over ${Math.round(MAX_IMPORT_CHARS / 1_000_000)} million characters).` }]);
  }
  if (!content.trim()) return fail([{ where: "file", message: "The file is empty." }]);

  const label = payload.fileName?.trim() ? payload.fileName.trim() : payload.format === "text" ? "Pasted notes" : "Uploaded export";
  const ctx: BuildContext = { tenantId: opts.tenantId, now: opts.now ?? new Date(), label, warnings: [] };

  let built: { doc: ImportDocument } | { bundle: EpisodeBundle } | { issues: ImportIssue[] };
  switch (payload.format) {
    case "json":
      built = readJson(content, ctx);
      break;
    case "csv":
      built = readCsv(content, ctx);
      break;
    case "text":
      built = readText(content, ctx);
      break;
    default:
      return fail([{ where: "format", message: "Unknown format. Use json, csv or text." }]);
  }
  if ("issues" in built) return fail(built.issues);
  const result = "bundle" in built ? finishBundle(built.bundle, ctx, null) : documentToBundle(built.doc, ctx);
  if ("issues" in result) return fail(result.issues);
  const bundle = result.bundle;
  return {
    ok: true,
    bundle,
    warnings: ctx.warnings.slice(0, MAX_ISSUES),
    stats: {
      notes: bundle.notes.length,
      appointments: bundle.appointments.length,
      outcomeSeries: bundle.outcomeMeasures.length,
      clinicians: bundle.clinicians.length,
    },
  };
}

interface BuildContext {
  tenantId: TenantId;
  now: Date;
  label: string;
  warnings: ImportIssue[];
}

function fail(issues: ImportIssue[]): ImportResult {
  return { ok: false, issues: issues.slice(0, MAX_ISSUES) };
}

/* ------------------------------------------------------------------------------------------------
 * Dates, times and small normalisers
 * ----------------------------------------------------------------------------------------------*/

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
};

/** "2026-03-18", "18/03/2026", "18-3-2026", "18.03.2026" or "18 March 2026" → ISO, else null. */
export function toIsoDate(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  let y: number;
  let m: number;
  let d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(s))) {
    d = Number(match[1]);
    m = MONTHS[match[2].toLowerCase()] ?? 0;
    y = Number(match[3]);
  } else {
    return null;
  }
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : null;
}

/** "09:30", "9:30", "9.30" → "09:30", else null. */
export function toTime(input: string | null | undefined): string | null {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec((input ?? "").trim());
  if (!match) return null;
  const h = Number(match[1]);
  const min = Number(match[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function blankToNull(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t ? t : null;
}

function normaliseNoteType(input: string): ImportDocument["notes"][number]["note_type"] | null {
  const s = input.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!s) return null;
  if (["initial_assessment", "initial", "ia", "assessment", "new_patient"].indexOf(s) >= 0) return "initial_assessment";
  if (["follow_up", "followup", "fu", "review", "treatment", "follow_up_appointment"].indexOf(s) >= 0) return "follow_up";
  if (["discharge", "discharged", "discharge_note", "final_review"].indexOf(s) >= 0) return "discharge";
  if (["telephone", "phone", "telephone_call", "phone_call", "tel"].indexOf(s) >= 0) return "telephone";
  if (s === "other" || s === "note") return "other";
  return null;
}

function normaliseReferralType(input: string): ImportDocument["episode"]["referral"]["source_type"] | null {
  const s = input.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const known = ["solicitor", "employer", "insurer", "case_manager", "self", "gp"] as const;
  for (const k of known) if (s === k) return k;
  if (s === "self_referral") return "self";
  if (s === "insurance") return "insurer";
  return null;
}

function normaliseIncidentType(input: string): NonNullable<ImportDocument["episode"]["incident"]>["incident_type"] {
  const s = input.trim().toLowerCase();
  if (/road|rta|traffic|collision|vehicle/.test(s)) return "road_traffic_accident";
  if (/work/.test(s)) return "workplace";
  if (/slip|trip|fall/.test(s)) return "slip_trip_fall";
  if (/sport/.test(s)) return "sport";
  return "other";
}

function parseYesNo(input: string): boolean | null {
  const s = input.trim().toLowerCase();
  if (/^(yes|y|true|recorded|given|1)\b/.test(s)) return true;
  if (/^(no|n|false|not recorded|not given|0)\b/.test(s)) return false;
  return null;
}

function inferReferralTypeFromName(name: string): ImportDocument["episode"]["referral"]["source_type"] | null {
  if (/solicitor|\blaw\b|legal|\bllp\b/i.test(name)) return "solicitor";
  if (/insur/i.test(name)) return "insurer";
  if (/case manage/i.test(name)) return "case_manager";
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * JSON
 * ----------------------------------------------------------------------------------------------*/

function readJson(content: string, ctx: BuildContext): { doc: ImportDocument } | { bundle: EpisodeBundle } | { issues: ImportIssue[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    const detail = err instanceof Error ? err.message.replace(/^JSON\.parse:\s*/, "") : "";
    return { issues: [{ where: "file", message: `The file is not valid JSON${detail ? ` (${detail})` : ""}. Check for a missing comma, bracket or quote.` }] };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { issues: [{ where: "file", message: "The JSON must be one object with patient, episode and notes." }] };
  }
  const obj = raw as Record<string, unknown>;

  // Our canonical EpisodeBundle (e.g. saved from GET …/bundle) is accepted as it is.
  if ("registration" in obj && "source" in obj) {
    const parsed = EpisodeBundleSchema.safeParse(obj);
    if (!parsed.success) return { issues: zodToIssues(parsed.error.issues, "") };
    return { bundle: parsed.data };
  }

  if ("format" in obj && obj.format !== IMPORT_FORMAT_ID) {
    return { issues: [{ where: "format", message: `Unknown format "${String(obj.format)}". Expected "${IMPORT_FORMAT_ID}".` }] };
  }
  const parsed = ImportDocumentSchema.safeParse(obj);
  if (!parsed.success) return { issues: zodToIssues(parsed.error.issues, "") };
  void ctx;
  return { doc: parsed.data };
}

function zodToIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string; code?: string }>, prefix: string): ImportIssue[] {
  return issues.slice(0, MAX_ISSUES).map((i) => {
    const path = i.path
      .map((p, idx) => (typeof p === "number" ? `[${p}]` : `${idx === 0 ? "" : "."}${String(p)}`))
      .join("");
    const where = `${prefix}${path}` || "file";
    const message =
      i.code === "invalid_type" && /received undefined/i.test(i.message)
        ? `"${String(i.path[i.path.length - 1] ?? "value")}" is missing.`
        : i.message;
    return { where, message };
  });
}

/* ------------------------------------------------------------------------------------------------
 * CSV
 * ----------------------------------------------------------------------------------------------*/

interface CsvRecord {
  line: number;
  cells: string[];
}

/** RFC 4180 CSV: quoted fields, "" escapes, embedded newlines, CRLF or LF. */
export function parseCsvRecords(text: string, firstLine = 1): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = firstLine;
  let recordLine = firstLine;
  let i = 0;
  const pushCell = () => {
    cells.push(cell);
    cell = "";
  };
  const pushRecord = () => {
    pushCell();
    records.push({ line: recordLine, cells });
    cells = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === "\n") line += 1;
      if (ch === "\r" && text[i + 1] === "\n") {
        cell += "\n";
        line += 1;
        i += 2;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      cell = "";
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushCell();
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      pushRecord();
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      line += 1;
      recordLine = line;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell !== "" || cells.length > 0) pushRecord();
  return records.filter((r) => r.cells.some((c) => c.trim() !== ""));
}

const CSV_META_KEYS = CSV_METADATA_KEYS.map((m) => m.key);

function normaliseHeader(h: string): string {
  const t = h.trim();
  const instrument = INSTRUMENTS.find((i) => i.toLowerCase() === t.toLowerCase());
  if (instrument) return instrument;
  return t.toLowerCase().replace(/[\s-]+/g, "_");
}

function readCsv(content: string, ctx: BuildContext): { doc: ImportDocument } | { issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const physical = content.split(/\r?\n/);
  const meta = new Map<string, { value: string; line: number }>();
  let headerStart = physical.length;
  for (let i = 0; i < physical.length; i++) {
    const t = physical[i].trim();
    if (t === "") continue;
    if (!t.startsWith("#")) {
      headerStart = i;
      break;
    }
    const kv = /^#\s*([A-Za-z_.]+)\s*:\s*(.*)$/.exec(t);
    if (!kv) continue; // plain comment
    const key = kv[1].toLowerCase();
    if (CSV_META_KEYS.indexOf(key) < 0) {
      ctx.warnings.push({ where: `line ${i + 1}`, message: `Unknown setting "${kv[1]}" was ignored.` });
      continue;
    }
    meta.set(key, { value: kv[2].trim(), line: i + 1 });
  }
  if (headerStart >= physical.length) {
    return { issues: [{ where: "file", message: `No header row found. The first line that does not start with "#" must be the column names: ${CSV_REQUIRED_COLUMNS.join(",")}.` }] };
  }

  const records = parseCsvRecords(physical.slice(headerStart).join("\n"), headerStart + 1);
  const [headerRecord, ...rows] = records;
  const header = headerRecord.cells.map(normaliseHeader);
  const missing = CSV_REQUIRED_COLUMNS.filter((c) => header.indexOf(c) < 0);
  if (missing.length) {
    issues.push({
      where: `line ${headerRecord.line}`,
      message: `The header row is missing the column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
    });
  }
  if (rows.length === 0) issues.push({ where: "file", message: "The file has a header row but no notes." });
  if (rows.length > MAX_IMPORT_ROWS) issues.push({ where: "file", message: `Too many rows (maximum ${MAX_IMPORT_ROWS}).` });

  // Metadata
  const m = (key: string) => blankToNull(meta.get(key)?.value);
  const metaWhere = (key: string) => (meta.has(key) ? `line ${meta.get(key)?.line}` : `# ${key}`);
  const requireMeta = (key: string, example: string) => {
    if (!m(key)) issues.push({ where: `# ${key}`, message: `Add a line "# ${key}: ${example}" above the header row.` });
  };
  for (const k of CSV_METADATA_KEYS) if (k.required) requireMeta(k.key, k.example);
  if (issues.length) return { issues };

  const dob = toIsoDate(m("patient.date_of_birth"));
  if (!dob) issues.push({ where: metaWhere("patient.date_of_birth"), message: "The date of birth is not a valid date (use DD/MM/YYYY)." });
  const referralType = normaliseReferralType(m("referral.type") ?? "");
  if (!referralType) {
    issues.push({ where: metaWhere("referral.type"), message: "The referral type must be solicitor, employer, insurer or case manager." });
  }
  const consent = parseYesNo(m("consent.recorded") ?? "");
  if (consent === null) issues.push({ where: metaWhere("consent.recorded"), message: 'Consent must be "yes" or "no".' });
  const optionalMetaDate = (key: string): string | null => {
    const raw = m(key);
    if (!raw) return null;
    const iso = toIsoDate(raw);
    if (!iso) issues.push({ where: metaWhere(key), message: `"${raw}" is not a valid date (use DD/MM/YYYY).` });
    return iso;
  };
  const referralDate = optionalMetaDate("referral.date");
  const incidentDate = optionalMetaDate("incident.date");
  const consentDate = optionalMetaDate("consent.date");
  const sexRaw = (m("patient.sex") ?? "").toLowerCase();
  const sex = sexRaw === "female" || sexRaw === "male" || sexRaw === "other" ? sexRaw : sexRaw === "f" ? "female" : sexRaw === "m" ? "male" : "not_recorded";
  const statusRaw = (m("episode.status") ?? "").toLowerCase();
  if (statusRaw && statusRaw !== "open" && statusRaw !== "discharged") {
    issues.push({ where: metaWhere("episode.status"), message: 'Episode status must be "open" or "discharged".' });
  }

  // Rows
  const col = (r: CsvRecord, name: string) => {
    const idx = header.indexOf(name);
    return idx >= 0 ? (r.cells[idx] ?? "").trim() : "";
  };
  const hasStatusColumn = header.indexOf("status") >= 0;
  const instrumentCols = header.filter((h): h is Instrument => INSTRUMENTS.indexOf(h as Instrument) >= 0);
  const notes: ImportDocument["notes"] = [];
  const appointments: ImportDocument["appointments"] = [];
  const scores = new Map<Instrument, Array<{ date: string; value: number; note_id: string | null }>>();

  for (const r of rows.slice(0, MAX_IMPORT_ROWS)) {
    if (issues.length >= MAX_ISSUES) break;
    const where = (c?: string) => `line ${r.line}${c ? `, column '${c}'` : ""}`;
    if (r.cells.length > header.length && r.cells.slice(header.length).some((c) => c.trim())) {
      issues.push({ where: where(), message: `The row has ${r.cells.length} values but the header has ${header.length} columns. Put text containing commas in double quotes.` });
      continue;
    }
    const date = toIsoDate(col(r, "date"));
    if (!date) {
      issues.push({ where: where("date"), message: col(r, "date") ? `"${col(r, "date")}" is not a valid date (use DD/MM/YYYY).` : "The date is missing." });
      continue;
    }
    const soap = {
      subjective: col(r, "subjective"),
      objective: col(r, "objective"),
      assessment: col(r, "assessment"),
      plan: col(r, "plan"),
      free_text: col(r, "free_text"),
    };
    const hasNote = Object.values(soap).some(Boolean);
    const statusText = col(r, "status").toUpperCase();
    const status = statusText ? (["ATT", "DNA", "LCN", "CNC", "BOOKED"].indexOf(statusText) >= 0 ? (statusText as ImportDocument["appointments"][number]["status"]) : null) : undefined;
    if (status === null) {
      issues.push({ where: where("status"), message: `"${col(r, "status")}" is not a status. Use ATT, DNA, LCN, CNC or BOOKED.` });
      continue;
    }
    const timeText = col(r, "time");
    const time = timeText ? toTime(timeText) : null;
    if (timeText && !time) {
      issues.push({ where: where("time"), message: `"${timeText}" is not a 24-hour time like 09:30.` });
      continue;
    }
    if (!hasNote && !status) {
      issues.push({ where: where(), message: hasStatusColumn ? "The row has no note text and no status." : "The row has no note text." });
      continue;
    }
    const author = col(r, "author");
    const hcpc = col(r, "hcpc");
    const noteId = `csv-note-${r.line}`;
    if (hasNote) {
      const type = normaliseNoteType(col(r, "type"));
      if (!type) {
        issues.push({ where: where("type"), message: col(r, "type") ? `"${col(r, "type")}" is not a note type. Use initial_assessment, follow_up, discharge, telephone or other.` : "The note type is missing." });
        continue;
      }
      if (!author || !hcpc) {
        issues.push({ where: where(author ? "hcpc" : "author"), message: author ? "The author's HCPC registration number is missing." : "The note's author is missing." });
        continue;
      }
      notes.push({
        id: noteId,
        note_date: date,
        note_time: time,
        note_type: type,
        author: { name: author, hcpc, role: null },
        subjective: soap.subjective,
        objective: soap.objective,
        assessment: soap.assessment,
        plan: soap.plan,
        free_text: blankToNull(soap.free_text),
        past_medical_history: blankToNull(col(r, "past_medical_history")),
        social_history: blankToNull(col(r, "social_history")),
        appointment_id: status === "ATT" ? `csv-appt-${r.line}` : null,
      });
    }
    if (status) {
      if (!time) {
        issues.push({ where: where("time"), message: "Appointments need a time (24-hour, like 09:30)." });
        continue;
      }
      appointments.push({
        id: `csv-appt-${r.line}`,
        date,
        start_time: time,
        duration_minutes: null,
        status,
        status_reason: blankToNull(col(r, "reason")),
        clinician: author && hcpc ? { name: author, hcpc, role: null } : null,
        note_id: status === "ATT" && hasNote ? noteId : null,
      });
    }
    for (const instrument of instrumentCols) {
      const raw = col(r, instrument).replace(/%$/, "").trim();
      if (!raw) continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        issues.push({ where: where(instrument), message: `"${col(r, instrument)}" is not a number.` });
        continue;
      }
      const list = scores.get(instrument) ?? [];
      list.push({ date, value, note_id: hasNote ? noteId : null });
      scores.set(instrument, list);
    }
  }
  if (!issues.length && notes.length === 0) issues.push({ where: "file", message: "The file has no clinical notes (only appointments)." });
  if (notes.length > MAX_IMPORT_NOTES) issues.push({ where: "file", message: `Too many notes (maximum ${MAX_IMPORT_NOTES}).` });
  if (issues.length) return { issues };

  const incidentMechanism = m("incident.mechanism");
  const incidentTypeRaw = m("incident.type");
  const doc: ImportDocument = {
    patient: {
      id: m("patient.id"),
      title: m("patient.title"),
      first_name: m("patient.first_name") as string,
      last_name: m("patient.last_name") as string,
      date_of_birth: dob as string,
      sex,
      occupation: m("patient.occupation"),
      employer_name: m("patient.employer_name"),
    },
    episode: {
      id: m("episode.id"),
      title: m("episode.title"),
      status: statusRaw === "open" || statusRaw === "discharged" ? statusRaw : notes.some((n) => n.note_type === "discharge") ? "discharged" : "open",
      referral: {
        source_type: referralType as NonNullable<typeof referralType>,
        organisation_name: m("referral.name") as string,
        reference: m("referral.reference"),
        contact_name: m("referral.contact_name"),
        address: m("referral.address"),
        referral_date: referralDate,
        reason: m("referral.reason"),
      },
      incident:
        incidentDate || incidentMechanism || incidentTypeRaw
          ? { date: incidentDate, mechanism: incidentMechanism ?? "", incident_type: normaliseIncidentType(incidentTypeRaw ?? incidentMechanism ?? "") }
          : null,
      consent: { disclosure_consent_recorded: consent === true, recorded_on: consentDate },
    },
    notes,
    appointments,
    outcome_measures: Array.from(scores.entries()).map(([instrument, points]) => ({
      instrument,
      scores: points,
    })),
  };
  return { doc };
}

/* ------------------------------------------------------------------------------------------------
 * Pasted notes (text)
 * ----------------------------------------------------------------------------------------------*/

const DATE_TOKEN =
  "(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?,?\\s+\\d{4})";
/** A line that starts a note: optional markdown/bullet/"Date:" prefix, then a date. */
const HEADING = new RegExp(`^\\s*(?:#{1,6}\\s*|\\*{1,2}\\s*|[-•]\\s+)?(?:date\\s*[:\\-–—]?\\s*)?${DATE_TOKEN}(.*)$`, "i");
const SOAP_LABEL =
  /^\s*(?:\*{1,2})?(S|O|A|P|Subjective|Objective|Assessment|Plan|PMH|Past medical history|SH|Social history)(?:\*{1,2})?\s*[:\-–](?:\*{1,2})?\s*(.*)$/i;
const OUTCOME_LINE = /\b(?:outcome measures?|outcomes?|scores?)\s*:\s*(.*)$/i;

type SoapField = "subjective" | "objective" | "assessment" | "plan" | "past_medical_history" | "social_history" | "free_text";

function soapFieldFor(label: string): SoapField {
  const l = label.toLowerCase();
  if (l === "s" || l === "subjective") return "subjective";
  if (l === "o" || l === "objective") return "objective";
  if (l === "a" || l === "assessment") return "assessment";
  if (l === "p" || l === "plan") return "plan";
  if (l === "pmh" || l === "past medical history") return "past_medical_history";
  return "social_history";
}

const TEXT_KEYS: Record<string, string> = {
  patient: "patient", name: "patient", "patient name": "patient",
  "date of birth": "dob", dob: "dob",
  sex: "sex", gender: "sex",
  occupation: "occupation",
  "instructing party": "party", "instructed by": "party", solicitor: "party:solicitor", insurer: "party:insurer", "case manager": "party:case_manager",
  "instructing party type": "partyType", "referral type": "partyType",
  reference: "reference", ref: "reference", "instructing reference": "reference",
  "incident date": "incidentDate", "date of incident": "incidentDate", "date of accident": "incidentDate", "accident date": "incidentDate", "injury date": "incidentDate",
  incident: "incident", mechanism: "incident", accident: "incident", "mechanism of injury": "incident",
  "incident type": "incidentType",
  consent: "consent", "disclosure consent": "consent", "consent to disclose": "consent",
  clinician: "clinician", physiotherapist: "clinician", author: "clinician",
  "episode status": "status", status: "status",
  title: "title", episode: "title", condition: "title",
};

function parseClinician(text: string): { name: string; hcpc: string } | null {
  const match = /^\s*([^()]+?)\s*\(([^()]+)\)\s*$/.exec(text);
  if (!match) return null;
  return { name: match[1].trim(), hcpc: match[2].trim() };
}

function readText(content: string, ctx: BuildContext): { doc: ImportDocument } | { issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const header = new Map<string, { value: string; line: number }>();

  interface Draft {
    line: number;
    date: string;
    time: string | null;
    headingRest: string;
    body: Array<{ text: string; line: number }>;
  }
  const drafts: Draft[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const heading = HEADING.exec(raw);
    const iso = heading ? toIsoDate(heading[1].replace(/\s+/g, " ")) : null;
    if (heading && iso) {
      let rest = heading[2] ?? "";
      let time: string | null = null;
      const t = /^\s*(?:at\s*)?(\d{1,2}[:.]\d{2})\b/.exec(rest);
      if (t) {
        time = toTime(t[1]);
        rest = rest.slice(t[0].length);
      }
      drafts.push({ line: i + 1, date: iso, time, headingRest: rest.replace(/\*+/g, "").trim(), body: [] });
      continue;
    }
    if (drafts.length === 0) {
      const t = raw.trim();
      if (!t) continue;
      const kv = /^([A-Za-z][A-Za-z ]{0,40}?)\s*:\s*(.+)$/.exec(t);
      const key = kv ? TEXT_KEYS[kv[1].trim().toLowerCase()] : undefined;
      if (kv && key) header.set(key.split(":")[0] === "party" ? "party" : key, { value: kv[2].trim(), line: i + 1 });
      if (kv && key?.startsWith("party:")) header.set("partyType", { value: key.slice(6), line: i + 1 });
      if (!key) ctx.warnings.push({ where: `line ${i + 1}`, message: "Text before the first dated note that is not a recognised 'Key: value' line was ignored." });
      continue;
    }
    drafts[drafts.length - 1].body.push({ text: raw, line: i + 1 });
  }

  if (drafts.length === 0) {
    return {
      issues: [{ where: "text", message: 'No dated notes found. Start each note on a new line beginning with its date, e.g. "18/03/2026 – Initial assessment – <clinician name> (<HCPC number>)".' }],
    };
  }
  if (drafts.length > MAX_IMPORT_NOTES) return { issues: [{ where: "text", message: `Too many notes (maximum ${MAX_IMPORT_NOTES}).` }] };

  const h = (key: string) => blankToNull(header.get(key)?.value);
  const hWhere = (key: string) => (header.has(key) ? `line ${header.get(key)?.line}` : "top of the text");

  const dob = toIsoDate(h("dob"));
  if (!dob) {
    issues.push({
      where: hWhere("dob"),
      message: h("dob") ? `"${h("dob")}" is not a valid date of birth (use DD/MM/YYYY).` : 'Add a line "Date of birth: DD/MM/YYYY" above the first note.',
    });
  }
  const partyName = h("party");
  let partyType = h("partyType") ? normaliseReferralType(h("partyType") as string) : null;
  if (!partyName) {
    issues.push({ where: "top of the text", message: 'Add a line "Instructing party: <name>" above the first note (and "Instructing party type: solicitor" or employer, insurer, case manager).' });
  } else if (!partyType) {
    partyType = inferReferralTypeFromName(partyName);
    if (!partyType) {
      issues.push({ where: hWhere("party"), message: 'Add a line "Instructing party type: solicitor" (or employer, insurer, case manager).' });
    }
  }
  const defaultClinician = h("clinician") ? parseClinician(h("clinician") as string) : null;
  if (h("clinician") && !defaultClinician) {
    ctx.warnings.push({ where: hWhere("clinician"), message: 'Write the clinician as "Name (HCPC number)".' });
  }

  const notes: ImportDocument["notes"] = [];
  const scores = new Map<Instrument, Array<{ date: string; value: number; note_id: string | null }>>();
  let untyped = 0;
  let unauthored = 0;
  drafts.forEach((d, idx) => {
    const id = `txt-note-${idx + 1}`;
    // Heading → type + author.
    const segments = d.headingRest.split(/\s+[–—|-]\s+|\s*[–—|]\s*|^\s*[-:,]\s*/).map((s) => s.trim()).filter(Boolean);
    let type: ImportDocument["notes"][number]["note_type"] | null = null;
    let author: { name: string; hcpc: string } | null = null;
    for (const seg of segments) {
      const c = parseClinician(seg);
      if (c && !author) {
        author = c;
        continue;
      }
      const lower = seg.toLowerCase();
      if (!type) {
        if (/discharge|final review/.test(lower)) type = "discharge";
        else if (/initial|new patient|\bia\b/.test(lower)) type = "initial_assessment";
        else if (/telephone|phone/.test(lower)) type = "telephone";
        else if (/follow[- ]?up|review|treatment|\bfu\b/.test(lower)) type = "follow_up";
      }
    }
    if (!type) {
      untyped += 1;
      type = "other";
    }
    if (!author) author = defaultClinician;
    if (!author) {
      unauthored += 1;
      author = { name: "Not recorded", hcpc: "Not recorded" };
    }

    // Body → SOAP fields.
    const fields: Record<SoapField, string[]> = {
      subjective: [], objective: [], assessment: [], plan: [], past_medical_history: [], social_history: [], free_text: [],
    };
    let current: SoapField = "free_text";
    for (const b of d.body) {
      const label = SOAP_LABEL.exec(b.text);
      if (label) {
        current = soapFieldFor(label[1]);
        if (label[2].trim()) fields[current].push(label[2].trim());
      } else if (b.text.trim() || fields[current].length) {
        fields[current].push(b.text.trim());
      }
      const outcome = OUTCOME_LINE.exec(b.text);
      if (outcome) {
        for (const s of extractScores(outcome[1])) {
          const list = scores.get(s.instrument) ?? [];
          if (!list.some((p) => p.note_id === id)) list.push({ date: d.date, value: s.value, note_id: id });
          scores.set(s.instrument, list);
        }
      }
    }
    const join = (f: SoapField) => fields[f].join("\n").replace(/\n+$/, "").trim();
    if (!["subjective", "objective", "assessment", "plan", "free_text"].some((f) => join(f as SoapField))) {
      ctx.warnings.push({ where: `line ${d.line}`, message: "This note has no text." });
    }
    notes.push({
      id,
      note_date: d.date,
      note_time: d.time,
      note_type: type,
      author: { name: author.name, hcpc: author.hcpc, role: null },
      subjective: join("subjective"),
      objective: join("objective"),
      assessment: join("assessment"),
      plan: join("plan"),
      free_text: blankToNull(join("free_text")),
      past_medical_history: blankToNull(join("past_medical_history")),
      social_history: blankToNull(join("social_history")),
      appointment_id: null,
    });
  });
  if (untyped) {
    ctx.warnings.push({ where: "text", message: `${untyped} note${untyped === 1 ? "" : "s"} did not name a type in the heading (initial assessment, follow-up, discharge, telephone) and ${untyped === 1 ? "was" : "were"} recorded as "other".` });
  }
  if (unauthored) {
    ctx.warnings.push({ where: "text", message: `${unauthored} note${unauthored === 1 ? "" : "s"} had no author. Add "Name (HCPC number)" to the heading or a "Clinician:" line at the top.` });
  }
  ctx.warnings.push({ where: "text", message: "Pasted notes carry no attendance record; use the CSV or JSON format for appointments." });
  if (issues.length) return { issues };

  const names = (h("patient") ?? "").split(/\s+/).filter(Boolean);
  const first = names.length ? names[0] : "Anonymised";
  const last = names.length > 1 ? names.slice(1).join(" ") : names.length === 1 ? "(surname not given)" : "Patient";
  const consentRaw = h("consent");
  const consent = consentRaw ? parseYesNo(consentRaw) : false;
  const consentDateMatch = consentRaw ? /(\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{4}-\d{2}-\d{2})/.exec(consentRaw) : null;
  if (consentRaw && consent === null) ctx.warnings.push({ where: hWhere("consent"), message: 'Consent should start with "yes" or "no"; it was recorded as not given.' });
  const incidentDate = h("incidentDate") ? toIsoDate(h("incidentDate")) : null;
  if (h("incidentDate") && !incidentDate) ctx.warnings.push({ where: hWhere("incidentDate"), message: "The incident date is not a valid date and was ignored." });
  const statusRaw = (h("status") ?? "").toLowerCase();
  const sexRaw = (h("sex") ?? "").toLowerCase();

  const doc: ImportDocument = {
    patient: {
      id: "pasted-patient",
      first_name: first,
      last_name: last,
      date_of_birth: dob as string,
      sex: sexRaw === "female" || sexRaw === "f" ? "female" : sexRaw === "male" || sexRaw === "m" ? "male" : sexRaw === "other" ? "other" : "not_recorded",
      occupation: h("occupation"),
    },
    episode: {
      id: "pasted-episode",
      title: h("title"),
      status: statusRaw === "open" || statusRaw === "discharged" ? statusRaw : notes.some((n) => n.note_type === "discharge") ? "discharged" : "open",
      referral: {
        source_type: partyType as NonNullable<typeof partyType>,
        organisation_name: partyName as string,
        reference: h("reference"),
      },
      incident:
        incidentDate || h("incident") || h("incidentType")
          ? { date: incidentDate, mechanism: h("incident") ?? "", incident_type: normaliseIncidentType(h("incidentType") ?? h("incident") ?? "") }
          : null,
      consent: { disclosure_consent_recorded: consent === true, recorded_on: consentDateMatch ? toIsoDate(consentDateMatch[1]) : null },
      primary_clinician: defaultClinician ? { ...defaultClinician, role: null } : null,
    },
    notes,
    appointments: [],
    outcome_measures: Array.from(scores.entries()).map(([instrument, points]) => ({ instrument, scores: points })),
  };
  return { doc };
}

/** "NDI 42%, NPRS 7/10, QuickDASH 52" → scores (first mention of each instrument, in text order). */
export function extractScores(text: string): Array<{ instrument: Instrument; value: number }> {
  const out: Array<{ instrument: Instrument; value: number; at: number }> = [];
  const patterns: Array<[Instrument, RegExp]> = [
    ["NDI", /\bNDI\s*(?:score)?\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)\s*%?/i],
    ["ODI", /\bODI\s*(?:score)?\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)\s*%?/i],
    ["NPRS", /\b(?:NPRS|NRS)\s*(?:score)?\s*[:=]?\s*(\d{1,2}(?:\.\d+)?)\s*(?:\/\s*10)?/i],
    ["PSFS", /\bPSFS\s*(?:score)?\s*[:=]?\s*(\d{1,2}(?:\.\d+)?)/i],
    ["QuickDASH", /\bQuick\s*-?DASH\s*(?:score)?\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)/i],
  ];
  for (const [instrument, re] of patterns) {
    const match = re.exec(text);
    if (match) out.push({ instrument, value: Number(match[1]), at: match.index });
  }
  return out.sort((a, b) => a.at - b.at).map(({ instrument, value }) => ({ instrument, value }));
}

/* ------------------------------------------------------------------------------------------------
 * ImportDocument → wire data → mapper → EpisodeBundle
 * ----------------------------------------------------------------------------------------------*/

/**
 * An ImportDocument built in code (wave 3: a reviewed general-notes upload, ./review-bundle.ts) → the bundle,
 * exactly as an uploaded export would be mapped. `patch` adds what the import format has no field for (the
 * insurer's identifiers, a medico-legal company as the instructing party) before the bundle is validated.
 */
export function bundleFromImportDocument(
  doc: ImportDocument,
  opts: { tenantId: TenantId; now?: Date; label: string; patch?: (bundle: EpisodeBundle) => EpisodeBundle },
): ImportResult {
  const ctx: BuildContext = { tenantId: opts.tenantId, now: opts.now ?? new Date(), label: opts.label, warnings: [] };
  const result = documentToBundle(doc, ctx, opts.patch);
  if ("issues" in result) return fail(result.issues);
  const bundle = result.bundle;
  return {
    ok: true,
    bundle,
    warnings: ctx.warnings.slice(0, MAX_ISSUES),
    stats: {
      notes: bundle.notes.length,
      appointments: bundle.appointments.length,
      outcomeSeries: bundle.outcomeMeasures.length,
      clinicians: bundle.clinicians.length,
    },
  };
}

function documentToBundle(
  doc: ImportDocument,
  ctx: BuildContext,
  patch?: (bundle: EpisodeBundle) => EpisodeBundle,
): { bundle: EpisodeBundle } | { issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const date = (value: string | null | undefined, where: string): string | null => {
    if (!value) return null;
    const iso = toIsoDate(value);
    if (!iso) issues.push({ where, message: `"${value}" is not a valid date.` });
    return iso;
  };

  const patientId = blankToNull(doc.patient.id) ?? "imported-patient";
  const episodeId = blankToNull(doc.episode.id) ?? "imported-episode";
  const dob = date(doc.patient.date_of_birth, "patient.date_of_birth");

  // Notes (IDs filled in, duplicates rejected).
  const noteIds = new Set<string>();
  const notes: SimNote[] = doc.notes.map((n, i) => {
    const id = blankToNull(n.id) ?? `imp-note-${i + 1}`;
    if (noteIds.has(id)) issues.push({ where: `notes[${i}].id`, message: `Note ID "${id}" is used twice.` });
    noteIds.add(id);
    return {
      id,
      episode_id: episodeId,
      note_date: date(n.note_date, `notes[${i}].note_date`) ?? n.note_date,
      note_time: n.note_time ?? null,
      note_type: n.note_type,
      author: clinician(n.author),
      subjective: n.subjective,
      objective: n.objective,
      assessment: n.assessment,
      plan: n.plan,
      free_text: n.free_text ?? null,
      past_medical_history: n.past_medical_history ?? null,
      social_history: n.social_history ?? null,
      appointment_id: blankToNull(n.appointment_id),
      _simulated: true, // wire-type marker only; the bundle's source says simulated: false
    };
  });
  const sortedNotes = notes.slice().sort((a, b) => (a.note_date + (a.note_time ?? "")).localeCompare(b.note_date + (b.note_time ?? "")));
  const primary: SimClinician | null = doc.episode.primary_clinician
    ? clinician(doc.episode.primary_clinician)
    : sortedNotes.length
      ? sortedNotes[0].author
      : null;
  if (!primary) issues.push({ where: "notes", message: "The export has no clinical notes." });

  const apptIds = new Set<string>();
  const appointments: SimAppointment[] = doc.appointments.map((a, i) => {
    const id = blankToNull(a.id) ?? `imp-appt-${i + 1}`;
    if (apptIds.has(id)) issues.push({ where: `appointments[${i}].id`, message: `Appointment ID "${id}" is used twice.` });
    apptIds.add(id);
    let noteId = blankToNull(a.note_id);
    if (noteId && !noteIds.has(noteId)) {
      ctx.warnings.push({ where: `appointments[${i}].note_id`, message: `Note "${noteId}" does not exist; the link was ignored.` });
      noteId = null;
    }
    return {
      id,
      episode_id: episodeId,
      date: date(a.date, `appointments[${i}].date`) ?? a.date,
      start_time: a.start_time,
      duration_minutes: a.duration_minutes ?? 30,
      status: a.status,
      status_reason: blankToNull(a.status_reason),
      clinician: a.clinician ? clinician(a.clinician) : (primary ?? { name: "Not recorded", hcpc: "Not recorded", role: null }),
      note_id: noteId,
      _simulated: true,
    };
  });

  const outcomeMeasures: SimOutcomeMeasure[] = doc.outcome_measures.map((m, i) => {
    const defaults = INSTRUMENT_DEFAULTS[m.instrument];
    return {
      id: blankToNull(m.id) ?? `imp-om-${i + 1}`,
      episode_id: episodeId,
      instrument: m.instrument,
      unit: blankToNull(m.unit) ?? defaults.unit,
      higher_is_worse: m.higher_is_worse ?? defaults.higherIsWorse,
      scores: m.scores.map((s, j) => {
        let noteId = blankToNull(s.note_id);
        if (noteId && !noteIds.has(noteId)) {
          ctx.warnings.push({ where: `outcome_measures[${i}].scores[${j}].note_id`, message: `Note "${noteId}" does not exist; the link was ignored.` });
          noteId = null;
        }
        return { date: date(s.date, `outcome_measures[${i}].scores[${j}].date`) ?? s.date, value: s.value, note_id: noteId };
      }),
      _simulated: true,
    };
  });

  const allDates = sortedNotes.map((n) => n.note_date).concat(appointments.map((a) => a.date)).sort();
  const discharge = sortedNotes.filter((n) => n.note_type === "discharge").pop();
  const startDate = date(doc.episode.start_date, "episode.start_date") ?? allDates[0] ?? ctx.now.toISOString().slice(0, 10);
  const endDate =
    date(doc.episode.end_date, "episode.end_date") ?? (doc.episode.status === "discharged" ? (discharge?.note_date ?? null) : null);
  const referralDate = date(doc.episode.referral.referral_date, "episode.referral.referral_date");
  const incidentDate = doc.episode.incident ? date(doc.episode.incident.date, "episode.incident.date") : null;
  const consentDate = date(doc.episode.consent.recorded_on, "episode.consent.recorded_on");
  if (issues.length || !primary || !dob) return { issues: issues.length ? issues : [{ where: "file", message: "The export is incomplete." }] };

  const address = doc.patient.address;
  const patient: SimPatient = {
    id: patientId,
    title: blankToNull(doc.patient.title),
    first_name: doc.patient.first_name.trim(),
    last_name: doc.patient.last_name.trim(),
    date_of_birth: dob,
    sex: doc.patient.sex ?? "not_recorded",
    address:
      typeof address === "string"
        ? { line1: address, line2: null, town: "", postcode: "" }
        : address
          ? { line1: address.line1, line2: address.line2 ?? null, town: address.town ?? "", postcode: address.postcode ?? "" }
          : { line1: "", line2: null, town: "", postcode: "" },
    phone: blankToNull(doc.patient.phone),
    email: blankToNull(doc.patient.email),
    occupation: blankToNull(doc.patient.occupation),
    employer_name: blankToNull(doc.patient.employer_name),
    registered_at: ctx.now.toISOString(),
    episode_count: 1,
    _simulated: true,
  };
  const r = doc.episode.referral;
  const episode: SimEpisode = {
    id: episodeId,
    patient_id: patientId,
    title: blankToNull(doc.episode.title) ?? "Imported episode",
    status: doc.episode.status,
    start_date: startDate,
    end_date: endDate,
    referral: {
      source_type: r.source_type,
      organisation_name: r.organisation_name.trim(),
      reference: blankToNull(r.reference),
      contact_name: blankToNull(r.contact_name),
      address: blankToNull(r.address),
      referral_date: referralDate,
      reason: blankToNull(r.reason),
    },
    incident: doc.episode.incident
      ? { date: incidentDate, mechanism: doc.episode.incident.mechanism, incident_type: doc.episode.incident.incident_type }
      : null,
    consent: { disclosure_consent_recorded: doc.episode.consent.disclosure_consent_recorded, recorded_on: consentDate },
    primary_clinician: primary,
    _simulated: true,
  };

  const data: SimEpisodeData = { patient, episode, notes, appointments, outcomeMeasures };
  let mapped: EpisodeBundle;
  try {
    mapped = mapSimEpisodeToBundle(data, { tenantId: ctx.tenantId, fetchedAt: ctx.now.toISOString() });
  } catch (err) {
    if (err instanceof ConnectorError) {
      return { issues: [{ where: err.code === "UNSUPPORTED" ? "episode.referral.source_type" : "file", message: err.message }] };
    }
    throw err;
  }
  return finishBundle(patch ? patch(mapped) : mapped, ctx, { patientId, episodeId });
}

function clinician(c: { name: string; hcpc: string; role?: string | null }): SimClinician {
  return { name: c.name.trim(), hcpc: c.hcpc.trim(), role: blankToNull(c.role) };
}

/** Stamp the file-import provenance, then validate against the contract. */
function finishBundle(
  bundle: EpisodeBundle,
  ctx: BuildContext,
  ids: { patientId: string; episodeId: string } | null,
): { bundle: EpisodeBundle } | { issues: ImportIssue[] } {
  const stamped: EpisodeBundle = {
    ...bundle,
    tenantId: ctx.tenantId,
    source: {
      connectorId: "file-import",
      simulated: false,
      fetchedAt: ctx.now.toISOString(),
      externalPatientId: ids?.patientId ?? bundle.source.externalPatientId,
      externalEpisodeId: ids?.episodeId ?? bundle.source.externalEpisodeId,
      label: ctx.label,
    },
  };
  const parsed = EpisodeBundleSchema.safeParse(stamped);
  if (!parsed.success) return { issues: zodToIssues(parsed.error.issues, "bundle.") };
  return { bundle: parsed.data };
}
