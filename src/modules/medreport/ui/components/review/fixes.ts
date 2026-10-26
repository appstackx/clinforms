/**
 * Review workspace model – one-click fixes (bh2 WD design 6, invariant I8): the one-click engine, plus "Write in my own
 * voice", "Name <clinician> instead" and removing the draft's superseded "not recorded" sentences.
 *
 * The engine: offeredFixes(report, {actor, form, template}) lists every one-click fix it offers, each a FixProposal
 * (core/fix-types.ts: the paragraph's text before and after, the spans it removes, the generator that made it). Every
 * proposal has passed planFix() – the engine's rules, checked on a copy before anything is offered:
 *   - removals take whole sentences only (the shared tokenizer, core/text/sentences.ts – never a split inside "8.0");
 *   - the figures and dates after = before minus the removed spans (plus the date of a note the paragraph cites, which
 *     an attribution fix may add);
 *   - no sentence the edit creates starts in lower case, with a digit or with a comma (a compact value – "7/10 at worst",
 *     "lighter work" – is a value, not a sentence);
 *   - no sentence is left without the clinician or the date it relied on (B3-5 a): when the removed sentences named a
 *     clinician or a date (or "I recorded …"), the sentence after them must name one itself – "He recorded …", "At
 *     that review he recorded …", "His review also recorded …", "The Oswestry Disability Index was 18%." would each be
 *     left saying a finding without who recorded it or when;
 *   - the repeated twin still prints (its box keeps it, prints text and is not set aside), and it says every figure and
 *     date the removed sentence says – removing "limited by 10%" because another box says "limited by 50%" is refused;
 *   - the box's answer is never removed: the box keeps text, and keeps a sentence that answers its question when the
 *     removed one did – by the question's own words or by its topic ("Treatment provided": a home programme, manual
 *     therapy, advice … – B3-5 c);
 *   - a clinical negative is never removed or reworded away: a removal never takes a sentence that says something was
 *     absent ("No red flags were reported."), and a rewrite keeps every negation ("no", "not", "without", "denies" …);
 *   - a rewrite of WD's (value-only, printed lead) drops only the words it is for – the attribution, or the repeated
 *     printed verb – never a clause of the answer ("…, and no red flags were noted", "…, with pain at end of range");
 *   - re-validation adds no blocking flag and clears none but the one the fix answers – a wording fix never makes
 *     unsafe text approvable;
 *   - the paragraph's other warnings stay: the fixed paragraph keeps origin "ai" and records the fix in
 *     Paragraph.fixes {kind, by, at, edits}, so every drafted-text check keeps running on it.
 * Who may apply one: a text fix in a clinician's box (an opinion, or the physiotherapist's own choice) is the
 * approver's (WC design 4); elsewhere any member working on the report.
 * Every proposal is shown with its before and after (fix-preview.tsx) and can be undone (undoProposal() – a removed
 * duplicate paragraph is put back where it was).
 *
 * Generators: "repeat-removal" (the sentences another box already says, draft-fit/repeats.ts), "duplicate-paragraph"
 * (an exact second copy in the same box), "value-only" (a compact value from the voice owner's own note,
 * draft-fit/shorten.ts), "dose-not-stated" (B3-12, draft-fit/measure.ts), "printed-lead" (the verb the form already
 * prints, draft-fit/printed-lead.ts), and WB's attribution, quotation and commentary fixes
 * (core/validation/attribution-fixes.ts ATTRIBUTION_FIX_GENERATORS), each checked by the same rules.
 *
 * Pure, no React. Split out of review-model.ts by W0.4 (bh2 module split, pure move; review-model.ts re-exports it).
 * Owner: WD (drafting and text edits; the one-click engine) – docs/bh2-ownership.json. WB's fix generators reach the
 * review through here.
 */
import { inOwnClinicalWording, isOwnVoiceCandidate, nameClinicianInstead, otherCliniciansInFirstPerson } from "../../../core/voice";
import { appendActivity } from "../../../core/report-factory";
import type { Actor } from "../../../core/actor";
import type { FixProposal, TextSpan as FixSpan } from "../../../core/fix-types";
import { compactPlace, printedLeadOf } from "../../../core/forms/answer-shape";
import { recordSourceOf } from "../../../core/forms/record-paths";
import { checkSafeEdit, figureChanges, figuresOf, removeSentences, sentenceKey, splitSentences, type TextSpan } from "../../../core/text/sentences";
import type { Clinician, EpisodeBundle, FormDefinition, FormField, Paragraph, Report, ReportFlag, ReportSection, ReportTemplate } from "../../../core/types";
import { validateReport } from "../../../core/validation";
import { ATTRIBUTION_FIX_GENERATORS } from "../../../core/validation/attribution-fixes";
import { defaultVoiceOwner } from "../../../core/validation/attribution-owner";
import { medicinesWithoutDose } from "../../../core/validation/draft-fit/measure";
import { withoutPrintedVerb } from "../../../core/validation/draft-fit/printed-lead";
import { REPEAT_REMOVAL_HOOK, duplicateParagraphs, nameWords, removableRepeat, repeatedSentences } from "../../../core/validation/draft-fit/repeats";
import { VALUE_ONLY_HOOK, citesOnlyOwnersNotes, valueOnlyText, valueOnlyTimePoint } from "../../../core/validation/draft-fit/shorten";
import { hookEnabled } from "../../../core/validation/hooks";
import { editParagraph, removeParagraph } from "./reducer";

/* ------------------------------------------------------------------------------------------------
 * The one-click engine
 * ----------------------------------------------------------------------------------------------*/

/** What a generator proposes for one paragraph, before the engine checks it. */
export interface FixCandidate {
  generator: string;
  label: string;
  sectionKey: string;
  paragraphId: string;
  before: string;
  after: string;
  /** Whole sentences the fix takes out (a removal); empty for a rewrite. */
  removedSpans: TextSpan[];
  /** The flags the fix answers (their blocking flag may go). */
  answers: ReportFlag[];
  ackPolicy?: FixProposal["ackPolicy"];
  /**
   * A repeat removal: for each removed sentence, the earlier box's sentence it repeats (its twin) – which must still
   * print, and say every figure and date the removed sentence says.
   */
  twins?: Array<{ sectionKey: string; paragraphId: string; text: string; removed: string }>;
  /**
   * A rewrite of WD's own: the words (lower case) it may drop besides the attribution wording – e.g. a printed lead's
   * verb. Absent for another workstream's rewrite (WB's), which is checked by every other rule.
   */
  droppable?: ReadonlySet<string>;
}

export interface FixContext {
  form: Pick<FormDefinition, "fields" | "analysis"> | null;
  template: ReportTemplate;
}

/**
 * The voice owner of a report for the engine: its approver, else nobody (bh2 WD design 2, C-REV-1; harden N5). Never the
 * report's author – the client defaults that to the clinician who wrote the most notes, so a colleague's finding would
 * lose its name on that guess ("Use the value only" with no approver chosen is never offered).
 */
function voiceOwnerOfReport(report: Pick<Report, "approver">): Clinician | null {
  if (report.approver?.name?.trim()) return { name: report.approver.name, hcpc: report.approver.hcpc };
  return null;
}

function validationOf(report: Report, ctx: FixContext): ReportFlag[] {
  const owner = voiceOwnerOfReport(report);
  return validateReport(report, ctx.template, { form: ctx.form, ...(owner ? { voice: { owner } } : {}) }).blocking;
}

function boxText(report: Pick<Report, "sections">, key: string): string {
  return (report.sections.find((s) => s.key === key)?.paragraphs ?? []).map((p) => p.text).join(" ").trim();
}

/** A sentence of clinical content that says something was absent or negative ("No red flags were reported."). */
const CLINICAL_NEGATIVE = /\b(?:no|not|nil|none|never|without|denie[sd]|negative|absent|unremarkable)\b/i;
/** The negations a rewrite must keep, counted ("No red flags" → "Red flags" is refused). */
const NEGATION =
  /\b(?:no|not|nil|none|never|nothing|neither|nor|without|denie[sd]|deny|negative|absent|unremarkable|unable|cannot|can['’]t|isn['’]t|wasn['’]t|weren['’]t|aren['’]t|doesn['’]t|didn['’]t|don['’]t|hasn['’]t|haven['’]t|hadn['’]t|won['’]t|couldn['’]t|wouldn['’]t|shouldn['’]t)\b/gi;

function negationsOf(text: string): string[] {
  return (text.match(NEGATION) ?? []).map((w) => w.toLowerCase().replace("’", "'"));
}

/** Items of `a` (a multiset) that `b` does not have. */
function missingFrom(a: readonly string[], b: readonly string[]): string[] {
  const pool = [...b];
  const out: string[] = [];
  for (const x of a) {
    const i = pool.indexOf(x);
    if (i >= 0) pool.splice(i, 1);
    else out.push(x);
  }
  return out;
}

/** Attribution wording a value-only rewrite may drop: who recorded it, how, and where ("as recorded by …, using the …"). */
const ATTRIBUTION_WORDS = new Set(
  (
    "as recorded reported noted measured assessed documented scored rated described stated using by on at in the a an of " +
    "her his their my our first initial latest last final assessment review appointment session visit note notes " +
    "physiotherapist physiotherapists physio clinician therapist senior scale score"
  ).split(" "),
);
/** The repeated printed verb a printed-lead rewrite drops ("returning to", "to go back to", "resuming"). */
const PRINTED_VERB_WORDS: ReadonlySet<string> = new Set(
  "to return returns returning returned go goes going back get gets getting come comes coming went got resume resumes resuming resumed improve improves improving improved be being able".split(" "),
);

/** The lower-case words of `before` a rewrite no longer has (capitalised names and terms aside). */
function droppedWords(before: string, after: string): string[] {
  const lower = (t: string) => (t.match(/\b[a-z][a-z'’-]*\b/g) ?? []).map((w) => w.replace("’", "'"));
  const afterAll = (after.toLowerCase().match(/\b[a-z][a-z'’-]*\b/g) ?? []).map((w) => w.replace("’", "'"));
  return missingFrom(lower(before), afterAll);
}

/** The clinicians of the record, as their full names and surnames ("Tom Ellis", "Ellis"). */
function clinicianNames(bundle: Pick<EpisodeBundle, "clinicians" | "notes">): string[] {
  const out = new Set<string>();
  const add = (name: string | undefined) => {
    const n = (name ?? "").trim();
    if (!n) return;
    out.add(n);
    const last = n.split(/\s+/).pop() ?? "";
    if (last.length >= 3) out.add(last);
  };
  for (const c of bundle.clinicians ?? []) add(c.name);
  for (const n of bundle.notes ?? []) add(n.author?.name);
  return Array.from(out);
}

const JOB_TITLE = /\b(?:physiotherapists?|physio|clinicians?|therapists?|consultants?|surgeons?|doctors?|GPs?)\b/i;
const TITLED_NAME = /\b(?:Dr|Prof)\.?\s+[A-Z]/;
const FIRST_PERSON_RECORD = /\bI (?:recorded|noted|found|assessed|measured|observed|examined|documented|saw|reviewed)\b/;
const DATE_FIGURE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/;
/** A recording verb or "also": the sentence reports what a clinician recorded, at a time the sentence before gave. */
const RECORDING = /\b(?:also|recorded|noted|found|assessed|measured|observed|examined|documented|reviewed|scored|reported)\b/i;
/**
 * A sentence that leans on the one before it (bh2 WD harden N6): it opens by pointing back ("This had improved …",
 * "These were …", "It settled …"), or it refers to a time the sentence before gave ("At that review …", "on the same
 * day", "at that appointment") without a date of its own.
 */
const POINTS_BACK =
  /^\s*[("“‘]?\s*(?:This|These|That|Those|It|Such|The same|Again|Then|Afterwards|Subsequently|Later|Thereafter|Since then|By then|Back then|Until then|At the time|At that (?:time|point|stage)|Before (?:this|that)|At this point|Following this|After (?:this|that)|Despite (?:this|that)|However|Nevertheless|In addition|Additionally|Furthermore|Moreover|Also|As a result|Consequently|Therefore|Otherwise|Instead)\b|\b(?:this|these|those|the same)\s+(?:had|has|have|was|were|is|are|did|does|settled|improved|resolved|eased|worsened|persisted|continued|remained)\b/i;
const REFERS_TO_TIME =
  /\b(?:(?:at|on|in|during|from|by|after|before|since|following)\s+(?:that|this|the same|the said|the|each)\s+(?:review|appointment|session|visit|assessment|consultation|examination|contact|occasion|note|day|date|time|point|stage)|(?:that|the same)\s+(?:day|date|week|morning|afternoon|evening))\b/i;

/** Whether a sentence names a clinician: by name, as "Dr …" / "Prof …", or as "I recorded …". */
function namesClinician(sentence: string, names: readonly string[]): boolean {
  if (TITLED_NAME.test(sentence) || FIRST_PERSON_RECORD.test(sentence)) return true;
  return names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(sentence));
}

/** Whether a sentence holds a date ("06/05/2026", "6 May"). */
function hasDate(sentence: string): boolean {
  return figuresOf(sentence).some((f) => DATE_FIGURE.test(f)) || /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(sentence);
}

/**
 * Whether a removed sentence gave who recorded something or when – a clinician's name or job title, "I recorded …", or
 * a date – so that the sentence after it may lean on it.
 */
function givesAttribution(sentence: string, names: readonly string[]): boolean {
  return JOB_TITLE.test(sentence) || namesClinician(sentence, names) || hasDate(sentence);
}

/**
 * Whether a sentence says who recorded it or when on its own (bh2 WD harden N6): a clinician's name, "Dr …", "I
 * recorded …", or a date. A bare job title is not enough – "the physiotherapist also recorded …" names nobody in a
 * record with two physiotherapists.
 */
function attributes(sentence: string, names: readonly string[]): boolean {
  return namesClinician(sentence, names) || hasDate(sentence);
}

/** Question words that say nothing about what is asked. */
const QUESTION_STOPWORDS = new Set(
  ("a an the and or of to in on at for with by from is are was were be been if yes no please give state describe details detail any other what which when how does do did has have had this that these those there their his her its patient claimant " +
    "you your we our us client above below either both brief briefly provide note notes list where necessary appropriate relevant additional further comments comment information").split(" "),
);

/** The words of a question that say what it asks ("If yes, describe the treatment advised" → treatment, advised). */
function questionWords(question: string): string[] {
  return (question.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2 && !QUESTION_STOPWORDS.has(w));
}

/**
 * The topics a question can ask about, each with the words of a sentence that answers it – so a sentence that answers
 * "Treatment provided" without the question's own words ("He was given a home programme of pelvic tilts") still counts
 * as the box's answering sentence (B3-5 c, bh2 WD review M2).
 */
const QUESTION_TOPICS: ReadonlyArray<{ question: RegExp; sentence: RegExp }> = [
  {
    question: /\b(?:treat\w*|therap\w*|intervention\w*|management|managed|exercis\w*|rehab\w*|advice|advised|care|done|so far|to date|given|provided|carried out|undertaken)\b/i,
    sentence:
      /\b(?:treat\w*|therap\w*|exercis\w*|programmes?|programs?|HEP|manual|mobilis\w*|mobiliz\w*|manipulat\w*|massage|soft[- ]tissue|acupunct\w*|needl\w*|tap(?:e|ed|ing)|advice|advised|educat\w*|reassur\w*|stretch\w*|strengthen\w*|hydrotherap\w*|ultrasound|TENS|shockwave|injections?|sessions?|prescrib\w*|pilates|gym|tilts?|squats?|bridges?|rehab\w*|taught|shown|instructed|demonstrated|issued|bracing|core|graded|pacing|loading|progressed|mobility|heat|ice|cold|hot|packs?|braces?|splints?|crutch\w*|walking aid|orthotic\w*|insoles?)\b/i,
  },
  {
    question: /\b(?:examin\w*|findings?|find|found|observations?|objective|physical|impression|range|movement|flexion|extension|tests?|measure\w*|scores?|outcome)\b/i,
    sentence:
      /\b(?:range|flexion|extension|rotation|abduction|movement|tender\w*|palpat\w*|strength|power|reflex\w*|tests?|tested|positive|negative|limited|restricted|full|pain-free|ROM|examin\w*|observ\w*|measur\w*|scor\w*|index|oswestry|ODI|NPRS|PSFS|QuickDASH|degrees?|neurolog\w*|sensation)\b/i,
  },
  {
    question: /\b(?:symptoms?|complaints?|pain|presenting|problems?|feel\w*|felt)\b/i,
    sentence: /\b(?:pain\w*|ache\w*|aching|stiff\w*|sore\w*|symptom\w*|numb\w*|tingl\w*|sleep\w*|swell\w*|weak\w*|discomfort|headaches?|spasms?)\b/i,
  },
  {
    question: /\b(?:work\w*|employ\w*|job|dut(?:y|ies)|occupation\w*)\b/i,
    sentence: /\b(?:work\w*|job|dut(?:y|ies)|employ\w*|shifts?|office|occupation\w*|fit note)\b/i,
  },
  {
    question: /\b(?:incident|accident|injur\w*|mechanism|history|onset)\b/i,
    sentence: /\b(?:lift\w*|fell|fall\w*|slip\w*|twist\w*|collision|accident|incident|injur\w*|struck|hit|onset|began|started)\b/i,
  },
  {
    question: /\b(?:medic\w*|drugs?|analges\w*|tablets?|prescri\w*)\b/i,
    sentence: /\b(?:medic\w*|tablets?|analges\w*|ibuprofen|paracetamol|naproxen|codeine|co-codamol|tramadol|diclofenac|gabapentin|pregabalin|amitriptyline|prescri\w*|dose)\b/i,
  },
  {
    question: /\b(?:progress|current|status|now|discharg\w*|recover\w*|outcome)\b/i,
    sentence: /\b(?:progress\w*|improv\w*|better|worse|resolv\w*|settl\w*|discharg\w*|recover\w*|currently|now|status|returned)\b/i,
  },
  {
    question: /\b(?:goals?|aims?|targets?)\b/i,
    sentence: /\b(?:goals?|aim\w*|return\w*|targets?)\b/i,
  },
  {
    question: /\b(?:prognos\w*|outlook|expected|expectation\w*|recovery time)\b/i,
    sentence: /\b(?:prognos\w*|outlook|expect\w*|recover\w*|resolv\w*|settl\w*|improv\w*|full|return\w*|weeks?|months?)\b/i,
  },
  {
    question: /\b(?:adjust\w*|modif\w*|restrict\w*|adaptations?|amended|phased|fitness|fit for)\b/i,
    sentence: /\b(?:adjust\w*|modif\w*|restrict\w*|avoid\w*|amended|light(?:er)? duties|phased|reduced hours|no (?:heavy )?lifting|fit|duties|hours|shifts?)\b/i,
  },
  {
    question: /\b(?:referr\w*|reason for)\b/i,
    sentence: /\b(?:referr\w*|injur\w*|pain|accident|incident|assess\w*|treatment|GP|insurer|employer)\b/i,
  },
  {
    question: /\b(?:diagnos\w*|impression|conditions?|injur(?:y|ies)|sustained|clinical details)\b/i,
    sentence: /\b(?:diagnos\w*|strain\w*|sprain\w*|whiplash|WAD|non-specific|mechanical|tendin\w*|tendon\w*|syndrome|injur\w*|fracture\w*|tear|lesion|pain|ligament\w*|muscul\w*|soft[- ]tissue|consistent with)\b/i,
  },
  {
    question: /\b(?:red flags?)\b/i,
    sentence: /\b(?:red flags?|saddle|bladder|bowel|cauda|weight loss|fever|night pain|neurolog\w*)\b/i,
  },
  {
    question: /\b(?:pre-existing|previous|past|prior|medical history|PMH|history)\b/i,
    sentence: /\b(?:previous\w*|past|history|before|prior|pre-existing|episode|years? ago|no other|otherwise well|fit and well|(?:19|20)\d{2})\b/i,
  },
  {
    question: /\b(?:psychosocial|barriers?|obstacles?|yellow flags?|recovery)\b/i,
    sentence: /\b(?:anx\w*|stress\w*|worr\w*|fear\w*|mood|depress\w*|barriers?|obstacles?|psychosocial|motivat\w*|confiden\w*|sleep\w*|work\w*|childcare|caring)\b/i,
  },
  {
    question: /\b(?:hospital|A&E|admitted|admission|overnight)\b/i,
    sentence: /\b(?:hospital|A&E|admitted|ambulance|emergency|x-?ray\w*|scan\w*)\b/i,
  },
  {
    question: /\b(?:dates?|appointments?|sessions?|attend\w*|failures? to attend)\b/i,
    sentence: /\b(?:attended|sessions?|appointments?|did not attend|DNA|cancel\w*|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i,
  },
  {
    question: /\b(?:quality of life|daily|activit\w*|function\w*|hobb\w*|sleep\w*|lifestyle|social)\b/i,
    sentence: /\b(?:sleep\w*|walk\w*|sit\w*|stand\w*|driv\w*|housework|hobb\w*|sport\w*|football|run\w*|dress\w*|lift\w*|daily|activit\w*|function\w*|gym|garden\w*)\b/i,
  },
];

/**
 * Whether the engine can tell what a question asks about by one of the topics above ("Mechanism of injury", "Work
 * status", "Appointment dates"). "Anything else to add" and "Details where it applies" are not: for them
 * only the question's own words, used by a sentence of the box, tell which sentence answers it.
 */
export function questionTopicKnown(question: string): boolean {
  return QUESTION_TOPICS.some((t) => t.question.test(question));
}

/**
 * Whether a sentence answers the question: it uses a word of the question (compared on their first five letters:
 * "advised" ~ "advise"), or the words of a topic the question asks about.
 */
export function answersQuestion(sentence: string, question: string): boolean {
  const stems = new Set(questionWords(question).map((w) => w.slice(0, 5)));
  if (stems.size > 0 && (sentence.toLowerCase().match(/[a-z]+/g) ?? []).some((w) => w.length > 2 && stems.has(w.slice(0, 5)))) return true;
  return QUESTION_TOPICS.some((t) => t.question.test(question) && t.sentence.test(sentence));
}

/** A box only the clinician decides: an opinion, or the physiotherapist's own choice (WC design 3). */
function clinicianBox(section: Pick<ReportSection, "kind">, field: Pick<FormField, "fillSource" | "guidance"> | undefined): boolean {
  if (section.kind === "clinician_opinion") return true;
  return field ? field.fillSource.kind === "clinician_opinion" || recordSourceOf(field) === "physio_choice" : false;
}

/** Whether a box prints the text of its paragraphs as the report stands (not a structured answer, not set aside). */
function printsText(section: ReportSection | undefined): boolean {
  if (!section) return false;
  if (section.answer && section.answer.kind !== "text") return false;
  if (section.disposition && section.disposition.kind !== "applies_anyway") return false;
  // A box with a condition may not be asked at all (WA1's issue state decides) – the twin is not relied on.
  if (section.condition) return false;
  return true;
}

/** The text with one paragraph's text replaced (or the paragraph removed when `text` is ""). */
function withParagraphText(report: Report, key: string, paragraphId: string, text: string): Report {
  return {
    ...report,
    sections: report.sections.map((s) =>
      s.key !== key ? s : { ...s, paragraphs: text === "" ? s.paragraphs.filter((p) => p.id !== paragraphId) : s.paragraphs.map((p) => (p.id === paragraphId ? { ...p, text } : p)) },
    ),
  };
}

const blockKey = (f: ReportFlag) => `${f.code}|${f.sectionKey ?? ""}`;

function countBy(flags: readonly ReportFlag[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of flags) if (f.code !== "OPEN_GAP") m.set(blockKey(f), (m.get(blockKey(f)) ?? 0) + 1);
  return m;
}

/**
 * The engine's rules for one candidate (see the header). Returns the problems found – empty when the fix may be
 * offered. `blockingBefore` is the report's blocking flags now (computed once by the caller).
 */
export function fixRuleProblems(report: Report, c: FixCandidate, ctx: FixContext, blockingBefore: readonly ReportFlag[]): string[] {
  const problems: string[] = [];
  const section = report.sections.find((s) => s.key === c.sectionKey);
  const paragraph = section?.paragraphs.find((p) => p.id === c.paragraphId);
  if (!section || !paragraph || paragraph.text !== c.before) return ["the paragraph has changed"];
  const field = ctx.form?.fields.find((f) => f.id === (section.fieldId ?? section.key));
  const compact = compactPlace(field) !== null || (field ? printedLeadOf(field, ctx.form) !== null : false);

  // Text: whole sentences, figures, starts, orphaned "He recorded".
  const noteDates = paragraph.sourceIds.map((id) => report.bundleSnapshot.notes.find((n) => n.id === id)?.date).filter((d): d is string => Boolean(d));
  const citedDates = noteDates.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`);
  for (const p of checkSafeEdit({ before: c.before, after: c.after, removedSpans: c.removedSpans })) {
    if (p.kind === "partial_sentence") problems.push("it would take out part of a sentence");
    else if (p.kind === "figures_changed") {
      const gained = p.gained.filter((g) => !citedDates.includes(g));
      if (p.lost.length || gained.length) problems.push(`it would change a figure or date (${[...p.lost, ...gained].join(", ")})`);
    } else if (p.kind === "bad_start") {
      // A compact value is a value, not a sentence: it may start with a figure or in lower case.
      const first = splitSentences(c.after, "notes")[0]?.text === p.sentence;
      if (!(compact && first && (p.problem === "digit" || p.problem === "lower_case"))) problems.push(`a sentence would start badly (“${p.sentence.slice(0, 30)}”)`);
    }
  }
  // No sentence is left leaning on a clinician or a date the removal takes out (B3-5 a): "At that review he recorded …".
  if (c.removedSpans.length > 0) {
    const names = clinicianNames(report.bundleSnapshot);
    const spans = splitSentences(c.before);
    const removed = (i: number) => c.removedSpans.some((r) => spans[i].start >= r.start && spans[i].end <= r.end);
    for (let i = 0; i < spans.length; i++) {
      if (!removed(i)) continue;
      let j = i;
      while (j + 1 < spans.length && removed(j + 1)) j++;
      const next = spans[j + 1];
      const run = spans.slice(i, j + 1);
      const tookAttribution = run.some((x) => givesAttribution(x.text, names));
      const tookDate = run.some((x) => hasDate(x.text));
      if (next && POINTS_BACK.test(next.text)) {
        problems.push(`“${next.text.slice(0, 30)}…” would point back at a sentence that is no longer there`);
      } else if (next && REFERS_TO_TIME.test(next.text) && !hasDate(next.text)) {
        problems.push(`“${next.text.slice(0, 30)}…” would lose the date it refers to`);
      } else if (next && tookAttribution && !attributes(next.text, names)) {
        problems.push(`“${next.text.slice(0, 30)}…” would lose the clinician or date it relies on`);
      } else if (next && tookDate && !hasDate(next.text) && RECORDING.test(next.text)) {
        problems.push(`“${next.text.slice(0, 30)}…” would lose the date it relies on`);
      }
      i = j;
    }
  }
  if (c.removedSpans.length === 0 && c.after !== "" && c.before !== c.after) {
    // A rewrite keeps every figure (bar the cited note's own date it may add) – checked above with no removed spans.
    const { lost } = figureChanges(c.before, c.after);
    if (lost.length && !problems.some((x) => x.startsWith("it would change"))) problems.push(`it would drop a figure (${lost.join(", ")})`);
    // A rewrite keeps every negation (bh2 WD review M3): "No red flags were reported" never becomes "Red flags …".
    const lostNegations = missingFrom(negationsOf(c.before), negationsOf(c.after));
    if (lostNegations.length) problems.push(`it would drop a negation (“${lostNegations.join("”, “")}”)`);
    // A rewrite of WD's drops only what it is for (the attribution, the printed verb) – never a clause of the answer.
    if (c.droppable) {
      const extra = droppedWords(c.before, c.after).filter((w) => !ATTRIBUTION_WORDS.has(w) && !c.droppable!.has(w));
      if (extra.length) problems.push(`it would drop words of the answer (“${extra.slice(0, 4).join("”, “")}”)`);
    }
  }
  // Clinical negatives are never removed.
  const kept = splitSentences(c.after).map((s) => s.text);
  for (const s of splitSentences(c.before)) {
    if (CLINICAL_NEGATIVE.test(s.text) && !kept.some((k) => k.includes(s.text.replace(/[.\s]+$/, "")))) {
      if (c.removedSpans.some((r) => r.text.includes(s.text)) || c.after === "") problems.push(`it would remove a clinical negative (“${s.text.slice(0, 30)}…”)`);
    }
  }
  // The box keeps its answer: never left empty, and never without the only sentence that answers its question (B3-5 c).
  const next = withParagraphText(report, c.sectionKey, c.paragraphId, c.after);
  if (!boxText(next, c.sectionKey)) problems.push("it would remove the box's only answer");
  else if (c.removedSpans.length > 0) {
    const question = section.title || field?.label || "";
    const answering = (t: string) => answersQuestion(t, question);
    const removedAnswering = c.removedSpans.some((r) => answering(r.text));
    const stillAnswering = splitSentences(boxText(next, c.sectionKey)).some((x) => answering(x.text));
    if (removedAnswering && !stillAnswering) problems.push("it would remove the only sentence that answers the question");
    // A question whose topic the engine cannot tell ("Anything else to add", "Details where it applies") and whose
    // words no sentence of the box uses: any sentence may be its answer, so none is removed (bh2 WD harden N6).
    else if (!questionTopicKnown(question) && !splitSentences(boxText(report, c.sectionKey)).some((x) => answering(x.text))) {
      problems.push("it cannot tell which sentence answers the question");
    }
  }
  // The repeated twin still prints, and says every figure and date the removed sentence says (bh2 WD review M1).
  for (const t of c.twins ?? []) {
    const twinSection = next.sections.find((s) => s.key === t.sectionKey);
    const twinParagraph = twinSection?.paragraphs.find((p) => p.id === t.paragraphId);
    const label = twinSection?.title.trim() || t.sectionKey;
    if (!twinParagraph || !printsText(twinSection) || !splitSentences(twinParagraph.text).some((x) => sentenceKey(x.text) === sentenceKey(t.text))) {
      problems.push(`what it repeats (“${label}”) would not print`);
      continue;
    }
    const lost = figureChanges(t.removed, t.text).lost;
    if (lost.length) problems.push(`“${label}” does not say ${lost.join(", ")}`);
    // The twin says the same finding, and every word of it (bh2 WD harden N1): never "right knee" for "left knee",
    // "occasional" for "constant", the discharge state for the first assessment's, a finding for its negative.
    else if (!removableRepeat(t.removed, t.text, nameWords(report.bundleSnapshot))) problems.push(`“${label}” does not say all of “${t.removed.slice(0, 40)}…”`);
  }
  // Re-validation: no blocking flag added, none cleared but the ones the fix answers.
  const after = validationOf({ ...next, flags: [] }, ctx);
  const was = countBy(blockingBefore);
  const now = countBy(after);
  const answered = countBy(c.answers.filter((f) => f.severity === "blocking"));
  now.forEach((n, k) => {
    if (n > (was.get(k) ?? 0)) problems.push(`re-validation adds a blocking ${k.split("|")[0]}`);
  });
  was.forEach((n, k) => {
    if ((now.get(k) ?? 0) < n - (answered.get(k) ?? 0)) problems.push(`it would clear a blocking ${k.split("|")[0]} it does not answer`);
  });
  return problems;
}

/**
 * The engine's check of one candidate: the proposal to offer, or null when any rule fails (WD design 6 – planFix).
 */
export function planFix(report: Report, c: FixCandidate, ctx: FixContext, blockingBefore?: readonly ReportFlag[]): FixProposal | null {
  const before = blockingBefore ?? validationOf({ ...report, flags: [] }, ctx);
  if (fixRuleProblems(report, c, ctx, before).length > 0) return null;
  const flagId = c.answers[0]?.id;
  return {
    generator: c.generator,
    ...(flagId ? { flagId } : {}),
    sectionKey: c.sectionKey,
    paragraphId: c.paragraphId,
    label: c.label,
    before: c.before,
    after: c.after,
    removedSpans: c.removedSpans.map((r): FixSpan => ({ start: r.start, end: r.end })),
    ...(c.ackPolicy ? { ackPolicy: c.ackPolicy } : {}),
  };
}

function paragraphOf(report: Report, key: string | undefined, paragraphId: string | undefined): { section: ReportSection; paragraph: Paragraph } | null {
  const section = report.sections.find((s) => s.key === key);
  const paragraph = section?.paragraphs.find((p) => p.id === paragraphId);
  return section && paragraph ? { section, paragraph } : null;
}

const open = (report: Report) => report.flags.filter((f) => !f.acknowledged && f.code === "DRAFT_FIT");

/** "Remove the repeated sentence": every sentence of the paragraph another box already says, in one action (B3-5 b). */
function repeatCandidates(report: Report, ctx: FixContext): FixCandidate[] {
  if (!hookEnabled(REPEAT_REMOVAL_HOOK)) return [];
  const flags = open(report).filter((f) => (f.evidence ?? "").startsWith("repeat ") && f.severity === "warning");
  if (flags.length === 0) return [];
  const repeats = repeatedSentences(report, ctx.form);
  const out: FixCandidate[] = [];
  for (const flag of flags) {
    const at = paragraphOf(report, flag.sectionKey, flag.paragraphId);
    if (!at) continue;
    const mine = repeats.filter((r) => r.paragraphId === at.paragraph.id);
    if (mine.length === 0) continue;
    const { after, removedSpans } = removeSentences(at.paragraph.text, mine.map((r) => r.sentence.index));
    out.push({
      generator: "repeat-removal",
      label: mine.length === 1 ? "Remove the repeated sentence" : `Remove the ${mine.length} repeated sentences`,
      sectionKey: at.section.key,
      paragraphId: at.paragraph.id,
      before: at.paragraph.text,
      after,
      removedSpans,
      answers: [flag],
      ackPolicy: "member",
      twins: mine.map((r) => ({ sectionKey: r.of.key, paragraphId: r.of.paragraphId, text: r.of.sentence, removed: r.sentence.text })),
    });
  }
  return out;
}

/** "Remove the second copy": an exact duplicate paragraph of the same box. */
function duplicateCandidates(report: Report): FixCandidate[] {
  const flags = open(report).filter((f) => (f.evidence ?? "").startsWith("duplicate "));
  const dups = duplicateParagraphs(report.sections);
  const out: FixCandidate[] = [];
  for (const flag of flags) {
    const at = paragraphOf(report, flag.sectionKey, flag.paragraphId);
    if (!at || !dups.some((d) => d.paragraphId === at.paragraph.id)) continue;
    const whole = splitSentences(at.paragraph.text).map((s) => ({ start: s.start, end: s.end, text: s.text }));
    out.push({ generator: "duplicate-paragraph", label: "Remove the second copy", sectionKey: at.section.key, paragraphId: at.paragraph.id, before: at.paragraph.text, after: "", removedSpans: whole, answers: [flag], ackPolicy: "member" });
  }
  return out;
}

/** The time point a printed question names: "start" (initial, first, pre-injury …), "end" (now, current, discharge …), or null. */
function labelTimePoint(field: Pick<FormField, "label">): "start" | "end" | null {
  return valueOnlyTimePoint(field.label);
}

/** "Use the value only" (B2-16): a compact value from the voice owner's own note, without its undated attribution. */
function valueOnlyCandidates(report: Report, ctx: FixContext): FixCandidate[] {
  if (!hookEnabled(VALUE_ONLY_HOOK)) return [];
  const owner = voiceOwnerOfReport(report);
  const out: FixCandidate[] = [];
  for (const flag of open(report).filter((f) => f.evidence === "shorten")) {
    const at = paragraphOf(report, flag.sectionKey, flag.paragraphId);
    if (!at || at.section.paragraphs[0] !== at.paragraph) continue;
    const field = ctx.form?.fields.find((f) => f.id === (at.section.fieldId ?? at.section.key));
    if (!field || compactPlace(field) === null || field.fillSource.kind !== "notes_narrative") continue;
    // C-REV-1: a colleague's finding keeps their name – only the owner's own notes.
    if (!citesOnlyOwnersNotes(at.paragraph, report.bundleSnapshot, owner)) continue;
    const value = valueOnlyText(at.paragraph.text);
    if (!value) continue;
    // The attribution may say which time point the value is from ("… at the first assessment"): it goes only when the
    // printed question says the same time point.
    const said = valueOnlyTimePoint(at.paragraph.text.slice(value.length));
    if (said && said !== labelTimePoint(field)) continue;
    out.push({
      generator: "value-only",
      label: `Use the value only (${value.length > 40 ? `${value.slice(0, 37)}…` : value})`,
      sectionKey: at.section.key,
      paragraphId: at.paragraph.id,
      before: at.paragraph.text,
      after: value,
      removedSpans: [],
      answers: [flag],
      ackPolicy: "member",
      droppable: new Set<string>(),
    });
  }
  return out;
}

/**
 * "(dose not stated)" (B3-12): a medicine named without a dose no cited source gives. The finding is the validator's
 * own (draft-fit/measure.ts dosePart, which reads every cited source – notes, REG, facts – and every mention of the
 * medicine in them): the fix uses the flag's medicine and re-checks only the paragraph's own wording.
 */
function doseCandidates(report: Report): FixCandidate[] {
  const out: FixCandidate[] = [];
  for (const flag of open(report).filter((f) => (f.evidence ?? "").startsWith("dose "))) {
    const at = paragraphOf(report, flag.sectionKey, flag.paragraphId);
    if (!at) continue;
    const flagged = (flag.evidence ?? "").slice("dose ".length).trim().toLowerCase();
    const mention = medicinesWithoutDose(at.paragraph.text).find((m) => m.name === flagged);
    if (!mention) continue;
    const end = mention.end;
    const after = `${at.paragraph.text.slice(0, end)} (dose not stated)${at.paragraph.text.slice(end)}`;
    out.push({ generator: "dose-not-stated", label: "Add “(dose not stated)”", sectionKey: at.section.key, paragraphId: at.paragraph.id, before: at.paragraph.text, after, removedSpans: [], answers: [flag], ackPolicy: "member" });
  }
  return out;
}

/** "Take out the repeated verb" (B2-8, B3-8): the answer without the verb the form prints before it. */
function printedLeadCandidates(report: Report, ctx: FixContext): FixCandidate[] {
  const out: FixCandidate[] = [];
  for (const flag of open(report).filter((f) => f.evidence === "printed lead")) {
    const at = paragraphOf(report, flag.sectionKey, flag.paragraphId);
    if (!at) continue;
    const field = ctx.form?.fields.find((f) => f.id === (at.section.fieldId ?? at.section.key));
    const lead = field ? printedLeadOf(field, ctx.form) : null;
    const after = withoutPrintedVerb(at.paragraph.text, lead);
    if (!after || after === at.paragraph.text) continue;
    out.push({ generator: "printed-lead", label: `Take out the repeated “${lead}”`, sectionKey: at.section.key, paragraphId: at.paragraph.id, before: at.paragraph.text, after, removedSpans: [], answers: [flag], ackPolicy: "member", droppable: PRINTED_VERB_WORDS });
  }
  return out;
}

/** WB's attribution, quotation and commentary fixes (core/validation/attribution-fixes.ts), as candidates. */
function attributionCandidates(report: Report, actor: Actor): FixCandidate[] {
  const out: FixCandidate[] = [];
  if (ATTRIBUTION_FIX_GENERATORS.length === 0) return out;
  for (const flag of report.flags.filter((f) => !f.acknowledged && f.paragraphId)) {
    const at = paragraphOf(report, flag.sectionKey, flag.paragraphId);
    if (!at) continue;
    for (const gen of ATTRIBUTION_FIX_GENERATORS) {
      const p = gen({ report, section: at.section, paragraph: at.paragraph, flag, actor });
      if (!p || p.sectionKey !== at.section.key || p.paragraphId !== at.paragraph.id || p.before !== at.paragraph.text) continue;
      const removedSpans = p.removedSpans.map((r) => ({ start: r.start, end: r.end, text: p.before.slice(r.start, r.end) }));
      out.push({ generator: p.generator, label: p.label, sectionKey: p.sectionKey, paragraphId: p.paragraphId, before: p.before, after: p.after, removedSpans, answers: [flag], ...(p.ackPolicy ? { ackPolicy: p.ackPolicy } : {}) });
    }
  }
  return out;
}

/** Whether `actor` may apply a fix with this policy: "approver" fixes are the report's approver's (WC). */
function mayApply(policy: FixProposal["ackPolicy"], report: Pick<Report, "approver">, actor: Actor): boolean {
  if (policy === "never") return false;
  if (policy === "approver") return Boolean(report.approver && report.approver.memberId === actor.memberId);
  return true;
}

/**
 * Every one-click fix the engine offers `actor` on `report` (whose flags are the validators' latest), each checked by
 * planFix. A signed report offers none. Used by the review (fix-preview.tsx) and the safety corpus.
 */
export function offeredFixes(report: Report, ctx: FixContext & { actor: Actor }): FixProposal[] {
  if (report.status === "signed") return [];
  // A text fix in a clinician's box is the approver's (WC design 4); WB's generators set their own policy.
  const own = [...repeatCandidates(report, ctx), ...duplicateCandidates(report), ...valueOnlyCandidates(report, ctx), ...doseCandidates(report), ...printedLeadCandidates(report, ctx)].map(
    (c): FixCandidate => {
      const section = report.sections.find((s) => s.key === c.sectionKey);
      const field = ctx.form?.fields.find((f) => f.id === (section?.fieldId ?? c.sectionKey));
      return section && clinicianBox(section, field) ? { ...c, ackPolicy: "approver" } : c;
    },
  );
  const candidates = [...own, ...attributionCandidates(report, ctx.actor)].filter((c) => mayApply(c.ackPolicy, report, ctx.actor));
  if (candidates.length === 0) return [];
  const blockingBefore = validationOf({ ...report, flags: [] }, ctx);
  const out: FixProposal[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = `${c.generator}|${c.paragraphId}`;
    if (seen.has(key)) continue;
    const proposal = planFix(report, c, ctx, blockingBefore);
    if (!proposal) continue;
    seen.add(key);
    out.push(proposal);
  }
  return out;
}

/** An undo: a FixProposal, plus – for a removed duplicate paragraph – the paragraph to put back and where. */
export interface UndoProposal extends FixProposal {
  restore?: { paragraph: Paragraph; index: number };
}

/**
 * The proposal that undoes an applied one: its after back to its before. A removed duplicate paragraph (after "")
 * is put back as it was, where it was – pass the report as it stood when the fix was applied (`before`), which holds
 * the paragraph; without it the removal cannot be undone (the undo changes nothing).
 */
export function undoProposal(applied: FixProposal, before?: Pick<Report, "sections">): UndoProposal {
  const base: UndoProposal = { generator: `undo-${applied.generator}`.slice(0, 64), sectionKey: applied.sectionKey, paragraphId: applied.paragraphId, label: "Undo", before: applied.after, after: applied.before, removedSpans: [] };
  if (applied.after.trim() !== "" || !before) return base;
  const section = before.sections.find((s) => s.key === applied.sectionKey);
  const index = section ? section.paragraphs.findIndex((p) => p.id === applied.paragraphId) : -1;
  if (!section || index < 0 || section.paragraphs[index].text !== applied.before) return base;
  return { ...base, restore: { paragraph: section.paragraphs[index], index } };
}

const quoteExcerpt = (s: string) => `“${s.length > 70 ? `${s.slice(0, 67).trimEnd()}…` : s}”`;

/**
 * Apply a one-click fix the engine offered (the reducer's `applyFix {proposal}`, use-review-state.ts – WC; the safety
 * corpus dispatches it too). Only while the paragraph still reads `before`; a signed report never changes. The text
 * becomes `after` (a removal of a whole duplicate paragraph removes it), the paragraph keeps its origin – "ai" stays
 * "ai", so the drafted-text checks keep running – and the fix is recorded in Paragraph.fixes {kind, by, at, edits} and
 * in the activity log.
 */
export function applyFixProposal(report: Report, proposal: FixProposal | UndoProposal, actor: Actor, now?: Date): Report {
  if (report.status === "signed") return report;
  const restore = "restore" in proposal ? proposal.restore : undefined;
  if (restore) return restoreParagraph(report, proposal, restore, actor, now);
  const at = paragraphOf(report, proposal.sectionKey, proposal.paragraphId);
  if (!at || at.paragraph.text !== proposal.before || proposal.before === proposal.after) return report;
  const when = (now ?? new Date()).toISOString();
  const section = at.section;
  let sections: ReportSection[];
  if (proposal.after.trim() === "") {
    // Only a duplicate paragraph goes whole – and only while the box keeps another paragraph.
    if (!section.paragraphs.some((p) => p.id !== proposal.paragraphId && p.text.trim())) return report;
    sections = report.sections.map((s) => (s.key !== section.key ? s : { ...s, paragraphs: s.paragraphs.filter((p) => p.id !== proposal.paragraphId) }));
  } else {
    const fix = { kind: proposal.generator.slice(0, 64), by: actor, at: when, edits: [{ start: 0, end: proposal.before.length, text: proposal.after }] };
    sections = report.sections.map((s) =>
      s.key !== section.key ? s : { ...s, paragraphs: s.paragraphs.map((p): Paragraph => (p.id !== proposal.paragraphId ? p : { ...p, text: proposal.after, fixes: [...(p.fixes ?? []), fix] })) },
    );
  }
  return appendActivity(
    { ...report, sections, updatedAt: when },
    { actor: actor.name, action: "edited", detail: `${section.key}: one-click fix “${proposal.label}” – ${quoteExcerpt(proposal.before)} → ${proposal.after.trim() ? quoteExcerpt(proposal.after) : "removed"}.` },
    now,
  );
}

/** Undo of "Remove the second copy": the paragraph back where it was, while the box does not have it. */
function restoreParagraph(report: Report, proposal: FixProposal, restore: NonNullable<UndoProposal["restore"]>, actor: Actor, now?: Date): Report {
  const section = report.sections.find((s) => s.key === proposal.sectionKey);
  if (!section || section.paragraphs.some((p) => p.id === restore.paragraph.id) || restore.paragraph.text !== proposal.after) return report;
  const when = (now ?? new Date()).toISOString();
  const paragraphs = [...section.paragraphs];
  paragraphs.splice(Math.min(restore.index, paragraphs.length), 0, restore.paragraph);
  const sections = report.sections.map((s) => (s.key !== section.key ? s : { ...s, paragraphs }));
  return appendActivity(
    { ...report, sections, updatedAt: when },
    { actor: actor.name, action: "edited", detail: `${section.key}: one-click fix undone – ${quoteExcerpt(restore.paragraph.text)} put back.` },
    now,
  );
}

/* ------------------------------------------------------------------------------------------------
 * The signer's own voice, leftover "not recorded" sentences
 * ----------------------------------------------------------------------------------------------*/

/**
 * Drafted paragraphs that report `authorName`'s own notes as record-keeping – in the third person ("Sarah
 * Reid recorded…", "she recorded…") or as "I recorded…" – which "Write in my own voice" turns into the
 * signer's plain clinical wording (core/voice.ts inOwnClinicalWording).
 */
export function ownVoiceCandidates(report: Pick<Report, "sections" | "bundleSnapshot">, authorName: string): Array<{ key: string; paragraphId: string }> {
  const out: Array<{ key: string; paragraphId: string }> = [];
  for (const s of report.sections) {
    for (const p of s.paragraphs) {
      if (isOwnVoiceCandidate(p, report.bundleSnapshot, authorName, { pronouns: true }) && inOwnClinicalWording(p.text, authorName, { pronouns: true }) !== p.text) out.push({ key: s.key, paragraphId: p.id });
    }
  }
  return out;
}

/**
 * Rewrite every candidate paragraph in the author's own voice. Each becomes "edited" (the AI wording
 * stays available through "Revert to AI draft"); citations are unchanged. One activity entry.
 */
export function writeInOwnVoice(report: Report, authorName: string, actor: string, now?: Date): Report {
  const targets = ownVoiceCandidates(report, authorName);
  if (targets.length === 0) return report;
  let next = report;
  for (const t of targets) {
    const p = next.sections.find((s) => s.key === t.key)?.paragraphs.find((x) => x.id === t.paragraphId);
    if (p) next = editParagraph(next, t.key, t.paragraphId, inOwnClinicalWording(p.text, authorName, { pronouns: true }), now);
  }
  return appendActivity(
    next,
    { actor, action: "edited", detail: `Wrote ${targets.length} drafted answer${targets.length === 1 ? "" : "s"} about ${authorName}'s own notes in ${authorName}'s own clinical wording (citations unchanged).` },
    now,
  );
}

/**
 * "Name Tom Ellis instead" (fix round 1, B0-1): the rewrite offered on an OTHER_CLINICIAN_VOICE flag – the paragraph
 * with the one other clinician whose note it cites named instead of "I" / "me" / "my" – or null (two clinicians, or
 * wording the rewrite cannot settle: the clinician edits it).
 */
export function nameClinicianFix(report: Pick<Report, "sections" | "bundleSnapshot" | "author" | "approver">, flag: Pick<ReportFlag, "code" | "sectionKey" | "paragraphId">): { name: string; text: string } | null {
  if (flag.code !== "OTHER_CLINICIAN_VOICE" || !flag.sectionKey || !flag.paragraphId) return null;
  const p = report.sections.find((s) => s.key === flag.sectionKey)?.paragraphs.find((x) => x.id === flag.paragraphId);
  if (!p) return null;
  // The voice owner the validators use (WB's seam, attribution-owner.ts – the author today, the approver once WB
  // lands): the flag and its fix always agree on whose "I" it is (bh2 WD harden N5).
  const others = otherCliniciansInFirstPerson(p, report.bundleSnapshot, defaultVoiceOwner(report));
  if (!others || others.length !== 1) return null;
  const text = nameClinicianInstead(p.text, others[0]);
  return text ? { name: others[0], text } : null;
}

/** Apply nameClinicianFix() to the flagged paragraphs (by flag ID): each becomes "edited" (revertable); one activity entry each. */
export function nameCliniciansInstead(report: Report, flags: readonly ReportFlag[], actor: string, now?: Date): Report {
  let next = report;
  for (const flag of flags) {
    const fix = nameClinicianFix(next, flag);
    if (!fix || !flag.sectionKey || !flag.paragraphId) continue;
    next = appendActivity(
      editParagraph(next, flag.sectionKey, flag.paragraphId, fix.text, now),
      { actor, action: "edited", detail: `${flag.sectionKey}: named ${fix.name}, who wrote the cited note, instead of “I” or “my” (citations unchanged).` },
      now,
    );
  }
  return next;
}

/**
 * Sentences of drafted text that only say something was NOT recorded (whole sentences, by the shared tokenizer – bh2
 * WD design 5: never a split inside "8.0").
 */
export function notRecordedSentences(text: string): string[] {
  return splitSentences(text)
    .map((x) => x.text.trim())
    .filter((x) => /\b(?:no|not|nothing)\b[\s\S]*\b(?:recorded|documented|noted|stated)\b/i.test(x) && !/\bI recorded\b/.test(x));
}

/**
 * On an opinion question the clinician has now answered: the AI paragraphs' "No … was recorded."
 * sentences, which the clinician's own answer replaces.
 */
export function supersededAbsenceSentences(section: Pick<ReportSection, "kind" | "paragraphs">): Array<{ paragraphId: string; sentence: string }> {
  if (section.kind !== "clinician_opinion") return [];
  if (!section.paragraphs.some((p) => p.origin === "clinician" && p.text.trim())) return [];
  const out: Array<{ paragraphId: string; sentence: string }> = [];
  for (const p of section.paragraphs) {
    if (p.origin !== "ai" && p.origin !== "edited") continue;
    for (const sentence of notRecordedSentences(p.text)) out.push({ paragraphId: p.id, sentence });
  }
  return out;
}

/** Remove superseded "not recorded" sentences (paragraphs left empty are removed). */
export function removeAbsenceSentences(report: Report, key: string, actor: string, now?: Date): Report {
  const section = report.sections.find((s) => s.key === key);
  if (!section) return report;
  const found = supersededAbsenceSentences(section);
  if (found.length === 0) return report;
  let next = report;
  for (const { paragraphId, sentence } of found) {
    const p = next.sections.find((s) => s.key === key)?.paragraphs.find((x) => x.id === paragraphId);
    if (!p) continue;
    // Whole sentences only (the shared tokenizer), the rest of the paragraph as written.
    const text = removeSentences(p.text, (span) => sentenceKey(span.text) === sentenceKey(sentence)).after.trim();
    next = text ? editParagraph(next, key, paragraphId, text, now) : removeParagraph(next, key, paragraphId, now);
  }
  return appendActivity(next, { actor, action: "edited", detail: `${key}: removed the draft's “not recorded” wording now that the clinician has answered.` }, now);
}
