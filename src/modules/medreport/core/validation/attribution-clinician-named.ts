/**
 * The wrong clinician named (plan WB design 9, C-ATTR-2; DoC I3): a clinician from the record's list, named as the
 * subject of a record or clinical act (recorded, noted, documented, wrote, stated, reported, said, found, assessed,
 * examined, measured, observed, treated, advised, discharged, diagnosed, concluded …), as the holder of "<Name>'s
 * assessment / opinion / examination / findings", as the source of "according to <Name>" / "…, per <Name>", or in an
 * attribution suffix "(<Name>, 06/05/2026)" – by full name or by title and surname ("Mr Ellis"), with or without a
 * role between ("Tom Ellis, our senior physiotherapist, recorded") – must have written a note the paragraph cites –
 * one of that date when the sentence gives a date ("On 06/05/2026 Sarah Reid recorded …" citing only Tom Ellis's note
 * of 06/05 is Tom Ellis's finding under Sarah Reid's name; "On 18/03/2026 Tom Ellis recorded …" citing his note of
 * 06/05 dates it wrongly). An act told in the passive ("seen by Tom Ellis", "treated by Tom Ellis") is the cited
 * note's account of that clinician's act when a cited note mentions them. A GP or anyone else the record does not list
 * is left alone (check-WB M4 widened the verbs and forms). harden-WB (check2-WB N3): only a date that dates the act –
 * before the name as a lead ("On 06/05/2026 Tom Ellis recorded"), straight after the act ("recorded on", "note of",
 * "(06/05/2026)") or in the suffix – must be a cited note's date; a date inside what is reported ("Tom Ellis recorded
 * that he twisted his knee on 22/08/2026") needs that clinician's cited note to give it or be of it. A first-person act
 * the sentence dates ("On 12/03/2026 I recorded …") must be of a cited note of the owner's own.
 *
 * OTHER_CLINICIAN_VOICE, blocking. Drafted text: never acknowledged (the wording must say who recorded it, and when).
 * Text a person edited or wrote: only the approving clinician may acknowledge it (ackPolicy "approver"). No subject is
 * ever substituted by a click.
 *
 * Registered in registry.ts (VALIDATORS "attribution-clinician-named"). Owner: WB – docs/bh2-ownership.json.
 */
import { formatUkDate } from "../dates";
import type { Note, ReportFlag } from "../types";
import { clinicianNames, noteMentions, sameName } from "./attribution-text";
import { firstPersonOverColleagues, type ColleagueClause } from "./attribution-voice";
import { getValidationContext, hasText, makeFlag, voiceOwnerOf } from "./context";
import { authorshipOf } from "./opinion-language";
import type { Validator } from "./registry";
import { splitSentences } from "../text/sentences";
import { escapeRegExp } from "./text";

/** A record or clinical act a clinician is said to have done (the attribution verbs of attribution-text.ts and more). */
const ACT_VERBS =
  "recorded|noted|documented|wrote|written|stated|reported|said|observed|found|measured|assessed|examined|described|explained|advised|recommended|discharged|treated|reviewed|concluded|confirmed|diagnosed|saw|identified|considered|felt|thought|believed|opined|commented|indicated|graded|tested|palpated|elicited|summarised|summarized";
const PASSIVE_VERBS = "recorded|noted|documented|written|stated|reported|observed|found|measured|assessed|examined|seen|treated|reviewed|discharged|diagnosed|confirmed|graded|tested";
const HOLDS = "assessment|opinion|examination|findings?|impression|diagnosis|view|clinical impression|discharge note|note|notes|record|records|letter|report|conclusion|summary|plan";
/** A role or description between the name and the verb: ", our senior physiotherapist," / " (physiotherapist)". */
const ROLE = "(?:,\\s*[^,;.()\\n]{2,60}?,|\\s*\\([^()\\n]{2,40}\\))?";
const UK_DATE_SRC = "\\d{2}\\/\\d{2}\\/\\d{4}";
const UK_DATE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;

export interface NamedAct {
  name: string;
  /** The ISO date the sentence gives for it, or null. */
  date: string | null;
  /**
   * How the date is given (check2-WB N3): "record" – it dates the act ("On 06/05/2026 Tom Ellis recorded", "Tom Ellis
   * recorded on 06/05/2026", "Tom Ellis's note of 06/05/2026", the suffix "(Tom Ellis, 06/05/2026)"), so a cited note of
   * that clinician must be of that date; "content" – a date inside what is reported ("Tom Ellis recorded that she
   * started a phased return on 28/09/2026"), which that clinician's cited note must give or be of.
   */
  dateRole?: "record" | "content";
  /** The words that name it ("Sarah Reid, physiotherapist, recorded", "Sarah Reid's assessment"). */
  words: string;
  /** Told in the passive ("seen by Tom Ellis"): the cited note's own account when it mentions that clinician. */
  passive?: boolean;
}

function isoOf(m: RegExpExecArray): string {
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** The clause around [start, end) of a sentence: back to and up to ; or ", and" (a second dated act starts there). */
function clauseBounds(text: string, start: number, end: number): [number, number] {
  let a = start;
  while (a > 0 && !/;/.test(text.charAt(a - 1)) && !/,\s*and\s+$/.test(text.slice(Math.max(0, a - 6), a))) a -= 1;
  let b = end;
  while (b < text.length && !/[;]/.test(text.charAt(b)) && !/^,\s*and\s/.test(text.slice(b, b + 6))) b += 1;
  return [a, b];
}

/** Before the name: a lead that dates the act – "On 06/05/2026", "At the review on 06/05/2026", "In his note of 06/05/2026". */
const LEAD_BEFORE_DATE =
  /(?:^\s*|[;:.]\s*|,\s*|\s(?:and|but|then)\s+)(?:on|at (?:the |his |her |their |my |this |that )?(?:[a-z-]+ ){0,3}?(?:assessment|review|appointment|session|visit|consultation|discharge|follow-up)(?: on)?|in (?:his|her|their|the|that|this) (?:[a-z-]+ ){0,2}?(?:note|notes|assessment|review|record|letter)(?: of| on| dated)?|dated)\s*$/i;
/** Between a lead date and the name: nothing but a comma or a short occasion ("On 06/05/2026, at the review, Tom Ellis"). */
const LEAD_GAP = /^\s*,?\s*(?:(?:at|during|in) (?:the|his|her|their|a|an|that|this) [a-z -]{1,30},\s*)?$/i;
/** After the act words: "on <date>" straight after the verb (and its object pronoun), "of/on/dated <date>", or "(<date>)". */
const DATE_AFTER_ACT = /^\s*(?:(?:him|her|them|mr\.? [a-z'’-]+|mrs\.? [a-z'’-]+|ms\.? [a-z'’-]+|miss [a-z'’-]+|mx\.? [a-z'’-]+|the patient|the claimant|the client)\s+)?(?:(?:on|of|dated)\s+|\(\s*)(\d{2})\/(\d{2})\/(\d{4})/i;

/**
 * The date a sentence gives for a named act and how (check2-WB N3): a date inside the act's own words (the suffix
 * "(Tom Ellis, 06/05/2026)"), a lead before the name, or "on / of <date>" straight after the act dates the record; failing
 * those, the first date after the name in its clause is a date in what is reported ("Tom Ellis recorded that he twisted
 * his knee on 22/08/2026") – the wrong-clinician check then asks only that the clinician's cited note give it or be of it.
 */
function actDate(clause: string, rel: number, relEnd: number, words: string): { date: string | null; role: "record" | "content" } {
  const own = new RegExp(UK_DATE.source).exec(words);
  if (own) return { date: isoOf(own), role: "record" };
  let lead: RegExpExecArray | null = null;
  for (const d of Array.from(clause.matchAll(UK_DATE))) {
    const at = d.index ?? 0;
    if (at >= rel) break;
    if (LEAD_BEFORE_DATE.test(clause.slice(0, at)) && LEAD_GAP.test(clause.slice(at + d[0].length, rel))) lead = d as RegExpExecArray;
  }
  if (lead) return { date: isoOf(lead), role: "record" };
  const after = DATE_AFTER_ACT.exec(clause.slice(relEnd));
  if (after) return { date: `${after[3]}-${after[2]}-${after[1]}`, role: "record" };
  const later = new RegExp(UK_DATE.source).exec(clause.slice(relEnd));
  if (later) return { date: isoOf(later), role: "content" };
  // A date before the name that does not lead the act ("Following the incident on 01/09/2026, Tom Ellis recorded …").
  let before: RegExpExecArray | null = null;
  for (const d of Array.from(clause.matchAll(UK_DATE))) if ((d.index ?? 0) < rel) before = d as RegExpExecArray;
  return before ? { date: isoOf(before), role: "content" } : { date: null, role: "record" };
}

/** Whether a note's own text gives the ISO date (as the notes write it, dd/mm/yyyy). */
function noteGivesDate(note: Note, iso: string): boolean {
  const [y, mo, d] = iso.split("-");
  const uk = `${d}/${mo}/${y}`;
  return [note.subjective, note.objective, note.assessment, note.plan, note.freeText ?? ""].some((f) => (f ?? "").includes(uk));
}

export interface NamedActOptions {
  /** The patient's surname: "Mr Testcase" is never a clinician. */
  patientSurname?: string | null;
}

/** How a sentence may name `name`: in full, or by title and surname when no other clinician or the patient shares it. */
function nameSource(name: string, people: readonly string[], opts: NamedActOptions): string {
  const full = escapeRegExp(name).replace(/ /g, "\\s+");
  const surname = name.trim().split(/\s+/).pop() ?? "";
  const shared = people.some((p) => p !== name && (p.trim().split(/\s+/).pop() ?? "").toLowerCase() === surname.toLowerCase());
  const patient = (opts.patientSurname ?? "").trim().toLowerCase() === surname.toLowerCase();
  if (surname.length < 2 || shared || patient || surname === name.trim()) return full;
  return `(?:${full}|(?:Dr|Mr|Mrs|Ms|Miss|Mx)\\.?\\s+${escapeRegExp(surname)})`;
}

/** The clinicians a sentence names as doing a clinical act or holding an assessment, with the date it gives. */
export function namedActs(sentence: string, people: readonly string[], opts: NamedActOptions = {}): NamedAct[] {
  const out: NamedAct[] = [];
  for (const name of people) {
    const N = nameSource(name, people, opts);
    const res: Array<[RegExp, boolean]> = [
      [new RegExp(`\\b${N}${ROLE}\\s+(?:also\\s+|then\\s+|later\\s+|again\\s+|clearly\\s+|subsequently\\s+)?(?:${ACT_VERBS})\\b`, "gi"), false],
      [new RegExp(`\\b${N}['’]s?\\s+(?:[a-z-]+\\s+){0,2}?(?:${HOLDS})\\b`, "gi"), false],
      [new RegExp(`\\b(?:according to|as per|per)\\s+${N}\\b`, "gi"), false],
      [new RegExp(`\\(\\s*${N}(?:,\\s*(?:[^()\\n]{0,40}?,\\s*)?${UK_DATE_SRC})?\\s*\\)`, "gi"), false],
      [new RegExp(`\\b(?:${PASSIVE_VERBS})\\s+(?:[a-z]+\\s+){0,2}?by\\s+${N}\\b`, "gi"), true],
    ];
    for (const [re, passive] of res) {
      for (const m of Array.from(sentence.matchAll(re))) {
        const start = m.index ?? 0;
        const end = start + m[0].length;
        const [a, b] = clauseBounds(sentence, start, end);
        const clause = sentence.slice(a, b);
        const { date, role } = actDate(clause, start - a, end - a, m[0]);
        if (out.some((o) => o.name === name && o.words === m[0] && o.date === date)) continue;
        out.push({ name, date, words: m[0], ...(date ? { dateRole: role } : {}), ...(passive ? { passive } : {}) });
      }
    }
  }
  return out;
}

/**
 * First-person acts that a date governs ("On 12/03/2026 I recorded …", "I recorded on 12/03/2026 …", "my note of
 * 12/03/2026"): the owner's own record misdated (harden-WB – "Write in my own voice" must not turn a misdated "Sarah Reid
 * recorded" into an unchecked "I recorded"). Only a date that dates the act counts; a date in what is reported is the
 * figure check's.
 */
export function firstPersonDatedActs(sentence: string): Array<{ date: string; words: string }> {
  const out: Array<{ date: string; words: string }> = [];
  const res = [
    new RegExp(`\\b(?:I|[Ww]e)\\s+(?:also\\s+|then\\s+|later\\s+|again\\s+|subsequently\\s+)?(?:${ACT_VERBS})\\b`, "g"),
    new RegExp(`\\b(?:my|our)\\s+(?:[a-z-]+\\s+){0,2}?(?:${HOLDS})\\b`, "gi"),
  ];
  for (const re of res) {
    for (const m of Array.from(sentence.matchAll(re))) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      const [a, b] = clauseBounds(sentence, start, end);
      const { date, role } = actDate(sentence.slice(a, b), start - a, end - a, m[0]);
      if (date && role === "record" && !out.some((o) => o.date === date)) out.push({ date, words: m[0] });
    }
  }
  return out;
}

/** What is wrong with a named act given the cited notes, or null. */
export function wrongClinician(act: NamedAct, cited: readonly Note[]): string | null {
  const theirs = cited.filter((n) => sameName(n.author.name, act.name));
  if (theirs.length === 0) {
    const writers = Array.from(new Set(cited.map((n) => n.author.name)));
    return `This answer says ${act.name} recorded it (“${act.words}”), but the note${cited.length === 1 ? "" : "s"} it cites ${cited.length === 1 ? "was" : "were"} written by ${writers.join(" and ") || "someone else"}. Name the clinician who recorded it.`;
  }
  if (act.date && !theirs.some((n) => n.date === act.date)) {
    if (act.dateRole === "content") {
      // A date in what is reported: the clinician's own cited note gives it ("twisted his right knee on 22/08/2026").
      if (theirs.some((n) => noteGivesDate(n, act.date as string))) return null;
      return `This answer gives ${formatUkDate(act.date)} in what ${act.name} recorded (“${act.words}”), but no cited note of ${act.name}'s is of that date or gives it (${theirs.map((n) => formatUkDate(n.date)).join(", ")}). Check the date, or name the clinician whose note records it.`;
    }
    return `This answer dates ${act.name}'s record to ${formatUkDate(act.date)}, but no cited note of that date is ${act.name}'s (${theirs.map((n) => formatUkDate(n.date)).join(", ")}). Give the date of the note that records it.`;
  }
  return null;
}

export const validateClinicianNamed: Validator = (input) => {
  const ctx = getValidationContext(input);
  const people = clinicianNames(input.bundle);
  const flags: ReportFlag[] = [];
  for (const { paragraph: p, section } of ctx.paragraphs) {
    if (!hasText(p)) continue;
    const who = authorshipOf(p, input.report, section);
    if (who === "approver" || who === "record") continue;
    const cited = p.sourceIds.filter((id) => /^N-\d+$/.test(id)).map((id) => input.bundle.notes.find((n) => n.id === id)).filter((n): n is Note => Boolean(n));
    if (cited.length === 0) continue;
    const seen = new Set<string>();
    const patientSurname = input.bundle.registration?.lastName ?? null;
    const owner = voiceOwnerOf(input);
    const ownNotes = owner ? cited.filter((n) => sameName(n.author.name, owner.name)) : [];
    let clauses: ColleagueClause[] | null | undefined;
    const voiceClauses = (): ColleagueClause[] => (clauses === undefined ? (clauses = owner ? firstPersonOverColleagues(p, input.bundle, owner) : null) : clauses) ?? [];
    for (const s of splitSentences(p.text, "prose")) {
      // The owner's own record, misdated in the first person (a first person over a colleague's note is the voice check's).
      for (const act of ownNotes.length ? firstPersonDatedActs(s.text) : []) {
        if (ownNotes.some((n) => n.date === act.date) || seen.has(`I|${act.date}`)) continue;
        // Fix round 1 (R1T-WB-09/11): a date only a colleague's cited note has is that colleague's clause in the owner's
        // "I" – the voice check's one flag (attribution-voice.ts firstPersonOverColleagues: a clause dated to a colleague's
        // note alone), answered by its "Name <colleague>" one-click. A second flag for the same words would leave that
        // one-click unofferable (it would clear a blocking flag it does not answer).
        if (cited.some((n) => !ownNotes.includes(n) && n.date === act.date) && voiceClauses().some((c) => !c.namesColleague && p.text.slice(c.start, c.end).includes(formatUkDate(act.date)))) continue;
        seen.add(`I|${act.date}`);
        const flag = makeFlag({
          code: "OTHER_CLINICIAN_VOICE",
          severity: "blocking",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: `dates my record ${formatUkDate(act.date)}`,
          message: `This answer dates your record to ${formatUkDate(act.date)} (“${act.words}”), but no cited note of yours is of that date (${ownNotes.map((n) => formatUkDate(n.date)).join(", ")}). Give the date of the note that records it.`,
        });
        flag.ackPolicy = who === "drafted" ? "never" : "approver";
        flags.push(flag);
      }
      for (const act of namedActs(s.text, people, { patientSurname })) {
        // "Seen by Tom Ellis" over a cited note that mentions him is that note's account of his act.
        if (act.passive && !cited.some((n) => sameName(n.author.name, act.name)) && cited.some((n) => noteMentions(n, act.name))) continue;
        const problem = wrongClinician(act, cited);
        const key = `${act.name}|${act.date ?? ""}`;
        if (!problem || seen.has(key)) continue;
        seen.add(key);
        const flag = makeFlag({ code: "OTHER_CLINICIAN_VOICE", severity: "blocking", sectionKey: section.key, paragraphId: p.id, evidence: `names ${act.name}${act.date ? ` ${formatUkDate(act.date)}` : ""}`, message: problem });
        flag.ackPolicy = who === "drafted" ? "never" : "approver";
        flags.push(flag);
      }
    }
  }
  return flags;
};
