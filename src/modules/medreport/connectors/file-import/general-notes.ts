import "server-only";

/**
 * The general notes reader (production wave 3): ordinary clinic notes → a NotesReview (./review-contract.ts)
 * that staff check before the patient record is built.
 *
 * Input is a sequence of blocks in document order: lines of text (a PDF's text layer, a Word document's
 * paragraphs, a text file or pasted text) and tables (a CSV export, a Word table). The reader:
 *
 *  - splits the lines into entries at every line that STARTS with a date – 18/03/2026, 8/3/26, 18 March 2026,
 *    Mar 18 2026, 2026-03-18 – optionally after "Date:", "Appointment:", a weekday, a bullet or markdown, and
 *    optionally followed by a time ("09:00", "9.30am"). The heading's own text gives the type
 *    ("Initial assessment", "Follow-up", "Discharge", "Telephone call"), the clinician ("Sarah Reid
 *    (PH-DEMO-01)", "Practitioner: …") and an attendance status ("Attended", "DNA"); "Key: value" lines right
 *    under the heading (Time:, Practitioner:, Type:, Status:, HCPC:) belong to it;
 *  - reads a table whose header row has a date column (Date / Appointment date …) and a note or clinician
 *    column (Notes, Clinician, Practitioner, Subjective…Plan, Treatment, Appointment type, Status) as one entry
 *    per row; other tables become "label: value" lines;
 *  - takes a clinician from the heading first, else from a signature line at the end of the note
 *    ("Signed: …", "Seen by …", "— Name (HCPC)", "Kind regards" + name);
 *  - keeps each note's text exactly as written (only blank lines around it and a bare "Notes:" label are
 *    dropped); labelled S/O/A/P sections are split later, on confirm (./review-bundle.ts);
 *  - reads registration details from the "Label: value" lines before the first note (several per line are
 *    fine): name, title, date of birth, sex, address, postcode, phone, email, occupation, employer, insurer,
 *    membership / policy number, authorisation number, instructing party, reference, referred by, GP practice,
 *    date of accident, consent. Values are checked against conservative patterns; anything that does not
 *    clearly match is left EMPTY (with a warning where useful) – never guessed. A date of birth written with a
 *    two-digit year is never completed;
 *  - finds outcome scores written like "NPRS 7/10", "QuickDASH 52.3", "PSFS 2.7", "ODI 48%", "NDI 42%" (with the
 *    entry's date, or a date written right after the score); one instrument written with two different values
 *    and no dates in one note (e.g. "NPRS from 7/10 to 3/10") is left out with a warning, as are ranges.
 *
 * Pure apart from `now` (two-digit note years and future dates). Never logs content.
 *
 * Owner: integration agent.
 */
import { isValidIsoDate } from "../../core/dates";
import type { AppointmentStatus, InstructingPartyType, NoteType, OutcomeInstrument } from "../../core/types";
import { parseCsvRecords } from "./parser";
import {
  EMPTY_REVIEW_REGISTRATION,
  NOTES_REVIEW_COPY,
  NOTES_REVIEW_LIMITS,
  NOTES_REVIEW_VERSION,
  type NotesReview,
  type NotesReviewEntry,
  type NotesReviewField,
  type NotesReviewOutcome,
  type NotesReviewRegistration,
  type NotesReviewWarning,
  type NotesReviewWarningCode,
} from "./review-contract";

/* ------------------------------------------------------------------------------------------------
 * Input
 * ----------------------------------------------------------------------------------------------*/

export type NotesBlock =
  | { kind: "line"; text: string; where: string }
  | { kind: "table"; rows: string[][]; where: string };

export interface GeneralNotesInput {
  format: NotesReview["format"];
  blocks: NotesBlock[];
  fileName?: string;
  pages?: number;
  now: Date;
}

export type GeneralNotesResult = { ok: true; review: NotesReview } | { ok: false; message: string };

/** Lines of plain text as blocks ("line N"). */
export function textToBlocks(text: string, firstLine = 1): NotesBlock[] {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line, i) => ({ kind: "line" as const, text: line.replace(/\s+$/, ""), where: `line ${i + firstLine}` }));
}

/** A CSV file as blocks: lines above the table's header row stay lines; the rest is one table ("row N"). */
export function csvToBlocks(content: string): NotesBlock[] {
  const records = parseCsvRecords(content.replace(/^\uFEFF/, ""));
  const rows = records.map((r) => r.cells.map((c) => c.trim()));
  const headerIdx = rows.findIndex((cells, i) => i < 25 && isEntryHeader(cells));
  if (headerIdx < 0) return [{ kind: "table", rows, where: "row 1" }];
  const blocks: NotesBlock[] = rows.slice(0, headerIdx).map((cells, i) => ({
    kind: "line" as const,
    text: cells.filter(Boolean).length === 2 && cells[0] && !/:\s*$/.test(cells[0]) ? `${cells[0]}: ${cells.filter(Boolean)[1]}` : cells.filter(Boolean).join(" "),
    where: `row ${records[i].line}`,
  }));
  blocks.push({ kind: "table", rows: rows.slice(headerIdx), where: `row ${records[headerIdx].line}` });
  return blocks;
}

/* ------------------------------------------------------------------------------------------------
 * Dates and times
 * ----------------------------------------------------------------------------------------------*/

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
};
const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
/** One date in any of the accepted spellings (no capture groups). */
export const DATE_PATTERN = [
  "\\d{4}-\\d{1,2}-\\d{1,2}",
  "\\d{1,2}[/.\\-]\\d{1,2}[/.\\-](?:\\d{4}|\\d{2})",
  `\\d{1,2}(?:st|nd|rd|th)?(?:\\s+of)?[\\s\\-]+${MONTH}\\.?,?[\\s\\-]+(?:\\d{4}|\\d{2})`,
  `${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}`,
].join("|");
const WEEKDAY = "(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\\.?,?";
const TIME_PATTERN = "\\d{1,2}[:.]\\d{2}(?:\\s*(?:am|pm|a\\.m\\.|p\\.m\\.))?|\\d{1,2}\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)";

export interface ParsedDate {
  iso: string;
  /** Written with a two-digit year (completed as 20YY for notes; never completed for a date of birth). */
  twoDigitYear: boolean;
}

/** One date token → ISO (DD/MM order for numeric dates, as UK clinic systems print them), else null. */
export function parseDateToken(input: string, now?: Date): ParsedDate | null {
  const s = input.trim().replace(/\s+/g, " ");
  let y: number;
  let m: number;
  let d: number;
  let yearText: string;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) {
    yearText = match[1];
    m = Number(match[2]);
    d = Number(match[3]);
  } else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(s))) {
    d = Number(match[1]);
    m = Number(match[2]);
    yearText = match[3];
  } else if ((match = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?(?: of)?[ -]+(${MONTH})\\.?,?[ -]+(\\d{4}|\\d{2})$`, "i").exec(s))) {
    d = Number(match[1]);
    m = MONTHS[match[2].toLowerCase()] ?? 0;
    yearText = match[3];
  } else if ((match = new RegExp(`^(${MONTH})\\.? (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})$`, "i").exec(s))) {
    m = MONTHS[match[1].toLowerCase()] ?? 0;
    d = Number(match[2]);
    yearText = match[3];
  } else {
    return null;
  }
  const twoDigitYear = yearText.length === 2;
  y = twoDigitYear ? 2000 + Number(yearText) : Number(yearText);
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (!isValidIsoDate(iso)) return null;
  if (twoDigitYear && now) {
    // A two-digit note year more than a year ahead is not a note date.
    const limit = new Date(now.getTime() + 366 * 86_400_000).toISOString().slice(0, 10);
    if (iso > limit) return null;
  }
  return { iso, twoDigitYear };
}

/** "09:00", "9.30", "9:30am", "2pm" → "HH:mm", else null. */
export function parseTimeToken(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/\./g, (c, i: number, all: string) => (/\d/.test(all[i - 1] ?? "") && /\d/.test(all[i + 1] ?? "") ? ":" : ""));
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!match || (match[2] === undefined && !match[3])) return null;
  let h = Number(match[1]);
  const min = Number(match[2] ?? "0");
  if (match[3]) {
    if (h < 1 || h > 12) return null;
    if (match[3] === "pm" && h !== 12) h += 12;
    if (match[3] === "am" && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------------------------------------
 * Headings
 * ----------------------------------------------------------------------------------------------*/

const HEADING_PREFIX =
  "(?:date|appointment(?:\\s+date)?|session(?:\\s+date)?|consultation(?:\\s+date)?|visit(?:\\s+date)?|entry(?:\\s+date)?|note(?:\\s+date)?|treatment(?:\\s+date)?|date\\s+seen|seen(?:\\s+on)?|attended(?:\\s+on)?|dated)";
const HEADING_RE = new RegExp(
  `^\\s*(?:[#>*•·\\-–—]+\\s*|\\d{1,3}[.)]\\s+)?(?:\\*\\*|__)?\\s*(?:${HEADING_PREFIX}\\s*[:\\-–—]?\\s*)?(?:${WEEKDAY}\\s+)?(${DATE_PATTERN})(?![\\d/])(?:\\s*(?:,|at|@|from|-|–|—)?\\s*(${TIME_PATTERN})(?:\\s*(?:-|–|—|to)\\s*(?:${TIME_PATTERN}))?(?![\\d:]))?(.*)$`,
  "i",
);

export interface Heading {
  date: ParsedDate;
  time: string | null;
  rest: string;
}

export function matchHeading(line: string, now?: Date): Heading | null {
  const m = HEADING_RE.exec(line);
  if (!m) return null;
  const date = parseDateToken(m[1].replace(/\s+/g, " "), now);
  if (!date) return null;
  // "18/03/2026 – 7/10" style ratios are not headings; neither is a date directly followed by letters.
  const rest = (m[3] ?? "").replace(/^\s*(?:\*\*|__)\s*/, "");
  if (/^[A-Za-z]/.test(rest)) return null;
  return { date, time: m[2] ? parseTimeToken(m[2]) : null, rest: rest.replace(/\*\*|__/g, "").trim() };
}

/* ------------------------------------------------------------------------------------------------
 * Clinicians
 * ----------------------------------------------------------------------------------------------*/

const NAME_WORD = "[A-Z][A-Za-z'’]*[a-z](?:-[A-Z][A-Za-z'’]*[a-z])?";
const NAME_INITIAL = "[A-Z]\\.?";
const NAME_TITLE = "(?:Dr|Mr|Mrs|Ms|Miss|Mx|Prof)\\.?";
const NAME = `(?:${NAME_TITLE}\\s+)?(?:${NAME_INITIAL}\\s+){0,2}${NAME_WORD}(?:\\s+(?:${NAME_INITIAL}\\s+)?${NAME_WORD}){0,3}`;
const HCPC_ID = "PH-DEMO-\\d{2}|[A-Z]{2}[\\s-]?\\d{4,6}";
const HCPC_LABEL = "(?:HCPC|HCPC\\s+(?:no\\.?|number|reg(?:istration)?\\.?(?:\\s+no\\.?)?))\\s*[:#]?\\s*";

/** Words that make a capitalised phrase clinical text rather than a person's name. */
const NOT_NAME_WORDS = new Set(
  (
    "right left bilateral neck back knee hip shoulder ankle foot wrist elbow hand lumbar cervical thoracic spine spinal pain review session treatment " +
    "assessment initial follow up discharge summary note notes call telephone phone video virtual letter report exercise exercises programme " +
    "physio physiotherapy clinic appointment sports massage acupuncture hydrotherapy class gym home visit new patient progress plan objective " +
    "subjective outcome outcomes measures dna attended cancelled cancellation status type practitioner clinician therapist physiotherapist " +
    "date time details record records history medical social referral insurer insurance policy membership authorisation total sessions " +
    "manual therapy rehab rehabilitation whiplash injury accident road traffic work workplace fall the and of with for to on in at by no yes"
  ).split(/\s+/),
);

export interface ClinicianRef {
  name: string;
  hcpc: string;
}

function isNameLike(name: string): boolean {
  if (!new RegExp(`^${NAME}$`).test(name)) return false;
  const tokens = name.replace(new RegExp(`^${NAME_TITLE}\\s+`), "").split(/\s+/);
  const titled = new RegExp(`^${NAME_TITLE}\\s+`).test(name);
  if (tokens.length < 2 && !titled) return false;
  return !tokens.some((t) => NOT_NAME_WORDS.has(t.replace(/\.$/, "").toLowerCase()));
}

function cleanHcpc(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * A clinician written as "Name (HCPC)", "Name, Physiotherapist, HCPC PH12345", "Name – HCPC: …" or (when
 * `allowBare`) just a name, optionally followed by a job title. Null when the text is not clearly a name.
 */
export function parseClinicianText(input: string, allowBare: boolean): ClinicianRef | null {
  const s = input.replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim().replace(/[.;,]$/, "");
  if (!s || s.length > 160) return null;
  let m = new RegExp(`^(${NAME})\\s*\\(\\s*(?:${HCPC_LABEL})?(${HCPC_ID})\\s*\\)`).exec(s);
  if (m && isNameLike(m[1])) return { name: m[1], hcpc: cleanHcpc(m[2]) };
  m = new RegExp(`^(${NAME})\\s*(?:[,–—-]\\s*[^,()]{0,60}?)?[,–—-]?\\s*\\(?${HCPC_LABEL}(${HCPC_ID})\\)?\\s*$`).exec(s);
  if (m && isNameLike(m[1])) return { name: m[1], hcpc: cleanHcpc(m[2]) };
  if (!allowBare) return null;
  m = new RegExp(`^(${NAME})(?:\\s*(?:,|–|—|-)\\s*[A-Za-z][A-Za-z ()/&]{0,60})?$`).exec(s);
  if (m && isNameLike(m[1])) return { name: m[1], hcpc: "" };
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * Note types and attendance
 * ----------------------------------------------------------------------------------------------*/

const TYPE_SEGMENT =
  /^(?:(?:new|initial|first)\s+(?:patient\s+)?(?:assessment|appointment|consultation|visit|session)|ia|np|new\s+patient|follow[\s-]?up(?:\s+(?:appointment|session|treatment|review|visit|consultation))?|f\/?u|review|re-?assessment|treatment(?:\s+session)?|discharge(?:\s+(?:summary|note|session|appointment|review))?|final\s+(?:review|session|appointment)|telephone(?:\s+(?:call|consultation|review|appointment|follow[\s-]?up))?|phone\s+call|video(?:\s+(?:call|consultation|appointment))?|virtual\s+(?:consultation|appointment|session)|(?:clinical\s+)?notes?|session(?:\s*\d+)?|physio(?:therapy)?(?:\s+(?:session|appointment|treatment))?)$/i;

export function noteTypeFrom(text: string): NoteType | null {
  const s = text.toLowerCase();
  if (/\bdischarg|\bfinal (?:review|session|appointment)\b/.test(s)) return "discharge";
  if (/\b(?:initial|first) (?:patient )?(?:assessment|appointment|consultation|visit|session)\b|\bnew patient\b|^ia\b|^np\b/.test(s)) return "initial_assessment";
  if (/\btelephone\b|\bphone call\b|\bphone\b/.test(s)) return "telephone";
  if (/\bfollow[\s-]?up\b|^f\/?u\b|\breview\b|\bre-?assessment\b|\btreatment\b|\bsession\b/.test(s)) return "follow_up";
  return null;
}

export function statusFrom(text: string): AppointmentStatus | null {
  const s = text.trim().toLowerCase().replace(/[.!]$/, "");
  if (/^(?:attended|arrived|completed|seen|att|checked in)$/.test(s)) return "ATT";
  if (/^(?:dna|d\.n\.a|did not attend|did not arrive|no[\s-]?show|failed to attend|fta)$/.test(s)) return "DNA";
  if (/^(?:late cancel(?:l?ation|l?ed)?|lcn|cancelled late|cancelled within 24 ?h(?:ours?)?|late cancelled)$/.test(s)) return "LCN";
  if (/^(?:cancel(?:l?ed)?|cancelled by (?:the )?(?:patient|clinic)|cnc|cancelled with notice)$/.test(s)) return "CNC";
  if (/^(?:booked|scheduled|future|bkd)$/.test(s)) return "BOOKED";
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * "Label: value" lines
 * ----------------------------------------------------------------------------------------------*/

interface LabelHit {
  key: string;
  label: string;
  value: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A splitter for lines holding one or more "Label: value" pairs with the given labels (longest first). */
function labelSplitter(table: ReadonlyArray<readonly [string, readonly string[]]>): (line: string) => LabelHit[] {
  const byLabel = new Map<string, string>();
  table.forEach(([key, labels]) => labels.forEach((l) => byLabel.set(l.toLowerCase(), key)));
  const alts = Array.from(byLabel.keys())
    .sort((a, b) => b.length - a.length)
    .map((l) => escapeRe(l).replace(/\\ /g, "\\s+").replace(/ /g, "\\s+"));
  const re = new RegExp(`(^|[\\s|;,•])(${alts.join("|")})\\s*[:：]\\s*`, "gi");
  return (line: string) => {
    const hits: Array<{ key: string; label: string; start: number; end: number }> = [];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const label = m[2].toLowerCase().replace(/\s+/g, " ");
      const key = byLabel.get(label);
      if (key) hits.push({ key, label, start: m.index + m[1].length, end: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex += 1;
    }
    // Only lines that START with a label are "Label: value" lines (text that merely contains "x: y" is not).
    if (!hits.length || line.slice(0, hits[0].start).replace(/^[\s*#>•·\-–—|]+/, "").trim() !== "") return [];
    return hits.map((h, i) => ({
      key: h.key,
      label: h.label,
      value: line
        .slice(h.end, i + 1 < hits.length ? hits[i + 1].start : line.length)
        .replace(/\*\*|__/g, "")
        .replace(/[\s|;,•]+$/, "")
        .trim(),
    }));
  };
}

/** "Key: value" lines right under a heading. */
const DETAIL_LABELS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["clinician", ["practitioner", "clinician", "therapist", "physiotherapist", "physio", "seen by", "author", "written by", "entered by", "treating clinician", "staff member", "consultant"]],
  ["hcpc", ["hcpc", "hcpc no", "hcpc no.", "hcpc number", "hcpc reg", "hcpc registration", "registration number", "registration no", "registration no."]],
  ["time", ["time", "start time", "appointment time"]],
  ["type", ["type", "appointment type", "session type", "visit type", "consultation type", "note type", "service", "treatment type"]],
  ["status", ["status", "attendance", "appointment status"]],
  ["other", ["duration", "length", "end time", "finish", "location", "site", "room", "venue", "booked by", "fee", "charge", "price", "invoice", "invoice number", "payment", "paid"]],
];
const splitDetail = labelSplitter(DETAIL_LABELS);

/** Registration labels (before the first note). "ignore" labels are known non-registration lines. */
const REG_LABELS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["name", ["patient name", "patient's name", "name of patient", "full name", "client name", "patient", "client", "name", "re"]],
  ["firstName", ["first name", "first names", "forename", "forenames", "forename(s)", "given name", "given names"]],
  ["lastName", ["last name", "surname", "family name"]],
  ["title", ["title"]],
  ["dob", ["date of birth", "d.o.b.", "d.o.b", "dob", "birth date", "born"]],
  ["sex", ["sex", "gender"]],
  ["address", ["home address", "patient address", "address"]],
  ["postcode", ["post code", "postcode"]],
  ["phone", ["mobile phone", "mobile number", "mobile", "home phone", "telephone number", "telephone", "phone number", "phone", "tel", "tel.", "contact number"]],
  ["email", ["email address", "e-mail address", "email", "e-mail"]],
  ["occupation", ["occupation", "job title", "job"]],
  ["employer", ["employer", "employer name"]],
  ["insurer", ["insurance company", "insurance provider", "health insurer", "medical insurer", "insurer name", "insurer", "insured with", "pmi provider", "insurance"]],
  ["membership", ["membership number", "membership no.", "membership no", "member number", "member no.", "member no", "policy number", "policy no.", "policy no", "scheme number", "membership"]],
  ["authorisation", ["pre-authorisation number", "pre-authorisation code", "preauthorisation number", "authorisation number", "authorization number", "authorisation code", "authorization code", "authorisation no.", "authorisation no", "auth number", "auth no.", "auth no", "auth code", "pre-authorisation", "authorisation", "authorization"]],
  ["reference", ["claim reference", "claim number", "claim no.", "claim no", "case reference", "case ref", "your reference", "your ref", "instructing reference", "reference", "ref"]],
  ["party:solicitor", ["instructing solicitor", "instructing solicitors", "solicitors", "solicitor"]],
  ["party:case_manager", ["case manager", "case management company"]],
  ["party:mlc", ["medico-legal company", "medico-legal agency", "instructing agency"]],
  ["party", ["instructing party", "instructed by"]],
  ["referredBy", ["referred by", "referral from", "referral source", "source of referral", "referring clinician", "referring doctor", "referring consultant", "referrer"]],
  ["gp", ["gp practice", "gp surgery", "registered gp", "gp name", "general practitioner", "gp"]],
  ["incidentDate", ["date of accident", "date of incident", "date of injury", "accident date", "incident date", "injury date"]],
  ["mechanism", ["mechanism of injury", "mechanism", "how the injury happened"]],
  ["consent", ["consent to disclose", "consent to share", "disclosure consent", "consent"]],
  [
    "ignore",
    [
      "our ref", "our reference", "patient id", "patient no", "patient no.", "patient number", "nhs number", "nhs no", "nhs no.", "hospital number",
      "clinic ref", "account number", "account no", "invoice", "date printed", "printed", "printed by", "printed on", "page", "from", "sent", "to",
      "subject", "cc", "age", "date of report", "report date", "episode", "condition", "diagnosis", "clinic", "location",
    ],
  ],
];
const splitRegistration = labelSplitter(REG_LABELS);

/* ------------------------------------------------------------------------------------------------
 * Warnings
 * ----------------------------------------------------------------------------------------------*/

class Warnings {
  readonly list: NotesReviewWarning[] = [];
  add(code: NotesReviewWarningCode, message: string, entryKeys?: string[]): void {
    if (this.list.length >= NOTES_REVIEW_LIMITS.warnings) return;
    if (this.list.some((w) => w.code === code && w.message === message)) return;
    this.list.push(entryKeys && entryKeys.length ? { code, message, entryKeys } : { code, message });
  }
}

/* ------------------------------------------------------------------------------------------------
 * Tables of entries (CSV exports, Word tables)
 * ----------------------------------------------------------------------------------------------*/

type Column =
  | "date"
  | "time"
  | "clinician"
  | "hcpc"
  | "note"
  | "subjective"
  | "objective"
  | "assessment"
  | "plan"
  | "treatment"
  | "type"
  | "status"
  | "reason"
  | "patient"
  | "dob"
  | "insurer"
  | "membership"
  | "authorisation"
  | "reference"
  | `score:${OutcomeInstrument}`;

const COLUMN_PATTERNS: Array<[Column, RegExp]> = [
  ["date", /^(?:(?:appointment|session|visit|consultation|treatment|note|entry|clinic)\s+)?date(?:\s+of\s+(?:appointment|session|visit|consultation))?$|^date\s+seen$|^seen\s+on$|^when$/],
  ["time", /^(?:(?:appointment|start|session)\s+)?time$|^start$/],
  ["clinician", /^(?:clinician|practitioner|therapist|physiotherapist|physio|seen\s+by|author|staff(?:\s+member)?|treating\s+clinician|written\s+by)(?:\s+name)?$/],
  ["hcpc", /^(?:hcpc|hcpc\s+(?:no|number|reg|registration)|registration(?:\s+(?:no|number))?|reg\s+no)$/],
  ["note", /^(?:notes?|clinical\s+notes?|treatment\s+notes?|consultation\s+notes?|session\s+notes?|entry|details|comments?|narrative|text|record|summary)$/],
  ["subjective", /^(?:s|subjective)$/],
  ["objective", /^(?:o|objective)$/],
  ["assessment", /^(?:a|assessment|analysis|impression)$/],
  ["plan", /^(?:p|plan)$/],
  ["treatment", /^(?:treatment|treatment\s+given|intervention|interventions)$/],
  ["type", /^(?:type|appointment\s+type|session\s+type|visit\s+type|consultation\s+type|note\s+type|service)$/],
  ["status", /^(?:status|attendance|appointment\s+status)$/],
  ["reason", /^(?:reason|cancellation\s+reason|dna\s+reason|status\s+reason)$/],
  ["patient", /^(?:patient|patient\s+name|client|client\s+name|name)$/],
  ["dob", /^(?:dob|d\s*o\s*b|date\s+of\s+birth)$/],
  ["insurer", /^(?:insurer|insurance|insurance\s+company)$/],
  ["membership", /^(?:membership(?:\s+(?:no|number))?|policy(?:\s+(?:no|number))?)$/],
  ["authorisation", /^(?:auth(?:orisation|orization)?(?:\s+(?:no|number|code))?)$/],
  ["reference", /^(?:claim(?:\s+(?:no|number|reference))?|reference|ref)$/],
  ["score:NPRS", /^(?:nprs|nrs)$/],
  ["score:ODI", /^odi(?:\s*%)?$/],
  ["score:NDI", /^ndi(?:\s*%)?$/],
  ["score:PSFS", /^psfs$/],
  ["score:QuickDASH", /^quick\s*-?\s*dash$/],
];

function normaliseHeaderCell(cell: string): string {
  return cell.toLowerCase().replace(/[.#:()*_]/g, " ").replace(/\s+/g, " ").trim();
}

function columnsOf(header: string[]): Array<Column | null> {
  const used = new Set<string>();
  return header.map((h) => {
    const n = normaliseHeaderCell(h);
    const hit = COLUMN_PATTERNS.find(([col, re]) => !used.has(col) && re.test(n));
    if (!hit) return null;
    used.add(hit[0]);
    return hit[0];
  });
}

/** A header row of an entries table: a date column and a note, SOAP or clinician column. */
function isEntryHeader(cells: string[]): boolean {
  const cols = columnsOf(cells);
  return cols.indexOf("date") >= 0 && cols.some((c) => c === "note" || c === "subjective" || c === "clinician" || c === "treatment" || c === "plan");
}

interface RawEntry {
  where: string;
  date: ParsedDate | null;
  time: string | null;
  clinician: ClinicianRef | null;
  hcpc: string;
  type: NoteType | null;
  status: AppointmentStatus | null;
  reason: string;
  headingLines: string[];
  bodyLines: string[];
  fromTable: boolean;
  /** Scores read from a table's score columns. */
  tableScores: Array<{ instrument: OutcomeInstrument; value: number }>;
}

interface TableRead {
  entries: RawEntry[];
  /** The table had a status column. */
  attendance: boolean;
  /** Registration values that were the same on every row. */
  constants: Partial<Record<"patient" | "dob" | "insurer" | "membership" | "authorisation" | "reference", string>>;
}

const SOAP_COLUMN_LABEL: Record<string, string> = {
  subjective: "Subjective",
  objective: "Objective",
  assessment: "Assessment",
  treatment: "Treatment",
  plan: "Plan",
};

function readEntryTable(rows: string[][], firstRowWhere: string, now: Date, warnings: Warnings): TableRead | null {
  if (!rows.length || !isEntryHeader(rows[0])) return null;
  const header = rows[0];
  const cols = columnsOf(header);
  const at = (c: Column) => cols.indexOf(c);
  const cell = (r: string[], c: Column) => (at(c) >= 0 ? (r[at(c)] ?? "").trim() : "");
  const whereParts = /^(.*?)row (\d+)$/.exec(firstRowWhere);
  const wherePrefix = whereParts ? whereParts[1] : "";
  const rowBase = whereParts ? Number(whereParts[2]) : 1;
  const entries: RawEntry[] = [];
  let skipped = 0;
  let statusNoTime = 0;
  const constants: TableRead["constants"] = {};
  const seen: Record<string, Set<string>> = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some((c) => c.trim())) continue;
    const where = `${wherePrefix}row ${rowBase + i}`;
    for (const k of ["patient", "dob", "insurer", "membership", "authorisation", "reference"] as const) {
      const v = cell(r, k);
      if (v) (seen[k] ??= new Set()).add(v);
    }
    const bodyParts: string[] = [];
    const note = at("note") >= 0 ? (r[at("note")] ?? "").replace(/\r\n?/g, "\n").replace(/^\s+|\s+$/g, "") : "";
    if (note) bodyParts.push(note);
    for (const c of ["subjective", "objective", "assessment", "treatment", "plan"] as const) {
      const v = at(c) >= 0 ? (r[at(c)] ?? "").replace(/\r\n?/g, "\n").replace(/^\s+|\s+$/g, "") : "";
      if (v) bodyParts.push(`${SOAP_COLUMN_LABEL[c]}: ${v}`);
    }
    const statusText = cell(r, "status");
    const status = statusText ? statusFrom(statusText) : null;
    if (statusText && !status) warnings.add("VALUE_UNCLEAR", `The status "${statusText.slice(0, 40)}" (${where}) was not recognised and was left out.`);
    const date = parseDateToken(cell(r, "date"), now);
    const tableScores: RawEntry["tableScores"] = [];
    (["NPRS", "ODI", "NDI", "PSFS", "QuickDASH"] as const).forEach((inst) => {
      const raw = cell(r, `score:${inst}`).replace(/%$/, "").replace(/\s*\/\s*(?:10|100)$/, "").trim();
      if (!raw) return;
      const value = Number(raw);
      if (Number.isFinite(value) && withinRange(inst, value)) tableScores.push({ instrument: inst, value });
      else warnings.add("VALUE_UNCLEAR", `The ${inst} score "${cell(r, `score:${inst}`).slice(0, 20)}" (${where}) is not a valid score and was left out.`);
    });
    if (!bodyParts.length && !status) {
      skipped += 1;
      continue;
    }
    const clinicianText = cell(r, "clinician");
    const clinician = clinicianText ? parseClinicianText(clinicianText, true) : null;
    if (clinicianText && !clinician) warnings.add("VALUE_UNCLEAR", `The clinician "${clinicianText.slice(0, 60)}" (${where}) is not written as a name and was left out – choose one.`);
    let time = cell(r, "time") ? parseTimeToken(cell(r, "time")) : null;
    if (!time && at("time") < 0) {
      // A date cell may carry the time ("18/03/2026 09:00").
      const dt = new RegExp(`^(${DATE_PATTERN})\\s+(${TIME_PATTERN})$`, "i").exec(cell(r, "date"));
      if (dt) time = parseTimeToken(dt[2]);
    }
    let rowDate = date;
    if (!rowDate) {
      const dt = new RegExp(`^(${DATE_PATTERN})\\s+(?:${TIME_PATTERN})$`, "i").exec(cell(r, "date"));
      if (dt) rowDate = parseDateToken(dt[1], now);
    }
    let rowStatus = status;
    if (rowStatus && !time) {
      statusNoTime += 1;
      rowStatus = null;
      if (!bodyParts.length) continue;
    }
    const typeText = cell(r, "type");
    entries.push({
      where,
      date: rowDate,
      time,
      clinician: clinician && cell(r, "hcpc") && !clinician.hcpc ? { ...clinician, hcpc: cleanHcpc(cell(r, "hcpc")) } : clinician,
      hcpc: cell(r, "hcpc"),
      type: typeText ? noteTypeFrom(typeText) : null,
      status: rowStatus,
      reason: rowStatus && rowStatus !== "ATT" ? cell(r, "reason").slice(0, 300) : "",
      headingLines: [header.map((h, j) => (r[j] && ["date", "time", "clinician", "hcpc", "type", "status"].indexOf(String(cols[j])) >= 0 ? `${h}: ${r[j]}` : "")).filter(Boolean).join(" · ")],
      bodyLines: bodyParts.join("\n").split("\n"),
      fromTable: true,
      tableScores,
    });
  }
  if (skipped) warnings.add("ROW_SKIPPED", `${skipped} ${skipped === 1 ? "row has" : "rows have"} no note text and no status, and ${skipped === 1 ? "was" : "were"} left out.`);
  if (statusNoTime) {
    warnings.add(
      "PARTIAL_ATTENDANCE",
      `${statusNoTime} ${statusNoTime === 1 ? "row has" : "rows have"} an attendance status but no time, so ${statusNoTime === 1 ? "it is" : "they are"} not counted as ${statusNoTime === 1 ? "an appointment" : "appointments"}.`,
    );
  }
  for (const k of Object.keys(seen) as Array<keyof TableRead["constants"]>) {
    const values = Array.from(seen[k]);
    if (values.length === 1) constants[k] = values[0];
    else warnings.add("NOT_CONSTANT", `The "${header[at(k)] ?? k}" column holds different values on different rows, so it was not used.`);
  }
  return { entries, attendance: at("status") >= 0, constants };
}

/** A table that is not a list of entries: "Label: value" lines (two cells) or cells joined with " | ". */
function tableAsLines(rows: string[][], where: string): Array<{ text: string; where: string }> {
  return rows
    .map((cells) => cells.map((c) => c.replace(/\s+/g, " ").trim()))
    .filter((cells) => cells.some(Boolean))
    .map((cells) => {
      const filled = cells.filter(Boolean);
      const text =
        filled.length === 2 && filled[0].length <= 40 && !/[.!?]$/.test(filled[0])
          ? `${filled[0].replace(/\s*:\s*$/, "")}: ${filled[1]}`
          : filled.join(" | ");
      return { text, where };
    });
}

/* ------------------------------------------------------------------------------------------------
 * Outcome scores
 * ----------------------------------------------------------------------------------------------*/

const INSTRUMENT_LABELS: Array<[OutcomeInstrument, string]> = [
  ["NPRS", "\\b(?:NPRS|NRS|numeric pain rating(?: scale)?)\\b"],
  ["PSFS", "\\bPSFS\\b"],
  ["QuickDASH", "\\b(?:quick\\s?-?dash|q-?dash)\\b"],
  ["ODI", "\\b(?:ODI|oswestry(?: disability index)?)\\b"],
  ["NDI", "\\b(?:NDI|neck disability index)\\b"],
];
const ANY_INSTRUMENT = new RegExp(INSTRUMENT_LABELS.map(([, re]) => re).join("|"), "i");

function withinRange(instrument: OutcomeInstrument, value: number): boolean {
  if (value < 0) return false;
  if (instrument === "NPRS" || instrument === "PSFS") return value <= 10;
  return value <= 100;
}

interface ScoreMention {
  instrument: OutcomeInstrument;
  value: number;
  date: string | null;
  ambiguous: boolean;
}

/** Every score written in `text` ("NPRS 7/10", "QuickDASH 52.3", "ODI 48%", "NDI 21/50", "PSFS avg 2.7 (18/03/2026)"). */
export function findScores(text: string, now?: Date): ScoreMention[] {
  const out: ScoreMention[] = [];
  const item = new RegExp(
    `^\\s*(?:from\\s+|was\\s+|of\\s+|now\\s+|is\\s+)?(\\d{1,3}(?:\\.\\d{1,2})?)(\\s*[-–]\\s*\\d)?\\s*(\\/\\s*(?:10|50|100)|%|out of (?:10|50|100))?(?:\\s*\\(?\\s*(?:on\\s+)?(${DATE_PATTERN})\\s*\\)?)?`,
    "i",
  );
  const sep = /^\s*(?:,|;|→|->|>|then|to|and|now)\s*(?:then\s+)?/i;
  for (const [instrument, labelSrc] of INSTRUMENT_LABELS) {
    const label = new RegExp(labelSrc, "gi");
    let m: RegExpExecArray | null;
    while ((m = label.exec(text))) {
      let pos = m.index + m[0].length;
      // Filler between the label and the value: "score", "average", ":", "=", "(avg)" – never another instrument.
      const filler = /^[^\d\n]{0,25}?(?=\d)/.exec(text.slice(pos));
      if (!filler || ANY_INSTRUMENT.test(filler[0]) || /[.!?]\s/.test(filler[0])) continue;
      pos += filler[0].length;
      for (let n = 0; n < 6; n++) {
        const it = item.exec(text.slice(pos));
        if (!it || !it[1]) break;
        const scale = (it[3] ?? "").replace(/\s+/g, "").toLowerCase();
        let value = Number(it[1]);
        let ok = Number.isFinite(value);
        if (scale === "/50" || scale === "outof50") {
          if (instrument === "ODI" || instrument === "NDI") value = Math.round(value * 2 * 100) / 100;
          else ok = false;
        } else if ((scale === "/100" || scale === "%" || scale === "outof100") && (instrument === "NPRS" || instrument === "PSFS")) ok = false;
        else if ((scale === "/10" || scale === "outof10") && instrument !== "NPRS" && instrument !== "PSFS") ok = false;
        if (ok && withinRange(instrument, value)) {
          const date = it[4] ? parseDateToken(it[4].replace(/\s+/g, " "), now) : null;
          out.push({ instrument, value, date: date ? date.iso : null, ambiguous: Boolean(it[2]) });
        }
        pos += it[0].length;
        const next = sep.exec(text.slice(pos));
        if (!next || !/^\s*\d/.test(text.slice(pos + next[0].length).replace(/^(?:from|was|of|now|is)\s+/i, ""))) break;
        pos += next[0].length;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Registration
 * ----------------------------------------------------------------------------------------------*/

const TITLES = /^(Mr|Mrs|Ms|Miss|Mx|Dr|Master|Prof)\.?$/i;
const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const NAME_TOKEN = /^[A-Za-z][A-Za-z'’.-]*$/;

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function canonicalTitle(t: string): string {
  const s = t.replace(/\.$/, "");
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** "Mrs Jane Example", "EXAMPLE, Jane", "Jane Example (DOB 01/02/1980)" → name parts, or null when unclear. */
export function parsePatientName(raw: string): { title: string; first: string; last: string } | null {
  let s = raw
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s*[,–—-]?\s*\b(?:DOB|D\.O\.B\.?|date of birth|born|NHS|patient (?:id|no|number)|ref|age)\b.*$/i, "")
    .replace(/[,;:\s]+$/, "");
  s = tidy(s);
  if (!s) return null;
  let title = "";
  let first: string;
  let last: string;
  const comma = /^([^,]+),\s*([^,]+)$/.exec(s);
  if (comma) {
    let given = tidy(comma[2]).split(" ");
    if (given.length && TITLES.test(given[given.length - 1])) title = canonicalTitle(given.pop() as string);
    if (given.length && TITLES.test(given[0])) title = canonicalTitle(given.shift() as string);
    given = given.filter(Boolean);
    const family = tidy(comma[1]).split(" ");
    if (!given.length || !family.length) return null;
    first = given.join(" ");
    last = family.join(" ");
  } else {
    const tokens = s.split(" ");
    if (tokens.length && TITLES.test(tokens[0])) title = canonicalTitle(tokens.shift() as string);
    if (tokens.length < 2) return null;
    last = tokens[tokens.length - 1];
    first = tokens.slice(0, -1).join(" ");
  }
  const all = `${first} ${last}`.split(" ");
  if (all.length > 5 || !all.every((t) => NAME_TOKEN.test(t)) || all.some((t) => NOT_NAME_WORDS.has(t.toLowerCase()))) return null;
  return { title, first, last };
}

/** A date of birth written inline: "Re: Jane Example, DOB 14/09/1984", "D.O.B. 30/06/1991". */
const INLINE_DOB = new RegExp(`\\b(?:DOB|D\\.O\\.B\\.?|date of birth|born(?: on)?)\\s*[:\\-]?\\s*(${DATE_PATTERN})(?![\\d/])`, "i");

function firstDateIn(value: string, now?: Date): ParsedDate | null {
  const m = new RegExp(`(?:^|[^\\d/])(${DATE_PATTERN})(?![\\d/])`, "i").exec(value);
  return m ? parseDateToken(m[1].replace(/\s+/g, " "), now) : null;
}

function inferPartyType(name: string): InstructingPartyType | "" {
  if (/medico-?legal|medical report|\bmlc\b|\bagency\b/i.test(name)) return "mlc";
  if (/insur|assurance|health\s*care plan|healthcare\b|\bpmi\b/i.test(name)) return "insurer";
  if (/case manage/i.test(name)) return "case_manager";
  if (/solicitor|\blaw\b|legal|\bllp\b|lawyers?/i.test(name)) return "solicitor";
  return "";
}

function identifier(value: string): string {
  const v = tidy(value);
  return /^[A-Za-z0-9][A-Za-z0-9 /.\-]{1,39}$/.test(v) && /\d/.test(v) ? v : "";
}

interface RegistrationRead {
  registration: NotesReviewRegistration;
  detected: Set<NotesReviewField>;
  fieldNotes: Partial<Record<NotesReviewField, string>>;
}

function readRegistration(lines: Array<{ text: string; where: string }>, now: Date, warnings: Warnings): RegistrationRead {
  const reg: NotesReviewRegistration = { ...EMPTY_REVIEW_REGISTRATION };
  const detected = new Set<NotesReviewField>();
  const fieldNotes: RegistrationRead["fieldNotes"] = {};
  const set = (field: NotesReviewField, value: string) => {
    if (!value || (reg[field] as string)) return;
    (reg as Record<string, string>)[field] = value;
    detected.add(field);
  };
  let nameSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const hits = splitRegistration(lines[i].text);
    for (const hit of hits) {
      const v = hit.value;
      switch (hit.key) {
        case "name": {
          if (!v) break;
          nameSeen = true;
          const name = parsePatientName(v);
          if (name) {
            if (name.title) set("title", name.title);
            set("firstName", name.first);
            set("lastName", name.last);
          }
          break;
        }
        case "firstName":
          if (v.split(" ").every((t) => NAME_TOKEN.test(t))) set("firstName", tidy(v));
          break;
        case "lastName":
          if (v.split(" ").every((t) => NAME_TOKEN.test(t))) set("lastName", tidy(v));
          break;
        case "title":
          if (TITLES.test(v)) set("title", canonicalTitle(v));
          break;
        case "dob": {
          if (!v) break;
          const d = firstDateIn(v);
          if (d && d.twoDigitYear) warnings.add("DOB_TWO_DIGIT_YEAR", "The date of birth is written with a two-digit year, so it was left blank – enter it in full.");
          else if (d && d.iso >= "1900-01-01" && d.iso <= now.toISOString().slice(0, 10)) set("dob", d.iso);
          else warnings.add("DOB_UNCLEAR", "The date of birth could not be read clearly, so it was left blank – enter it.");
          break;
        }
        case "sex": {
          const s = v.toLowerCase();
          set("sex", /^(?:female|f|woman)$/.test(s) ? "female" : /^(?:male|m|man)$/.test(s) ? "male" : /^(?:other|non-binary|nonbinary)$/.test(s) ? "other" : "");
          break;
        }
        case "address": {
          const parts = [v];
          // An address may continue on the next lines (no label, not a note heading, short).
          for (let j = i + 1; j < lines.length && parts.length < 6; j++) {
            const next = lines[j].text.trim();
            if (!next || splitRegistration(next).length || matchHeading(next) || next.length > 60 || /[.!?]$/.test(next)) break;
            parts.push(next);
            i = j;
          }
          let address = parts.map(tidy).filter(Boolean).join(", ");
          const pc = UK_POSTCODE.exec(address);
          if (pc && address.toUpperCase().endsWith(pc[1].toUpperCase())) {
            set("postcode", pc[1].toUpperCase().replace(/\s+/g, " ").replace(/^(\S+?)(\d[A-Z]{2})$/, "$1 $2"));
            address = address.slice(0, address.length - pc[1].length).replace(/[,\s]+$/, "");
          }
          if (address.length >= 5 && address.length <= 300) set("address", address);
          break;
        }
        case "postcode": {
          const pc = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i.exec(tidy(v));
          if (pc) set("postcode", `${pc[1]} ${pc[2]}`.toUpperCase());
          else if (v) warnings.add("VALUE_UNCLEAR", "The postcode could not be read clearly, so it was left blank.");
          break;
        }
        case "phone": {
          const m = /(\+44\s?\(?0?\)?\s?\d[\d\s]{7,12}\d|\b0\d[\d\s-]{7,12}\d)/.exec(v);
          const digits = m ? m[1].replace(/\D/g, "") : "";
          if (m && digits.length >= 10 && digits.length <= 13) set("phone", tidy(m[1]));
          break;
        }
        case "email": {
          const m = /^[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}$/.exec(tidy(v).replace(/^<|>$/g, ""));
          if (m) set("email", m[0]);
          break;
        }
        case "occupation":
          if (v.length <= 120 && !/\d{3}/.test(v)) set("occupation", tidy(v));
          break;
        case "employer":
          if (v.length <= 200) set("employer", tidy(v));
          break;
        case "insurer":
          if (v.length >= 2 && v.length <= 200 && /[A-Za-z]/.test(v)) set("insurerName", tidy(v));
          break;
        case "membership":
          set("membershipNumber", identifier(v));
          break;
        case "authorisation":
          set("authorisationNumber", identifier(v));
          break;
        case "reference":
          set("reference", identifier(v));
          break;
        case "party":
        case "party:solicitor":
        case "party:case_manager":
        case "party:mlc": {
          if (!v || v.length > 200 || reg.instructingPartyName) break;
          set("instructingPartyName", tidy(v));
          const type = hit.key === "party" ? inferPartyType(v) : (hit.key.slice(6) as InstructingPartyType);
          set("instructingPartyType", type);
          break;
        }
        case "referredBy":
          if (v.length <= 200) set("referredBy", tidy(v));
          break;
        case "gp":
          if (v.length >= 3 && v.length <= 200) set("gpPractice", tidy(v));
          break;
        case "incidentDate": {
          const d = firstDateIn(v, now);
          if (d && !d.twoDigitYear && d.iso <= now.toISOString().slice(0, 10)) set("incidentDate", d.iso);
          else if (v) warnings.add("VALUE_UNCLEAR", "The date of the accident or injury could not be read clearly, so it was left blank.");
          break;
        }
        case "mechanism":
          if (v.length <= 500) set("incidentMechanism", tidy(v));
          break;
        case "consent": {
          const s = v.toLowerCase();
          const yes = /^(?:yes|y|given|recorded|signed|obtained)\b/.test(s);
          const no = /^(?:no|n|not given|not recorded|refused|declined)\b/.test(s);
          if (yes || no) set("consent", yes ? "yes" : "no");
          const d = yes ? firstDateIn(v, now) : null;
          if (d && !d.twoDigitYear) set("consentDate", d.iso);
          break;
        }
        default:
          break;
      }
    }
    // Inline date of birth without a label line ("Re: Jane Example, DOB 14/09/1984").
    if (!reg.dob) {
      const m = INLINE_DOB.exec(lines[i].text);
      if (m) {
        const d = parseDateToken(m[1].replace(/\s+/g, " "));
        if (d && d.twoDigitYear) warnings.add("DOB_TWO_DIGIT_YEAR", "The date of birth is written with a two-digit year, so it was left blank – enter it in full.");
        else if (d && d.iso >= "1900-01-01" && d.iso <= now.toISOString().slice(0, 10)) set("dob", d.iso);
      }
    }
  }
  if (nameSeen && !reg.lastName) warnings.add("VALUE_UNCLEAR", "The patient's name could not be read clearly, so it was left blank – enter it.");

  // Who the form is for: when no instructing party is written, an insurer (or a referral line naming a
  // solicitor, insurer, case manager or medico-legal company) is offered – marked for staff to check.
  if (!reg.instructingPartyName && reg.insurerName) {
    reg.instructingPartyName = reg.insurerName;
    reg.instructingPartyType = "insurer";
    fieldNotes.instructingPartyName = NOTES_REVIEW_COPY.fromInsurer;
  } else if (!reg.instructingPartyName && reg.referredBy && inferPartyType(reg.referredBy)) {
    reg.instructingPartyName = reg.referredBy;
    reg.instructingPartyType = inferPartyType(reg.referredBy);
    fieldNotes.instructingPartyName = NOTES_REVIEW_COPY.fromReferrer;
  }
  if (reg.instructingPartyName && !reg.instructingPartyType) reg.instructingPartyType = "";
  return { registration: reg, detected, fieldNotes };
}

/* ------------------------------------------------------------------------------------------------
 * Lines → entries
 * ----------------------------------------------------------------------------------------------*/

const SIGNATURE_LABEL = /^\s*(?:signed|signature|e-?signed(?:\s+by)?|electronically signed(?:\s+by)?|seen by|written by|entered by|author|clinician|practitioner|therapist)\s*(?:by)?\s*[:\-–]?\s*(.+)$/i;
const VALEDICTION = /^\s*(?:kind regards|best regards|regards|best wishes|many thanks|thanks|thank you|yours sincerely|yours faithfully|sincerely)[,.!]?\s*$/i;
const NOTES_LABEL = /^\s*(?:clinical\s+|treatment\s+|consultation\s+|session\s+)?notes?\s*[:\-–]\s*/i;

/** The clinician named by a signature at the end of a note, if any. */
function signatureClinician(body: string[]): ClinicianRef | null {
  const lines = body.map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-5);
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = tail[i];
    const labelled = SIGNATURE_LABEL.exec(line);
    if (labelled) {
      const c = parseClinicianText(labelled[1], true);
      if (c) return c;
    }
    const dashed = /^[-–—~]+\s*(.+)$/.exec(line);
    if (dashed) {
      const c = parseClinicianText(dashed[1], true);
      if (c) return c;
    }
    const withHcpc = parseClinicianText(line, false);
    if (withHcpc) return withHcpc;
    if (i > 0 && VALEDICTION.test(tail[i - 1])) {
      const c = parseClinicianText(line, true);
      if (c) {
        // "Sarah Reid" / "Physiotherapist, HCPC PH-DEMO-01": the registration number on the next lines.
        const after = tail.slice(i + 1).join(" ");
        const hcpc = new RegExp(`${HCPC_LABEL}(${HCPC_ID})`, "i").exec(after);
        return hcpc && !c.hcpc ? { ...c, hcpc: cleanHcpc(hcpc[1]) } : c;
      }
    }
  }
  return null;
}

interface HeadingRead {
  clinician: ClinicianRef | null;
  type: NoteType | null;
  status: AppointmentStatus | null;
  time: string | null;
  hcpc: string;
  /** The heading's own text beyond date, time, type, clinician and status – part of the note. */
  leftover: string;
}

/** The text after a heading's date and time. */
function readHeadingRest(rest: string): HeadingRead {
  const out: HeadingRead = { clinician: null, type: null, status: null, time: null, hcpc: "", leftover: "" };
  let text = rest.replace(/^[\s:,|•·\-–—]+/, "").replace(/[\s|•·\-–—]+$/, "");
  if (!text) return out;
  // "Key: value" pairs inside the heading ("Time: 09:00 Practitioner: Sarah Reid").
  const kv = splitDetail(text);
  if (kv.length) {
    kv.forEach((h) => applyDetail(out, h));
    return out;
  }
  const kvFrom = /\s(?=(?:practitioner|clinician|therapist|physiotherapist|seen by|time|type|status|hcpc)\s*:)/i.exec(text);
  let tail: LabelHit[] = [];
  if (kvFrom) {
    tail = splitDetail(text.slice(kvFrom.index + 1));
    if (tail.length) text = text.slice(0, kvFrom.index);
  }
  tail.forEach((h) => applyDetail(out, h));
  // Segments separated by dashes, bars or bullets (commas only between short segments).
  const segRe = /\s+[–—-]\s+|\s*[|•·]\s*|\s*[–—]\s*/g;
  const segments: Array<{ text: string; start: number }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = segRe.exec(text))) {
    segments.push({ text: text.slice(last, m.index), start: last });
    last = m.index + m[0].length;
  }
  segments.push({ text: text.slice(last), start: last });
  const expanded: Array<{ text: string; start: number }> = [];
  for (const seg of segments) {
    // Commas split a segment only when every part is short ("Sarah Reid, Physiotherapist, Follow-up").
    const parts: Array<{ text: string; start: number }> = [];
    const comma = /,\s+/g;
    let from = 0;
    let c: RegExpExecArray | null;
    while ((c = comma.exec(seg.text))) {
      parts.push({ text: seg.text.slice(from, c.index), start: seg.start + from });
      from = c.index + c[0].length;
    }
    parts.push({ text: seg.text.slice(from), start: seg.start + from });
    if (parts.length > 1 && parts.every((p) => p.text.trim().split(/\s+/).length <= 5)) expanded.push(...parts);
    else expanded.push(seg);
  }
  let leftoverStart = -1;
  for (const seg of expanded) {
    const t = seg.text.trim().replace(/^[(\[]|[)\]]$/g, "").replace(/[.:]$/, "");
    if (!t) continue;
    const clinician = parseClinicianText(t, true);
    if (clinician && !out.clinician) {
      out.clinician = clinician;
      continue;
    }
    if (TYPE_SEGMENT.test(t)) {
      out.type ??= noteTypeFrom(t);
      continue;
    }
    const status = statusFrom(t);
    if (status) {
      out.status ??= status;
      continue;
    }
    const hcpcOnly = new RegExp(`^(?:${HCPC_LABEL})?(${HCPC_ID})$`, "i").exec(t);
    if (hcpcOnly && /hcpc/i.test(t)) {
      out.hcpc = cleanHcpc(hcpcOnly[1]);
      continue;
    }
    if (leftoverStart < 0) leftoverStart = seg.start;
  }
  if (leftoverStart >= 0) {
    out.leftover = text.slice(leftoverStart).trim();
    // A type written at the start of the heading's text still names the note ("Initial assessment. Patient…").
    out.type ??= noteTypeFrom(out.leftover.split(/[.:;]/)[0] ?? "");
  }
  return out;
}

function applyDetail(out: HeadingRead, hit: LabelHit): void {
  const v = hit.value;
  if (!v) return;
  switch (hit.key) {
    case "clinician":
      out.clinician ??= parseClinicianText(v, true);
      break;
    case "hcpc": {
      const m = new RegExp(`(${HCPC_ID})`, "i").exec(v);
      if (m) out.hcpc = cleanHcpc(m[1]);
      break;
    }
    case "time":
      out.time ??= parseTimeToken(v.split(/\s*[-–]\s*|\s+to\s+/)[0] ?? "");
      break;
    case "type":
      out.type ??= noteTypeFrom(v);
      break;
    case "status":
      out.status ??= statusFrom(v);
      break;
    default:
      break;
  }
}

/** A date alone on a line that dates a letter ("9 October 2026" above "Dear …"), not a note. */
function isLetterDate(lines: Array<{ text: string }>, i: number, heading: Heading): boolean {
  if (heading.rest) return false;
  let seen = 0;
  for (let j = i + 1; j < lines.length && seen < 6; j++) {
    const t = lines[j].text.trim();
    if (!t) continue;
    seen += 1;
    if (/^(?:dear\b|to whom|re\s*:|ref\s*:|our ref|your ref)/i.test(t)) return true;
    if (matchHeading(t)) return false;
  }
  return false;
}

/** Short title-like lines (report titles, clinic names, greetings) are not note text. */
function isTitleLike(line: string): boolean {
  const t = line.trim();
  return t.length <= 60 && !/[.!?]\s|[.!?]$/.test(t);
}

/* ------------------------------------------------------------------------------------------------
 * The reader
 * ----------------------------------------------------------------------------------------------*/

type Item = { kind: "line"; text: string; where: string } | { kind: "entries"; read: TableRead };

export function readGeneralNotes(input: GeneralNotesInput): GeneralNotesResult {
  const { now } = input;
  const warnings = new Warnings();
  const items: Item[] = [];
  let tableAttendance = false;
  const tableConstants: TableRead["constants"] = {};
  for (const block of input.blocks) {
    if (block.kind === "line") items.push(block);
    else {
      const read = readEntryTable(block.rows, block.where, now, warnings);
      if (read) {
        items.push({ kind: "entries", read });
        if (read.attendance) tableAttendance = true;
        Object.assign(tableConstants, read.constants);
      } else tableAsLines(block.rows, block.where).forEach((l) => items.push({ kind: "line", ...l }));
    }
  }

  const lines = items.filter((it): it is Extract<Item, { kind: "line" }> => it.kind === "line");
  const preamble: Array<{ text: string; where: string }> = [];
  const orphan: Array<{ text: string; where: string }> = [];
  const raw: RawEntry[] = [];
  let current: RawEntry | null = null;
  let inDetail = false;
  let emptyDateLines = 0;
  let lineIdx = -1;

  const close = () => {
    if (!current) return;
    finishEntry(current);
    // A date alone on its line with nothing under it (a print date, a page footer) is not a note.
    if (!current.bodyLines.some((l) => l.trim()) && current.headingLines.length === 1 && !current.status && !current.clinician && !current.type) {
      emptyDateLines += 1;
      current = null;
      return;
    }
    raw.push(current);
    current = null;
  };

  for (const it of items) {
    if (it.kind === "entries") {
      close();
      it.read.entries.forEach((e) => raw.push(e));
      inDetail = false;
      continue;
    }
    lineIdx += 1;
    const text = it.text;
    const heading = matchHeading(text, now);
    if (heading && !isLetterDate(lines, lineIdx, heading)) {
      close();
      const rest = readHeadingRest(heading.rest);
      current = {
        where: it.where,
        date: heading.date,
        time: heading.time ?? rest.time,
        clinician: rest.clinician,
        hcpc: rest.hcpc,
        type: rest.type,
        status: rest.status,
        reason: "",
        headingLines: [text.trim()],
        bodyLines: rest.leftover ? [rest.leftover] : [],
        fromTable: false,
        tableScores: [],
      };
      inDetail = true;
      continue;
    }
    if (!current) {
      if (raw.length) orphan.push(it);
      else preamble.push(it);
      continue;
    }
    if (inDetail) {
      const t = text.trim();
      if (t) {
        const hits = splitDetail(t);
        if (hits.length && t.length <= 160) {
          const read: HeadingRead = { clinician: current.clinician, type: current.type, status: current.status, time: current.time, hcpc: current.hcpc, leftover: "" };
          hits.forEach((h) => applyDetail(read, h));
          Object.assign(current, { clinician: read.clinician, type: read.type, status: read.status, time: read.time, hcpc: read.hcpc });
          current.headingLines.push(t);
          continue;
        }
        const bare = !current.clinician && current.bodyLines.length === 0 ? parseClinicianText(t, false) : null;
        if (bare) {
          current.clinician = bare;
          current.headingLines.push(t);
          continue;
        }
      }
      inDetail = false;
    }
    current.bodyLines.push(text);
  }
  close();

  if (raw.length > NOTES_REVIEW_LIMITS.entries) {
    return { ok: false, message: `The notes hold more than ${NOTES_REVIEW_LIMITS.entries} entries. Upload one episode of care at a time.` };
  }

  // Registration: "Label: value" lines before the first note, then values every table row agreed on.
  const regRead = readRegistration(preamble, now, warnings);
  const reg = regRead.registration;
  const fromTable = (field: NotesReviewField, value: string | undefined) => {
    if (!value || (reg[field] as string)) return;
    (reg as Record<string, string>)[field] = value;
    regRead.detected.add(field);
  };
  if (tableConstants.patient) {
    const name = parsePatientName(tableConstants.patient);
    if (name) {
      fromTable("title", name.title);
      fromTable("firstName", name.first);
      fromTable("lastName", name.last);
    }
  }
  if (tableConstants.dob) {
    const d = parseDateToken(tableConstants.dob, now);
    if (d && d.twoDigitYear) warnings.add("DOB_TWO_DIGIT_YEAR", "The date of birth is written with a two-digit year, so it was left blank – enter it in full.");
    else if (d) fromTable("dob", d.iso);
  }
  fromTable("insurerName", tableConstants.insurer);
  fromTable("membershipNumber", tableConstants.membership ? identifier(tableConstants.membership) : "");
  fromTable("authorisationNumber", tableConstants.authorisation ? identifier(tableConstants.authorisation) : "");
  fromTable("reference", tableConstants.reference ? identifier(tableConstants.reference) : "");
  if (!reg.instructingPartyName && reg.insurerName) {
    reg.instructingPartyName = reg.insurerName;
    reg.instructingPartyType = "insurer";
    regRead.fieldNotes.instructingPartyName = NOTES_REVIEW_COPY.fromInsurer;
  }

  // Text before the first note (other than registration and title lines), and text after a table that no
  // dated heading claimed, become blocks without a date: left out unless staff give them one. (Undated table
  // rows – a date cell that could not be read – stay where they are.)
  const undatedBlock = (group: Array<{ text: string; where: string }>): RawEntry[] => {
    const s = group.filter(
      (l) =>
        l.text.trim() &&
        !splitRegistration(l.text.trim()).length &&
        !/^\s*[A-Za-z][\w .'/()&-]{0,30}:\s/.test(l.text) &&
        !INLINE_DOB.test(l.text) &&
        !isTitleLike(l.text),
    );
    if (s.reduce((n, l) => n + l.text.trim().length, 0) < 40) return [];
    return [
      {
        where: s[0].where,
        date: null,
        time: null,
        clinician: null,
        hcpc: "",
        type: null,
        status: null,
        reason: "",
        headingLines: [],
        bodyLines: s.map((l) => l.text),
        fromTable: false,
        tableScores: [],
      },
    ];
  };
  const all: RawEntry[] = [...undatedBlock(preamble), ...raw, ...undatedBlock(orphan)];

  if (!all.length) {
    return {
      ok: false,
      message:
        input.format === "csv"
          ? 'No notes were found. The file needs a column headed "Date" and a column with the notes (for example "Notes", or "Subjective" … "Plan").'
          : 'No notes were found. Each note needs its date at the start of a line, for example "18/03/2026" or "18 March 2026".',
    };
  }

  // Entries.
  const entries: NotesReviewEntry[] = [];
  let truncated = false;
  all.forEach((e, idx) => {
    const key = `E-${idx + 1}`;
    let body = e.bodyLines.join("\n");
    if (body.length > NOTES_REVIEW_LIMITS.entryChars) {
      if (e.date) return void (truncated = true);
      body = body.slice(0, NOTES_REVIEW_LIMITS.entryChars);
      warnings.add("TRUNCATED", "A long block of text without a date was shortened in this review.");
    }
    entries.push({
      key,
      date: e.date ? e.date.iso : "",
      time: e.time ?? "",
      clinicianName: e.clinician?.name ?? "",
      clinicianHcpc: e.clinician?.hcpc ?? "",
      type: e.type ?? "other",
      status: e.status ?? "",
      reason: e.reason,
      heading: e.headingLines.join("\n").slice(0, 4_000),
      body,
      where: e.where.slice(0, 40),
      include: Boolean(e.date),
    });
  });
  if (truncated) return { ok: false, message: `One note is longer than ${NOTES_REVIEW_LIMITS.entryChars.toLocaleString("en-GB")} characters. Check that the notes have a date at the start of each entry.` };

  // A clinician named with an HCPC number in one entry and by the same name alone in another: same person.
  const hcpcByName = new Map<string, Set<string>>();
  entries.forEach((e) => {
    if (e.clinicianName && e.clinicianHcpc) {
      const set = hcpcByName.get(e.clinicianName) ?? new Set<string>();
      set.add(e.clinicianHcpc);
      hcpcByName.set(e.clinicianName, set);
    }
  });
  entries.forEach((e) => {
    const known = e.clinicianName && !e.clinicianHcpc ? hcpcByName.get(e.clinicianName) : undefined;
    if (known && known.size === 1) e.clinicianHcpc = Array.from(known)[0];
  });

  // Outcome scores.
  const outcomes: NotesReviewOutcome[] = [];
  const byInstrumentDate = new Map<string, NotesReviewOutcome & { own: boolean }>();
  all.forEach((e, idx) => {
    const entry = entries[idx];
    if (!entry || !e.date) return;
    const mentions = findScores([entry.heading, entry.body].join("\n"), now);
    e.tableScores.forEach((s) => mentions.push({ instrument: s.instrument, value: s.value, date: null, ambiguous: false }));
    const instruments = Array.from(new Set(mentions.map((x) => x.instrument)));
    for (const inst of instruments) {
      const list = mentions.filter((x) => x.instrument === inst);
      if (list.some((x) => x.ambiguous)) {
        warnings.add("AMBIGUOUS_SCORE", `${inst} on ${ukDate(e.date.iso)} is written as a range, so it was not recorded as a score.`, [entry.key]);
        continue;
      }
      const dated = list.filter((x) => x.date);
      const undatedValues = Array.from(new Set(list.filter((x) => !x.date).map((x) => x.value)));
      const points: Array<{ value: number; date: string }> = [];
      dated.forEach((x) => points.push({ value: x.value, date: x.date as string }));
      if (undatedValues.length === 1) points.push({ value: undatedValues[0], date: e.date.iso });
      else if (undatedValues.length > 1) {
        warnings.add("AMBIGUOUS_SCORE", `${inst} is written with more than one value on ${ukDate(e.date.iso)}, so it was not recorded as a score – check the note.`, [entry.key]);
      }
      for (const p of points) {
        const k = `${inst}|${p.date}`;
        const own = p.date === e.date.iso;
        const prev = byInstrumentDate.get(k);
        if (prev && (prev.value === p.value || prev.own || !own)) continue;
        byInstrumentDate.set(k, { instrument: inst, value: p.value, date: own ? "" : p.date, entryKey: entry.key, own });
      }
    }
  });
  byInstrumentDate.forEach((o) => outcomes.push({ instrument: o.instrument, value: o.value, date: o.date, entryKey: o.entryKey }));
  outcomes.sort((a, b) => a.instrument.localeCompare(b.instrument) || entryOrder(a.entryKey) - entryOrder(b.entryKey));

  // Attendance: a table's status column, or every dated note heading naming a status and a time.
  const lineEntries = entries.filter((e, i) => e.date && !all[i].fromTable);
  let attendance = tableAttendance;
  if (!tableAttendance && lineEntries.length) {
    const withStatus = lineEntries.filter((e) => e.status);
    if (withStatus.length === lineEntries.length && lineEntries.every((e) => e.time)) attendance = true;
    else if (withStatus.length) {
      warnings.add(
        "PARTIAL_ATTENDANCE",
        `Attendance is written for ${withStatus.length} of ${lineEntries.length} notes (or without a time), so no attendance record was made from it.`,
      );
    }
  }

  // Warnings shown with the review (the Studio recounts the clinician and date ones as staff edit).
  const noClinician = entries.filter((e) => e.include && !e.clinicianName);
  if (noClinician.length) warnings.add("NO_CLINICIAN", NOTES_REVIEW_COPY.noClinician(noClinician.length), noClinician.map((e) => e.key));
  const noDate = entries.filter((e) => !e.date);
  if (noDate.length) warnings.add("NO_DATE", NOTES_REVIEW_COPY.noDate(noDate.length), noDate.map((e) => e.key));
  if (emptyDateLines) {
    warnings.add("EMPTY_DATE_LINE", `${emptyDateLines} ${emptyDateLines === 1 ? "date stands" : "dates stand"} alone on a line with no note under ${emptyDateLines === 1 ? "it" : "them"} and ${emptyDateLines === 1 ? "was" : "were"} ignored.`);
  }

  const review: NotesReview = {
    version: NOTES_REVIEW_VERSION,
    layout: "general",
    format: input.format,
    ...(input.fileName ? { fileName: input.fileName.slice(0, 200) } : {}),
    pages: input.pages ?? 0,
    registration: reg,
    detected: Array.from(regRead.detected),
    ...(Object.keys(regRead.fieldNotes).length ? { fieldNotes: regRead.fieldNotes } : {}),
    entries,
    outcomes: outcomes.slice(0, NOTES_REVIEW_LIMITS.outcomes),
    attendance,
    warnings: warnings.list,
  };
  return { ok: true, review };
}

function finishEntry(e: RawEntry): void {
  // Blank lines around the note go; a bare "Notes:" label line at its start goes; the rest is kept as written.
  while (e.bodyLines.length && !e.bodyLines[0].trim()) e.bodyLines.shift();
  while (e.bodyLines.length && !e.bodyLines[e.bodyLines.length - 1].trim()) e.bodyLines.pop();
  if (e.bodyLines.length && NOTES_LABEL.test(e.bodyLines[0]) && !e.fromTable) {
    const rest = e.bodyLines[0].replace(NOTES_LABEL, "");
    if (rest.trim()) e.bodyLines[0] = rest;
    else {
      e.headingLines.push(e.bodyLines.shift() as string);
      while (e.bodyLines.length && !e.bodyLines[0].trim()) e.bodyLines.shift();
    }
  }
  if (!e.clinician && !e.fromTable) e.clinician = signatureClinician(e.bodyLines);
  if (e.clinician && !e.clinician.hcpc && e.hcpc) e.clinician = { ...e.clinician, hcpc: e.hcpc };
}

function entryOrder(key: string): number {
  return Number(key.slice(2));
}

function ukDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
