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
 *    optionally followed by a time ("09:00", "9.30am"). A numeric date uses ONE separator ("2-3/10" is a pain
 *    range, never 02/03/2010), and a line that starts like a date far from every other note's date is kept as
 *    note text with a warning (fix wave 3). The heading's own text gives the type ("Initial assessment",
 *    "Follow Up (30 min)", "Discharge", "Telephone call"), the clinician ("Sarah Reid (PH-DEMO-01)", "Amara Okafor
 *    (Physiotherapist)", "Practitioner: …") and an attendance status ("Attended", "DNA", "(attended)", "did not
 *    attend (unwell)"); "Key: value" lines right under the heading (Time:, Practitioner:, Type:, Status:, HCPC:)
 *    belong to it. An admin, reception or message entry is left out until staff tick it;
 *  - reads a table whose header row has a date column (Date / Appointment date / Appointment start / Date/Time …,
 *    or a column whose cells are dates) and a note, clinician or status column as one entry per row; a table whose
 *    columns carry dates ("Initial (01/07/2026) | Latest (12/08/2026)") as dated outcome scores; other tables become
 *    "label: value" lines;
 *  - takes a clinician from the heading first, else from a signature line at the end of the note ("Signed: …",
 *    "Electronically signed by Name MCSP, HCPC … on <date>", "— Name (HCPC)", "Kind regards" + name, a closing
 *    "Name, Physiotherapist"); a letter's signature names the clinician of its entries that name none (with a
 *    warning);
 *  - keeps each note's text exactly as written (only blank lines around it and a bare "Notes:" label are
 *    dropped); labelled S/O/A/P sections are split later, on confirm (./review-bundle.ts). An entry written as a
 *    bullet ends with the bullet list: the paragraphs after it are a block of their own;
 *  - reads registration details from the "Label: value" lines before the first note (several per line are
 *    fine, an address carried on to the next line too): name, title, date of birth, sex, address, postcode, phone,
 *    email, occupation, employer, insurer ("Funding:", "Payer:" too), membership / policy number, authorisation
 *    number, instructing party, reference, referred by, GP practice, date of accident, consent – and the policy and
 *    authorisation numbers written inside a "Re:" line. Values are checked against conservative patterns; anything
 *    that does not clearly match is left EMPTY (with a warning where useful) – never guessed. A date of birth
 *    written with a two-digit year is never completed. Header lines that are not used are returned as
 *    "other details" so nothing is dropped silently;
 *  - finds outcome scores written like "NPRS 7/10", "QuickDASH 52.3", "PSFS 2.7", "ODI 48%", "NDI 42%" (with the
 *    entry's date, or a date written right after the score); one instrument written with two different values
 *    and no dates in one note (e.g. "NPRS from 7/10 to 3/10") is left out with a warning, as are ranges.
 *
 * Linear time on any input (fix wave 3): trailing runs are trimmed by ./text-runs.ts, headings are matched on the
 * first characters of a line, and only lines up to STRUCTURE_LINE_CHARS are read as headings, labels or signatures.
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
  reviewAttendance,
  type NotesReview,
  type NotesReviewEntry,
  type NotesReviewField,
  type NotesReviewOutcome,
  type NotesReviewRegistration,
  type NotesReviewWarning,
  type NotesReviewWarningCode,
} from "./review-contract";
import { STRUCTURE_LINE_CHARS, collapseSpaces, isSpace, spaceOr, splitHeadingSegments, trimEndWhere, trimStartWhere, trimWhere } from "./text-runs";

/* ------------------------------------------------------------------------------------------------
 * Input
 * ----------------------------------------------------------------------------------------------*/

export type NotesBlock =
  /** `bullet`: a list item (a Word numbered or bulleted paragraph, or a line starting with "•"). */
  | { kind: "line"; text: string; where: string; bullet?: boolean }
  | { kind: "table"; rows: string[][]; where: string };

export interface GeneralNotesInput {
  format: NotesReview["format"];
  blocks: NotesBlock[];
  fileName?: string;
  pages?: number;
  now: Date;
}

export type GeneralNotesResult = { ok: true; review: NotesReview } | { ok: false; message: string };

const BULLET_LINE = /^\s*[•◦▪‣]\s+\S/;

/** Lines of plain text as blocks ("line N"). */
export function textToBlocks(text: string, firstLine = 1): NotesBlock[] {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line, i) => {
      const t = line.trimEnd();
      return BULLET_LINE.test(t.slice(0, 8)) ? { kind: "line" as const, text: t, where: `line ${i + firstLine}`, bullet: true } : { kind: "line" as const, text: t, where: `line ${i + firstLine}` };
    });
}

/** A CSV file as blocks: lines above the table's header row stay lines; the rest is one table ("row N"). */
export function csvToBlocks(content: string): NotesBlock[] {
  const records = parseCsvRecords(content.replace(/^\uFEFF/, ""));
  const rows = records.map((r) => r.cells.map((c) => c.trim()));
  const headerIdx = findEntryHeaderRow(rows);
  if (headerIdx < 0) return [{ kind: "table", rows, where: "row 1" }];
  const blocks: NotesBlock[] = rows.slice(0, headerIdx).map((cells, i) => ({
    kind: "line" as const,
    text: cells.filter(Boolean).length === 2 && cells[0] && !/:\s*$/.test(cells[0].slice(0, 200)) ? `${cells[0]}: ${cells.filter(Boolean)[1]}` : cells.filter(Boolean).join(" "),
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
/**
 * One date in any of the accepted spellings (no capture groups). A numeric date uses the same separator twice
 * (fix wave 3: "2-3/10" is a pain range, not 02/03/2010).
 */
export const DATE_PATTERN = [
  "\\d{4}-\\d{1,2}-\\d{1,2}",
  "\\d{1,2}/\\d{1,2}/(?:\\d{4}|\\d{2})",
  "\\d{1,2}\\.\\d{1,2}\\.(?:\\d{4}|\\d{2})",
  "\\d{1,2}-\\d{1,2}-(?:\\d{4}|\\d{2})",
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
  const s = collapseSpaces(input).trim();
  if (s.length > 40) return null;
  let m: number;
  let d: number;
  let yearText: string;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) {
    yearText = match[1];
    m = Number(match[2]);
    d = Number(match[3]);
  } else if ((match = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})$/.exec(s))) {
    d = Number(match[1]);
    m = Number(match[3]);
    yearText = match[4];
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
  const y = twoDigitYear ? 2000 + Number(yearText) : Number(yearText);
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
  const raw = input.trim().toLowerCase();
  if (raw.length > 20) return null;
  const s = raw.replace(/\./g, (c, i: number, all: string) => (/\d/.test(all[i - 1] ?? "") && /\d/.test(all[i + 1] ?? "") ? ":" : ""));
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
/** The start of a heading line (matched on the line's first HEADING_PROBE_CHARS, leading spaces removed). */
const HEADING_RE = new RegExp(
  `^(?:[#>*•·◦▪‣\\-–—]+\\s*|\\d{1,3}[.)]\\s+)?(?:\\*\\*|__)?\\s*(?:${HEADING_PREFIX}\\s*[:\\-–—]?\\s*)?(?:${WEEKDAY}\\s+)?(${DATE_PATTERN})(?![\\d/])(?:\\s*(?:,|at|@|from|-|–|—)?\\s*(${TIME_PATTERN})(?:\\s*(?:-|–|—|to)\\s*(?:${TIME_PATTERN}))?(?![\\d:]))?`,
  "i",
);
const HEADING_PROBE_CHARS = 300;

export interface Heading {
  date: ParsedDate;
  time: string | null;
  rest: string;
}

export function matchHeading(line: string, now?: Date): Heading | null {
  const trimmed = trimStartWhere(line, isSpace);
  const m = HEADING_RE.exec(trimmed.slice(0, HEADING_PROBE_CHARS));
  if (!m) return null;
  const date = parseDateToken(m[1], now);
  if (!date) return null;
  // "18/03/2026 – 7/10" style ratios are not headings; neither is a date directly followed by letters.
  const rest = trimmed.slice(m[0].length).replace(/^\s*(?:\*\*|__)\s*/, "");
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
/** A clinician's job title ("Physiotherapist", "Senior Physio", "Clinical Lead Physiotherapist", "Sports Therapist"). */
const CLINICAL_ROLE =
  /^(?:(?:senior|junior|lead|principal|advanced|extended scope|clinical(?: lead| specialist)?|specialist|consultant|msk|first contact|locum|band \d)\s+)*(?:physiotherapist|physio|physical therapist|sports therapist|sports rehabilitator|osteopath|chiropractor|occupational therapist|therapist|clinician|practitioner|podiatrist|rehabilitation specialist)s?$/i;
/** Post-nominals written after a clinician's name ("Amara Okafor MCSP", "Sophie Lang BSc (Hons) MSc"). */
const POST_NOMINALS = /\s+(?:MCSP|FCSP|MMACP|MACP|MSST|SRP|HCPC-registered|BSc|MSc|BA|MA|PhD|DPT|MPhty|MCPPE|AACP|MCSSP|Hons|\(Hons\))\b\.?/g;

/** Words that make a capitalised phrase clinical text rather than a person's name. */
const NOT_NAME_WORDS = new Set(
  (
    "right left bilateral neck back knee hip shoulder ankle foot wrist elbow hand lumbar cervical thoracic spine spinal pain review session treatment " +
    "assessment initial follow up discharge summary note notes call telephone phone video virtual letter report exercise exercises programme " +
    "physio physiotherapy clinic appointment sports massage acupuncture hydrotherapy class gym home visit new patient progress plan objective " +
    "subjective outcome outcomes measures dna attended cancelled cancellation status type practitioner clinician therapist physiotherapist " +
    "date time details record records history medical social referral insurer insurance policy membership authorisation total sessions " +
    "manual therapy rehab rehabilitation whiplash injury accident road traffic work workplace fall the and of with for to on in at by no yes " +
    "admin reception receptionist message email sms consultation"
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
 * A clinician written as "Name (HCPC)", "Name, Physiotherapist, HCPC PH12345", "Name MCSP, HCPC: …", "Name –
 * HCPC: …" or (when `allowBare`) just a name, optionally followed by a job title ("Name, Physiotherapist", "Name
 * (Physiotherapist)"). A trailing "on <date> <time>" (an e-signature) is ignored. Null when not clearly a name.
 */
export function parseClinicianText(input: string, allowBare: boolean): ClinicianRef | null {
  if (input.length > 300) return null;
  let s = collapseSpaces(input.replace(/\*\*|__/g, "")).trim();
  s = s.replace(new RegExp(`\\s+(?:on|at)\\s+(?:${DATE_PATTERN})(?:\\s*(?:at\\s+)?(?:${TIME_PATTERN}))?\\s*$`, "i"), "");
  s = s.replace(POST_NOMINALS, "").trim();
  s = trimEndWhere(s, (c) => c === "." || c === ";" || c === "," || c === " ");
  if (!s || s.length > 160) return null;
  let m = new RegExp(`^(${NAME})\\s*\\(\\s*(?:${HCPC_LABEL})?(${HCPC_ID})\\s*\\)`).exec(s);
  if (m && isNameLike(m[1])) return { name: m[1], hcpc: cleanHcpc(m[2]) };
  m = new RegExp(`^(${NAME})\\s*(?:[,–—-]\\s*[^,()]{0,60}?)?[,–—-]?\\s*\\(?${HCPC_LABEL}(${HCPC_ID})\\)?\\s*$`).exec(s);
  if (m && isNameLike(m[1])) return { name: m[1], hcpc: cleanHcpc(m[2]) };
  if (!allowBare) {
    // "Sarah Reid, Physiotherapist" / "Amara Okafor (Physiotherapist)": a name with a clinical job title.
    const role = new RegExp(`^(${NAME})\\s*(?:,\\s*|[–—-]\\s*|\\(\\s*)([A-Za-z][A-Za-z ]{2,60}?)\\s*\\)?$`).exec(s);
    if (role && CLINICAL_ROLE.test(role[2].trim()) && isNameLike(role[1])) return { name: role[1], hcpc: "" };
    return null;
  }
  m = new RegExp(`^(${NAME})(?:\\s*(?:,|–|—|-)\\s*[A-Za-z][A-Za-z ()/&]{0,60}|\\s*\\(\\s*[A-Za-z][A-Za-z /&]{0,60}\\))?$`).exec(s);
  if (m && isNameLike(m[1])) return { name: m[1], hcpc: "" };
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * Note types and attendance
 * ----------------------------------------------------------------------------------------------*/

const TYPE_SEGMENT =
  /^(?:(?:new|initial|first)\s+(?:patient\s+)?(?:assessment|appointment|consultation|visit|session)|ia|np|new\s+patient|follow[\s-]?up(?:\s+(?:appointment|session|treatment|review|visit|consultation))?|f\/?u|review|re-?assessment|treatment(?:\s+session)?|discharge(?:\s+(?:summary|note|session|appointment|review))?|final\s+(?:review|session|appointment)|telephone(?:\s+(?:call|consultation|review|appointment|follow[\s-]?up))?|phone\s+call|video(?:\s+(?:call|consultation|appointment|review))?|virtual\s+(?:consultation|appointment|session|review)|(?:clinical\s+)?notes?|session(?:\s*\d+)?|physio(?:therapy)?(?:\s+(?:session|appointment|treatment|review))?)$/i;
/** An admin or message entry (left out of the record unless staff include it). */
const ADMIN_SEGMENT = /^(?:admin(?:istration|istrative)?(?:\s+(?:note|entry|task))?|reception(?:ist)?|front\s+desk|sms(?:\s+(?:sent|reminder))?|text\s+message|e-?mail(?:\s+(?:sent|received))?|letter(?:\s+(?:sent|received))?|phone\s+message|message|telephone\s+message|invoice|billing|finance)$/i;
/** A duration written in a heading ("(30 min)", "45 mins", "1 hr"). */
const DURATION = /\s*\(?\s*\d{1,3}\s*(?:min(?:ute)?s?|hrs?|hours?)\s*\)?\s*$/i;

export function noteTypeFrom(text: string): NoteType | null {
  const s = text.toLowerCase();
  if (/\bdischarg|\bfinal (?:review|session|appointment)\b/.test(s)) return "discharge";
  if (/\b(?:initial|first) (?:patient )?(?:assessment|appointment|consultation|visit|session)\b|\bnew patient\b|^ia\b|^np\b/.test(s)) return "initial_assessment";
  if (/\btelephone\b|\bphone call\b|\bphone\b/.test(s)) return "telephone";
  if (/\bfollow[\s-]?up\b|^f\/?u\b|\breview\b|\bre-?assessment\b|\btreatment\b|\bsession\b/.test(s)) return "follow_up";
  return null;
}

const STATUS_WORDS: Array<[AppointmentStatus, RegExp]> = [
  ["LCN", /^(?:late\s+cancel(?:l?ation|l?ed)?|lcn|cancelled\s+late|late\s+cancelled|cancel(?:l?ed)?\s*(?:<|less\s+than|within|under)\s*24\s*(?:h|hrs?|hours?)|cancel(?:l?ed)?\s+(?:on\s+the\s+day|same\s+day))\b/i],
  ["DNA", /^(?:dna|d\.n\.a\.?|did\s+not\s+attend|did\s+not\s+arrive|didn['’]t\s+attend|no[\s-]?show|failed\s+to\s+attend|fta)\b/i],
  ["CNC", /^(?:cancel(?:l?ed)?(?:\s+by\s+(?:the\s+)?(?:patient|clinic|pt))?(?:\s+with\s+notice)?|cnc)\b/i],
  ["ATT", /^(?:attended|arrived|completed|seen|att|checked\s+in)\b/i],
  ["BOOKED", /^(?:booked|scheduled|future|bkd)\b/i],
];

/** A whole cell or field that is an attendance status ("Attended", "DNA", "Cancelled < 24 hrs"), else null. */
export function statusFrom(text: string): AppointmentStatus | null {
  const p = statusPhrase(text);
  return p && !p.rest ? p.status : null;
}

/**
 * A status at the start of a text, with what follows: "Did Not Attend. No contact from patient." → DNA, rest "No
 * contact from patient."; "did not attend (unwell, telephoned on the day)" → DNA, rest "unwell, telephoned on the
 * day". Null when the text does not start with a status.
 */
export function statusPhrase(text: string): { status: AppointmentStatus; rest: string } | null {
  if (text.length > STRUCTURE_LINE_CHARS) return null;
  const s = collapseSpaces(text).trim().replace(/^(?:status|attendance)\s*[:\-–]?\s*/i, "").replace(/^(?:pt|patient)\s+(?=did|dna|failed|cancel|no)/i, "");
  for (const [status, re] of STATUS_WORDS) {
    const m = re.exec(s);
    if (!m) continue;
    let rest = s.slice(m[0].length).trim();
    rest = trimStartWhere(rest, spaceOr(".,;:–—-")).trim();
    if (/^\(.*\)$/.test(rest)) rest = rest.slice(1, -1).trim();
    rest = trimEndWhere(rest, (c) => c === "." || c === " ").trim();
    return { status, rest };
  }
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

const VALUE_TRAIL = spaceOr("|;,•");

/**
 * A splitter for lines holding one or more "Label: value" pairs with the given labels (longest first). `lead` is
 * the text before the first label ("" when the line starts with one). Lines longer than STRUCTURE_LINE_CHARS are
 * never read as labels.
 */
function labelSplitter(table: ReadonlyArray<readonly [string, readonly string[]]>): (line: string) => { lead: string; hits: LabelHit[] } {
  const byLabel = new Map<string, string>();
  table.forEach(([key, labels]) => labels.forEach((l) => byLabel.set(l.toLowerCase(), key)));
  const alts = Array.from(byLabel.keys())
    .sort((a, b) => b.length - a.length)
    .map((l) => escapeRe(l).replace(/\\ /g, "\\s+").replace(/ /g, "\\s+"));
  const re = new RegExp(`(^|[\\s|;,•])(${alts.join("|")})\\s*[:：]\\s*`, "gi");
  return (line: string) => {
    if (line.length > STRUCTURE_LINE_CHARS) return { lead: line, hits: [] };
    const hits: Array<{ key: string; label: string; start: number; end: number }> = [];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const label = collapseSpaces(m[2].toLowerCase());
      const key = byLabel.get(label);
      if (key) hits.push({ key, label, start: m.index + m[1].length, end: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex += 1;
    }
    if (!hits.length) return { lead: line, hits: [] };
    const lead = trimWhere(line.slice(0, hits[0].start), spaceOr("*#>•·-–—|")).trim();
    return {
      lead,
      hits: hits.map((h, i) => ({
        key: h.key,
        label: h.label,
        value: trimEndWhere(line.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : line.length).replace(/\*\*|__/g, ""), VALUE_TRAIL).trim(),
      })),
    };
  };
}

/** Only lines that START with a label are "Label: value" lines (text that merely contains "x: y" is not). */
function leadingLabels(split: (line: string) => { lead: string; hits: LabelHit[] }): (line: string) => LabelHit[] {
  return (line) => {
    const r = split(line);
    return r.lead ? [] : r.hits;
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
const splitDetail = leadingLabels(labelSplitter(DETAIL_LABELS));

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
  [
    "insurer",
    ["insurance company", "insurance provider", "health insurer", "medical insurer", "insurer name", "insurer", "insured with", "pmi provider", "insurance", "funding", "funder", "funded by", "payer", "paying party", "payor"],
  ],
  [
    "membership",
    ["membership number", "membership no.", "membership no", "member number", "member no.", "member no", "policy number", "policy no.", "policy no", "policy", "scheme number", "membership"],
  ],
  ["authorisation", ["pre-authorisation number", "pre-authorisation code", "preauthorisation number", "authorisation number", "authorization number", "authorisation code", "authorization code", "authorisation no.", "authorisation no", "auth number", "auth no.", "auth no", "auth code", "pre-authorisation", "authorisation", "authorization", "auth"]],
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
      "subject", "cc", "age", "date of report", "report date", "episode", "condition", "diagnosis", "clinic", "location", "notes shown", "filter",
    ],
  ],
];
const splitRegistrationWithLead = labelSplitter(REG_LABELS);
const splitRegistration = leadingLabels(splitRegistrationWithLead);

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

/** Header names → columns, in priority order (a date of birth before any other date). */
const COLUMN_PATTERNS: Array<[Column, RegExp]> = [
  ["dob", /^(?:(?:patient|client)(?:['’]s)?\s+)?(?:dob|d\s*o\s*b|date\s+of\s+birth|birth\s*date)$/],
  [
    "date",
    /^(?:(?:appointment|session|visit|consultation|treatment|note|entry|clinic|booking|event)\s+)?(?:date(?:\s*(?:\/|and|&)\s*time)?|datetime)(?:\s+(?:of\s+(?:appointment|session|visit|consultation)|seen))?$|^(?:(?:appointment|session|booking|visit|consultation|event)\s+)?(?:starts?(?:\s+(?:date|at|date\s*\/\s*time))?|start\s+date)$|^(?:appointment|booking)\s+(?:date\s*\/\s*time|start(?:\s+time)?)$|^seen\s+on$|^when$/,
  ],
  ["time", /^(?:(?:appointment|start|session)\s+)?time$/],
  ["clinician", /^(?:clinician|practitioner|therapist|physiotherapist|physio|seen\s+by|author|staff(?:\s+member)?|treating\s+clinician|written\s+by)(?:\s+name)?$/],
  ["hcpc", /^(?:hcpc|hcpc\s+(?:no|number|reg|registration)|registration(?:\s+(?:no|number))?|reg\s+no)$/],
  ["note", /^(?:notes?|clinical\s+notes?|treatment\s+notes?|consultation\s+notes?|session\s+notes?|entry|details|comments?|narrative|text|record|summary)$/],
  ["subjective", /^(?:s|subjective)$/],
  ["objective", /^(?:o|objective)$/],
  ["assessment", /^(?:a|assessment|analysis|impression)$/],
  ["plan", /^(?:p|plan)$/],
  ["treatment", /^(?:treatment|treatment\s+given|intervention|interventions)$/],
  ["type", /^(?:type|appointment\s+type|session\s+type|visit\s+type|consultation\s+type|note\s+type|service)$/],
  ["status", /^(?:status|attendance|appointment\s+status|attended)$/],
  ["reason", /^(?:reason|cancellation\s+reason|dna\s+reason|status\s+reason)$/],
  ["patient", /^(?:patient|patient\s+name|client|client\s+name|name)$/],
  ["insurer", /^(?:insurer|insurance|insurance\s+company|funder|funding|payer)$/],
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
  return collapseSpaces(cell.slice(0, 80).toLowerCase().replace(/[.#:()*_]/g, " ")).trim();
}

function columnsByName(header: string[]): Array<Column | null> {
  const used = new Set<string>();
  return header.map((h) => {
    const n = normaliseHeaderCell(h);
    const hit = COLUMN_PATTERNS.find(([col, re]) => !used.has(col) && re.test(n));
    if (!hit) return null;
    used.add(hit[0]);
    return hit[0];
  });
}

const DATE_CELL = new RegExp(`^(${DATE_PATTERN})(?:,?\\s*(?:at\\s+)?(${TIME_PATTERN}))?$`, "i");

/** A table cell holding a date, or a date and time ("28/07/2026 08:30"). */
function dateCell(cell: string, now: Date): { date: ParsedDate; time: string | null } | null {
  const c = cell.trim();
  if (!c || c.length > 40) return null;
  const m = DATE_CELL.exec(c);
  if (!m) return null;
  const date = parseDateToken(m[1], now);
  return date ? { date, time: m[2] ? parseTimeToken(m[2]) : null } : null;
}

/**
 * The columns of a table whose first row is its header: by the header's names, then by content (fix wave 3) –
 * a column whose cells below are mostly dates is the date column, and with no note column named, the column of
 * longest text is the notes.
 */
function entryColumns(rows: string[][], now: Date): Array<Column | null> {
  const header = rows[0] ?? [];
  const cols = columnsByName(header);
  const body = rows.slice(1, 61).filter((r) => r.some((c) => c.trim()));
  if (!body.length) return cols;
  if (cols.indexOf("date") < 0) {
    let best = -1;
    let bestHits = 0;
    header.forEach((_, j) => {
      if (cols[j] && cols[j] !== "time") return;
      const cells = body.map((r) => (r[j] ?? "").trim()).filter(Boolean);
      const hits = cells.filter((c) => dateCell(c, now)).length;
      if (hits >= 2 && hits >= 0.6 * cells.length && hits > bestHits) {
        best = j;
        bestHits = hits;
      }
    });
    if (best >= 0) cols[best] = "date";
  }
  const named = cols.some((c) => c === "note" || c === "subjective" || c === "treatment" || c === "plan");
  if (cols.indexOf("date") >= 0 && !named) {
    let best = -1;
    let bestLen = 0;
    header.forEach((_, j) => {
      if (cols[j]) return;
      const cells = body.map((r) => (r[j] ?? "").trim()).filter(Boolean);
      if (!cells.length) return;
      const avg = cells.reduce((n, c) => n + Math.min(c.length, 2_000), 0) / cells.length;
      if (avg >= 25 && avg > bestLen && cells.some((c) => /\s/.test(c))) {
        best = j;
        bestLen = avg;
      }
    });
    if (best >= 0) cols[best] = "note";
  }
  return cols;
}

/** A header row of an entries table: a date column and a note, SOAP, clinician or status column. */
function isEntryColumns(cols: Array<Column | null>): boolean {
  return cols.indexOf("date") >= 0 && cols.some((c) => c === "note" || c === "subjective" || c === "clinician" || c === "treatment" || c === "plan" || c === "status");
}

/** The first of the top 25 rows that heads a table of entries, or -1. */
function findEntryHeaderRow(rows: string[][]): number {
  const now = new Date();
  for (let i = 0; i < rows.length && i < 25; i++) {
    if (rows[i].filter((c) => c.trim()).length < 2) continue;
    if (isEntryColumns(entryColumns(rows.slice(i), now))) return i;
  }
  return -1;
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
  /** An admin, reception or message entry (left out unless staff include it). */
  admin?: boolean;
  /** The entry's heading was a list item: the entry ends with the list. */
  bullet?: boolean;
  /** Lines of a dated score table inside the entry (their scores are read with the table's dates, never again). */
  scoreTableLines?: Set<string>;
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
  if (!rows.length) return null;
  const cols = entryColumns(rows, now);
  if (!isEntryColumns(cols)) return null;
  const header = rows[0];
  const at = (c: Column) => cols.indexOf(c);
  const cell = (r: string[], c: Column) => (at(c) >= 0 ? (r[at(c)] ?? "").trim() : "");
  const whereParts = /^(.*?)row (\d+)$/.exec(firstRowWhere);
  const wherePrefix = whereParts ? whereParts[1] : "";
  const rowBase = whereParts ? Number(whereParts[2]) : 1;
  const entries: RawEntry[] = [];
  let skipped = 0;
  const constants: TableRead["constants"] = {};
  const seen: Record<string, Set<string>> = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some((c) => c.trim())) continue;
    const where = `${wherePrefix}row ${rowBase + i}`;
    for (const k of ["patient", "dob", "insurer", "membership", "authorisation", "reference"] as const) {
      const v = cell(r, k);
      if (v && v.length <= 200) (seen[k] ??= new Set()).add(v);
    }
    const bodyParts: string[] = [];
    const note = at("note") >= 0 ? (r[at("note")] ?? "").replace(/\r\n?/g, "\n").trim() : "";
    if (note) bodyParts.push(note);
    for (const c of ["subjective", "objective", "assessment", "treatment", "plan"] as const) {
      const v = at(c) >= 0 ? (r[at(c)] ?? "").replace(/\r\n?/g, "\n").trim() : "";
      if (v) bodyParts.push(`${SOAP_COLUMN_LABEL[c]}: ${v}`);
    }
    const statusText = cell(r, "status");
    const statusRead = statusText ? statusPhrase(statusText) : null;
    const status = statusRead ? statusRead.status : null;
    if (statusText && !status) warnings.add("VALUE_UNCLEAR", `The status "${statusText.slice(0, 40)}" (${where}) was not recognised and was left out.`);
    const dateRead = dateCell(cell(r, "date"), now);
    const tableScores: RawEntry["tableScores"] = [];
    (["NPRS", "ODI", "NDI", "PSFS", "QuickDASH"] as const).forEach((inst) => {
      const written = cell(r, `score:${inst}`);
      if (!written) return;
      const raw = written.length > 20 ? "" : written.replace(/%$/, "").replace(/\s*\/\s*(?:10|100)$/, "").trim();
      const value = raw ? Number(raw) : Number.NaN;
      if (Number.isFinite(value) && withinRange(inst, value)) tableScores.push({ instrument: inst, value });
      else warnings.add("VALUE_UNCLEAR", `The ${inst} score "${written.slice(0, 20)}" (${where}) is not a valid score and was left out.`);
    });
    if (!bodyParts.length && !status) {
      skipped += 1;
      continue;
    }
    const clinicianText = cell(r, "clinician");
    const clinician = clinicianText ? parseClinicianText(clinicianText, true) : null;
    if (clinicianText && !clinician) warnings.add("VALUE_UNCLEAR", `The clinician "${clinicianText.slice(0, 60)}" (${where}) is not written as a name and was left out – choose one.`);
    const time = (cell(r, "time") ? parseTimeToken(cell(r, "time")) : null) ?? dateRead?.time ?? null;
    const typeText = cell(r, "type");
    const reasonText = cell(r, "reason") || (statusRead && statusRead.rest ? statusRead.rest : "");
    entries.push({
      where,
      date: dateRead ? dateRead.date : null,
      time,
      clinician: clinician && cell(r, "hcpc") && !clinician.hcpc ? { ...clinician, hcpc: cleanHcpc(cell(r, "hcpc")) } : clinician,
      hcpc: cell(r, "hcpc"),
      type: typeText ? noteTypeFrom(typeText) : null,
      status,
      reason: status && status !== "ATT" ? reasonText.slice(0, 300) : "",
      headingLines: [header.map((h, j) => (r[j] && ["date", "time", "clinician", "hcpc", "type", "status"].indexOf(String(cols[j])) >= 0 ? `${h}: ${r[j]}` : "")).filter(Boolean).join(" · ")],
      bodyLines: bodyParts.join("\n").split("\n"),
      fromTable: true,
      tableScores,
    });
  }
  if (skipped) warnings.add("ROW_SKIPPED", `${skipped} ${skipped === 1 ? "row has" : "rows have"} no note text and no status, and ${skipped === 1 ? "was" : "were"} left out.`);
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
    .map((cells) => cells.map((c) => collapseSpaces(c).trim()))
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
  // Sticky patterns read from a position without copying the text (linear on long notes).
  // (Sticky flags through the constructor: the project's TypeScript has no target for /…/y literals.)
  const filler = new RegExp("[^\\d\\n]{0,25}?(?=\\d)", "y");
  const item = new RegExp(
    `\\s*(?:from\\s+|was\\s+|of\\s+|now\\s+|is\\s+)?(\\d{1,3}(?:\\.\\d{1,2})?)(\\s*[-–]\\s*\\d)?\\s*(\\/\\s*(?:10|50|100)|%|out of (?:10|50|100))?(?:\\s*\\(?\\s*(?:on\\s+)?(${DATE_PATTERN})\\s*\\)?)?`,
    "iy",
  );
  const sep = new RegExp("\\s*(?:,|;|→|->|>|then|to|and|now)\\s*(?:then\\s+)?", "iy");
  const nextValue = new RegExp("(?:(?:from|was|of|now|is)\\s+)?\\s*\\d", "iy");
  for (const [instrument, labelSrc] of INSTRUMENT_LABELS) {
    const label = new RegExp(labelSrc, "gi");
    let m: RegExpExecArray | null;
    while ((m = label.exec(text))) {
      let pos = m.index + m[0].length;
      // Filler between the label and the value: "score", "average", ":", "=", "(avg)" – never another instrument.
      filler.lastIndex = pos;
      const f = filler.exec(text);
      if (!f || ANY_INSTRUMENT.test(f[0]) || /[.!?]\s/.test(f[0])) continue;
      pos += f[0].length;
      for (let n = 0; n < 6; n++) {
        item.lastIndex = pos;
        const it = item.exec(text);
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
          const date = it[4] ? parseDateToken(it[4], now) : null;
          out.push({ instrument, value, date: date ? date.iso : null, ambiguous: Boolean(it[2]) });
        }
        pos += it[0].length;
        sep.lastIndex = pos;
        const next = sep.exec(text);
        if (!next) break;
        nextValue.lastIndex = pos + next[0].length;
        if (!nextValue.exec(text)) break;
        pos += next[0].length;
      }
    }
  }
  return out;
}

/**
 * A table of outcome scores whose columns carry dates ("Measure | Initial (01/07/2026) | Latest (12/08/2026)"):
 * one score per cell, with its column's date. Null when the table is not one.
 */
function readScoreTable(rows: string[][], now: Date): Array<{ instrument: OutcomeInstrument; value: number; date: string }> | null {
  if (rows.length < 2) return null;
  const colDates = rows[0].map((h, j) => (j === 0 ? null : firstDateIn(h.slice(0, 80), now)));
  if (!colDates.some(Boolean)) return null;
  const out: Array<{ instrument: OutcomeInstrument; value: number; date: string }> = [];
  for (const r of rows.slice(1)) {
    const name = (r[0] ?? "").slice(0, 80);
    const inst = INSTRUMENT_LABELS.find(([, re]) => new RegExp(re, "i").test(name));
    if (!inst) continue;
    r.forEach((c, j) => {
      const date = colDates[j];
      if (!date || date.twoDigitYear) return;
      const raw = c.trim();
      if (!raw || raw.length > 20) return;
      const m = /^(\d{1,3}(?:\.\d{1,2})?)\s*(\/\s*(?:10|50|100)|%)?$/.exec(raw);
      if (!m) return;
      let value = Number(m[1]);
      if (m[2] && /50/.test(m[2])) {
        if (inst[0] !== "ODI" && inst[0] !== "NDI") return;
        value *= 2;
      }
      if (withinRange(inst[0], value)) out.push({ instrument: inst[0], value, date: date.iso });
    });
  }
  return out.length ? out : null;
}

/* ------------------------------------------------------------------------------------------------
 * Registration
 * ----------------------------------------------------------------------------------------------*/

const TITLES = /^(Mr|Mrs|Ms|Miss|Mx|Dr|Master|Prof)\.?$/i;
const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i;
const NAME_TOKEN = /^[A-Za-z][A-Za-z'’.-]*$/;

function tidy(value: string): string {
  return collapseSpaces(value).trim();
}

function canonicalTitle(t: string): string {
  const s = t.replace(/\.$/, "");
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** "Mrs Jane Example", "EXAMPLE, Jane", "Jane Example (DOB 01/02/1980)" → name parts, or null when unclear. */
export function parsePatientName(raw: string): { title: string; first: string; last: string } | null {
  let s = tidy(raw);
  if (s.length > 200) return null;
  s = s
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s*[,–—-]?\s*\b(?:DOB|D\.O\.B\.?|date of birth|born|NHS|patient (?:id|no|number)|ref|age|policy|membership|authori[sz]ation|auth|claim)\b.*$/i, "");
  s = tidy(trimEndWhere(s, spaceOr(",;:–—-")));
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

function inlineDob(line: string): RegExpExecArray | null {
  return line.length > STRUCTURE_LINE_CHARS ? null : INLINE_DOB.exec(tidy(line));
}

function firstDateIn(value: string, now?: Date): ParsedDate | null {
  const m = new RegExp(`(?:^|[^\\d/])(${DATE_PATTERN})(?![\\d/])`, "i").exec(tidy(value.slice(0, 300)));
  return m ? parseDateToken(m[1], now) : null;
}

function inferPartyType(name: string): InstructingPartyType | "" {
  if (/medico-?legal|medical report|\bmlc\b|\bagency\b/i.test(name)) return "mlc";
  if (/insur|assurance|health\s*care plan|healthcare\b|\bpmi\b/i.test(name)) return "insurer";
  if (/case manage/i.test(name)) return "case_manager";
  if (/solicitor|\blaw\b|legal|\bllp\b|lawyers?/i.test(name)) return "solicitor";
  return "";
}

/** An identifier: letters, digits and separators with at least one digit ("NFA-88213407", "AUTH-55120 (6 sessions)" → "AUTH-55120"). */
function identifier(value: string): string {
  const ok = (v: string) => (/^[A-Za-z0-9][A-Za-z0-9 /.\-]{1,39}$/.test(v) && /\d/.test(v) ? v : "");
  const v = tidy(value);
  if (v.length > 120) return "";
  const whole = ok(v);
  if (whole) return whole;
  const lead = /^([A-Za-z0-9][A-Za-z0-9/.\-]{2,39})(?:\s*\([^)]{0,60}\)|\s*[–—,;].{0,80})?$/.exec(v);
  return lead ? ok(lead[1]) : "";
}

/** "Northfield Assurance (fictional) – J. Barker, Claims Handler" → "Northfield Assurance (fictional)". */
function organisationOnly(value: string): string {
  const m = new RegExp(`^(.{2,200}?)\\s+[–—-]\\s+(?:(?:Mr|Mrs|Ms|Miss|Dr)\\.?\\s+)?(?:[A-Z]\\.\\s*){0,2}[A-Z][A-Za-z'’-]+(?:\\s+[A-Z][A-Za-z'’-]+)?(?:,\\s*[A-Za-z][A-Za-z ]{1,40})?$`).exec(value);
  return m && inferPartyType(m[1]) ? m[1].trim() : value;
}

/** Policy, membership, authorisation and claim numbers written inside a line ("Re: … – Policy NFA-77310288 – Authorisation AUTH-60412"). */
const INLINE_IDS =
  /\b(policy(?:\s+(?:no\.?|number))?|membership(?:\s+(?:no\.?|number))?|authori[sz]ation(?:\s+(?:no\.?|number|code))?|pre-?authori[sz]ation|auth\.?(?:\s+(?:no\.?|code))?|claim(?:\s+(?:no\.?|number|ref(?:erence)?))?)\s*[:#]?\s*([A-Z0-9][A-Z0-9/.\-]{3,39})\b/gi;

interface RegistrationRead {
  registration: NotesReviewRegistration;
  detected: Set<NotesReviewField>;
  fieldNotes: Partial<Record<NotesReviewField, string>>;
  /** Header lines that were not used. */
  other: string[];
  /** Header lines read as registration (never part of an undated block). */
  used: Set<number>;
}

function readRegistration(input: Array<{ text: string; where: string }>, now: Date, warnings: Warnings): RegistrationRead {
  const reg: NotesReviewRegistration = { ...EMPTY_REVIEW_REGISTRATION };
  const detected = new Set<NotesReviewField>();
  const fieldNotes: RegistrationRead["fieldNotes"] = {};
  const other: string[] = [];
  const used = new Set<number>();
  const set = (field: NotesReviewField, value: string) => {
    if (!value || (reg[field] as string)) return;
    (reg as Record<string, string>)[field] = value;
    detected.add(field);
  };
  let nameSeen = false;
  // A working copy: an address continuation line that also holds labels is read again for those labels.
  const lines = input.map((l) => ({ ...l }));

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text;
    if (text.length > STRUCTURE_LINE_CHARS) continue;
    const hits = splitRegistration(text);
    if (hits.length) used.add(i);
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
          readInlineIds(v);
          break;
        }
        case "firstName":
          if (v.length <= 100 && v.split(" ").every((t) => NAME_TOKEN.test(t))) set("firstName", tidy(v));
          break;
        case "lastName":
          if (v.length <= 100 && v.split(" ").every((t) => NAME_TOKEN.test(t))) set("lastName", tidy(v));
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
          if (v.length > 300) break;
          const parts = [v];
          // An address may continue on the next lines (no label, not a note heading, short) – in a two-column
          // patient box the continuation line also holds the right-hand column's labels ("Larkfield ZZ3 9LT
          // Employer: …"): the part before them continues the address, the labels are read in turn.
          for (let j = i + 1; j < lines.length && parts.length < 6; j++) {
            const next = lines[j].text.trim();
            if (!next || next.length > 200 || matchHeading(next)) break;
            const split = splitRegistrationWithLead(next);
            if (split.hits.length && !split.lead) break;
            const piece = split.hits.length ? split.lead : next;
            if (piece.length > 60 || /[.!?]$/.test(piece)) break;
            parts.push(piece);
            if (split.hits.length) {
              lines[j] = { ...lines[j], text: next.slice(next.indexOf(piece) + piece.length) };
              i = j - 1;
              break;
            }
            used.add(j);
            i = j;
          }
          let address = parts.map(tidy).filter(Boolean).join(", ");
          const pc = UK_POSTCODE.exec(address);
          if (pc && address.toUpperCase().endsWith(pc[1].toUpperCase())) {
            set("postcode", pc[1].toUpperCase().replace(/\s+/g, " ").replace(/^(\S+?)(\d[A-Z]{2})$/, "$1 $2"));
            address = trimEndWhere(address.slice(0, address.length - pc[1].length), spaceOr(","));
          }
          if (address.length >= 5 && address.length <= 300) set("address", address);
          break;
        }
        case "postcode": {
          const pc = /^([A-Z]{1,2}\d[A-Z\d]?)\s?(\d[A-Z]{2})$/i.exec(tidy(v));
          if (pc) set("postcode", `${pc[1]} ${pc[2]}`.toUpperCase());
          else if (v) warnings.add("VALUE_UNCLEAR", "The postcode could not be read clearly, so it was left blank.");
          break;
        }
        case "phone": {
          const m = /(\+44\s?\(?0?\)?\s?\d[\d\s]{7,12}\d|\b0\d[\d\s-]{7,12}\d)/.exec(tidy(v).slice(0, 60));
          const digits = m ? m[1].replace(/\D/g, "") : "";
          if (m && digits.length >= 10 && digits.length <= 13) set("phone", tidy(m[1]));
          break;
        }
        case "email": {
          const e = tidy(v).replace(/^<|>$/g, "");
          const m = e.length <= 254 ? /^[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}$/.exec(e) : null;
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
          if (v.length >= 2 && v.length <= 200 && /[A-Za-z]/.test(v)) set("insurerName", organisationOnly(tidy(v)));
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
          set("instructingPartyName", organisationOnly(tidy(v)));
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
      const m = inlineDob(text);
      if (m) {
        used.add(i);
        const d = parseDateToken(m[1]);
        if (d && d.twoDigitYear) warnings.add("DOB_TWO_DIGIT_YEAR", "The date of birth is written with a two-digit year, so it was left blank – enter it in full.");
        else if (d && d.iso >= "1900-01-01" && d.iso <= now.toISOString().slice(0, 10)) set("dob", d.iso);
      }
    }
    // A "Label: value" line with a label nobody reads ("Case: Lower back – injury at work"): an other detail.
    if (!hits.length && !used.has(i) && text.length <= NOTES_REVIEW_LIMITS.otherDetailChars && /^\s*[A-Za-z][\w .'/()&-]{0,30}:\s*\S/.test(text)) {
      other.push(tidy(text));
    }
  }
  if (nameSeen && !reg.lastName) warnings.add("VALUE_UNCLEAR", "The patient's name could not be read clearly, so it was left blank – enter it.");

  function readInlineIds(value: string): void {
    INLINE_IDS.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_IDS.exec(value.slice(0, 300)))) {
      const id = identifier(m[2]);
      if (!id) continue;
      const label = m[1].toLowerCase();
      if (/^(?:policy|membership)/.test(label)) set("membershipNumber", id);
      else if (/^claim/.test(label)) set("reference", id);
      else set("authorisationNumber", id);
    }
  }

  // Who the form is for: when no instructing party is written, an insurer (or a referral line naming a
  // solicitor, insurer, case manager or medico-legal company) is offered – marked for staff to check.
  if (!reg.instructingPartyName && reg.insurerName) {
    reg.instructingPartyName = reg.insurerName;
    reg.instructingPartyType = "insurer";
    fieldNotes.instructingPartyName = NOTES_REVIEW_COPY.fromInsurer;
  } else if (!reg.instructingPartyName && reg.referredBy && inferPartyType(reg.referredBy)) {
    reg.instructingPartyName = organisationOnly(reg.referredBy);
    reg.instructingPartyType = inferPartyType(reg.referredBy);
    fieldNotes.instructingPartyName = NOTES_REVIEW_COPY.fromReferrer;
  }
  if (reg.instructingPartyName && !reg.instructingPartyType) reg.instructingPartyType = "";
  return { registration: reg, detected, fieldNotes, other, used };
}

/* ------------------------------------------------------------------------------------------------
 * Lines → entries
 * ----------------------------------------------------------------------------------------------*/

const SIGNATURE_LABEL = /^\s*(?:signed|signature|e-?signed(?:\s+by)?|electronically signed(?:\s+by)?|digitally signed(?:\s+by)?|seen by|written by|entered by|author|clinician|practitioner|therapist)\s*(?:by)?\s*[:\-–]?\s*(.+)$/i;
const VALEDICTION = /^\s*(?:kind regards|best regards|regards|best wishes|many thanks|thanks|thank you|yours sincerely|yours faithfully|sincerely)[,.!]?\s*$/i;
const NOTES_LABEL = /^\s*(?:clinical\s+|treatment\s+|consultation\s+|session\s+)?notes?\s*[:\-–]\s*/i;
const SIGNATURE_LINE_CHARS = 300;

/** The clinician named by a signature at the end of a note, if any. */
function signatureClinician(body: string[]): ClinicianRef | null {
  const lines = body.map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-6);
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = tail[i];
    if (line.length > SIGNATURE_LINE_CHARS) continue;
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
    // "Sarah Reid (PH-DEMO-01)", or a closing "Sarah Reid, Physiotherapist" on the note's last line.
    const withHcpc = parseClinicianText(line, false);
    if (withHcpc && (withHcpc.hcpc || i === tail.length - 1)) return withHcpc;
    if (i > 0 && VALEDICTION.test(tail[i - 1])) {
      const c = parseClinicianText(line, true);
      if (c) {
        // "Sarah Reid" / "Physiotherapist, HCPC PH-DEMO-01": the registration number on the next lines.
        const after = tail.slice(i + 1).join(" ").slice(0, 400);
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
  reason: string;
  time: string | null;
  hcpc: string;
  admin: boolean;
  /** The heading's own text beyond date, time, type, clinician and status – part of the note. */
  leftover: string;
}

const HEADING_EDGE = spaceOr(":,|•·-–—");
const HEADING_TAIL = spaceOr("|•·-–—");

/** The text after a heading's date and time. */
function readHeadingRest(rest: string): HeadingRead {
  const out: HeadingRead = { clinician: null, type: null, status: null, reason: "", time: null, hcpc: "", admin: false, leftover: "" };
  let text = trimEndWhere(trimStartWhere(rest, HEADING_EDGE), HEADING_TAIL);
  if (!text) return out;
  // "Key: value" pairs inside the heading ("Time: 09:00 Practitioner: Sarah Reid").
  const kv = splitDetail(text);
  if (kv.length) {
    kv.forEach((h) => applyDetail(out, h));
    return out;
  }
  const kvFrom = text.length <= STRUCTURE_LINE_CHARS ? /\s(?=(?:practitioner|clinician|therapist|physiotherapist|seen by|time|type|status|hcpc)\s*:)/i.exec(text) : null;
  let tail: LabelHit[] = [];
  if (kvFrom) {
    tail = splitDetail(text.slice(kvFrom.index + 1));
    if (tail.length) text = text.slice(0, kvFrom.index);
  }
  tail.forEach((h) => applyDetail(out, h));
  // Segments separated by dashes, bars or bullets (commas only between short segments).
  const segments = splitHeadingSegments(text);
  const expanded: Array<{ text: string; start: number }> = [];
  for (const seg of segments) {
    // Commas split a segment only when every part is short ("Sarah Reid, Physiotherapist, Follow-up").
    const parts: Array<{ text: string; start: number }> = [];
    let from = 0;
    let depth = 0;
    for (let k = 0; k < seg.text.length; k++) {
      const ch = seg.text.charAt(k);
      if (ch === "(") depth += 1;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      else if (ch === "," && depth === 0 && isSpace(seg.text.charAt(k + 1))) {
        parts.push({ text: seg.text.slice(from, k), start: seg.start + from });
        from = k + 1;
        while (from < seg.text.length && isSpace(seg.text.charAt(from))) from += 1;
        k = from - 1;
      }
    }
    parts.push({ text: seg.text.slice(from), start: seg.start + from });
    if (parts.length > 1 && parts.every((p) => p.text.trim().split(/\s+/).length <= 5)) expanded.push(...parts);
    else expanded.push(seg);
  }
  let leftoverStart = -1;
  for (const seg of expanded) {
    if (seg.text.length > 200) {
      if (leftoverStart < 0) leftoverStart = seg.start;
      continue;
    }
    const whole = seg.text.trim().replace(/[.:]$/, "");
    if (!whole) continue;
    const t = whole.replace(/^[(\[]|[)\]]$/g, "");
    const clinician = parseClinicianText(whole, true);
    if (clinician && !out.clinician) {
      out.clinician = clinician;
      continue;
    }
    // "initial assessment (attended)", "Follow Up (30 min)": a status in brackets and a duration come off first.
    let core = whole;
    const bracketStatus = /^(.*?)\s*\(([^()]{1,120})\)$/.exec(core);
    if (bracketStatus) {
      const p = statusPhrase(bracketStatus[2]);
      if (p) {
        out.status ??= p.status;
        if (p.rest && p.status !== "ATT") out.reason ||= p.rest.slice(0, 300);
        core = bracketStatus[1].trim();
        if (!core) continue;
      }
    }
    core = core.replace(DURATION, "").trim();
    if (!core) continue;
    if (TYPE_SEGMENT.test(core)) {
      out.type ??= noteTypeFrom(core);
      continue;
    }
    if (ADMIN_SEGMENT.test(core)) {
      out.admin = true;
      continue;
    }
    const status = statusPhrase(core);
    if (status && (!status.rest || /^\(?[^()]{0,120}\)?$/.test(status.rest))) {
      out.status ??= status.status;
      if (status.rest && status.status !== "ATT") out.reason ||= status.rest.slice(0, 300);
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
    out.type ??= noteTypeFrom((out.leftover.slice(0, 200).split(/[.:;]/)[0] ?? "").replace(DURATION, ""));
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
      const m = new RegExp(`(${HCPC_ID})`, "i").exec(v.slice(0, 80));
      if (m) out.hcpc = cleanHcpc(m[1]);
      break;
    }
    case "time":
      out.time ??= parseTimeToken(v.slice(0, 40).split(/\s*[-–]\s*|\s+to\s+/)[0] ?? "");
      break;
    case "type":
      out.type ??= noteTypeFrom(v.slice(0, 200));
      if (ADMIN_SEGMENT.test(v.replace(DURATION, "").trim())) out.admin = true;
      break;
    case "status": {
      const p = statusPhrase(v);
      if (p) {
        out.status ??= p.status;
        if (p.rest && p.status !== "ATT") out.reason ||= p.rest.slice(0, 300);
      }
      break;
    }
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

/** "Status" / "Attendance" alone on a line (a printout's section heading). */
const STATUS_HEADING = /^\s*(?:status|attendance|appointment status)\s*:?\s*$/i;
/** A note body that starts with a missed or cancelled appointment ("Did Not Attend. No contact…", "Pt DNA"). */
const BODY_STATUS_START = /^\s*(?:(?:pt|patient)\s+)?(?:dna\b|d\.n\.a|did\s+not\s+(?:attend|arrive)|didn['’]t\s+attend|failed\s+to\s+attend|no[\s-]?show|late\s+cancel|cancel(?:l?ed)?\s+(?:appointment|appt|session|by\s+(?:phone|patient|pt)|<|within|less\s+than|on\s+the\s+day))/i;

/* ------------------------------------------------------------------------------------------------
 * The reader
 * ----------------------------------------------------------------------------------------------*/

type LineItem = { kind: "line"; text: string; where: string; bullet?: boolean; scoreTable?: boolean };
type Item = LineItem | { kind: "entries"; read: TableRead };

/** Days between two ISO dates. */
function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/** A heading date with no other note date within this many days (and at least two other notes) is suspect. */
const OUTLIER_DAYS = 400;

export function readGeneralNotes(input: GeneralNotesInput): GeneralNotesResult {
  const { now } = input;
  const warnings = new Warnings();
  const items: Item[] = [];
  let entryTables = 0;
  const tableConstants: TableRead["constants"] = {};
  const datedTableScores: Array<{ instrument: OutcomeInstrument; value: number; date: string }> = [];
  for (const block of input.blocks) {
    if (block.kind === "line") items.push(block);
    else {
      const read = readEntryTable(block.rows, block.where, now, warnings);
      if (read) {
        entryTables += 1;
        items.push({ kind: "entries", read });
        Object.assign(tableConstants, read.constants);
        continue;
      }
      if (input.format === "csv") continue;
      const scores = readScoreTable(block.rows, now);
      if (scores) datedTableScores.push(...scores);
      tableAsLines(block.rows, block.where).forEach((l) => items.push({ kind: "line", ...l, ...(scores ? { scoreTable: true } : {}) }));
    }
  }
  if (input.format === "csv" && !entryTables) {
    const table = input.blocks.find((b): b is Extract<NotesBlock, { kind: "table" }> => b.kind === "table");
    const names = (table?.rows.find((r) => r.filter((c) => c.trim()).length >= 2) ?? []).filter((c) => c.trim()).slice(0, 8).map((c) => `"${c.trim().slice(0, 30)}"`);
    return {
      ok: false,
      message: `No column of appointment dates was found in this file${names.length ? ` (columns: ${names.join(", ")})` : ""}. The file needs a column of dates – for example "Date", "Appointment date" or "Appointment start" – and a column with the notes or the attendance.`,
    };
  }

  const lines = items.filter((it): it is LineItem => it.kind === "line");

  // Headings first, so a line that starts like a date far from every other note (a wrapped "2/3/10, flares…") can
  // be kept as note text (fix wave 3).
  const headings: Array<Heading | null> = lines.map((l, i) => {
    if (l.text.length > STRUCTURE_LINE_CHARS * 4) return null;
    const h = matchHeading(l.text, now);
    return h && !isLetterDate(lines, i, h) ? h : null;
  });
  const letterLine = lines.findIndex((l, i) => {
    const h = matchHeading(l.text, now);
    return Boolean(h && isLetterDate(lines, i, h));
  });
  const letterDate = letterLine >= 0 ? matchHeading(lines[letterLine].text, now)?.date : undefined;
  const candidateDates = headings.map((h) => h?.date.iso ?? null);
  const outlier = new Set<number>();
  candidateDates.forEach((d, i) => {
    if (!d) return;
    const others = candidateDates.filter((x, j): x is string => Boolean(x) && j !== i);
    if (others.length >= 2 && others.every((x) => daysApart(x, d) > OUTLIER_DAYS)) outlier.add(i);
  });

  const preamble: Array<{ text: string; where: string }> = [];
  const orphan: Array<{ text: string; where: string }> = [];
  const raw: RawEntry[] = [];
  let current: RawEntry | null = null;
  let inDetail = false;
  let emptyDateLines = 0;
  let lineIdx = -1;
  let addressee: string[] = [];
  let collectingAddressee = false;

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
    if (lineIdx === letterLine) {
      collectingAddressee = true;
      continue;
    }
    if (collectingAddressee) {
      const t = text.trim();
      if (/^(?:dear\b|to whom|re\s*:)/i.test(t) || addressee.length >= 6) collectingAddressee = false;
      else if (t && t.length <= 120) addressee.push(t);
    }
    const heading = headings[lineIdx];
    if (heading && outlier.has(lineIdx)) {
      const uk = ukDate(heading.date.iso);
      warnings.add("DATE_OUTLIER", `A line starting “${collapseSpaces(text).trim().slice(0, 24)}…” looked like a date (${uk}) far from every other note's date, so it was kept as part of the note above it – check it.`);
    } else if (heading) {
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
        reason: rest.reason,
        headingLines: [text.trim()],
        bodyLines: rest.leftover ? [rest.leftover] : [],
        fromTable: false,
        tableScores: [],
        ...(rest.admin ? { admin: true } : {}),
        ...(it.bullet || BULLET_LINE.test(text.slice(0, 8)) ? { bullet: true } : {}),
      };
      inDetail = true;
      continue;
    }
    // A bulleted entry ends with its list: the next paragraph that is not a list item (a Word list), or a line
    // after a blank one (plain text), is not part of it.
    const lastBody = current ? current.bodyLines[current.bodyLines.length - 1] : undefined;
    if (current && current.bullet && text.trim() && !it.bullet && (input.format === "docx" || (lastBody !== undefined && !lastBody.trim()))) {
      close();
    }
    if (!current) {
      if (raw.length) orphan.push(it);
      else preamble.push(it);
      continue;
    }
    if (it.scoreTable) (current.scoreTableLines ??= new Set()).add(text);
    if (inDetail) {
      const t = text.trim();
      if (t && t.length <= 160) {
        const hits = splitDetail(t);
        if (hits.length) {
          const read: HeadingRead = { clinician: current.clinician, type: current.type, status: current.status, reason: current.reason, time: current.time, hcpc: current.hcpc, admin: Boolean(current.admin), leftover: "" };
          hits.forEach((h) => applyDetail(read, h));
          Object.assign(current, { clinician: read.clinician, type: read.type, status: read.status, reason: read.reason, time: read.time, hcpc: read.hcpc });
          if (read.admin) current.admin = true;
          current.headingLines.push(t);
          continue;
        }
        const bare = !current.clinician && current.bodyLines.length === 0 ? parseClinicianText(t, false) : null;
        if (bare && bare.hcpc) {
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
    else if (d && d.iso <= now.toISOString().slice(0, 10)) fromTable("dob", d.iso);
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
  // A letter addressed to an insurer, solicitor, case manager or medico-legal company: offered as who the form is for.
  if (!reg.instructingPartyName) {
    const org = addressee.find((l) => inferPartyType(l) && !/\d{3}/.test(l));
    if (org) {
      reg.instructingPartyName = organisationOnly(tidy(org)).slice(0, 200);
      reg.instructingPartyType = inferPartyType(org);
      regRead.fieldNotes.instructingPartyName = NOTES_REVIEW_COPY.fromAddressee;
      if (reg.instructingPartyType === "insurer" && !reg.insurerName) {
        reg.insurerName = reg.instructingPartyName;
        regRead.fieldNotes.insurerName = NOTES_REVIEW_COPY.fromAddressee;
      }
    }
  }

  // Text before the first note (other than registration and title lines), and text after the last entry that no
  // dated heading claimed, become blocks without a date: left out unless staff give them one. (Undated table
  // rows – a date cell that could not be read – stay where they are.)
  const preambleUsed = regRead.used;
  const undatedBlock = (group: Array<{ text: string; where: string }>, isPreamble: boolean): RawEntry[] => {
    const s = group.filter(
      (l, i) =>
        l.text.trim() &&
        !(isPreamble && preambleUsed.has(i)) &&
        !splitRegistration(l.text.trim()).length &&
        !/^\s*[A-Za-z][\w .'/()&-]{0,30}:\s/.test(l.text.slice(0, 40)) &&
        !inlineDob(l.text) &&
        !isTitleLike(l.text) &&
        !(isPreamble && addressee.indexOf(l.text.trim()) >= 0),
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
  // The orphan block keeps every line from the first one with text (a letter's closing and signature included).
  const orphanBlock = (): RawEntry[] => {
    const start = orphan.findIndex((l) => l.text.trim());
    if (start < 0) return [];
    const body = orphan.slice(start).map((l) => l.text);
    if (body.join(" ").trim().length < 40) return [];
    return [{ where: orphan[start].where, date: null, time: null, clinician: null, hcpc: "", type: null, status: null, reason: "", headingLines: [], bodyLines: body, fromTable: false, tableScores: [] }];
  };
  const all: RawEntry[] = [...undatedBlock(preamble, true), ...raw, ...orphanBlock()];

  if (!all.length) {
    return {
      ok: false,
      message: 'No notes were found. Each note needs its date at the start of a line, for example "18/03/2026" or "18 March 2026".',
    };
  }

  // A letter: its signature names the clinician of every entry that names none (staff are told).
  const letterSigner = letterDate ? signatureClinician(all[all.length - 1].bodyLines) : null;

  // Entries.
  const entries: NotesReviewEntry[] = [];
  let truncated = false;
  const signedByLetter: string[] = [];
  const leftOutAdmin: string[] = [];
  all.forEach((e, idx) => {
    const key = `E-${idx + 1}`;
    let body = e.bodyLines.join("\n");
    if (body.length > NOTES_REVIEW_LIMITS.entryChars) {
      if (e.date) return void (truncated = true);
      body = body.slice(0, NOTES_REVIEW_LIMITS.entryChars);
      warnings.add("TRUNCATED", "A long block of text without a date was shortened in this review.");
    }
    let clinician = e.clinician;
    if (!clinician && letterSigner && e.date) {
      clinician = letterSigner;
      signedByLetter.push(key);
    }
    if (e.admin) leftOutAdmin.push(key);
    entries.push({
      key,
      date: e.date ? e.date.iso : "",
      time: e.time ?? "",
      clinicianName: clinician?.name ?? "",
      clinicianHcpc: clinician?.hcpc ?? "",
      type: e.type ?? "other",
      status: e.status ?? "",
      reason: e.reason,
      heading: e.headingLines.join("\n").slice(0, 4_000),
      body,
      where: e.where.slice(0, 40),
      include: Boolean(e.date) && !e.admin,
    });
  });
  if (truncated) return { ok: false, message: `One note is longer than ${NOTES_REVIEW_LIMITS.entryChars.toLocaleString("en-GB")} characters. Check that the notes have a date at the start of each entry.` };
  if (signedByLetter.length && letterSigner) {
    warnings.add(
      "SIGNATURE_APPLIED",
      `The letter is signed by ${letterSigner.name}, so ${signedByLetter.length === 1 ? "the entry that names no clinician has" : `the ${signedByLetter.length} entries that name no clinician have`} that clinician – check ${signedByLetter.length === 1 ? "it" : "them"}.`,
      signedByLetter,
    );
  }
  if (leftOutAdmin.length) {
    warnings.add(
      "ADMIN_LEFT_OUT",
      `${leftOutAdmin.length === 1 ? "1 admin or message entry was" : `${leftOutAdmin.length} admin or message entries were`} left out (${leftOutAdmin.map((k) => ukDate(entries.find((x) => x.key === k)?.date ?? "")).join(", ")}) – tick Include to use ${leftOutAdmin.length === 1 ? "it" : "them"}.`,
      leftOutAdmin,
    );
  }

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
    const skip = e.scoreTableLines;
    const scanned = skip ? entry.body.split("\n").filter((l) => !skip.has(l)).join("\n") : entry.body;
    const mentions = findScores([entry.heading, scanned].join("\n"), now);
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
  // Scores from a table whose columns carry dates: each with its column's date, linked to the entry of that date
  // (else the nearest dated entry), never read again from the table's text.
  if (datedTableScores.length) {
    const dated = entries.filter((e) => e.date && e.include);
    for (const s of datedTableScores) {
      const host = dated.find((e) => e.date === s.date) ?? dated.slice().sort((a, b) => daysApart(a.date, s.date) - daysApart(b.date, s.date))[0];
      if (!host) continue;
      const k = `${s.instrument}|${s.date}`;
      const own = host.date === s.date;
      const prev = byInstrumentDate.get(k);
      if (prev && prev.own && !own) continue;
      byInstrumentDate.set(k, { instrument: s.instrument, value: s.value, date: own ? "" : s.date, entryKey: host.key, own });
    }
    const names = Array.from(new Set(datedTableScores.map((s) => s.instrument)));
    warnings.add("SCORE_TABLE", `${names.join(" and ")} ${names.length === 1 ? "was" : "were"} read from a table with a date on each column – check the scores and their dates.`);
  }
  byInstrumentDate.forEach((o) => outcomes.push({ instrument: o.instrument, value: o.value, date: o.date, entryKey: o.entryKey }));
  outcomes.sort((a, b) => a.instrument.localeCompare(b.instrument) || entryOrder(a.entryKey) - entryOrder(b.entryKey));

  // Warnings shown with the review (the Studio recounts the clinician and date ones as staff edit).
  const noClinician = entries.filter((e) => e.include && !e.clinicianName);
  if (noClinician.length) warnings.add("NO_CLINICIAN", NOTES_REVIEW_COPY.noClinician(noClinician.length), noClinician.map((e) => e.key));
  const noDate = entries.filter((e) => !e.date);
  if (noDate.length) warnings.add("NO_DATE", NOTES_REVIEW_COPY.noDate(noDate.length), noDate.map((e) => e.key));
  if (emptyDateLines) {
    warnings.add("EMPTY_DATE_LINE", `${emptyDateLines} ${emptyDateLines === 1 ? "date stands" : "dates stand"} alone on a line with no note under ${emptyDateLines === 1 ? "it" : "them"} and ${emptyDateLines === 1 ? "was" : "were"} ignored.`);
  }

  // Attendance: every included dated entry with a status and a time (a table's status column, or the headings).
  const attendance = reviewAttendance({ entries }).on;

  const other = regRead.other.slice(0, NOTES_REVIEW_LIMITS.otherDetails).map((l) => l.slice(0, NOTES_REVIEW_LIMITS.otherDetailChars));
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
    ...(other.length ? { otherDetails: other } : {}),
    ...(letterDate && !letterDate.twoDigitYear ? { letterDate: letterDate.iso } : {}),
  };
  return { ok: true, review };
}

function finishEntry(e: RawEntry): void {
  // Blank lines around the note go; a bare "Notes:" label line at its start goes; the rest is kept as written.
  while (e.bodyLines.length && !e.bodyLines[0].trim()) e.bodyLines.shift();
  while (e.bodyLines.length && !e.bodyLines[e.bodyLines.length - 1].trim()) e.bodyLines.pop();
  if (e.bodyLines.length && e.bodyLines[0].length <= STRUCTURE_LINE_CHARS && NOTES_LABEL.test(e.bodyLines[0]) && !e.fromTable) {
    const rest = e.bodyLines[0].replace(NOTES_LABEL, "");
    if (rest.trim()) e.bodyLines[0] = rest;
    else {
      e.headingLines.push(e.bodyLines.shift() as string);
      while (e.bodyLines.length && !e.bodyLines[0].trim()) e.bodyLines.shift();
    }
  }
  // A missed or cancelled appointment written at the start of the note ("Status" / "Did Not Attend. No contact…").
  if (!e.status && !e.fromTable && e.bodyLines.length) {
    const first = e.bodyLines[0].trim();
    const line = STATUS_HEADING.test(first.slice(0, 40)) && e.bodyLines.length > 1 ? e.bodyLines[1].trim() : first;
    if (line.length <= STRUCTURE_LINE_CHARS && (BODY_STATUS_START.test(line.slice(0, 80)) || (line !== first && statusPhrase(line)))) {
      const p = statusPhrase(line);
      if (p) {
        e.status = p.status;
        if (p.status !== "ATT" && p.rest) e.reason = p.rest.slice(0, 300);
      }
    }
  }
  if (!e.clinician && !e.fromTable) e.clinician = signatureClinician(e.bodyLines);
  else if (e.clinician && !e.clinician.hcpc && !e.hcpc && !e.fromTable) {
    // "Amara Okafor (Physiotherapist)" in the heading, "Electronically signed by Amara Okafor MCSP, HCPC …" below.
    const signed = signatureClinician(e.bodyLines);
    if (signed && signed.hcpc && sameName(signed.name, e.clinician.name)) e.clinician = { ...e.clinician, hcpc: signed.hcpc };
  }
  if (e.clinician && !e.clinician.hcpc && e.hcpc) e.clinician = { ...e.clinician, hcpc: e.hcpc };
}

function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(new RegExp(`^${NAME_TITLE}\\s+`), "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

function entryOrder(key: string): number {
  return Number(key.slice(2));
}

function ukDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
