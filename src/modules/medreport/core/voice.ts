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
 *
 * 4. keepFictionalLabels(): a name the demonstration record labels "(fictional)" keeps the label in
 *    drafted wording, and collapseRepeatedBrackets() drops a bracket that repeats the words before it
 *    ("8 wks (8 weeks)" written out as "8 weeks (8 weeks)").
 *
 * 5. otherClinicianVoice() (fix wave 2): drafted answers written in the report author's first person ("On
 *    10/04/2026 I recorded…") may only be approved by that author. Another clinician approving them would put
 *    the author's treatment and opinions in the approver's own first person on a medico-legal form; the sign
 *    endpoint refuses that (409 SIGNER_NOT_AUTHOR) and the review says which answers to edit.
 */
import { formatUkDate } from "./dates";
import type { Clinician, EpisodeBundle, Paragraph, Report } from "./types";

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

/* ------------------------------------------------------------------------------------------------
 * Plain clinical wording of the signer's own record ("On 01/10/2026 I recorded that X" → "On 01/10/2026, X")
 * ----------------------------------------------------------------------------------------------*/

const UK_DATE = "\\d{2}\\/\\d{2}\\/\\d{4}";
/** "On 01/10/2026" / "At my review on 01/10/2026" / "At the initial assessment on 01/09/2026" before "I recorded". */
const LEAD = `(?:(On (${UK_DATE})|At (?:my|the) (?:initial assessment|initial appointment|first appointment|assessment|latest review|final review|follow-up review|follow-up|discharge review|review|appointment|session) on (${UK_DATE})),?\\s+)?`;
/** The rest of a sentence: up to its full stop (a decimal point "52.3" does not end it). */
const REST = "((?:[^.!?]|\\.(?=\\d))*)";
/** Pronoun-only voice: verbs a patient never does ("she recorded" is always the clinician). */
const RECORD_VERBS = "recorded|documented|measured|examined";

/** "the further sessions" → were; "the shoulder" → was. */
function beFor(nounPhrase: string): string {
  const last = nounPhrase.trim().split(/\s+/).pop() ?? "";
  return /[^su]s$/i.test(last) && !/^(?:this|its|his|was|is)$/i.test(last) ? "were" : "was";
}

/** The body after "I recorded …" written as a clinical statement. `date` is the lead's date, if any. */
function plainRecordedBody(body: string, lead: string, date: string): string {
  const leadComma = lead ? `${lead}, ` : "";
  const on = date ? ` on ${date}` : "";
  const b = body.trim();
  let m: RegExpExecArray | null;
  // Fix round 1 (B0-23): "…, and that no further treatment is needed" loses its "that" with the frame.
  if ((m = /^(?:that,? in my opinion,?|my opinion that,?)\s+([\s\S]*)$/.exec(b))) return `${leadComma}in my opinion, ${m[1].replace(/ and that,? /, " and ")}`;
  if ((m = /^the clinical reason(?: for (?:the )?further treatment)? (?:as follows|as):\s*([\s\S]*)$/.exec(b))) return m[1];
  if ((m = /^as the clinical reason that,?\s+([\s\S]*)$/.exec(b))) return m[1];
  if ((m = /^(?:the |my )?goals? ((?:for|of) [^:]+?)(?: as)?:\s*([\s\S]*)$/.exec(b))) return `Goals ${m[1]}: ${m[2]}`;
  if ((m = /^(?:the |my )?goals? ((?:for|of) .+?) as ([\s\S]*)$/.exec(b))) return `Goals ${m[1]}: ${m[2]}`;
  if ((m = /^(?:that )?the guideline (?:followed )?(?:as|was) ([\s\S]*)$/.exec(b))) return `Guideline followed: ${m[1]}`;
  if ((m = /^(?:my|the|an) assessment that,?\s+([\s\S]*)$/.exec(b))) return `${leadComma}in my assessment, ${m[1]}`;
  if ((m = /^(?:an|my|the) assessment (?:of the condition(?: being treated)? )?(?:of|as) ([\s\S]*)$/.exec(b))) return `Assessment${on}: ${m[1]}`;
  if ((m = /^a (?:further )?treatment request(?: to (?:the insurer|[A-Z][\w&'’.-]*(?: [A-Z][\w&'’.-]*)*))?(?: for| of)? ([\s\S]*)$/.exec(b))) return `Further treatment requested${on}: ${m[1]}`;
  // Fix round 2 (B1-3): "in the past medical history that Mr Ellery was fit and well…" loses its "that".
  if ((m = /^(?:in the |the |a )?past medical history(?: of| as)?,?\s+(?:that,?\s+)?([\s\S]*)$/.exec(b))) return `Past medical history: ${m[1]}`;
  // "in my assessment mild travel anxiety…" / "in my plan that I explained…" / "in my plan about 6 sessions…".
  if ((m = /^in (?:my|the|her|his) (?:initial |clinical )?assessment,?\s+(?:that,?\s+)?([\s\S]*)$/.exec(b))) return `Assessment${on}: ${m[1]}`;
  if ((m = /^in (?:my|the|her|his) (?:treatment |management )?plan,?\s+(?:that,?\s+)?([\s\S]*)$/.exec(b))) return `Plan${on}: ${m[1]}`;
  // "a home exercise programme of chin tucks…" → "Home exercise programme on 15/07/2026: chin tucks…"; "a plan that
  // included…" → "On 15/07/2026, the plan included…".
  const plan = "((?:[a-z-]+ ){0,3}(?:programme|program|plan|regime|regimen|routine|course|referral))";
  if ((m = new RegExp(`^(?:a|an|the|my) ${plan} (?:that|which) ([\\s\\S]+)$`).exec(b))) return `${leadComma}the ${m[1]} ${m[2]}`;
  if ((m = new RegExp(`^(?:a|an) ${plan}(?: (?:of|with|for|including|comprising)| ?:) ([\\s\\S]+)$`).exec(b))) return `${capitalise(m[1])}${on}: ${m[2]}`;
  if ((m = /^advice (to|on|about) ([\s\S]*)$/.exec(b))) return `${leadComma}advice was given ${m[1]} ${m[2]}`;
  if ((m = /^progression of (the [^,;]+?)((?:[,;][\s\S]*)?)$/.exec(b))) return `${leadComma}${m[1]} was progressed${m[2]}`;
  // "the shoulder as improving: …" / "Mrs Lane's medication as …" / "right shoulder active range of movement as …"
  // Fix round 3 (B2-6): the noun phrase may hold capitals and numerals ("the whiplash-associated disorder grade II as now
  // largely resolved" → "… grade II was now largely resolved").
  if ((m = /^((?:the|my|an?)\s+[A-Za-z][\w'’ –-]{1,60}?|(?:\[CLAIMANT\]|[A-Z][a-z]+(?: [A-Z][a-z'-]+)?)['’]s [a-z][\w'’ –-]{1,40}?|(?:right|left)\s+[a-z][\w'’ –-]{1,60}?) as (?!follows|part of\b|well\b|such\b|a result\b)([\s\S]+)$/.exec(b))) {
    return `${leadComma}${m[1]} ${beFor(m[1])} ${m[2]}`;
  }
  // "right shoulder active range of movement: flexion 120°…" → "Right shoulder active range of movement on 01/09/2026: …"
  if ((m = /^([a-z][a-z' -]{2,60}?):\s+([\s\S]+)$/.exec(b)) && !/\b(?:that|was|were|is|are)\b/.test(m[1])) return `${m[1]}${on}: ${m[2]}`;
  if ((m = /^that,?\s+([\s\S]*)$/.exec(b))) {
    // Fix round 3 (B2-6): a clause with its own event date ("that Mr Ellery saw his GP on 07/07/2026") keeps "I recorded
    // that" – "On 15/07/2026, Mr Ellery saw his GP on 07/07/2026" reads as two clashing dates.
    if (lead && /\bon \d{2}\/\d{2}\/\d{4}\b/.test(m[1].replace(/\([^()]*\)/g, ""))) return `${lead}, I recorded that ${m[1].replace(/ and that,? /, " and ")}`;
    // "I recorded that she provided education…" – the recorder is the one who provided it.
    const clause = m[1]
      .replace(new RegExp(`^(?:she|he) (${OWN_ACTION_VERBS})\\b`), "I $1")
      .replace(/ and that,? /, " and ")
      // Fix round 3 (B2-6): "…, and noted mild travel anxiety" shared the recorder as its subject – it keeps one.
      .replace(/,? and (also )?(noted|recorded|observed|documented|found)\b/g, ", and I $1$2");
    return `${leadComma}${clause}`;
  }
  // A finding rather than a clause. Fix round 3 (B2-6): only a negative finding ("No previous shoulder problems.") or one
  // after a capitalised name or score ("On 01/10/2026: QuickDASH 29.5…") stands without a verb; any other keeps "I
  // recorded" ("I recorded full, pain-free cervical active range of movement…", "On 15/07/2026, I recorded gentle
  // cervical mobilisations…").
  const finding = b.replace(/, and that,? /, ", and ");
  if (/^no\b/i.test(finding)) return `${lead ? `${lead}: ` : ""}${finding}`;
  if (lead && /^[A-Z0-9]/.test(finding)) return `${lead}: ${finding}`;
  return `${leadComma}I recorded ${finding}`;
}

/** What a clinician does in a session ("she recorded that she provided education…" is the clinician). */
const OWN_ACTION_VERBS = "provided|gave|taught|advised|progressed|applied|performed|issued|explained|reassured|recommended|referred|discharged|assessed|measured|examined|reviewed";

/**
 * The signer's own record written as a clinician writes a form: drafted first-person attributions of
 * record-keeping ("On 01/10/2026 I recorded that 1 pre-authorised session remained", "I recorded the
 * clinical reason as follows: …", "I recorded an assessment of …") become clinical statements ("On
 * 01/10/2026, 1 pre-authorised session remained", "…", "Assessment on 01/09/2026: …"). Only "I recorded"
 * (the signer's own notes) is touched – another clinician's "Tom Ellis recorded…" keeps its attribution –
 * and no date, figure or quotation is added, changed or dropped except the lead date of a reason or goal.
 * Deterministic and idempotent. Applied to first-person drafts on assembly and by "Write in my own voice".
 */
export function plainClinicalWording(text: string): string {
  if (!/\bI (?:also |then |later )?(?:recorded|documented)\b/.test(text)) return text;
  let s = text;
  // Mid-sentence: "…, and on 01/10/2026 I recorded the assessment as X" → "…, and on 01/10/2026 the assessment was X".
  s = s.replace(new RegExp(`(\\band (?:on ${UK_DATE},? )?)I (?:also )?recorded (?:the|my|an) assessment as `, "g"), "$1the assessment was ");
  s = s.replace(/(?<=[^.!?\s]\s+)I (?:also )?recorded progression of (the [^,;.]+)/g, "$1 was progressed");
  s = s.replace(/(\b(?:and|but|where|when|which|while),? )I (?:also )?recorded that,? /g, "$1");
  // Sentence starts.
  const re = new RegExp(`(^|[.!?]\\s+|\\n\\s*)${LEAD}I (?:also |then |later )?(?:recorded|documented)\\s+${REST}`, "g");
  s = s.replace(re, (whole: string, pre: string, lead: string | undefined, d1: string | undefined, d2: string | undefined, body: string) => {
    const out = plainRecordedBody(body, lead ?? "", d1 ?? d2 ?? "");
    // Fix round 3 (B2-6): a sentence kept as "I recorded …" stays exactly as drafted (idempotent).
    if (/^I recorded /.test(out) && !lead) return whole;
    return `${pre}${out.startsWith("[CLAIMANT]") ? out : capitalise(out)}`;
  });
  return s;
}

/**
 * "Write in my own voice": the author's third-person attributions in the first person, then the
 * record-keeping frames as plain clinical wording. With `pronouns`, a paragraph that does not name the
 * author (it cites only the author's notes) has its "She recorded" taken as the author too.
 */
export function inOwnClinicalWording(text: string, authorName: string, opts: { pronouns?: boolean } = {}): string {
  const name = authorName.trim();
  let s = rewriteInFirstPerson(text, name);
  if (opts.pronouns && name && text.indexOf(name) < 0) {
    s = s.replace(new RegExp(`\\b(?:She|He|she|he)\\s+((?:also|then|later|again)\\s+)?(${RECORD_VERBS})\\b`, "g"), "I $1$2");
  }
  return plainClinicalWording(s);
}

/** N-* note IDs a paragraph cites. */
function citedNoteIds(p: Pick<Paragraph, "sourceIds">): string[] {
  return p.sourceIds.filter((id) => /^N-\d+$/.test(id));
}

/**
 * Whether a drafted paragraph only reports the author's OWN notes and names the author: then it can be
 * written in the author's voice. (A paragraph that also cites another clinician's note keeps names.)
 * With `pronouns`, a paragraph that does not name the author qualifies too when it says "she recorded"
 * or already says "I recorded" (a first-person draft) – the rewrite then gives it plain clinical wording.
 */
export function isOwnVoiceCandidate(
  p: Pick<Paragraph, "text" | "sourceIds" | "origin">,
  bundle: Pick<EpisodeBundle, "notes">,
  authorName: string,
  opts: { pronouns?: boolean } = {},
): boolean {
  const author = authorName.trim();
  if (p.origin !== "ai" || !author) return false;
  const named = p.text.indexOf(author) >= 0;
  if (!named && !(opts.pronouns && new RegExp(`\\b(?:[Ss]he|[Hh]e|I)\\s+(?:(?:also|then|later|again)\\s+)?(?:${RECORD_VERBS})\\b`).test(p.text))) return false;
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
  // Fix round 2 (B1-13): "attended 5 of 6 appointments, with 1 did not attend on 22/09/2026" (DNA written out).
  [/\bwith (\d+) did not attend\b/g, (_m, n: string) => `with ${n} missed appointment${n === "1" ? "" : "s"}`],
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

/**
 * A bracket that only repeats the words just before it is dropped: "over 8 weeks (8 weeks)" → "over 8
 * weeks". It appears when a draft gives note shorthand with its own expansion ("8 wks (8 weeks)") and the
 * shorthand is then written out above, or when a name is replaced by the words already beside it ("the
 * insurer (the insurer)"). Only a whole-word repeat counts ("18 weeks (8 weeks)" stays).
 */
export function collapseRepeatedBrackets(text: string): string {
  if (text.indexOf("(") < 0) return text;
  return text.replace(/\s*\(([^()]{1,80})\)/g, (m, inner: string, offset: number, whole: string) => {
    const said = inner.trim().replace(/\s+/g, " ").toLowerCase();
    if (!/[a-z0-9]/.test(said)) return m;
    const before = whole.slice(0, offset).replace(/\s+/g, " ").toLowerCase();
    if (!before.endsWith(said)) return m;
    const prev = before.charAt(before.length - said.length - 1);
    return prev === "" || /[^a-z0-9]/.test(prev) ? "" : m;
  });
}

/** Expand note shorthand and clinical abbreviations into plain words; every number is kept as written. */
export function expandNoteShorthand(text: string): string {
  let s = text;
  for (const [re, to] of SHORTHAND) s = typeof to === "string" ? s.replace(re, to) : s.replace(re, to as (...m: string[]) => string);
  return collapseRepeatedBrackets(expandClinicalAbbreviations(s));
}

/* ------------------------------------------------------------------------------------------------
 * "(fictional)" labels of demonstration data
 * ----------------------------------------------------------------------------------------------*/

/** Two or more capitalised words ("&" may join them) written just before "(fictional)". */
const FICTIONAL_NAME = /(?<![\w'’.&-])([A-Z0-9][\w'’.-]*(?:\s+(?:[A-Z0-9][\w'’.-]*|&)){1,7})\s*\(fictional\)/g;

/**
 * Names the record itself labels "(fictional)" ("Kents Hill Medical Practice (fictional)", "Ashby Freight
 * Ltd (fictional)"), longest first. Real records hold none, so for them nothing changes.
 */
export function fictionalNames(texts: Iterable<string>): string[] {
  const names = new Set<string>();
  for (const t of Array.from(texts)) {
    for (const m of Array.from(t.matchAll(FICTIONAL_NAME))) names.add(m[1].replace(/\s+/g, " ").trim());
  }
  return Array.from(names).sort((a, b) => b.length - a.length);
}

/**
 * Demonstration data keeps its "(fictional)" label in drafted wording: a name the record labels
 * "(fictional)" that a draft wrote without it gets it back ("Dr A Forsyth, Kents Hill Medical Practice,
 * referred…" → "…Kents Hill Medical Practice (fictional), referred…"). A possessive is left as written.
 */
export function keepFictionalLabels(text: string, names: readonly string[]): string {
  let s = text;
  for (const name of names) {
    if (s.indexOf(name.split(" ")[0]) < 0) continue;
    const re = new RegExp(`(?<![\\w&])${escapeRe(name).replace(/ /g, "\\s+")}(?![\\w'’-])(?!\\s*\\(fictional\\))`, "g");
    s = s.replace(re, (m) => `${m} (fictional)`);
  }
  return s;
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


/* ------------------------------------------------------------------------------------------------
 * Whose voice the drafted answers speak in (fix wave 2)
 * ----------------------------------------------------------------------------------------------*/

/** Words before a capital "I" that make it a numeral ("WAD I", "Grade I", "Type I"), not the first person. */
const NUMERAL_BEFORE_I = /(?:WAD|grade|type|stage|class|phase|level|part|section|schedule|category|tier|zone)\s*$/i;

/**
 * Whether drafted text speaks in the first person ("I recorded…", "in my opinion", "told me") outside
 * quotations from the notes ("…" / "…", where a patient's own words may say "my neck").
 */
export function speaksInFirstPerson(text: string): boolean {
  const plain = text.replace(/\u201C[^\u201D]*\u201D/g, " ").replace(/"[^"]*"/g, " ");
  const re = /\b(I|me|my|My|myself|Myself)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain))) {
    if (m[1] === "I") {
      if (NUMERAL_BEFORE_I.test(plain.slice(Math.max(0, m.index - 16), m.index))) continue;
      if (/^[-\u2013/.]\w/.test(plain.slice(m.index + 1, m.index + 3))) continue; // "I-II", "I/II"
    }
    return true;
  }
  return false;
}

const normName = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const normHcpc = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toUpperCase();

/** The same clinician: the same HCPC number when both have one, else the same name. */
export function sameClinician(a: Pick<Clinician, "name"> & { hcpc?: string | null }, b: Pick<Clinician, "name"> & { hcpc?: string | null }): boolean {
  if (a.hcpc && b.hcpc) return normHcpc(a.hcpc) === normHcpc(b.hcpc);
  return normName(a.name) === normName(b.name);
}

/**
 * Drafted answers (origin "ai", unedited) that speak in the first person of the report's author when the
 * approver is someone else: `{author, keys}` (the questions to edit), or null when there are none – no author
 * (third-person drafts), the approver is the author, or no drafted answer says "I".
 */
export function otherClinicianVoice(
  report: Pick<Report, "author" | "sections">,
  signer: Pick<Clinician, "name"> & { hcpc?: string | null },
): { author: string; keys: string[] } | null {
  const author = report.author;
  if (!author || !author.name.trim() || !signer.name.trim()) return null;
  if (sameClinician(author, signer)) return null;
  const keys = report.sections.filter((s) => s.paragraphs.some((p) => p.origin === "ai" && speaksInFirstPerson(p.text))).map((s) => s.key);
  return keys.length > 0 ? { author: author.name, keys } : null;
}

/* ------------------------------------------------------------------------------------------------
 * Another clinician's note in the author's first person (Blue Heart fix round 1, B0-1)
 * ----------------------------------------------------------------------------------------------*/

/** Whether `text` names `name` (case, spaces and a trailing possessive ignored). */
export function namesPerson(text: string, name: string): boolean {
  const n = name.trim();
  return n !== "" && new RegExp(`\\b${escapeRe(n).replace(/ /g, "\\s+")}\\b`, "i").test(text);
}

/**
 * A paragraph that says "I", "me" or "my" (outside quotations) while it cites a note another clinician wrote: the
 * clinicians to name instead, or null. The first person is the report author's own (the clinician who signs), so it
 * fits only the author's own notes:
 * - every cited note is the author's → null;
 * - no cited note is the author's (or no author is named, so nothing is anyone's "I") → every other clinician cited;
 * - the author's notes and another's together → null when each other clinician is named in the text ("I repeated it
 *   on 22/07/2026, and Tom Ellis recorded…"), else the ones not named.
 * Only N-* notes count: a paragraph citing no note (the registration record, a computed fact) is left to the other checks.
 */
export function otherCliniciansInFirstPerson(
  p: Pick<Paragraph, "text" | "sourceIds">,
  bundle: Pick<EpisodeBundle, "notes">,
  author: (Pick<Clinician, "name"> & { hcpc?: string | null }) | null | undefined,
): string[] | null {
  if (!speaksInFirstPerson(p.text)) return null;
  const cited = citedNoteIds(p)
    .map((id) => bundle.notes.find((n) => n.id === id))
    .filter((n): n is EpisodeBundle["notes"][number] => Boolean(n));
  if (cited.length === 0) return null;
  const own = (a: Pick<Clinician, "name"> & { hcpc?: string | null }) => Boolean(author?.name.trim()) && sameClinician(a, author as Pick<Clinician, "name">);
  const others = Array.from(new Set(cited.filter((n) => !own(n.author)).map((n) => n.author.name.trim()))).filter(Boolean);
  if (others.length === 0) return null;
  if (!cited.some((n) => own(n.author))) return others;
  const unnamed = others.filter((name) => !namesPerson(p.text, name));
  return unnamed.length > 0 ? unnamed : null;
}

/* ------------------------------------------------------------------------------------------------
 * A first-person count of sessions (fix round 2, B1-14)
 * ----------------------------------------------------------------------------------------------*/

const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const TITLED = "(?:Mr|Mrs|Ms|Miss|Dr|Mx)\\.? [A-Z][\\w'’-]+";
const FIRST_PERSON_COUNT = new RegExp(
  `\\bI (?:have )?(?:treated|saw|have seen|have treated|assessed and treated|provided (?:physiotherapy|treatment) (?:to|for))\\s+(${TITLED}|him|her|them|the (?:client|patient|claimant|employee))\\s+(?:for|over|in|across|on)\\s+(\\d{1,2}|${Object.keys(COUNT_WORDS).join("|")})\\s+((?:treatment |physiotherapy )?(?:sessions?|appointments?|treatments?|occasions?)(?: of physiotherapy)?)`,
  "i",
);

/** "I treated Mr Ellery for 7 sessions…" → { count: 7, phrase } – a first-person count of sessions – or null. */
export function firstPersonSessionCount(text: string): { count: number; phrase: string } | null {
  const m = FIRST_PERSON_COUNT.exec(text);
  if (!m) return null;
  const count = /^\d+$/.test(m[2]) ? Number(m[2]) : COUNT_WORDS[m[2].toLowerCase()];
  return count ? { count, phrase: m[0] } : null;
}

/**
 * How many attended sessions the author saw the patient for: attended appointments whose note (or clinician) is the
 * author's. Null when the record does not say who saw the patient at its appointments.
 */
export function authorsAttendedSessions(bundle: Pick<EpisodeBundle, "appointments" | "notes">, author: Pick<Clinician, "name"> & { hcpc?: string | null }): { own: number; others: Array<{ date: string; name: string }> } | null {
  const attended = bundle.appointments.filter((a) => a.status === "ATT");
  const who = attended.map((a) => a.clinician ?? bundle.notes.find((n) => n.id === a.noteId)?.author ?? null);
  if (attended.length === 0 || who.some((w) => w === null)) return null;
  const others = attended.flatMap((a, i) => (who[i] && !sameClinician(who[i] as Clinician, author) ? [{ date: a.date, name: (who[i] as Clinician).name }] : []));
  return { own: attended.length - others.length, others };
}

/**
 * "I treated Mr Ellery for 7 sessions of physiotherapy between…" → "Mr Ellery attended 7 sessions of physiotherapy
 * between…": the patient as the subject of a count that includes sessions with other clinicians. Null when the
 * patient is not named in it ("I treated him for 7 sessions").
 */
export function attendedInstead(text: string): string | null {
  const m = FIRST_PERSON_COUNT.exec(text);
  if (!m || !new RegExp(`^${TITLED}$`).test(m[1])) return null;
  return text.replace(m[0], `${m[1]} attended ${m[2]} ${m[3]}`);
}

/**
 * The first person forming or giving an opinion (fix round 3, B2-1): "in my opinion / view", "my assessment that", "I
 * expect / think / believe / feel / recommend / anticipate / consider…" (present tense – a past "I recommended" reports
 * what was recorded).
 */
export const OWN_OPINION =
  /\b(?:in my (?:clinical |professional )?(?:opinion|view)|my (?:clinical |professional )?(?:opinion|view|assessment|impression|expectation) (?:is |was )?that|I (?:also |would |do |still )?(?:expect|think|believe|feel|recommend|anticipate|consider|suspect|predict|estimate|foresee)(?![\w-]))/i;

/** Past-tense verbs that do not end in "-ed" (for "I saw" → "Tom Ellis saw"). */
const IRREGULAR_PAST =
  "saw|gave|took|told|found|made|felt|thought|taught|sent|kept|met|wrote|did|had|was|began|ran|put|set|got|left|brought|heard|held|knew|led|lost|meant|paid|read|said|showed|spent|stood|understood|went|withdrew|became|chose|drew|drove|fell|forgot|hurt|let|sat|spoke|struck|swam|threw|woke|won";

/** Every "I" outside quotations is followed by a past-tense verb (an adverb may come between), so naming someone in its place stays grammatical. */
function firstPersonVerbsInPast(text: string): boolean {
  const plain = text.replace(/“[^”]*”/g, " ").replace(/"[^"]*"/g, " ");
  const re = /\bI\b(?![-–/.]\w)\s*(\S*)\s*(\S*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain))) {
    if (NUMERAL_BEFORE_I.test(plain.slice(Math.max(0, m.index - 16), m.index))) continue;
    const adverb = /^(?:also|then|later|again|further|initially|subsequently|previously|first|last|next|once|briefly|only|personally)$/i.test(m[1]);
    const verb = (adverb ? m[2] : m[1]).replace(/[^A-Za-z]/g, "");
    if (!new RegExp(`^(?:[a-z]+ed|${IRREGULAR_PAST})$`, "i").test(verb)) return false;
  }
  return true;
}

/** Text outside quotations ("…", “…”) through `fn`; quoted note wording stays as written. */
function outsideQuotes(text: string, fn: (s: string) => string): string {
  return text
    .split(/(“[^”]*”|"[^"]*")/)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join("");
}

/**
 * "Name Tom Ellis instead": the inverse of rewriteInFirstPerson() for a paragraph that reports one other clinician's
 * notes in the first person – "told me" → "told Tom Ellis", "My assessment" → "Tom Ellis's assessment", "in my
 * opinion" → "in Tom Ellis's opinion", "I also advised" → "Tom Ellis also advised". Quotations, dates and figures are
 * untouched. Returns null when anything first-person is left, or when the text names the clinician already – then
 * the "I" or "my" may be the signer's own ("Tom Ellis covered my leave") – and the clinician rewrites it instead.
 */
export function nameClinicianInstead(text: string, clinicianName: string): string | null {
  const name = clinicianName.trim();
  if (!name || /\bI['\u2019](?:m|ve|d|ll)\b/.test(text) || namesPerson(text, name)) return null;
  // Fix round 3 (B2-1): an opinion or prognosis in the first person ("In my opinion\u2026", "I expect these to ease") is never
  // moved onto another clinician by a click \u2013 whose opinion it is, and whether they recorded it, is the clinician's to
  // settle. Nor is a present-tense "I expect" turned into "Tom Ellis expect".
  if (OWN_OPINION.test(text.replace(/\u201C[^\u201D]*\u201D|"[^"]*"/g, " "))) return null;
  if (!firstPersonVerbsInPast(text)) return null;
  const possessive = `${name}'s`;
  const out = outsideQuotes(text, (s) =>
    s
      .replace(/\bmy\b/g, possessive)
      .replace(/\bMy\b/g, possessive)
      .replace(/\b(?:me|myself|Myself)\b/g, name)
      .replace(/\bI\b(?![-–/.]\w)/g, (m, offset: number, whole: string) => (NUMERAL_BEFORE_I.test(whole.slice(Math.max(0, offset - 16), offset)) ? m : name)),
  );
  return out !== text && !speaksInFirstPerson(out) ? out : null;
}

/**
 * A report with no author (drafted in the third person: a draft staff prepared, a built-in report) approved by
 * `signer`: the drafted answers that still say "I", "me" or "my" about notes the signer did not write – the
 * questions to edit, or null. The validators check reports that have an author (validation/voice.ts).
 */
export function unsignableFirstPerson(
  report: Pick<Report, "author" | "sections" | "bundleSnapshot">,
  signer: Pick<Clinician, "name"> & { hcpc?: string | null },
): { names: string[]; keys: string[] } | null {
  if (report.author?.name.trim() || !signer.name.trim()) return null;
  const names = new Set<string>();
  const keys: string[] = [];
  for (const s of report.sections) {
    for (const p of s.paragraphs) {
      if (p.origin !== "ai") continue;
      const others = otherCliniciansInFirstPerson(p, report.bundleSnapshot, signer);
      if (!others) continue;
      others.forEach((n) => names.add(n));
      if (keys.indexOf(s.key) < 0) keys.push(s.key);
    }
  }
  return keys.length > 0 ? { names: Array.from(names), keys } : null;
}

/**
 * Fix round 1 (B0-23): gap wording ("issue", "suggestedQuestion") read by everyone who opens the review – staff too – so
 * "your discharge note of 16/09/2026" or "my note of 05/08/2026" names whose note it is: the clinician who wrote the
 * note of that date ("Sarah Reid's discharge note of 16/09/2026"), else "the" ("The notes do not record a dose").
 * Quotations are untouched. Pure; browser and server.
 */
export function notesNamedByAuthor(text: string, notes: ReadonlyArray<{ date: string; author: Pick<Clinician, "name"> }>): string {
  // "your discharge note", "my initial assessment note" – not "your clinic has no notes".
  const own = /\b(my|your)((?:\s+(?!(?:has|have|had|is|are|was|were|do|does|did|no|not|and|or|of|in|on|for|to)\b)[A-Za-z-]+){0,3}?\s+notes?)\b(\s+(?:of|on|dated)\s+(\d{2})\/(\d{2})\/(\d{4}))?/gi;
  return outsideQuotes(text, (s) =>
    s.replace(own, (_m, _who: string, rest: string, tail: string | undefined, dd?: string, mm?: string, yyyy?: string, offset?: number, whole?: string) => {
      const iso = dd && mm && yyyy ? `${yyyy}-${mm}-${dd}` : null;
      const authors = iso ? Array.from(new Set(notes.filter((n) => n.date === iso).map((n) => n.author.name.trim()).filter(Boolean))) : [];
      if (authors.length === 1) return `${authors[0]}'s${rest}${tail ?? ""}`;
      const start = (offset ?? 0) === 0 || /[.!?]\s+$/.test((whole ?? "").slice(0, offset));
      return `${start ? "The" : "the"}${rest}${tail ?? ""}`;
    }),
  );
}

/* ------------------------------------------------------------------------------------------------
 * Another clinician's recorded opinion named (fix round 3, B2-2) and the patient's name repeated (B2-18)
 * ----------------------------------------------------------------------------------------------*/

/** Whether `text` names `name`, in full or by title and surname ("Ms Shah"). */
export function namesClinician(text: string, name: string): boolean {
  if (namesPerson(text, name)) return true;
  const surname = name.trim().split(/\s+/).pop() ?? "";
  return surname.length > 1 && new RegExp(`\\b(?:Dr|Mr|Mrs|Ms|Miss|Mx)\\.? ${escapeRe(surname)}\\b`).test(text);
}

/**
 * "Name Priya Shah": a recorded opinion or diagnosis from another clinician's note, drafted without their name into a
 * compact place, gets a short attribution in front – "Priya Shah's assessment (01/09/2026): grade I–II sprain…". The
 * text after it reads on in lower case unless it starts with a name, an acronym or "I".
 */
export function withOpinionAttribution(text: string, name: string, isoDate: string | null, noun: "assessment" | "opinion"): string {
  const t = text.trim();
  const first = /^(\S+)/.exec(t)?.[1] ?? "";
  const keep = /^[A-Z]{2,}|^[A-Z][a-z]+[A-Z]|^I$|^(?:Mr|Mrs|Ms|Miss|Dr|Mx)\.?$/.test(first) || /^[A-Z][a-z]+ [A-Z][a-z]/.test(t);
  const body = keep ? t : `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  return `${name.trim()}'s ${noun}${isoDate ? ` (${formatUkDate(isoDate)})` : ""}: ${body}`;
}

/**
 * The patient's name written again where a pronoun belongs – "[CLAIMANT] told me on 16/09/2026 that [CLAIMANT] was
 * working…" once the name is put back ("Mr Ellery told me … that Mr Ellery was working") – becomes "he" / "him" (from the
 * title: Mr → he, Mrs / Ms / Miss → she). Only a later mention in the same sentence, as the subject of a reported clause
 * or the object of a clinician's verb; the first mention, quotations and every other mention stay. Without a gendered
 * title the text is unchanged (validation/draft-fit.ts then asks for a check).
 */
export function pronounForRepeatedName(text: string, displayName: string, title: string | null | undefined): string {
  const name = displayName.trim();
  const t = (title ?? "").trim().replace(/\.$/, "");
  const p = t === "Mr" ? { subj: "he", obj: "him" } : /^(?:Mrs|Ms|Miss)$/.test(t) ? { subj: "she", obj: "her" } : null;
  if (!p || !name || text.split(name).length < 3) return text;
  const N = escapeRe(name);
  return outsideQuotes(text, (part) =>
    eachSentence(part, (sentence) => {
      const first = sentence.indexOf(name);
      if (first < 0) return sentence;
      const head = sentence.slice(0, first + name.length);
      const tail = sentence
        .slice(first + name.length)
        .replace(new RegExp(`\\b(that|and|but|because|as|so|when|while|although|whether|if) ${N}(?=\\s+(?:had|has|was|were|is|would|could|felt|found|reported|said|described|wanted|planned|needed|continued|walked|drove|worked|did|kept|could|still|now|also|no longer|took|managed|returned|started|stopped)\\b)`, "g"), `$1 ${p.subj}`)
        .replace(new RegExp(`\\b(advised|told|asked|reminded|encouraged|referred|discharged|reassured|taught|showed|gave|helped|allowed|instructed|saw|treated|assessed|examined) ${N}\\b`, "g"), `$1 ${p.obj}`);
      return head + tail;
    }),
  );
}
