/**
 * Session dates and times: which questions of a form map ask for a value the appointments in the record hold, and the
 * runtime fill for maps that do not say so explicitly (WE, plan WE designs 4 and 5).
 *
 * 1. sessionQuestionOf(field) – the one classifier for "this question asks for the Nth attended session's date or
 *    time, the first appointment's date or time, or the list of attended session dates". It is used where a person
 *    reviews it: the map lint (core/form-map-lint.ts L6 suggests the record path) and the mapping page. A map then
 *    says so explicitly with the record paths episode.attendedDate / episode.attendedTime {index, of},
 *    episode.firstSeen / episode.firstSeenTime and episode.attendedDates {fromSession, of?} (core/forms/record-paths.ts
 *    resolves them).
 * 2. sessionDatesByCode – the runtime fill (fix round 3, B2-19, re-implemented here behind corpus and unit cases) for a
 *    map that does NOT say so: a drafted ("notes_narrative") session-date question is filled from the attended
 *    appointments instead of being drafted (one was left out, a list came out of order). It applies only to maps
 *    without any explicit episode.attended* / episode.firstSeenTime field (a map that names the record paths is the
 *    single source of truth: its other boxes are drafted as the map says), never to a clinician's opinion box, and
 *    never on an initial assessment form (the record there is as at that assessment), and never for a question that
 *    asks for the missed appointments too (fix round 1, R1T-WE-01: the attended appointments alone leave out what such
 *    a box asks for, and a box filled by code cannot be corrected on the review; it is drafted from the notes, as
 *    production does). createFormReport (core/report-factory.ts, WA1) asks it for every drafted box (seam
 *    "session-dates-call-site").
 *
 * Pure; browser and server.
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
import { compareIsoDateTime, formatUkDate } from "./dates";
import { reportKindOf } from "./forms";
import type { ComputedFact, EpisodeBundle, FormDefinition, FormField, FrozenCondition, RegistrationPath, ReportSection } from "./types";

/* ------------------------------------------------------------------------------------------------
 * The classifier
 * ----------------------------------------------------------------------------------------------*/

/** What a question asks of the appointments in the record (null: none of these). */
export type SessionQuestion =
  /** The Nth attended session's date or time ("Session 4 – date", "Treatment date 7", "Session time 3"). */
  | { kind: "session_date" | "session_time"; n: number; afterAssessment: boolean }
  /** The first appointment's date or time ("Date first seen", "Initial assessment time"). */
  | { kind: "first_date" | "first_time" }
  /** Every attended session's date, as a list ("Dates of the visits", "Attended session dates"). */
  | { kind: "session_dates"; afterAssessment: boolean };

const SESSION_WORD = String.raw`(?:session|treatment|appointment|visit|attendance)`;
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

/** The session number a label names ("Session 4 – date", "Session date 4", "Treatment date 7", "4th session"), or null. */
export function sessionNumberOf(label: string): number | null {
  const t = label.replace(/\s+/g, " ").trim();
  const patterns = [
    new RegExp(String.raw`\b${SESSION_WORD}s?\s*(?:no\.?|number|#)?\s*(\d{1,2})\b`, "i"),
    new RegExp(String.raw`\b${SESSION_WORD}\s+(?:date|time)\s*(\d{1,2})\b`, "i"),
    new RegExp(String.raw`\b(?:date|time)\s+of\s+${SESSION_WORD}\s*(?:no\.?|number)?\s*(\d{1,2})\b`, "i"),
    new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)\s+${SESSION_WORD}\b`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m) {
      const n = Number(m[1]);
      return n >= 1 && n <= 99 ? n : null;
    }
  }
  const word = new RegExp(String.raw`\b(${Object.keys(ORDINALS).join("|")})\s+${SESSION_WORD}\b`, "i").exec(t);
  // "first session" is the first appointment (first_date / first_time), not a numbered session.
  if (word && word[1].toLowerCase() !== "first") return ORDINALS[word[1].toLowerCase()];
  return null;
}

/**
 * Fix round 1 (R1T-WE-01, Ascenti ML EOTS F-31): words that name an appointment the patient did not attend – a failure
 * to attend, a DNA, a no-show, a missed or a cancelled appointment, a non-attendance.
 */
const MISSED_APPOINTMENT = /\b(?:fail(?:ure|ures|ed|s)?\s+to\s+attend|did\s+not\s+attend|non[-\s]?attend(?:ance|ances|ed)?|not\s+attended|unattended|missed|d\.?n\.?a\.?s?|no[-\s]?shows?|(?:late\s+)?cancel(?:l?ed|l?ations?|s)?)\b/i;
/** "…excluding DNAs", "except cancellations", "not counting missed ones": the words name what is left out. */
const LEFT_OUT_BEFORE = /\b(?:excluding|excludes?|except(?:\s+for)?|not\s+(?:including|counting|listing)|other\s+than|apart\s+from|without|leaving\s+out|leave\s+out|omit(?:ting)?)\b[^.;:()\n]*$/i;

/**
 * Fix round 1 (R1T-WE-01): whether the question asks for the appointments the patient did NOT attend as well ("All
 * appointment dates, any missed ones included", guidance "mark the ones not attended") – read from its printed label
 * and its guidance. The attended appointments alone would leave out what it asks for, so such a question is never "the
 * attended sessions" (sessionQuestionOf): it is drafted from the notes, which the physio can correct, never filled by
 * code from the attended sessions only (production drafted it). Words that say what is left out ("excluding DNAs",
 * "not counting cancellations") do not count.
 */
export function asksForMissedAppointments(field: Pick<FormField, "label"> & Partial<Pick<FormField, "guidance">>): boolean {
  for (const text of [field.label, field.guidance ?? ""]) {
    const t = text.replace(/\s+/g, " ").slice(0, 2000);
    const re = new RegExp(MISSED_APPOINTMENT.source, "gi");
    for (let m = re.exec(t); m; m = re.exec(t)) {
      if (!LEFT_OUT_BEFORE.test(t.slice(Math.max(0, m.index - 60), m.index))) return true;
    }
  }
  return false;
}

const DURATION = /\b(?:length|duration|how long|minutes?|mins?|hours?)\b/i;
const AFTER_ASSESSMENT = /\bafter the (?:initial |first )?assessment\b/i;
const FIRST_APPOINTMENT = new RegExp(String.raw`\b(?:first|initial)\s+(?:seen|attended|attendance|appointment|assessment|consultation|${SESSION_WORD})\b|\b(?:date|time)\s+(?:first\s+)?(?:seen|attended)\b|\bfirst\s+seen\b`, "i");
const SESSION_LIST = new RegExp(
  String.raw`^(?:the\s+)?dates?\s+of\s+(?:the\s+|all\s+|each\s+|every\s+)?(?:attended\s+)?(?:treatment\s+)?(?:${SESSION_WORD}s?)\b|\b(?:attended\s+|treatment\s+)?${SESSION_WORD}\s+dates\b`,
  "i",
);

/**
 * What the question asks of the appointments in the record, read from its printed label (and, for "after the
 * assessment", its guidance) – or null. A duration ("Session length", "Duration of sessions") is not a record value, and
 * nor is a list or a numbered appointment that includes the missed ones (asksForMissedAppointments, fix round 1
 * R1T-WE-01): the record paths and the fill by code hold the attended appointments only.
 */
export function sessionQuestionOf(field: Pick<FormField, "label" | "answerType"> & Partial<Pick<FormField, "guidance">>, extra = ""): SessionQuestion | null {
  const label = field.label.replace(/\s+/g, " ").trim();
  // A record value is a date, a time or a list of dates – never a yes/no, a tick or a choice ("was a session given on
  // this date?").
  if (!(field.answerType === "date" || field.answerType === "short_text" || field.answerType === "long_text")) return null;
  if (DURATION.test(label)) return null;
  const afterAssessment = AFTER_ASSESSMENT.test(`${field.guidance ?? ""} ${extra}`);
  const isTime = /\btimes?\b/i.test(label) && !/\bdates?\b/i.test(label);
  const isDate = /\bdates?\b/i.test(label) || field.answerType === "date";
  if (!isTime && !isDate) return null;
  // Fix round 1 (R1T-WE-01): a list (or the Nth appointment) that includes the missed appointments is not a question
  // about the attended sessions – the record path and the fill by code would leave the missed ones out.
  const missedToo = asksForMissedAppointments({ label, guidance: field.guidance ?? "" });
  if (isDate && field.answerType !== "date" && (field.answerType === "long_text" || field.answerType === "short_text") && SESSION_LIST.test(label)) {
    return missedToo ? null : { kind: "session_dates", afterAssessment };
  }
  if (FIRST_APPOINTMENT.test(label)) return { kind: isTime ? "first_time" : "first_date" };
  const n = sessionNumberOf(label);
  if (n === null || missedToo) return null;
  return { kind: isTime ? "session_time" : "session_date", n, afterAssessment };
}

/** The record path (and part) a map should name for this question – what the map lint suggests. */
export function suggestedRecordPath(q: SessionQuestion, of?: number): { path: RegistrationPath; part?: { index: number; of: number }; sessions?: { fromSession: number } } {
  switch (q.kind) {
    case "first_date":
      return { path: "episode.firstSeen" };
    case "first_time":
      return { path: "episode.firstSeenTime" };
    case "session_dates":
      return { path: "episode.attendedDates", sessions: { fromSession: q.afterAssessment ? 2 : 1 } };
    case "session_date":
    case "session_time": {
      const index = q.n + (q.afterAssessment ? 1 : 0);
      return { path: q.kind === "session_date" ? "episode.attendedDate" : "episode.attendedTime", part: { index, of: Math.max(index, of ?? index) } };
    }
  }
}

/** Record paths that name the appointments explicitly: a map with any of them says itself where session values go. */
const EXPLICIT_SESSION_PATHS: ReadonlySet<string> = new Set(["episode.attendedDate", "episode.attendedTime", "episode.attendedDates", "episode.firstSeenTime"]);

/** Whether the map names its session values explicitly (plan WE design 4: then the runtime fill never applies). */
export function mapsSessionsExplicitly(fields: ReadonlyArray<Pick<FormField, "fillSource">>): boolean {
  return fields.some((f) => f.fillSource.kind === "registration" && EXPLICIT_SESSION_PATHS.has(f.fillSource.path));
}

/* ------------------------------------------------------------------------------------------------
 * The runtime fill for maps without explicit session paths (B2-19)
 * ----------------------------------------------------------------------------------------------*/

/** What createFormReport hands over for one drafted box. */
export interface SessionDatesInput {
  field: FormField;
  form: Pick<FormDefinition, "title" | "fields">;
  bundle: Pick<EpisodeBundle, "appointments">;
  computedFacts: readonly ComputedFact[];
  /** The box's condition as frozen at creation (WA1 design 3), once WA1 passes it; absent until then. */
  condition?: FrozenCondition | null;
}

/** A box the record answers: its text (cited), and the structured answer for a date question. */
export interface SessionDatesAnswer {
  text: string;
  sourceIds: string[];
  answer?: ReportSection["answer"];
}

/**
 * The session dates the record holds for this drafted box, or null: not a session-date question, a clinician's opinion
 * box, an initial assessment form, a map that names its session values explicitly, or no such session in the record
 * (then the box is drafted as before – never guessed).
 */
export function sessionDatesByCode(input: SessionDatesInput): SessionDatesAnswer | null {
  const { field, form, bundle, computedFacts } = input;
  if (field.fillSource.kind !== "notes_narrative") return null;
  if (reportKindOf(form.title) === "initial") return null;
  if (mapsSessionsExplicitly(form.fields)) return null;
  const q = sessionQuestionOf(field, input.condition?.text ?? "");
  if (!q || (q.kind !== "session_date" && q.kind !== "session_dates")) return null;
  const attended = bundle.appointments.filter((a) => a.status === "ATT").sort(compareIsoDateTime);
  if (attended.length === 0) return null;
  const sessions = q.afterAssessment ? attended.slice(1) : attended;
  const cite = (list: typeof attended) => {
    const notes = Array.from(new Set(list.map((a) => a.noteId).filter((id): id is string => Boolean(id))));
    return notes.length > 0 ? notes : computedFacts.some((f) => f.id === "FACT-attendance") ? ["FACT-attendance"] : [];
  };
  if (q.kind === "session_date") {
    if (field.answerType !== "date") return null;
    const appt = sessions[q.n - 1];
    return appt ? { text: formatUkDate(appt.date), sourceIds: cite([appt]), answer: { kind: "date", value: appt.date } } : null;
  }
  if (sessions.length === 0) return null;
  return { text: sessions.map((a) => formatUkDate(a.date)).join(", "), sourceIds: cite(sessions) };
}
