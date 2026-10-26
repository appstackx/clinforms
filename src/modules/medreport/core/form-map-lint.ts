/**
 * Map lint (plan WE design 2, L1–L12): what makes a form map read wrong to the clinic or run wrong for a patient,
 * although it is a valid map. A schema check (checkFormDefinition) and the anchor check prove a map FITS its file; this
 * proves it SAYS the right thing – notes and guidance written for the clinic's staff, sources that match who may
 * answer, record values taken from the record, headings that match the printed ones.
 *
 * Heuristics live here, at authoring time, where a person reviews them – never at run time (RC-2: the runtime reads
 * the stored map as it is). Where it runs:
 * - admin:load-forms (create and replace): every finding is an error, overridden only per field and per rule through
 *   FormField.lintAccepted with a reason that is not blank (acceptanceFor; recorded in the audit);
 * - the Studio's mapping page: the findings are hints;
 * - /forms/confirm and a store PUT to "confirmed": L5 (a clinical judgement filled by staff, a fixed value or an
 *   unaccepted draft) blocks unless a clinician member accepted it for that field (server-stamped, audited).
 *
 *   L1  a note written for whoever prepares the map (ask/tell someone, verify on a date, until someone confirms,
 *       "owner to confirm", waiting for or pending someone's answer, the preparer's own "I have assumed", implementation
 *       talk, an edit log such as "Corrected:", "Fixed 24/10:", "Previously mapped as …")
 *   L2  guidance saying an unanswered box keeps what is printed (since B0-2 a blank box prints nothing)
 *   L3  "filled from the record" ("taken from the records", "from the clinic's record") on a clinic detail (clinic.*)
 *       or a staff entry, in a note or in guidance
 *   L4  guidance naming a printed option in another case or number than printed
 *   L5  judgement wording (fitness for work, restrictions, causation, prognosis, recovery, permanence, barriers,
 *       psychosocial factors, yellow flags, declarations, recommendations, an explicit opinion question) with a
 *       staff-entry, fixed or (unaccepted) drafted source – JUDGEMENT_KINDS, one vocabulary with the drafting check and
 *       the question classifier
 *   L6  a value the appointments hold (session dates and times, the first appointment) drafted or left to staff
 *   L7  headings: a box without a heading inside a run of one heading, row-mates under different headings, a heading
 *       that is only its own question's label
 *   L8  a "…" blank inside printed words whose printed lead is not known (analysis.printedLeads or quoted in guidance)
 *   L9  a "prepared by ClinForms" line other than load-forms' own single one
 *   L10 a conditional box whose own placeholder is a merge code
 *   L11 a converted form without a pin of its source file
 *   L12 vendor, product or technology names in a note, guidance, map warning, the map's title or its referrer
 *
 * Messages are ClinForms' own words and never quote the form's wording (load-forms prints rule + field id only).
 * Pure; browser and server.
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
import { conditionText } from "./conditions";
import { parseBlockId } from "./forms";
import { hasMergeToken } from "./merge-fields";
import { isConvertedFromRtf, isRtfConversionNote } from "./rtf/notes";
import { sessionQuestionOf, suggestedRecordPath } from "./session-dates";
import type { FormDefinition, FormField } from "./types";
import { defineHook, hookEnabled } from "./validation/hooks";
import { BANNED_TERM_PATTERNS } from "./wording";

/**
 * Ledger hook (safety corpus ledger.json "lint-accepted", an exemption): a field's lintAccepted entry turns that rule's
 * finding on that field into "accepted". The corpus seam disables it to show the accepted PASS cases depend on it.
 */
const LINT_ACCEPTED_HOOK = defineHook("lint-accepted");

export const LINT_RULES = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10", "L11", "L12"] as const;
export type LintRule = (typeof LINT_RULES)[number];

/** What each rule checks, in the clinic's words (the mapping page's hint titles). */
export const LINT_RULE_TITLES: Record<LintRule, string> = {
  L1: "A note written for whoever prepared the map",
  L2: "Guidance says an unanswered box keeps what is printed",
  L3: "Wrong source wording",
  L4: "An option named differently from the form",
  L5: "A clinical judgement not left to the clinician",
  L6: "A value the appointments hold",
  L7: "Heading",
  L8: "Printed words before the blank",
  L9: "A second “prepared by ClinForms” line",
  L10: "A merge code in a question that may not apply",
  L11: "The source file is not pinned",
  L12: "A product or technology name",
};

/** The single line load-forms adds to a map it prepares (L9: any other "prepared" line duplicates it). */
export const PREPARED_NOTE = "Prepared by ClinForms when your account was set up – check each question against your form and confirm the mapping once.";

export interface LintIssue {
  rule: LintRule;
  /** The field the finding is about (absent: the whole map). */
  fieldId?: string;
  /** "error" – a finding; "accepted" – the field's lintAccepted covers it (listed, never counted as an error). */
  severity: "error" | "accepted";
  /** ClinForms' own words; never the form's wording. */
  message: string;
  /** For "accepted": the acceptance's reason. */
  acceptedReason?: string;
}

export interface LintOptions {
  /** The file was converted from RTF (default: read from the map – convertedWith, the RTF notes, the file name). */
  convertedFromRtf?: boolean;
  /**
   * load-forms: what the MAPS FILE pins for this file (the map's own `file`), checked by L11 – the source file's
   * SHA-256, or the current conversion's. Absent: L11 reads the stored form's file.sourceSha256.
   */
  pin?: { sha256?: string; sourceSha256?: string };
  /** The current conversion's SHA-256 (with `pin`): a pinned sha256 equal to it counts as a pin. */
  conversionSha256?: string;
  /**
   * The template's printed text per Word block (load-forms has the parsed file; the mapping page may pass its
   * preview's): L8 then knows whether words are printed before a blank. Without it, a blank inside a block is taken
   * to complete printed words.
   */
  blockText?: (blockId: string) => string | null | undefined;
  /** Which rules to run (default: all). */
  rules?: readonly LintRule[];
}

/* ------------------------------------------------------------------------------------------------
 * Text helpers
 * ----------------------------------------------------------------------------------------------*/

/** Sentences of a note or guidance (split at . ! ? ; and at " – " / ": " after a short lead such as "Corrected:"). */
function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;])\s+(?=[A-Z(“"'])|\s[–—]\s/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const norm = (s: string) => s.normalize("NFC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Quoted phrases in a text (“…”, "…", '…' – at least two letters). */
function quotedPhrases(text: string): string[] {
  const out: string[] = [];
  const re = /“([^”]{2,120})”|"([^"]{2,120})"|(?:^|[\s(])'([^']{2,120})'(?=[\s).,;:!?]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const q = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (/[A-Za-z].*[A-Za-z]/.test(q)) out.push(q);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * L1 – notes written for whoever prepares the map
 * ----------------------------------------------------------------------------------------------*/

/** Why a sentence is written for the map's preparer (null: written for the clinic's staff). */
/** Someone other than the patient whose answer a preparer's note waits for (check-WE minor 5). */
const DECIDER = String.raw`(?:the\s+)?(?:owner|clinic|practice|practice manager|manager|admin(?:istrator)?|referrer|provider|dell|khuram)(?:'s)?`;

function preparerSentence(sentence: string): string | null {
  const s = sentence.trim().replace(/[‘’]/g, "'");
  // An edit log: the note says how the map was changed, not what the question is ("Corrected:", "Fixed 24/10:",
  // "Previously mapped as …", "Changed from drafted to …").
  if (/^\(?(?:corrected|fixed|changed|updated|amended|edited|revised|previously|was|todo|to[- ]?do|fixme|note to self)\b(?:\s+(?:on\s+)?\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?)?\s*[:\-–)]/i.test(s)) return "it records how the map was changed";
  if (/^\(?(?:previously|originally|formerly)\s+(?:mapped|set|marked|filled|anchored|read|treated|typed|entered)\b|\bwas (?:previously |originally |first )?mapped (?:as|to|from)\b|^\(?(?:changed|moved|switched|converted|re-?mapped)\s+(?:it\s+|this\s+)?(?:from|to)\b/i.test(s)) {
    return "it records how the map was changed";
  }
  if (/\b(?:TODO|FIXME|TBC|TBD)\b/.test(s) || /\bto[- ]?do\s*:/i.test(s)) return "it is a reminder for later";
  // The preparer speaking ("I have assumed the top row").
  if (/\bI (?:have |'ve )?(?:assumed|guessed|mapped|left|set|changed|moved|chose|chosen|picked)\b|\bI assume\b|\bmy (?:guess|assumption)\b/i.test(s)) return "it is the preparer's own note";
  // An instruction to contact or consult someone (never the patient: staff may ask the patient).
  // ("Phone", "email" and "call" are left out: they start ordinary labels – "phone number", "email address".)
  const contact = /(?:^|[:;(–—]\s*|\bplease\s+|\b(?:need|needs|have|has)\s+to\s+)(?:ask|tell|warn|remind|inform|notify|chase|check with|confirm with|clarify with|verify with|raise (?:it )?with|discuss (?:it )?with|agree (?:it )?with)\b\s*(.{0,40})/i.exec(s);
  if (contact && !/^(?:the\s+)?(?:patient|claimant|client)\b/i.test(contact[1].trim())) return "it asks the reader to contact someone";
  if (new RegExp(String.raw`\b(?:query|question)\s+for\s+(?:${DECIDER}|us|me)\b`, "i").test(s)) return "it asks the reader to contact someone";
  // A dated verification memo ("verified 24/10", "double-check … on Monday").
  if (/^\(?verif(?:y|ied)\b/i.test(s) || /\b(?:verif(?:y|ied)|checked|confirmed|re-?check(?:ed)?)\s+(?:on\s+|by\s+)?\d{1,2}[/.]\d{1,2}\b/i.test(s)) return "it is a verification memo";
  if (/\b(?:double-?check|re-?check|verify|check)\b[^.;]*\b(?:on|by|before|after|next)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|\d{1,2}[/.]\d{1,2})\b/i.test(s)) return "it is a verification memo";
  // A decision someone still has to make.
  if (/\buntil\b[^.;]*\b(?:confirms?|confirmed|says|said|decides|decided|agrees|agreed|answers|answered|replies|replied|tells|told)\b/i.test(s)) return "it waits for someone's decision";
  if (/\b(?:to be confirmed|still to confirm|open point|open question|awaiting (?:an? )?(?:answer|reply|confirmation|decision))\b/i.test(s) || /\(\s*[\w .'-]{1,30}\s+to confirm\s*\)/i.test(s)) return "it waits for someone's decision";
  if (/\b(?:confirm|check|decide)(?:ed)? later\b|\bto be (?:checked|decided) later\b/i.test(s)) return "it waits for someone's decision";
  // harden-WE (check2-WE minor 4, fresh wording): "Remember to update this once the owner replies", "Will revisit after
  // speaking to the owner", "best guess for now", "Left as drafted for now", "Need sign-off from the clinic lead",
  // "Placeholder until we hear back", "Check this against the paper copy later", "Mapping may be wrong".
  if (/^\(?remember to\b|\brevisit(?:ed|ing)?\b|\bbest guess\b|\b(?:not sure|unsure)\s+(?:which|whether|if|what|about|how)\b|\b(?:may|might|could) be wrong\b/i.test(s)) return "it is the preparer's own note";
  if (/\bleft as\b[^.;]{0,30}\bfor now\b|\b(?:as drafted|as is|as it is)\s+for now\b|^\(?placeholder\s*(?:until|till|for now|only|[:–—-]|\.|$)|\bplaceholder (?:until|till|for now)\b|\b(?:until|till|once|when)\s+(?:we|I)\s+hear\b|\bhear back\b/i.test(s)) return "it is a reminder for later";
  if (/\b(?:check|verify|confirm|revisit|review|update|fix)\s+(?:this|it|that)\b[^.;]{0,40}\blater\b/i.test(s)) return "it is a reminder for later";
  if (new RegExp(String.raw`\b(?:once|when|after|as soon as)\s+(?:${DECIDER}|we|they|someone)\s+(?:replies|replied|confirms|confirmed|answers|answered|says|decides|decided|agrees|agreed|gets back|responds|responded)\b|\bafter speaking (?:to|with)\b|\b(?:need|needs|awaiting|waiting for)\s+(?:a\s+|the\s+)?(?:sign-?off|approval|go-?ahead|confirmation|ok|okay|answer|reply|decision)\s+from\b`, "i").test(s)) {
    return "it waits for someone's decision";
  }
  if (
    new RegExp(
      [
        // "Owner to confirm whether …", "the clinic should decide", "Dell will advise".
        String.raw`\b(?:${DECIDER}|we|someone|somebody)\s+(?:still\s+)?(?:to|must|should|will|needs? to|has to|have to)\s+(?:confirm|check|decide|advise|answer|reply|clarify|verify|agree|say|let us know)\b`,
        // "Waiting on the clinic's answer", "pending the owner's reply", "we still need the owner's decision".
        String.raw`\bwait(?:ing)?\s+(?:on|for)\s+(?:${DECIDER}|(?:an?\s+|the\s+)?(?:answer|reply|decision|confirmation|go-?ahead))\b`,
        String.raw`\bpending\s+(?:${DECIDER}\s+|an?\s+|the\s+)?(?:reply|answer|decision|confirmation|input|go-?ahead|response)\b`,
        String.raw`\b(?:need|needs)\s+${DECIDER}\s+(?:decision|confirmation|answer|reply|go-?ahead|input)\b`,
      ].join("|"),
      "i",
    ).test(s)
  ) {
    return "it waits for someone's decision";
  }
  // Implementation talk (how the product works inside, not what staff see).
  if (/\b(?:from|by|in) the code\b|\bthe code (?:should|must|will|would|needs?|has to|fills?|does|can(?:not|'t)?|puts?|writes?|reads?)\b/i.test(s)) return "it talks about the product's code";
  if (/\b(?:anchor(?:s|ed|ing)?|regex|parser|schema|json|blockid|fillsource|placeholdertext|enum)\b/i.test(s)) return "it talks about how the map is built";
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * L2 – "unanswered … stays"
 * ----------------------------------------------------------------------------------------------*/

const NO_ANSWER = /\b(?:un-?answered|not answered|no answer|nobody answers|no one answers|no-one answers|if (?:it is |it's |this is )?(?:left )?(?:blank|empty)|left (?:blank|empty)|when (?:left )?(?:blank|empty)|without an answer|if not (?:completed|filled in))\b/i;
const KEEPS_PRINTED = /\b(?:stays?|staying|remains?|is kept|are kept|kept as (?:printed|it is)|left as (?:it is|printed|on the form)|unchanged|still prints?|keeps? (?:its|the) printed)\b/i;

function keepsPrintedWhenUnanswered(guidance: string): boolean {
  return sentencesOf(guidance.replace(/[()]/g, " ")).some((s) => {
    const m = NO_ANSWER.exec(s);
    return Boolean(m && KEEPS_PRINTED.test(s));
  });
}

/* ------------------------------------------------------------------------------------------------
 * L4 – options named in another case or number
 * ----------------------------------------------------------------------------------------------*/

const PLAIN_OPTION = /^(?:yes|no|n\/a|na|none|other|not applicable|unknown)$/i;

function optionNamingProblem(field: Pick<FormField, "options" | "guidance" | "answerType">): string | null {
  if (!field.options?.length || field.answerType === "yes_no" || !field.guidance.trim()) return null;
  const g = norm(field.guidance);
  const options = field.options.map((o) => norm(o)).filter((o) => o.length >= 3 && !PLAIN_OPTION.test(o));
  const known = new Set(field.options.map((o) => norm(o).toLowerCase()));
  for (const o of options) {
    const word = (s: string, flags: string) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(s)}(?![A-Za-z0-9])`, flags);
    const any = g.match(word(o, "gi")) ?? [];
    if (any.length > 0 && !any.some((m) => m === o)) return "it names a printed option in another case than printed";
    // The option in another number ("Exercises" for the printed "Exercise", "mobilisation" for "mobilisations").
    const variants = o.endsWith("s") && o.length > 3 ? [o.replace(/e?s$/, "")] : [`${o}s`, `${o}es`];
    for (const v of variants) {
      if (known.has(v.toLowerCase())) continue;
      if (word(v, "i").test(g) && !word(o, "i").test(g)) return "it names a printed option in another number than printed";
    }
  }
  // A quoted name that is no option but an option in another case or number.
  for (const q of quotedPhrases(g)) {
    if (known.has(q.toLowerCase()) && !field.options.some((o) => norm(o) === q)) return "it quotes a printed option in another case than printed";
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * L5 – judgement wording on a source that is not the clinician's
 * ----------------------------------------------------------------------------------------------*/

/** Who a question is about ("can the claimant …", "should the employee …"). */
const SUBJECT = String.raw`(?:(?:the|this|your)\s+)?(?:patient|claimant|client|employee|member|individual|injured (?:person|party)|person)|he|she|they|you`;

/**
 * Whether someone could be reached or an appointment kept – an administrative fact, not fitness ("unable to contact the
 * patient", "able to attend in person", "able to offer evening appointments"; harden-WE, check2-WE minor 3).
 */
const ADMIN_VERB = String.raw`(?:contact|reach|offer|book|speak|phone|call|email|e-mail|trace|locate|obtain|arrange|provide|send|pay|be\s+(?:contacted|reached|seen)|attend\s+(?:in\s+person|appointments?|sessions?|clinic|the\s+clinic|treatment|physio(?:therapy)?|for|on|at|remotely|online|by))\b`;

/** An appointment, a cost or a settlement after "expected/likely/projected …" – a date in the diary, not a prognosis. */
const ADMIN_NOUN = String.raw`(?:(?:date|day|time)\s+(?:of\s+)?(?:the\s+)?(?:next\s+)?(?:appointment|attendance|session|visit|arrival|payment|invoice|settlement|start|hearing)|(?:next\s+)?(?:appointment|attendance|arrival|costs?|fees?|price|invoice|payment|settlement|start|delivery)\b)`;

/**
 * The kinds of clinical judgement a question can ask for, read from its printed label and options (plan WE design 2;
 * check-WE M1). ONE vocabulary with the rest of ClinForms, worded for a question rather than a sentence:
 * - the shapes the drafting check counts as opinion wording (core/validation/opinion-language.ts – recovery
 *   "resolved/recovered/settled/symptom-free", prediction "will … resolve/improve/need", "expected/anticipated to",
 *   "likely", prognosis "outlook/prospects", permanence "permanent/lasting/chronic/irreversible", causation "caused/
 *   attributable/as a result of/resulting from/secondary to/related to the accident", fitness "fit for/capable of/
 *   ready to", advice "recommend…");
 * - the ones the question classifier gives the clinician (core/question-set.ts OPINION and FORWARD_LOOKING:
 *   "opinion", "recommend…", "fit to drive", "return to work", "further treatment", "maximum improvement",
 *   "expected/estimated/anticipated/planned/predicted/likely/projected/proposed");
 * - explicit opinion questions ("in your opinion", "do you consider", "clinical impression", "your view"), a statement of
 *   truth;
 * - harden-WE (check2-WE M1, fresh wording and Ascenti ML EOTS F-43): an outcome scale in the options (improving / no
 *   change / worsening), an improvement or progress asked or measured, treatment goals met, the condition at discharge,
 *   "can return to work" without a subject, "in a position to", incapacity, adjustments, what to avoid, a link between
 *   the accident and the symptoms, acceleration, "anyway", "left with", future risk, complicating factors, anxiety /
 *   fear / mood / stress, "I am satisfied that", "reasonable and necessary", onward referral, imaging needed,
 *   "continue treatment?", requested / more sessions, future treatment.
 * Facts stay facts: a fit note, a restriction of movement or range (an examination finding), a recommendation already
 * made ("have exercises been recommended?"), a return that happened ("is the claimant back at work?"), a start date
 * ("due to start"), factors that make a pain worse ("aggravating factors"), long-term medication or conditions
 * (history), the patient's own account ("patient's perceived improvement", "as described by the patient"), whether
 * someone could be reached or an appointment kept ("unable to contact", "able to attend in person"), a diary date, a
 * cost or a settlement ("expected date of the next appointment", "projected cost", "has the claim settled?"), how an
 * accident happened ("cause of the accident").
 * Label-only patterns cannot reach every free wording: what they still miss is listed in the release's known limits,
 * and the clinician still reviews and signs every answer.
 * The first kind that matches names the finding. scripts/medreport/bh2-data.test.ts pins the recall and the
 * precision (and the corpus's LINT-l5-recall-* / LINT-l5-fact-* cases).
 */
export const JUDGEMENT_KINDS: ReadonlyArray<{ kind: string; pattern: RegExp }> = [
  {
    kind: "fitness for work",
    pattern: new RegExp(
      [
        // "fit for duties", "fitness to work", "unfit" – never a fit note, nor fitness as an activity.
        String.raw`\b(?:un)?fit(?:ness)?\b(?![- ]?notes?\b)(?!\s+(?:classes?|activit(?:y|ies)|levels?|programmes?|programs?|regimes?|routines?|instructors?|training|centres?|centers?|clubs?)\b)`,
        // "able to drive", "unable to perform", "capable of their normal job", "ability to lift" – not whether someone
        // could be reached or an appointment kept ("unable to contact the patient", "able to attend in person";
        // harden-WE, check2-WE minor 3).
        String.raw`\b(?:able|unable|capable|incapable|ability|inability)\s+(?:of|to)\s+(?!${ADMIN_VERB})[a-z]`,
        String.raw`\bcan\s+(?:${SUBJECT})\s+(?:now\s+|still\s+|safely\s+)?(?:do|return|go back|get back|work|perform|carry(?: out)?|resume|manage|drive|lift|undertake|continue|cope|fulfil)\b`,
        // "Can return to work", "Can drive" (no subject); "the hours the claimant can work", "duties the employee
        // cannot do" (harden-WE: check2-WE M1 fresh wording).
        String.raw`(?:^|[·?:–—(]\s*)can\s+(?:now\s+|still\s+|safely\s+)?(?:return|go back|get back|resume|drive|lift|work|undertake|carry out|perform|manage|cope|attend work|do (?:normal|usual|full|light|all|his|her|their))\b`,
        String.raw`\b(?:${SUBJECT})\s+(?:can|could|cannot|can't|can not|should not|must not|is able to|is unable to|is not able to)\s+(?:now\s+|still\s+|safely\s+)?(?:work|return|drive|lift|do|perform|manage|undertake|carry|cope|resume|go back|get back|sit|stand|walk|fulfil)\b`,
        // Not a description of function ("current functional capacity" is what the notes record the patient can do).
        String.raw`\bin a position to\b|\bincapacit(?:y|ated|ies)\b|\blifting\s+capacity\b`,
        String.raw`\btime off(?:\s+(?:work|sick))?\s+(?:required|needed|advised|recommended|expected|necessary)\b`,
        // "Return to work", "return to normal activities" – the question classifier's own words; not one that happened
        // ("returned to work", "back at work").
        String.raw`\breturn(?:ing)?\s+to\s+(?:work|duties|normal|full|usual|sport|driving|pre-?(?:injury|accident|incident))\b`,
        String.raw`\b(?:suitable|ready|cleared|safe|well enough)\s+(?:for|to)\s+(?:[a-z'-]+\s+){0,2}?(?:work|duties|duty|job|role|employment|return|go back|get back|drive|driving|lift|lifting|discharge|sport|full|normal|usual)\b`,
        String.raw`\b(?:stay|stays|remain|remains|be|kept|keep)\s+off\s+(?:work|sick)\b`,
        String.raw`\b(?:work(?:ing)?\s+capacity|capacity\s+(?:for|to)\s+work)\b`,
      ].join("|"),
      "i",
    ),
  },
  {
    // A restriction of movement or range is an examination finding, not a restriction on what the patient may do.
    kind: "restrictions",
    pattern: new RegExp(
      [
        String.raw`(?<!\b(?:range|movement|motion|rom|mobility|flexion|extension|rotation)\b[\s\-–—:,()]{0,4})\brestrict(?:ion|ions|ed|ive)?\b(?!\s+(?:to|of|in|on)\s+(?:the\s+)?(?:movement|motion|range|rom|mobility)\b|\s+(?:range|movement|motion|rom|mobility)\b)`,
        String.raw`\b(?:modified|adjusted|amended|light|lighter|alternative|reduced|phased|graded|limited|selected)\s+(?:duties|duty|hours|work|return|role)\b`,
        String.raw`\bwork(?:place)?\s+(?:adjustments?|modifications?|limitations?)\b`,
        String.raw`\blimitations?\s+(?:on|to|at|affecting)\s+(?:work|duties|activities|activity|lifting|driving)\b|\b(?:lifting|weight|carrying)\s+limits?\b`,
        // "Reasonable adjustments", "Adjustments" – not a change to the treatment or a manual technique.
        String.raw`(?<!\b(?:chiropractic|spinal|postural|osteopathic|manual)\s)\badjustments?\b(?!\s+(?:to|of|in|made to)\s+(?:the\s+|his\s+|her\s+|their\s+)?(?:treatment|plan|dose|dosage|medication|exercises?|home\s+programme|programme|program|insoles?|brace|splint)\b)`,
        String.raw`\b(?:should|must|to|needs? to|advised to|told to)\s+avoid\b|\bactivities\s+to\s+avoid\b|\bavoid(?:ing)?\s+(?:lifting|driving|work|sport|running|heavy|prolonged|repetitive)\b`,
        String.raw`\bmaximum\s+(?:weight|load|lift(?:ing)?|hours|carrying)\b`,
      ].join("|"),
      "i",
    ),
  },
  {
    kind: "causation",
    pattern: new RegExp(
      [
        // Not how an accident happened ("cause of the accident", a mechanism the patient describes).
        String.raw`\bcaus(?:e|ed|es|ation|al|ally|ative)\b(?!\s+of\s+(?:the\s+)?(?:accident|incident|collision|crash|fall)\b)`,
        String.raw`\battributab(?:le|ly)\b|\battribut(?:ed|ion)\b|\blinks?\s+between\b|\bconnection\s+between\b|\blinked\s+with\b`,
        // "Did the accident make an existing condition worse?" – not what makes a pain worse (aggravating factors).
        String.raw`\b(?:accident|incident|collision|crash|fall|injury|event)\s+(?:\w+\s+)?ma(?:ke|de|king)\s+(?:\w+\s+){0,4}?worse\b|\bma(?:ke|de|king)\s+(?:an?\s+|the\s+|his\s+|her\s+|their\s+)?(?:pre-?existing|existing|previous|underlying|old|earlier)\s+(?:\w+\s+){0,2}?worse\b|\bworse(?:ned)?\s+(?:by|because of|since|after)\s+the\s+(?:accident|incident|collision|crash|fall)\b`,
        String.raw`\baccelerat(?:ion|ed|ing|es|e)\s+(?:of|by)\b|\bacceleration\s+period\b|\baccelerat\w*\s+(?:an?\s+|the\s+)?(?:pre-?existing|existing|previous|underlying|degenerat\w*|symptoms?|condition)\b`,
        String.raw`\banyway\b|\bin any event\b|\bregardless of the (?:accident|incident|collision)\b|\bwithout the (?:accident|incident|collision|crash|fall)\b`,
        // "due to the accident" – not "due to start".
        String.raw`\bdue to\b(?!\s+(?:be|start|begin|end|finish|commence|expire|attend|resume|restart|return|complete|take place|close|open|run|happen|occur|arrive|see|have|receive|book|stop|renew|review)\b)`,
        String.raw`\bbecause of\b|\bowing to\b|\bon account of\b`,
        String.raw`\b(?:related|attributable|attributed|linked|secondary|consequent|connected)\s+to\b`,
        String.raw`\b(?:directly|causally|probably|possibly)\s+(?:related|linked|attributable|caused|connected)\b|\b(?:un|not\s+)related\b`,
        String.raw`\b(?:result|consequence)s?\s+of\b|\bresult(?:s|ed|ing)?\s+(?:from|in)\b`,
        String.raw`\b(?:arising|arose|arisen|stem(?:s|med|ming)?)\s+(?:from|out of)\b`,
        // "sustained in the accident" – not the plain "injuries sustained".
        String.raw`\bsustained\s+(?:in|during|at|as|from|when|while|through)\b`,
        String.raw`\b(?:work|accident|injury|incident|collision|crash|fall)[- ](?:related|aggravated|induced|caused)\b`,
        // An aggravation of an earlier condition – not what makes a pain worse ("aggravating factors").
        String.raw`\baggravation of\b|\b(?:aggravat|exacerbat)(?:ed|ing|ion of)\s+(?:a\s+|an\s+|the\s+|his\s+|her\s+|their\s+)?(?:pre-?existing|previous|existing|underlying|old|earlier)\b`,
        String.raw`\bbrought on\b|\btriggered by\b`,
        String.raw`\bconsistent with the (?:mechanism|accident|incident|injury|collision)\b|\bbut for\b|\bwould not have (?:occurred|happened|developed|arisen)\b`,
      ].join("|"),
      "i",
    ),
  },
  {
    kind: "prognosis",
    pattern: new RegExp(
      [
        String.raw`\bprognos(?:is|es|tic)\b|\boutlook\b|\bprospects?\b`,
        // The question classifier's forward-looking words (core/question-set.ts FORWARD_LOOKING).
        // ... not an appointment, a cost or a settlement ("expected date of the next appointment", "projected cost",
        // "probable start date"; harden-WE, check2-WE minor 3).
        String.raw`\b(?:expected|anticipated|estimated|predicted|projected|forecast|likely|probable|foreseeable)\b(?!\s+${ADMIN_NOUN})`,
        String.raw`\bhow many (?:more|further|additional|extra|remaining)\b|\bmore sessions\b|\bfuture\s+(?:treatment|care|needs|management|surgery|sessions?|interventions?|prognosis)\b`,
        String.raw`\bgoing to (?:need|require|improve|recover|get better|be (?:able|fit|discharged|left))\b|\btime-?scales?\b|\btime ?frames?\b|\bwhen (?:do you (?:think|expect)|will|might|may)\b`,
        String.raw`\bwill\s+(?:${SUBJECT}|the\s+[a-z]+|it|this|symptoms?|pain)\s+(?:still\s+|ever\s+|fully\s+)?(?:recover|resolve|settle|improve|heal|return|be able|need|require|remain|persist|benefit|respond|get better|go back|make)`,
        String.raw`\b(?:further|more|continued|additional)\s+(?:improvement|progress|recovery|gains?)\b`,
        String.raw`\bmaximum\s+(?:medical\s+)?improvement\b|\bplateau(?:ed|s)?\b`,
        String.raw`\b(?:how long|time)\s+(?:until|to|before|for)\s+(?:a\s+)?(?:full\s+)?(?:recovery|resolution|return|discharge|improvement)\b`,
      ].join("|"),
      "i",
    ),
  },
  {
    kind: "recovery",
    pattern: new RegExp(
      [
        // Not first aid ("recovery position") nor a claim or an invoice that settled (check2-WE minor 3).
        String.raw`\brecover(?:y|ies|ed|ing|s)?\b(?!\s+position)|\bresol(?:ve|ves|ved|ving|ution)\b|(?<!\b(?:claims?|invoices?|accounts?|bills?|cases?|matters?|payments?|fees?|debts?)\b(?:\s+(?:has|have|is|was|been|now|fully)){0,3}\s)\bsettl(?:e|es|ed|ing)\b|\bhealed\b`,
        String.raw`\b(?:symptom|problem|trouble)[- ]free\b|\basymptomatic\b|\bfree (?:of|from) (?:all |any )?(?:symptoms?|pain)\b`,
        String.raw`\b(?:fully|completely|totally)\s+(?:better|well|healed|gone|cleared)\b`,
        String.raw`\b(?:symptoms?|pain|problems?|condition|injur(?:y|ies))\s+(?:has\s+|have\s+|now\s+)?(?:fully\s+|completely\s+|all\s+)?(?:gone|cleared|disappeared|subsided|ceased)\b`,
        String.raw`\bgetting better\b|\bfull return\b|\bback to normal\b|\bfull fitness\b`,
        // harden-WE (check2-WE M1): pain-free, abated, full function, cleared up; treatment goals met (10Bridge EOTS F-31,
        // Proclaim EOTS F-29, Bodycare Interim F-16 – ids only, never the forms' wording). A rating of the course of the
        // condition is RATING_STEMS (below); an outcome scale in the options is outcomeScale.
        String.raw`\bpain[- ]free\b|\babat(?:e|ed|es|ing)\b|\bcleared up\b|\bfull function\b|\b(?:back to|regained|restored to)\s+full\b`,
        String.raw`\bgoals?\b[^.?]{0,80}?\b(?:achieved|met|reached|attained|accomplished|achievement)\b|\b(?:achieved|met|reached|attained)\b[^.?]{0,40}?\bgoals?\b`,
        String.raw`\b(?:back|return(?:ed|ing|s)?|restored)\s+to\s+(?:(?:his|her|their|the)\s+)?(?:pre-?(?:injury|accident|incident)|normal)\b(?!\s+(?:work|duties|job|role|hours)\b)`,
      ].join("|"),
      "i",
    ),
  },
  {
    kind: "permanence",
    pattern: new RegExp(
      [
        String.raw`\bpermanen(?:t|ce|tly)\b|\blong[- ]?lasting\b|\blife[- ]?long\b|\birreversible\b|\b(?:any|some|a)\s+lasting\b|\bchronicity\b`,
        String.raw`\b(?:long[- ]?term|lasting|residual|enduring|indefinite)\s+(?:effects?|disabilit(?:y|ies)|damage|impairments?|problems?|symptoms?|consequences?|restrictions?|limitations?|loss|deficits?|pain|prognosis|outcome)\b`,
        // "is the condition chronic?" – not chronic conditions in the medical history.
        String.raw`\b(?:is|are|become|becomes|becoming|remain|remains|be|been|now|turned|turning)\s+(?:the\s+[a-z]+\s+)?chronic\b`,
        String.raw`\bongoing\s+(?:disabilit(?:y|ies)|impairments?|effects?)\b`,
        // harden-WE: "left with any disability?", "future risk of arthritis", a bare "Long-term" box.
        String.raw`\bleft with\b|\bfuture risk\b|\brisk of\s+(?:arthritis|osteoarthritis|degenerat\w*|recurrence|re-?injury|further (?:injury|problems|deterioration|damage)|deterioration|relapse|long[- ]term)\b|\b(?:any|lasting|residual|future)\s+disabilit(?:y|ies)\b`,
        String.raw`^long[- ]?term\s*[:?]?\s*(?:·|$)`,
      ].join("|"),
      "i",
    ),
  },
  {
    kind: "barriers to recovery",
    pattern: new RegExp(
      [
        String.raw`\bbarriers?\b|\bobstacles?\b|\bhinder(?:s|ing|ed|ance)?\b|\bimped(?:e|es|ing|iment|iments)\b|\b(?:preventing|stopping|delaying)\s+(?:a\s+|the\s+)?(?:recovery|progress|return)\b`,
        String.raw`\bfactors?\s+(?:that\s+(?:may\s+|might\s+|could\s+)?)?(?:slow(?:s|ing)?|delay(?:s|ing)?|affect(?:s|ing)?|limit(?:s|ing)?|influenc(?:e|es|ing)|hamper(?:s|ing)?|prevent(?:s|ing)?|complicat(?:e|es|ing))\s+(?:the\s+|his\s+|her\s+|their\s+)?(?:progress|recovery|treatment|rehabilitation|rehab|outcome|return|prognosis)\b`,
        String.raw`\b(?:slow(?:ing|ed)?|delay(?:ing|ed)?)\s+(?:the\s+)?(?:progress|recovery|rehabilitation|return)\b`,
        // harden-WE: "complicating factors", "what is slowing the patient's progress?", "reasons for slow progress",
        // "… affecting treatment".
        String.raw`\bcomplicating\b|\bcomplicat\w*\s+(?:factors?|the\s+(?:recovery|progress|treatment))\b|\bslow(?:ing|s|ed|er)?\b[^.?]{0,30}?\bprogress\b|\b(?:slow|poor|limited|lack of|little)\s+progress\b`,
        String.raw`\b(?:affect(?:ing|s)?|impact(?:ing|s)?(?:\s+on)?)\s+(?:the\s+|his\s+|her\s+|their\s+)?(?:treatment|recovery|progress|rehabilitation|rehab|outcome)\b`,
      ].join("|"),
      "i",
    ),
  },
  {
    kind: "psychosocial factors",
    pattern: new RegExp(
      [
        String.raw`\bpsycho-?social\b|\bpsycholog(?:ical|y)\b|\bfear[- ]avoidance\b|\bcatastrophi[sz]|\bemotional\s+(?:factors?|issues?|state|impact|wellbeing|well-being|distress|problems?|health)\b|\bsocial\s+factors?\b|\bmental\s+health\s+(?:factors?|impact)\b`,
        // harden-WE: anxiety, fear of re-injury, kinesiophobia, mood, stress – not in the medical history, not a stress
        // fracture or test.
        String.raw`(?<!\b(?:history|previous|past|pre-?existing)\b[^.?]{0,20})\banxi(?:ous|ety)\b|\bfear(?:s|ful)?\s+(?:of|about|over)\b|\bkinesiophobi|\blow\s+mood\b|\bmood\b|\bstress(?:ed|ful|ors?)?\b(?!\s+(?:fracture|test|testing|incontinence|reaction|response|x-?ray))|\bworr(?:y|ied|ies)\s+(?:about|that|over)\b`,
      ].join("|"),
      "i",
    ),
  },
  { kind: "yellow flags", pattern: /\b(?:yellow|blue|black|orange)\s+flags?\b/i },
  {
    kind: "a declaration",
    pattern: /\bdeclar(?:e|es|ed|ation)\b|\bI (?:confirm|certify|declare|attest|understand|believe|accept|acknowledge|agree)\b|\bconfirmation of\b|\bcertif(?:y|ies|ied|ication)\b|\battest(?:s|ed|ation)?\b|\bstatement of truth\b|\bduty to the court\b|\bto the best of (?:my|our) (?:knowledge|belief)\b|\b(?:true|accurate) and (?:accurate|correct|complete|true)\b|\bI\s+am\s+(?:satisfied|content|happy|sure)\s+that\b|\breasonabl[ey]\s+(?:and\s+)?necessar(?:y|ily)\b|^(?:please\s+)?confirm\s+(?:that\b|the\s+(?:patient|claimant|client)\b|all\b)/i,
  },
  {
    kind: "a recommendation",
    pattern: new RegExp(
      [
        // "Return to work recommended?", "Recommendations" – not one already made ("have exercises been recommended?").
        String.raw`\brecommend(?:s|ing|ation|ations)?\b|(?<!\b(?:been|was|were|had|has|have|being|previously|already)\s)\brecommended\b|\badvisable\b`,
        String.raw`\bshould\s+(?:${SUBJECT}|treatment|physiotherapy|therapy|sessions?|the\s+(?:treatment|sessions?|case|claim))\b`,
        String.raw`\bfurther\s+(?:treatment|sessions?|physio(?:therapy)?|therapy|interventions?|appointments?|care|investigations?|referrals?|rehabilitation|rehab|input)\b`,
        String.raw`\b(?:additional|more|extra)\s+(?:treatment|sessions|physio(?:therapy)?|therapy)\s+(?:needed|required|requested|advised|necessary|indicated)\b`,
        // "Appointments required from now on", "is treatment still appropriate?" – not "the treatment needed" in a detail box.
        String.raw`\b(?:sessions?|appointments?)\s+(?:required|needed|requested|proposed|planned)\b(?!\s+to\s+be\b)`,
        // harden-WE: an onward referral, imaging or surgery needed; continue treatment?; requested or more sessions.
        String.raw`\b(?:onward\s+)?referrals?\b[^.?]{0,40}?\b(?:required|needed|necessary|advised|recommended|indicated|suggested|warranted)\b|\bonward\s+referral\b(?!\s+(?:made|sent|completed|done|date|letter))`,
        String.raw`\b(?:imaging|scans?|x-?rays?|mri|investigations?|injections?|surgery|surgical|orthopaedic|consultant)\b[^.?]{0,30}?\b(?:needed|required|necessary|advised|recommended|indicated|warranted|suggested)\b`,
        String.raw`\bcontinue\s+(?:with\s+)?(?:the\s+)?(?:treatment|physio(?:therapy)?|therapy|sessions?|rehab(?:ilitation)?|care)\b|\brequested\s+(?:sessions?|treatments?|appointments?|number of sessions)\b|\badditional\s+(?:treatment|sessions)\b|\bmore\s+(?:treatment|physio(?:therapy)?|therapy)\b`,
        String.raw`\b(?:is|are)\s+(?:further\s+|more\s+|the\s+)?(?:treatment|physiotherapy|therapy|sessions)\s+(?:currently\s+|still\s+)?(?:appropriate|indicated|necessary|warranted|needed|required)\b`,
        String.raw`\b(?:planned|proposed)\s+(?:treatment|sessions?|discharge|review|plan|number|return|date|duration|frequency|interventions?|management)\b`,
      ].join("|"),
      "i",
    ),
  },
  {
    kind: "a clinical opinion",
    pattern: /(?<!\bsecond\s)\bopinions?\b|\bin your (?:clinical |professional )?(?:view|judge?ment|assessment|estimation)\b|\bdo you (?:consider|believe|think|expect|anticipate|foresee|regard|feel)\b|\bwould you (?:consider|say|expect|recommend|advise|regard)\b|\byour (?:clinical |professional )?(?:view|judge?ment|impression|assessment) of\b|\bclinical (?:judge?ment|reasoning|impressions?)\b|\byour (?:clinical |professional )?(?:view|impression|opinion)\b|\bis it your view\b|\b(?:physiotherapist|clinician|therapist|physio)(?:'s|s')?\s+(?:assessment|view|impression|opinion)\s+(?:of|on)\b/i,
  },
];

/**
 * A question that asks for the patient's own account – their perceived improvement, their own estimate, "as described
 * by the patient", "in the patient's words": what the patient said is a fact the notes record, not the clinician's
 * judgement (harden-WE: CLM EOTS F-34/F-36; check2-WE minor 3, the cause of an accident as the patient describes
 * it). A question that also asks the clinician ("in your view", "the physiotherapist's
 * opinion of …") stays a judgement.
 */
const PATIENT_ACCOUNT = /\b(?:patient|claimant|client|employee|member)(?:'s|s')?\s+(?:own\s+)?(?:perceived|perception|self-?reported|reported|estimates?|estimated|ratings?|description|account|words|preference)\b|\bas\s+(?:described|reported|told|stated|given|advised)\s+by\s+(?:the\s+)?(?:patient|claimant|client|employee)\b|\b(?:patient|self)[- ]reported\b|\bin\s+(?:the\s+|their\s+|his\s+|her\s+)?(?:(?:patient|claimant|client)(?:'s|s')?\s+)?own\s+words\b|\bin\s+the\s+(?:patient|claimant|client)(?:'s|s')\s+words\b|\baccording to the (?:patient|claimant|client)\b/i;
const ASKS_THE_CLINICIAN = /\bin your\b|\bdo you\b|\bwould you\b|\byour (?:clinical |professional )?(?:view|opinion|judge?ment|impression|assessment)\b|\bclinical (?:judge?ment|reasoning|impressions?|opinion)\b|\b(?:clinician|physiotherapist|therapist|physio)(?:'s|s')?\s+(?:view|opinion|judge?ment|impression|assessment)\b/i;

/**
 * An outcome scale in the options, whatever the label says: two or more of "improving / better", "no change / same",
 * "worsening / deteriorated" (harden-WE: Ascenti ML EOTS F-43; check2-WE M1 "Better / Same / Worse",
 * "Improved / No change / Deteriorated").
 */
const SCALE_STEPS: readonly RegExp[] = [
  /^(?:much\s+|slightly\s+|a\s+little\s+)?(?:improv(?:ed|ing|ement)|better|resolv(?:ed|ing)|recovered|progressing)\b/i,
  /^(?:no\s+change|unchanged|(?:the\s+)?same|static|stable|no\s+improvement|plateau(?:ed)?|no\s+different)\b/i,
  /^(?:much\s+|slightly\s+|a\s+little\s+)?(?:wors(?:e|ening|ened)|deteriorat(?:ed|ing|ion)|declin(?:ed|ing)|regress(?:ed|ing))\b/i,
];

function outcomeScale(options: readonly string[] | undefined): boolean {
  if (!options || options.length < 2) return false;
  return SCALE_STEPS.filter((step) => options.some((o) => step.test(norm(o)))).length >= 2;
}

/**
 * A rating of the course of the condition – an improvement or progress asked or measured (a percentage, "is it
 * improving?", "any improvement since …?"), the condition at discharge or after treatment, a question on how it is now
 * (harden-WE: Ascenti ML EOTS F-11…F-25, F-49, Ascenti IA F-50, Proclaim EOTS F-20). A judgement in a short answer, a
 * choice, a number or a question; a long narrative box that is not a question ("current symptoms and progress since the
 * first assessment") summarises what the notes record, and stays a fact (the bundled example question set; a regression
 * otherwise).
 */
const RATING_STEMS = new RegExp(
  [
    String.raw`\bimprov(?:ed|ing|ement|ements)\b|\bprogress\s+(?:since|so far|to date|made|of the|with|in)\b|\b(?:any|good|overall|expected|satisfactory|clinical)\s+progress\b|\bprogressing\b|\bprogress\s*\?`,
    String.raw`\b(?:condition|status|outcome|symptoms?|presentation|state)\s+(?:at|on|by|following|after)\s+(?:the\s+)?(?:discharge|end of (?:the\s+)?treatment|final (?:session|appointment|review)|last (?:session|appointment)|treatment)\b`,
    String.raw`\bhow (?:is|are|has|have)\s+(?:the\s+)?(?:(?:client|patient|claimant)(?:'s|s')?\s+)?(?:condition|symptoms?|injur(?:y|ies)|pain|problems?)\b`,
  ].join("|"),
  "i",
);

/** The judgement a question asks for, read from its printed label and options (and its answer type) – or null. */
export function judgementOf(field: Pick<FormField, "label"> & Partial<Pick<FormField, "options" | "answerType">>): string | null {
  const label = norm(field.label);
  const text = norm([field.label, ...(field.options ?? [])].join(" · "));
  if (PATIENT_ACCOUNT.test(label) && !ASKS_THE_CLINICIAN.test(label)) return null;
  const kind = JUDGEMENT_KINDS.find((j) => j.pattern.test(text))?.kind;
  if (kind) return kind;
  const narrative = field.answerType === "long_text" && !label.includes("?");
  if (!narrative && RATING_STEMS.test(text)) return "recovery";
  return outcomeScale(field.options) ? "recovery" : null;
}

/**
 * A field's acceptance of one rule's finding – only with a reason that says something (a blank or whitespace-only
 * reason accepts nothing: the lint, load-forms, /forms/confirm and the store check read it the same way).
 */
export function acceptanceFor(field: Pick<FormField, "lintAccepted">, rule: LintRule): NonNullable<FormField["lintAccepted"]>[number] | undefined {
  return field.lintAccepted?.find((a) => a.rule === rule && typeof a.reason === "string" && a.reason.trim().length > 0);
}

/**
 * Whether this person may accept a clinical judgement as the map words it (L5): the role clinician, or a member who may
 * sign – as core/actor.ts stamps them (memberActor: may sign only with a registration number; the public demo acts as a
 * clinician). One rule for the confirming caller, the stamp it writes, the store check and the mapping page.
 */
export function acceptsJudgement(by: { role?: string; canSign?: boolean } | null | undefined): boolean {
  return Boolean(by && (by.role === "clinician" || by.canSign === true));
}

/** Sources that are not the clinician's own answer: a staff entry, a fixed value, a draft from the notes. */
function nonClinicianSource(field: Pick<FormField, "fillSource">): "staff" | "fixed" | "drafted" | null {
  const s = field.fillSource;
  if (s.kind === "registration" && s.path === "staff.entry") return "staff";
  if (s.kind === "fixed") return "fixed";
  if (s.kind === "notes_narrative") return "drafted";
  return null;
}

/**
 * L5 for one field, as /forms/confirm and the store check it: the judgement it asks for and who would answer it
 * instead of the clinician – or null.
 */
export function judgementOnNonClinicianSource(field: Pick<FormField, "label" | "options" | "fillSource"> & Partial<Pick<FormField, "answerType">>): { kind: string; source: "staff" | "fixed" | "drafted" } | null {
  const source = nonClinicianSource(field);
  if (!source) return null;
  const kind = judgementOf(field);
  return kind ? { kind, source } : null;
}

/* ------------------------------------------------------------------------------------------------
 * L7 – headings
 * ----------------------------------------------------------------------------------------------*/

const headingOf = (f: Pick<FormField, "section">) => (typeof f.section === "string" ? norm(f.section) : "");

/** The table row a Word anchor sits in ("t2.r5"; nested rows keep their path), or null. */
function rowKeyOf(field: Pick<FormField, "anchor">): string | null {
  if (field.anchor.kind !== "docx") return null;
  const parsed = parseBlockId(field.anchor.blockId);
  if (!parsed || parsed.kind !== "cell") return null;
  return parsed.cells.map((c, i) => (i === parsed.cells.length - 1 ? `t${c.t}.r${c.r}` : `t${c.t}.r${c.r}.c${c.c}`)).join(".");
}

function headingProblems(fields: readonly FormField[]): Array<{ fieldId: string; message: string }> {
  const out: Array<{ fieldId: string; message: string }> = [];
  const headings = fields.map(headingOf);
  if (!headings.some(Boolean)) return out; // a form that prints no headings: nothing to check
  const seen = new Set<string>();
  const flag = (id: string, message: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ fieldId: id, message });
  };
  // A box without a heading inside a run of one heading.
  fields.forEach((f, i) => {
    if (headings[i]) return;
    let before = "";
    for (let j = i - 1; j >= 0 && !before; j--) before = headings[j];
    let after = "";
    for (let j = i + 1; j < fields.length && !after; j++) after = headings[j];
    if (before && before === after) flag(f.id, "This box has no heading, but the boxes before and after it share one: give it the heading it is printed under.");
  });
  // Boxes of one printed row under different headings.
  const rows = new Map<string, number[]>();
  fields.forEach((f, i) => {
    const key = rowKeyOf(f);
    if (key) rows.set(key, [...(rows.get(key) ?? []), i]);
  });
  for (const idx of Array.from(rows.values())) {
    if (new Set(idx.map((i) => headings[i])).size < 2) continue;
    // The row's heading: the one most of its boxes have (a heading before none on a tie).
    const count = new Map<string, number>();
    for (const i of idx) count.set(headings[i], (count.get(headings[i]) ?? 0) + 1);
    const rowHeading = Array.from(count.entries()).sort((a, b) => b[1] - a[1] || (a[0] ? -1 : 1))[0][0];
    for (const i of idx) {
      if (headings[i] !== rowHeading) flag(fields[i].id, "This box sits in one printed row with boxes under another heading: give the row's boxes the same heading.");
    }
  }
  // A heading that is only its own question's label (a label made into a heading) – unless the form's own convention is
  // "each numbered question is its own heading" (a heading that is its first question's label and holds more questions).
  const isOwnLabel = (i: number) => Boolean(headings[i]) && headings[i].toLowerCase() === norm(fields[i].label).toLowerCase();
  const questionHeadings = fields.some((_, i) => isOwnLabel(i) && headings.filter((x) => x === headings[i]).length > 1);
  fields.forEach((f, i) => {
    if (!isOwnLabel(i) || questionHeadings) return;
    const h = headings[i];
    const others = headings.filter((x, j) => j !== i && x === h).length;
    const subQuestions = fields.some((g, j) => j > i && headings[j].toLowerCase() === norm(f.label).toLowerCase());
    if (others === 0 && !subQuestions) flag(f.id, "This box's heading is only its own question: give it the heading it is printed under, or none.");
  });
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * L8 – a blank inside printed words, and its printed lead
 * ----------------------------------------------------------------------------------------------*/

/** A placeholder that is only a blank: dots, an ellipsis, underscores. */
export const BLANK_PLACEHOLDER = /^[\s.…_-]*(?:…|\.{2,}|_{2,})[\s.…_-]*$/;
/**
 * A short blank ("…", "...") sits inside a printed sentence; a long dotted or ruled line is a "write here" space after
 * a label. Without the template's text (the mapping page), only a short blank is taken to complete printed words.
 */
const SHORT_BLANK = /^\s*(?:…|\.{2,3}|…\.|\.…)\s*$/;

/**
 * The words printed before a blank in its block ("To return to" before "…"), from the template's text – the printed
 * lead the answer completes (analysis.printedLeads, read by the drafting checks). Null: no words before it, or the
 * placeholder is not printed there. At most the last 80 characters of the clause it sits in.
 */
export function printedLeadIn(blockText: string, placeholder: string, occurrence = 0): string | null {
  const text = blockText.replace(/\s+/g, " ");
  const needle = placeholder.replace(/\s+/g, " ");
  let at = text.indexOf(needle);
  for (let k = 0; k < occurrence && at >= 0; k++) at = text.indexOf(needle, at + needle.length);
  if (at < 0) return null;
  const before = text.slice(0, at);
  // The clause the blank completes: after the last sentence end, label colon, tab-like gap, an earlier blank, or a
  // comma before a capital (“Plan agreed, To return to …”).
  const clause = before.split(/(?:[.!?]\s|:\s|\s{2,}|[|•]|…|\.{2,}|_{2,}|,\s+(?=[A-Z]))/).pop() ?? "";
  const lead = clause.replace(/^[\s\-–—,;]+/, "").trimEnd().slice(-80).trim();
  return /[A-Za-z]/.test(lead) ? lead : null;
}

function leadIsKnown(form: Pick<FormDefinition, "analysis">, field: FormField, printedBefore: string | null): boolean {
  const stored = form.analysis.printedLeads?.[field.id];
  if (stored && stored.trim()) return true;
  const quoted = quotedPhrases(field.guidance);
  if (quoted.length === 0) return false;
  if (printedBefore === null) return true; // no template text to compare with: a quoted lead is taken as given
  const tail = norm(printedBefore).toLowerCase();
  return quoted.some((q) => tail.endsWith(norm(q).toLowerCase()));
}

/* ------------------------------------------------------------------------------------------------
 * L12 – vendor, product and technology names
 * ----------------------------------------------------------------------------------------------*/

/** Clinic-system (practice-management) product names: the clinic sees "your clinic system", never a vendor. */
const PRODUCT_NAMES = /\b(?:TM3|Cliniko|WriteUpp|Pabau|Semble|Jane App|Physitrack|Rehab My Patient)\b/i;
const MODEL_NAMES = /\b(?:opus|sonnet|haiku|fable|chatgpt|openai|gemini|copilot)\b/i;

function vendorName(text: string): boolean {
  return PRODUCT_NAMES.test(text) || MODEL_NAMES.test(text) || BANNED_TERM_PATTERNS.some((re) => re.test(text));
}

/* ------------------------------------------------------------------------------------------------
 * The lint
 * ----------------------------------------------------------------------------------------------*/

function isConverted(form: Pick<FormDefinition, "analysis" | "file">, opts: LintOptions): boolean {
  if (opts.convertedFromRtf !== undefined) return opts.convertedFromRtf;
  if (form.analysis.convertedWith) return true;
  if (form.analysis.warnings.some(isRtfConversionNote)) return true;
  return isConvertedFromRtf(form.file);
}

const PREPARED_LINE = /\bprepared\b[^.]*\bClinForms\b|\bClinForms\b[^.]*\bprepared\b/i;

/**
 * Every finding of the map lint, in field order then map-level. Findings a field's lintAccepted covers (same rule) are
 * returned with severity "accepted"; map-level findings cannot be accepted.
 */
export function lintFormMap(form: Pick<FormDefinition, "fields" | "analysis" | "file"> & Partial<Pick<FormDefinition, "title" | "referrer">>, opts: LintOptions = {}): LintIssue[] {
  const want = new Set<LintRule>(opts.rules ?? LINT_RULES);
  const issues: LintIssue[] = [];
  const fields = form.fields;
  const push = (rule: LintRule, field: FormField | null, message: string) => {
    if (!want.has(rule)) return;
    const accepted = hookEnabled(LINT_ACCEPTED_HOOK) && field ? acceptanceFor(field, rule) : undefined;
    issues.push({
      rule,
      ...(field ? { fieldId: field.id } : {}),
      severity: accepted ? "accepted" : "error",
      message,
      ...(accepted ? { acceptedReason: accepted.reason } : {}),
    });
  };

  const headingIssues = new Map(headingProblems(fields).map((h) => [h.fieldId, h.message] as const));

  for (const f of fields) {
    const note = f.note ?? "";
    const guidance = f.guidance ?? "";
    // L1
    const preparer = note ? sentencesOf(note).map(preparerSentence).find(Boolean) : null;
    if (preparer) push("L1", f, `The note is written for whoever prepared the map (${preparer}): write it for the clinic's staff, or remove it.`);
    // L2
    if (guidance && keepsPrintedWhenUnanswered(guidance)) push("L2", f, "The guidance says an unanswered box keeps what is printed; a box left blank prints nothing. Say what leaving it blank does.");
    // L3
    if (f.fillSource.kind === "registration" && (f.fillSource.path.startsWith("clinic.") || f.fillSource.path === "staff.entry")) {
      // "filled from the record", "taken from the records", "from the patient's record", "from the clinic's record",
      // "comes from the patient records" – not "From the clinic system's …" (check-WE minor 6).
      // harden-WE (check2-WE minor 4): "taken from the patient file", "comes from the clinic system record", "read off the
      // record", "copied from the case record".
      const fromRecord = /\b(?:from|out of|off) the (?:patient(?:'s|’s|s'|s’)? |patients(?:'|’) |clinic(?:'s|’s)? |clinic system(?:'s|’s)? |clinical |case |medical |treatment )?(?:records?|file)\b/i;
      const where = [fromRecord.test(note) ? "note" : "", fromRecord.test(guidance) ? "guidance" : ""].filter(Boolean).join(" and ");
      if (where) {
        push(
          "L3",
          f,
          f.fillSource.path === "staff.entry"
            ? `The ${where} says it is filled from the record, but staff enter it on each report: say “Entered by staff on each report”.`
            : `The ${where} says it is filled from the record, but it comes from the clinic's own details: say “From your Clinic details”.`,
        );
      }
    }
    // L4
    const naming = optionNamingProblem(f);
    if (naming) push("L4", f, `The guidance ${naming.replace(/^it /, "")}: name each option exactly as the form prints it.`);
    // L5
    const judgement = judgementOnNonClinicianSource(f);
    if (judgement) {
      const by = judgement.source === "staff" ? "entered by staff" : judgement.source === "fixed" ? "a fixed answer" : "drafted from the notes";
      push("L5", f, `This question asks for a clinical judgement (${judgement.kind}) but is ${by}: make it the clinician's own answer, or accept it with the reason (for example, the patient reports it).`);
    }
    // L6
    const session = sessionQuestionOf(f);
    const s = f.fillSource;
    const recordPathNamed = s.kind === "registration" && s.path !== "staff.entry";
    if (session && !recordPathNamed && (s.kind === "notes_narrative" || s.kind === "clinician_opinion" || (s.kind === "registration" && s.path === "staff.entry"))) {
      const suggested = suggestedRecordPath(session);
      push("L6", f, `The appointments in the record hold this value: take it from the record (${suggested.path}) instead of ${s.kind === "registration" ? "staff typing it" : "drafting it"}.`);
    }
    // L7
    const heading = headingIssues.get(f.id);
    if (heading) push("L7", f, heading);
    // L8
    if (f.anchor.kind === "docx" && f.anchor.target === "replace_placeholder" && !f.anchor.writeAfter && f.anchor.placeholderText && BLANK_PLACEHOLDER.test(f.anchor.placeholderText)) {
      const text = opts.blockText?.(f.anchor.blockId);
      const before = typeof text === "string" ? printedLeadIn(text, f.anchor.placeholderText) : null;
      const wordsBefore = typeof text === "string" ? before !== null : SHORT_BLANK.test(f.anchor.placeholderText);
      if (wordsBefore && !leadIsKnown(form, f, typeof text === "string" ? before : null)) {
        push("L8", f, "This blank completes words printed before it, which the map does not know: quote them in the guidance (or let ClinForms record them from the form).");
      }
    }
    // L10
    if (
      f.anchor.kind === "docx" &&
      (f.anchor.target === "replace_placeholder" || f.anchor.target === "delete_options") &&
      !f.anchor.clearPlaceholder &&
      hasMergeToken(f.anchor.placeholderText ?? "") &&
      conditionText(fields, f.id) !== null
    ) {
      push("L10", f, "This question applies only when the question before it says so, and its own place holds a clinic-system merge code: when it does not apply the code would stay printed. Clear the place, or anchor it elsewhere.");
    }
    // L12
    if (vendorName(note) || vendorName(guidance)) push("L12", f, "A note or the guidance names a product or technology: say “your clinic system” or what it does instead.");
  }

  // Map-level: L1, L12 in the map's own warnings (not the RTF conversion notes, not load-forms' own line).
  const warnings = form.analysis.warnings ?? [];
  const own = warnings.filter((w) => !isRtfConversionNote(w) && w !== PREPARED_NOTE);
  if (own.some((w) => sentencesOf(w).some((x) => preparerSentence(x)))) push("L1", null, "A note on the map is written for whoever prepared it: write it for the clinic's staff, or remove it.");
  // The map's title and referrer are shown to the clinic too (check2-WE minor 2).
  if (warnings.some(vendorName) || vendorName(form.title ?? "") || vendorName(form.referrer?.name ?? "")) push("L12", null, "A note on the map, its title or its referrer names a product or technology.");
  // L9
  const prepared = warnings.filter((w) => PREPARED_LINE.test(w));
  if (prepared.length > 1 || prepared.some((w) => w !== PREPARED_NOTE)) push("L9", null, "The map carries a “prepared by ClinForms” line besides the one ClinForms adds when it loads the form: remove it.");
  // L11
  if (isConverted(form, opts)) {
    const pinned = opts.pin
      ? Boolean(opts.pin.sourceSha256) || Boolean(opts.pin.sha256 && opts.conversionSha256 && opts.pin.sha256 === opts.conversionSha256)
      : Boolean(form.file.sourceSha256);
    if (!pinned) push("L11", null, "The form was converted from RTF, but the map does not pin the source file (file.sourceSha256): a later conversion could not be matched to it.");
  }
  return issues;
}

/** Errors only (what blocks a load). */
export function lintErrors(issues: readonly LintIssue[]): LintIssue[] {
  return issues.filter((i) => i.severity === "error");
}

/** "L5@F-12, L9" – rule and field ids only, for load-forms' output and audit rows (never the form's wording). */
export function lintSummary(issues: readonly LintIssue[]): string {
  return issues.map((i) => `${i.rule}${i.fieldId ? `@${i.fieldId}` : ""}`).join(", ");
}
