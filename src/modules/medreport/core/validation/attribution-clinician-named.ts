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
 * is left alone (check-WB M4 widened the verbs and forms).
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
import { getValidationContext, hasText, makeFlag } from "./context";
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
        // The date of the act: the nearest one before the name in its clause ("On 06/05/2026 Tom Ellis recorded"), else
        // the first after it ("Tom Ellis discharged him on 06/05/2026", "Priya Shah's assessment (01/09/2026)").
        // A date inside the words themselves ("(Tom Ellis, 06/05/2026)", "Tom Ellis's assessment (01/09/2026)") wins.
        const own = new RegExp(UK_DATE.source).exec(m[0]);
        let date: string | null = own ? isoOf(own) : null;
        const rel = start - a;
        if (!date) {
          for (const d of Array.from(clause.matchAll(UK_DATE))) {
            if ((d.index ?? 0) < rel) date = isoOf(d as RegExpExecArray);
          }
        }
        if (!date) {
          const after = new RegExp(UK_DATE.source).exec(clause.slice(rel));
          if (after) date = isoOf(after);
        }
        if (out.some((o) => o.name === name && o.words === m[0] && o.date === date)) continue;
        out.push({ name, date, words: m[0], ...(passive ? { passive } : {}) });
      }
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
    const who = authorshipOf(p, input.report);
    if (who === "approver" || who === "record") continue;
    const cited = p.sourceIds.filter((id) => /^N-\d+$/.test(id)).map((id) => input.bundle.notes.find((n) => n.id === id)).filter((n): n is Note => Boolean(n));
    if (cited.length === 0) continue;
    const seen = new Set<string>();
    const patientSurname = input.bundle.registration?.lastName ?? null;
    for (const s of splitSentences(p.text, "prose")) {
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
