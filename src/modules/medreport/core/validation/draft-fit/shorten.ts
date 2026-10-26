/**
 * DRAFT_FIT part "shorten" (B0-5, B1-12, B2-14, B3-12): a short answer that goes in a table cell, or fills a blank inside
 * the form's printed sentence ("To return to …", "…/10"), written as more than the value – it should be the value alone
 * ("Dog walking", "Daily", "6/10"); the citation keeps its source. Only boxes the record answers (an opinion keeps its
 * attribution). A warning: the clinician shortens it, or keeps it.
 *
 * What triggers it, each named in the message (bh2 WD design 9 – the message names its actual trigger):
 * - a date lead ("On 06/05/2026 …", "At the review on 06/05/2026, …", "06/05/2026: …") – a date later in the sentence
 *   ("…at work on 12/03/2026") is part of the value, not a lead (B2-14);
 * - an attribution ("… recorded", "reported", "told", "noted", "stated", "described", "assessed", "measured") – but not
 *   the box's own words for nothing found ("None reported", "Not recorded", "nothing noted") nor "(dose not stated)"
 *   (B2-14, B3-12);
 * - length: more than 12 words, or more than 30 when the question asks for more than the value (a line or two, "and the
 *   symptoms") (B1-12 (b)).
 *
 * Also the "value-only" one-click (B2-16, plan WD design 6; ledger hook "value-only"): valueOnlyFix() – the value with a
 * trailing attribution clause taken off ("7/10 at worst, as recorded by Sarah Reid using the Numeric Pain Rating
 * Scale" → "7/10 at worst"). Offered only in a compact place, on a box the record answers, when every note the
 * paragraph cites is the voice owner's own (C-REV-1: a colleague's finding keeps their name), only when the clause
 * holds no date or figure (a dated attribution – "measured by Sarah Reid on 18/03/2026" – tells the reader which time
 * point the value is from, B1-6), and only when the clause is the attribution and nothing else: who recorded it, their
 * job title, the scale or tool, and where ("at the first assessment") – never a clause of the answer ("…, and no red
 * flags were noted", "…, with no pain on overpressure", "…, with pain at end of range": bh2 WD review M3). A clause that
 * names a time point goes only when the printed question names the same one (ui/components/review/fixes.ts, with
 * valueOnlyTimePoint). ui/components/review/fixes.ts builds the proposal.
 *
 * Split out of core/validation/draft-fit.ts by W0.4 (bh2 module split); the triggers and value-only are bh2 WD.
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import { compactPlace } from "../../forms/answer-shape";
import { figuresOf } from "../../text/sentences";
import type { Clinician, EpisodeBundle, FormField, Paragraph, ReportFlag } from "../../types";
import { sameClinician } from "../../voice";
import { makeFlag } from "../context";
import type { DraftFitPart } from "../draft-fit";
import { defineHook } from "../hooks";
import type { ValidatorInput } from "../registry";

/**
 * Ledger hook "value-only" (one-click, ledger.json): the "Use the value only" fix. Registered here; the review's fix
 * engine (ui/components/review/fixes.ts) offers it only while hookEnabled(VALUE_ONLY_HOOK).
 */
export const VALUE_ONLY_HOOK = defineHook("value-only");

/** A date lead at the start of the answer. */
const DATE_LEAD = /^(?:On \d{1,2}\/\d{1,2}\/\d{4}\b|At [^,.;]{0,60}? on \d{1,2}\/\d{1,2}\/\d{4}\b|\d{1,2}\/\d{1,2}\/\d{4}\s*[:,–-])/i;
/** "…, 06/05/2026, Tom Ellis recorded" (a date then the recorder) also leads. */
const DATE_THEN_RECORDER = /^\d{1,2}\/\d{1,2}\/\d{4},?\s+[A-Z][a-z]+(?: [A-Z][a-z'-]+)+,?\s+(?:[a-z]+\s+)?(?:recorded|noted|assessed|reported|measured)\b/;
const ATTRIBUTED = /\b(?:recorded|reported|told|noted|stated|described|assessed|measured|documented)\b/i;
/** The box's own wording for nothing found – "None reported", "Not recorded", "nothing noted", "(dose not stated)". */
const NOTHING_REPORTED = /\b(?:none|nil|nothing|not|no(?:\s+\w+){0,3}?)\s+(?:was\s+|were\s+|been\s+)?(?:reported|recorded|noted|stated|described|documented)\b/gi;
/** The question asks for more than the value. */
const MORE_THAN_VALUE = /\b(?:(?:one|1)\s+or\s+(?:two|2)\s+lines?|(?:two|2)\s+lines|a\s+line\s+or\s+two|and\s+(?:the\s+)?symptoms|briefly\s+describe|brief\s+description|details?)\b/i;

export const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Why a compact answer is more than the value, or null. */
export function shortenTrigger(text: string, field: Pick<FormField, "label" | "guidance">): { kind: "date" | "attribution" | "length"; words: number } | null {
  const t = text.trim();
  const n = words(t).length;
  if (DATE_LEAD.test(t) || DATE_THEN_RECORDER.test(t)) return { kind: "date", words: n };
  if (ATTRIBUTED.test(t.replace(NOTHING_REPORTED, " "))) return { kind: "attribution", words: n };
  const limit = MORE_THAN_VALUE.test(`${field.label} ${field.guidance ?? ""}`) ? 30 : 12;
  if (n > limit) return { kind: "length", words: n };
  return null;
}

function shortenMessage(trigger: { kind: "date" | "attribution" | "length"; words: number }, place: "cell" | "blank"): string {
  const where = place === "cell" ? "this answer goes in a table cell" : "this answer completes the form's printed sentence";
  const value = place === "cell" ? "the value alone (for example “Dog walking”, “Daily”, “6/10”, “Lower back”)" : "only the words that complete it";
  switch (trigger.kind) {
    case "date":
      return `Shorten for the box: ${where} – it starts with a date, but it should be ${value}. Its citation keeps the source and the date.`;
    case "attribution":
      return `Shorten for the box: ${where} – it says who recorded it, but it should be ${value}. Its citation keeps who recorded it.`;
    default:
      return `Shorten for the box: ${where}, and it is ${trigger.words} words long – it should be ${value}.`;
  }
}

/** A trailing attribution clause: ", as recorded by …", ", assessed by …", " (recorded by …)", ", as Tom Ellis recorded …". */
const TRAILING_ATTRIBUTION =
  /(?:,\s*|\s+\(\s*|\s+)(?:as\s+)?(?:(?:recorded|reported|noted|measured|assessed|documented|scored|rated|described)\s+(?:by|on|at|using|in)\b|(?:[A-Z][a-z]+\s+[A-Z][a-z'’-]+)\s+(?:recorded|noted|measured|assessed|documented)\b)[^.;]*?\)?\s*[.;]?\s*$/;

/**
 * The lower-case words an attribution clause may hold: the attribution itself (how, by whom), the job title, the tool,
 * and where or when it was recorded. Anything else – "and", "with", "but", a negation, a finding – is a clause of the
 * answer, which value-only never drops. Capitalised words (names, "Numeric Pain Rating Scale") are allowed.
 */
const ATTRIBUTION_CLAUSE_WORDS = new Set(
  (
    "as recorded reported noted measured assessed documented scored rated described by on at in using use of the a an " +
    "her his their my our first initial latest last final most recent assessment review appointment session visit discharge note notes " +
    "physiotherapist physio clinician therapist senior extended scope practitioner scale score tool questionnaire"
  ).split(" "),
);

/**
 * The value alone: the paragraph's text without its trailing attribution clause and closing full stop, or null when
 * there is no such clause, nothing is left, the clause holds a date or figure (it shows which time point the value
 * is from), or the clause holds anything but the attribution (see ATTRIBUTION_CLAUSE_WORDS).
 */
export function valueOnlyText(text: string): string | null {
  const t = text.trim();
  const m = TRAILING_ATTRIBUTION.exec(t);
  if (!m || m.index === 0) return null;
  const clause = t.slice(m.index);
  if (figuresOf(clause).length > 0) return null;
  const lower = clause.match(/\b[a-z][a-z'’-]*\b/g) ?? [];
  if (lower.some((w) => !ATTRIBUTION_CLAUSE_WORDS.has(w))) return null;
  // Two attributions joined ("…, as recorded by Sarah Reid, and …") or a second clause after a comma or a dash.
  if (/[,;–—]\s*(?:and|but|with|without|though|although|while|whereas|which|who)\b/i.test(clause)) return null;
  const value = t.slice(0, m.index).replace(/[\s,;:–-]+$/, "").trim();
  return value && value !== t ? value : null;
}

/** Time point words: the start of the episode, or where it is now. */
const START_TIME = /\b(?:initial(?:ly)?|first|baseline|pre[- ]?(?:injury|accident|incident)|on (?:referral|admission|presentation)|at (?:the )?(?:outset|start|presentation)|onset)\b/i;
const END_TIME = /\b(?:now|current(?:ly)?|latest|last|final|most recent|discharge|present(?:ly)?|today)\b/i;

/** The time point a phrase names ("at the first assessment" → "start", "Lumbar flexion – now" → "end"), or null. */
export function valueOnlyTimePoint(phrase: string): "start" | "end" | null {
  const start = START_TIME.test(phrase);
  const end = END_TIME.test(phrase);
  if (start === end) return null;
  return start ? "start" : "end";
}

/** Every note a paragraph cites is the owner's own (C-REV-1); false when it cites none, or the owner is unknown. */
export function citesOnlyOwnersNotes(p: Pick<Paragraph, "sourceIds">, bundle: Pick<EpisodeBundle, "notes">, owner: Clinician | null): boolean {
  if (!owner?.name.trim()) return false;
  const notes = p.sourceIds.map((id) => bundle.notes.find((n) => n.id === id)).filter((n) => n !== undefined);
  return notes.length > 0 && notes.length === p.sourceIds.filter((id) => /^N-/.test(id)).length && notes.every((n) => sameClinician(n!.author, owner));
}

export function shortenPart(input: ValidatorInput): DraftFitPart {
  const fields = new Map((input.form?.fields ?? []).map((f) => [f.id, f]));
  return {
    paragraph(p, section) {
      const flags: ReportFlag[] = [];
      const field = fields.get(section.fieldId ?? section.key);
      const place = section.paragraphs[0] === p ? compactPlace(field) : null;
      const trigger = place && field ? shortenTrigger(p.text, field) : null;
      if (place && trigger) {
        flags.push(
          makeFlag({
            code: "DRAFT_FIT",
            severity: "warning",
            sectionKey: section.key,
            paragraphId: p.id,
            evidence: "shorten",
            message: shortenMessage(trigger, place),
          }),
        );
      }
      return flags;
    },
  };
}
