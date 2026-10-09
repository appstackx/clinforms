/**
 * Wording helpers for drafted answers (pure; browser and server):
 *
 * 1. rewriteInFirstPerson(): the referrer's form is the SIGNING clinician's own report. A drafted
 *    paragraph that attributes the signer's own notes in the third person ("On 22/09/2026 Tom Ellis,
 *    physiotherapist, recorded that in his opinion…") reads as a third party's report when Tom Ellis
 *    signs it. This rewrites exactly those attributions into the first person ("On 22/09/2026 I
 *    recorded that, in my opinion, …"). Other clinicians stay named. Dates, figures and quotations are
 *    untouched, so the citation and figure checks give the same result.
 *    Used by the review's "Write in my own voice" action (origin becomes "edited", the AI wording is
 *    kept for "Revert to AI draft").
 *
 * 2. expandNoteShorthand(): note shorthand that slips into drafted answers ("2x/wk", "1 hr", ">15 kg",
 *    "HR/OH") and clinical abbreviations ("NPRS", "AROM", "HEP", "LBP") are written out in plain words,
 *    keeping every number, and clinicians' job titles get the casing the clinic record uses. Applied to
 *    every drafted paragraph and gap (ai/assemble.ts).
 *
 * 3. describeSourceIds(): a record ID that slips into drafted text ("…every 30–45 minutes in N-010",
 *    "The final review (N-010) records…") is replaced by what a reader recognises: the note's date
 *    ("in the note of 22/09/2026", "(22/09/2026)"). The IDs stay in sourceIds / relatedNoteIds.
 */
import { formatUkDate } from "./dates";
import type { EpisodeBundle, Paragraph } from "./types";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Verbs a clinician does (never the patient), for "She recorded" → "I recorded". */
const CLINICIAN_VERBS = "recorded|assessed|advised|observed|explained|reassured|recommended|discharged|documented|examined|measured|tested|taught|issued|noted|planned|referred";

/** ", Senior Physiotherapist" / ", physiotherapist, MCSP" after a name (without the closing comma). */
const ROLE = "(?:,\\s*(?:[Ss]enior\\s+|[Ee]xtended [Ss]cope\\s+|[Cc]linical [Ss]pecialist\\s+)?[Pp]hysiotherapists?(?:,?\\s*MCSP)?)?";

/** Apply `fn` to each sentence (keeps the punctuation and spacing between sentences). */
function eachSentence(text: string, fn: (sentence: string) => string): string {
  return text.replace(/[^.!?]+(?:[.!?]+|$)\s*/g, (sentence) => fn(sentence));
}

/**
 * Rewrite the signer's own attributions into the first person. `authorName` exactly as it appears in
 * the text (e.g. "Sarah Reid"). Returns the text unchanged when it does not name the author.
 */
export function rewriteInFirstPerson(text: string, authorName: string): string {
  const name = authorName.trim();
  if (!name || text.indexOf(name) < 0) return text;
  const N = escapeRe(name);
  let s = text;

  // "Sarah Reid's" → "my"
  s = s.replace(new RegExp(`\\b${N}['’]s\\b`, "g"), "my");
  // "told Tom Ellis, physiotherapist, that" / "reported to Sarah Reid, Senior Physiotherapist, …" / "by …"
  // The role's commas were a pair around it ("told Tom Ellis, physiotherapist, that"): drop the closing
  // one with the role – except after "by", where it usually closes an introductory clause.
  s = s.replace(new RegExp(`\\b(told|to|by|with)\\s+${N}(${ROLE})(,?)(?=\\s|$)`, "g"), (_m, prep: string, role: string, comma: string) =>
    `${prep} me${role && prep !== "by" ? "" : comma}`,
  );
  // "Tom Ellis, physiotherapist, recorded" → "I recorded" (the name is the subject of a verb)
  s = s.replace(new RegExp(`\\b${N}${ROLE},?\\s+(?=[a-z])`, "g"), "I ");
  // "She recorded" / "he advised" in the same paragraph → "I recorded" (clinician verbs only).
  s = s.replace(new RegExp(`\\b(?:She|He|she|he)\\s+((?:also|then|later|again)\\s+)?(${CLINICIAN_VERBS})\\b`, "g"), "I $1$2");
  // "She found no tenderness" (an examination finding), not "she found driving difficult".
  s = s.replace(/\b(?:She|He|she|he)\s+((?:also\s+)?found)\s+(?=no\b|that\b|full\b|reduced\b|normal\b|increased\b|tenderness\b|mild\b)/g, "I $1 ");

  // Possessives in sentences where "I" is the subject: "in his opinion" → "in my opinion".
  s = eachSentence(s, (sentence) =>
    /\bI\s+[a-z]/.test(sentence)
      ? sentence
          .replace(/\bI recorded that,? in (?:his|her) opinion,?\s*/g, "I recorded that, in my opinion, ")
          .replace(/\b(?:his|her) (opinion|assessment|view|advice|recommendation|return-to-work recommendation|discharge note|clinical impression)\b/g, "my $1")
      : sentence,
  );

  // "At the final review on 07/07/2026, I recorded" → "At my final review on 07/07/2026, I recorded"
  return s.replace(/\bAt the (initial assessment|final review|discharge review|follow-up review|review|discharge)( on \d{2}\/\d{2}\/\d{4})?(,?) I\b/g, "At my $1$2$3 I");
}

/** N-* note IDs a paragraph cites. */
function citedNoteIds(p: Pick<Paragraph, "sourceIds">): string[] {
  return p.sourceIds.filter((id) => /^N-\d+$/.test(id));
}

/**
 * Whether a drafted paragraph only reports the author's OWN notes and names the author: then it can be
 * written in the author's voice. (A paragraph that also cites another clinician's note keeps names.)
 */
export function isOwnVoiceCandidate(p: Pick<Paragraph, "text" | "sourceIds" | "origin">, bundle: Pick<EpisodeBundle, "notes">, authorName: string): boolean {
  const author = authorName.trim();
  if (p.origin !== "ai" || !author || p.text.indexOf(author) < 0) return false;
  const ids = citedNoteIds(p);
  if (ids.length === 0) return false;
  if (!ids.every((id) => bundle.notes.find((n) => n.id === id)?.author.name === author)) return false;
  // A paragraph that also names another clinician keeps everyone's names (no "I and Sarah Reid…").
  const others = Array.from(new Set(bundle.notes.map((n) => n.author.name))).filter((n) => n !== author);
  return !others.some((n) => p.text.indexOf(n) >= 0);
}

/* ------------------------------------------------------------------------------------------------
 * Note shorthand and job titles
 * ----------------------------------------------------------------------------------------------*/

const NUM = "\\d+(?:\\.\\d+)?(?:\\s?[–-]\\s?\\d+(?:\\.\\d+)?)?";

const SHORTHAND: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  [new RegExp(`\\b(${NUM})\\s?x\\s?/\\s?(?:wk|week)\\b`, "g"), "$1 times a week"],
  [new RegExp(`\\b(${NUM})\\s?x\\s?/\\s?(?:day|d)\\b`, "g"), "$1 times a day"],
  [new RegExp(`\\b(${NUM})\\s?x\\s?/\\s?(?:month|mth)\\b`, "g"), "$1 times a month"],
  [new RegExp(`\\b(${NUM})\\s?(?:hrs?|hours?)\\b`, "g"), (_m, n: string) => `${n} ${n.trim() === "1" ? "hour" : "hours"}`],
  [new RegExp(`\\b(${NUM})\\s?mins?\\b`, "g"), (_m, n: string) => `${n} ${n.trim() === "1" ? "minute" : "minutes"}`],
  [new RegExp(`\\b(${NUM})\\s?wks?\\b`, "g"), (_m, n: string) => `${n} ${n.trim() === "1" ? "week" : "weeks"}`],
  [/(^|[\s(])>\s?(?=\d)/g, "$1more than "],
  [/(^|[\s(])<\s?(?=\d)/g, "$1less than "],
  [/(^|[\s(])≥\s?(?=\d)/g, "$1at least "],
  [/(^|[\s(])≤\s?(?=\d)/g, "$1no more than "],
  [/\bHR\/OH\b/g, "HR and occupational health"],
  [/\bHR\/occupational health\b/g, "HR and occupational health"],
];

/**
 * Clinical abbreviations from physiotherapy notes, written out on the referrer's form. Only these exact
 * upper-case tokens, standing alone: never inside a reference ("HP/RTA/2291", "KCM-RTW-01") or a word.
 * Well-known ones (GP, HR, HCPC, MCSP) and spinal levels (C3/4, L4–L5) stay as written.
 *
 * This is the one glossary: the drafting prompts (ai/prompts.ts, ai/form-prompts.ts) tell the drafting
 * service to KEEP these abbreviations as the notes write them, so their full forms always come from here
 * and are never generated (a generated expansion once read "whale-associated disorder" for WAD), and the
 * TERM_NOT_IN_SOURCE validator checks drafted text against these full forms. Adding an entry changes
 * the prompts: bump their versions.
 */
export const CLINICAL_ABBREVIATIONS: ReadonlyArray<readonly [abbreviation: string, fullForm: string]> = [
  ["NPRS", "Numeric Pain Rating Scale"],
  ["VAS", "visual analogue scale"],
  ["NDI", "Neck Disability Index"],
  ["ODI", "Oswestry Disability Index"],
  ["PSFS", "Patient-Specific Functional Scale"],
  ["AROM", "active range of movement"],
  ["PROM", "passive range of movement"],
  ["ROM", "range of movement"],
  ["HEP", "home exercise programme"],
  ["TTP", "tenderness on palpation"],
  ["NAD", "no abnormality detected"],
  ["LBP", "low back pain"],
  ["WAD", "whiplash-associated disorder"],
  ["RTA", "road traffic accident"],
  ["LOC", "loss of consciousness"],
  ["STM", "soft tissue mobilisation"],
  ["SNAGs", "sustained natural apophyseal glides"],
  ["SNAG", "sustained natural apophyseal glide"],
  ["CCFT", "cranio-cervical flexion test"],
  ["FRT", "flexion-rotation test"],
  ["MSK", "musculoskeletal"],
  ["RTW", "return to work"],
];

/** Not part of a longer token: letters, digits, "/", "-", "–" or "." joined to it. */
const EDGE_BEFORE = "(^|[^A-Za-z0-9/\\-–.])";
const EDGE_AFTER = "(?![A-Za-z0-9/\\-–]|\\.[A-Za-z0-9])";

/** Whether `offset` starts a sentence in `whole`. */
function atSentenceStart(whole: string, offset: number): boolean {
  return /(?:^|[.!?]\s+|\n\s*)$/.test(whole.slice(0, offset));
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "II", "grade II", "3" after WAD. */
const WAD_GRADE = "(?:grade )?(I{1,3}|IV|[1-4])";

/**
 * Write out the abbreviations above, fixing "a"/"an" before them ("an RTA" → "a road traffic accident"),
 * and keep a full form given next to its abbreviation only once: "Neck Disability Index (NDI)" and
 * "SNAGs (sustained natural apophyseal glides)" both become the full form alone.
 */
export function expandClinicalAbbreviations(text: string): string {
  let s = text;
  for (const [abbr, full] of CLINICAL_ABBREVIATIONS) {
    if (s.indexOf(abbr) < 0) continue;
    s = s.replace(new RegExp(`(${escapeRe(full)})\\s*\\(${abbr}\\)`, "gi"), "$1");
    // "NPRS (Numeric Pain Rating Scale)" / "WAD II (whiplash-associated disorder grade II)" → the bracket.
    const grade = abbr === "WAD" ? `(?: ${WAD_GRADE})?` : "()";
    s = s.replace(new RegExp(`${EDGE_BEFORE}${abbr}${grade}\\s*\\(([^()]+)\\)`, "g"), (m, pre: string, g: string | undefined, inner: string, offset: number, whole: string) => {
      const said = inner.trim();
      if (said.toLowerCase().indexOf(full.toLowerCase()) !== 0) return m;
      const written = atSentenceStart(whole, offset + pre.length) ? capitalise(said) : said;
      return `${pre}${written}${g && !/\bgrade\b/i.test(said) ? ` grade ${g}` : ""}`;
    });
    if (abbr === "WAD") s = s.replace(new RegExp(`${EDGE_BEFORE}WAD ${WAD_GRADE}${EDGE_AFTER}`, "g"), (_m, pre: string, g: string) => `${pre}WAD grade ${g}`);
    s = s.replace(new RegExp(`${EDGE_BEFORE}(?:([Aa]n?) )?${abbr}${EDGE_AFTER}`, "g"), (_m, pre: string, article: string | undefined, offset: number, whole: string) => {
      const start = atSentenceStart(whole, offset + pre.length);
      if (article) {
        const a = /^[aeiou]/i.test(full) ? "an" : "a";
        return `${pre}${article === article.toLowerCase() ? a : capitalise(a)} ${full}`;
      }
      return `${pre}${start ? capitalise(full) : full}`;
    });
  }
  return s;
}

/** Expand note shorthand and clinical abbreviations into plain words; every number is kept as written. */
export function expandNoteShorthand(text: string): string {
  let s = text;
  for (const [re, to] of SHORTHAND) s = typeof to === "string" ? s.replace(re, to) : s.replace(re, to as (...m: string[]) => string);
  return expandClinicalAbbreviations(s);
}

/** "Tom Ellis, physiotherapist" → "Tom Ellis, Physiotherapist" when the record gives that title. */
export function normaliseJobTitles(text: string, bundle: Pick<EpisodeBundle, "clinicians" | "notes">): string {
  const people = new Map<string, string>();
  for (const c of bundle.clinicians) if (c.role) people.set(c.name, c.role);
  for (const n of bundle.notes) if (n.author.role && !people.has(n.author.name)) people.set(n.author.name, n.author.role);
  let s = text;
  people.forEach((role, name) => {
    const title = role.split(",")[0].trim();
    if (!title) return;
    s = s.replace(new RegExp(`\\b${escapeRe(name)}, (${escapeRe(title)})\\b`, "gi"), (m, found: string) => (found === title ? m : `${name}, ${title}`));
  });
  return s;
}

/* ------------------------------------------------------------------------------------------------
 * Record IDs in drafted text
 * ----------------------------------------------------------------------------------------------*/

const NOTE_ID = "N-\\d{3,}";
const FACT_ID = "FACT-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*";
const ANY_ID = `(?:${NOTE_ID}|${FACT_ID}|REG)`;
const ID_EDGE_BEFORE = "(^|[^A-Za-z0-9\\-/])";
const ID_EDGE_AFTER = "(?![A-Za-z0-9/]|-[A-Za-z0-9])";
const ID_JOIN = "\\s*(?:,|;|&|\\band\\b|\\.\\.|–|—|\\bto\\b)\\s*";

export interface SourceIdNames {
  notes: ReadonlyArray<{ id: string; date: string }>;
  facts?: ReadonlyArray<{ id: string; label: string }>;
}

/**
 * Replace record IDs in text meant for a reader with what they recognise: a note by its date, a computed
 * fact by its name, "REG" as the registration record. IDs that are not in `names` are left as written.
 */
export function describeSourceIds(text: string, names: SourceIdNames): string {
  if (!/N-\d|FACT-|REG/.test(text)) return text;
  const noteDate = (id: string) => {
    const n = names.notes.find((x) => x.id === id);
    return n ? formatUkDate(n.date) : "";
  };
  const factName = (id: string) => {
    const label = names.facts?.find((f) => f.id === id)?.label?.trim();
    if (!label) return "";
    return label.indexOf(" – ") > 0 ? label.split(" – ").slice(1).join(" – ") : label.charAt(0).toLowerCase() + label.slice(1);
  };
  /** "22/09/2026" / "attendance" / "registration" – the short name used inside brackets and lists. */
  const short = (id: string) => (id === "REG" ? "registration record" : id.startsWith("FACT-") ? factName(id) : noteDate(id));
  const long = (id: string) => {
    if (id === "REG") return "the registration record";
    if (id.startsWith("FACT-")) return factName(id) ? `the ${factName(id)} record` : "";
    return noteDate(id) ? `the note of ${noteDate(id)}` : "";
  };
  let s = text;
  // "(N-010)", "(N-001, N-006)", "(N-002..N-007)" → "(22/09/2026)", "(18/06/2026, 22/09/2026)", "(25/03/2026 to 20/05/2026)".
  s = s.replace(new RegExp(`\\(\\s*(${ANY_ID}(?:${ID_JOIN}${ANY_ID})*)\\s*\\)`, "g"), (m, list: string) => {
    const ids = list.match(new RegExp(ANY_ID, "g")) ?? [];
    const named = ids.map(short);
    if (named.some((x) => !x)) return m;
    const range = new RegExp(`${NOTE_ID}\\s*(?:\\.\\.|–|—|\\bto\\b)\\s*${NOTE_ID}`).test(list) && ids.length === 2;
    return `(${range ? named.join(" to ") : named.join(", ")})`;
  });
  // "N-002..N-007" / "notes N-002 to N-007" → "the notes of 25/03/2026 to 20/05/2026".
  s = s.replace(new RegExp(`${ID_EDGE_BEFORE}(?:([Tt]he) )?(?:[Nn]otes? )?(${NOTE_ID})\\s*(?:\\.\\.|–|—|\\bto\\b)\\s*(${NOTE_ID})${ID_EDGE_AFTER}`, "g"), (m, pre: string, the: string | undefined, a: string, b: string, offset: number, whole: string) => {
    if (!noteDate(a) || !noteDate(b)) return m;
    const between = /\bbetween\s*$/i.test(whole.slice(0, offset + pre.length));
    const out = `the notes of ${noteDate(a)} ${between ? "and" : "to"} ${noteDate(b)}`;
    return `${pre}${(the && the !== "the") || atSentenceStart(whole, offset + pre.length) ? capitalise(out) : out}`;
  });
  // "the N-010 note" / "note N-010" / "N-010" → "the note of 22/09/2026"; "REG" → "the registration record".
  s = s.replace(new RegExp(`${ID_EDGE_BEFORE}(?:([Tt]he) )?(?:[Nn]ote )?(${ANY_ID})(?: note)?${ID_EDGE_AFTER}`, "g"), (m, pre: string, the: string | undefined, id: string, offset: number, whole: string) => {
    // "the FACT-attendance figures" → "the attendance figures" (the noun is already there).
    const nounFollows = id !== "REG" && !id.startsWith("N-") && /^\s+(?:figures?|record|data|summary|scores?|entry)\b/i.test(whole.slice(offset + m.length));
    const out = nounFollows && factName(id) ? `the ${factName(id)}` : long(id);
    if (!out) return m;
    return `${pre}${(the && the !== "the") || atSentenceStart(whole, offset + pre.length) ? capitalise(out) : out}`;
  });
  return s;
}
