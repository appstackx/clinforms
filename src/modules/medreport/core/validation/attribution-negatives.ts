/**
 * Clinical negatives (plan WB design 12, C-3; R-regression-5): a drafted "No red flags were reported.", "No swelling was
 * noted on examination." or "No head injury and no loss of consciousness." states a finding – the absence of something
 * a clinician looked for. It is never commentary about the notes and never removed by a click. It needs a cited note
 * that records the same absence ("No red flags.", "Neuro: no deficit", "No head injury. No loss of consciousness.");
 * when no cited note does, a NON-BLOCKING warning says "not found in the cited note – check it".
 *
 * "No … was recorded / documented / stated" is a statement about the record, not a finding: it is not checked here
 * (commentary.ts words the warning for it when it names the notes).
 *
 * TERM_NOT_IN_SOURCE, severity warning (acknowledged by anyone, never blocking). Ledger hook "notes-absence-strip"
 * (ledger.json): the only special treatment a "No …" sentence gets since the round-3 pre-strip was removed is this
 * anchor – a negative the note records needs no warning; the opinion check still reads every word of the sentence.
 * While the hook is disabled every clinical negative gets the warning.
 *
 * Run by the opinion-language validator (validateOpinionLanguage) after its own flags. Owner: WB – docs/bh2-ownership.json.
 */
import type { Note, Paragraph, ReportFlag } from "../types";
import { coveringSpan } from "./attribution-anchor";
import { contentStems, frameScope, noteSentences, stemsMatch } from "./attribution-text";
import { makeFlag } from "./context";
import { defineHook, hookEnabled } from "./hooks";
import { splitSentences } from "../text/sentences";
import { normaliseForMatch } from "./text";

/** Ledger hook (see the file header). */
export const NEGATIVE_FINDING_ANCHOR = defineHook("notes-absence-strip");

/** A clinician's finding verbs after a "No …" (the record-keeping verbs – recorded, documented, stated – are not findings). */
const FINDING_VERB = "(?:noted|reported|found|seen|present|elicited|observed|detected|identified|demonstrated|described|complained of|evident)";
/** Frame words around a negative that are not part of the finding ("on examination", "at discharge"). */
const FRAME_WORDS = new Set(["examination", "assessment", "discharge", "review", "today", "initially", "appointment", "session", "time", "presentation"]);
const NEGATOR = /\b(?:no|not|nil|none|without|negative|denies|denied|absent|nad|normal)\b/;

/** The findings a clinical-negative sentence denies ("No head injury and no loss of consciousness" → two), or []. */
export function negativeFindings(sentence: string): string[] {
  const n = normaliseForMatch(sentence).replace(/[.!]+$/, "").trim();
  const m = /^(?:there (?:was|were|is|are) )?no (.+)$/.exec(n);
  if (!m) return [];
  // A record statement, or a sentence that goes on to say more than the negative ("…, as he had made a full recovery").
  if (/\b(?:recorded|documented|stated|written|mentioned|given)\b/.test(m[1])) return [];
  const verb = new RegExp(`\\s+(?:was|were|is|are|has been|have been)\\s+(?:${FINDING_VERB})\\b`);
  const parts = m[1].split(/\s*(?:,\s*|\s+)?(?:and|or)\s+no\s+|\s*[,;]\s*no\s+/);
  const out: string[] = [];
  for (const raw of parts) {
    // "No further sessions were planned": another verb than a finding's – a statement about the plan, not a finding.
    const otherVerb = new RegExp(`\\s(?:was|were|is|are|has been|have been)\\s+(?!(?:${FINDING_VERB})\\b)[a-z]+(?:ed|en)\\b`);
    if (otherVerb.test(` ${raw}`)) continue;
    const part = raw.replace(verb, " ").replace(new RegExp(`\\s+(?:${FINDING_VERB})\\b`), " ").trim();
    // A clause that is not a finding at all ("… and he has made a full recovery"), or another conjunct with its own verb
    // (fix round 1, R1T-WB-L4: "There was no quadriceps lag, and single-leg squat was painful …" denies only the lag – the
    // squat is a second note sentence's finding, not part of the negative).
    const clean = part
      .split(/\s+(?:and|but|as|because|so)\s+(?:he|she|they|his|her|their|it|the)\b/)[0]
      .split(/\s*(?:[,;]\s*(?:and|but|while|whereas)\s+|;\s*)(?=(?:[a-z-]+\s+){0,4}(?:was|were|is|are|had|has)\b)/)[0]
      .trim();
    if (clean) out.push(clean);
  }
  return out;
}

/**
 * Whether a cited note records the absence of `finding`: one sentence holds every content word, and the part of it
 * that says them negates them (fix round 1, R1T-WB-04: the negator is in that part's own conjuncts and modifiers –
 * attribution-text.ts frameScope – so "No swelling" on one line of a terse note never lends its "no" to the next line's
 * "knee pain on stairs").
 */
export function negativeRecorded(finding: string, notes: readonly Note[]): boolean {
  const want = contentStems(normaliseForMatch(finding)).filter((w) => !FRAME_WORDS.has(w));
  if (want.length === 0) return true;
  for (const note of notes) {
    for (const s of noteSentences(note)) {
      if (s.field === "history") continue;
      if (!NEGATOR.test(s.norm)) continue;
      if (!want.every((w) => s.stems.some((h) => stemsMatch(w, h)))) continue;
      const span = coveringSpan(s.norm, want, undefined, undefined, s);
      if (!span) continue;
      if (NEGATOR.test(frameScope(s, span.start, span.end))) return true;
    }
  }
  return false;
}

/** The warnings for one drafted paragraph's unsupported clinical negatives. */
export function unsupportedNegatives(p: Pick<Paragraph, "id" | "text" | "sourceIds">, sectionKey: string, notes: readonly Note[]): ReportFlag[] {
  const cited = p.sourceIds.filter((id) => /^N-\d+$/.test(id)).map((id) => notes.find((n) => n.id === id)).filter((n): n is Note => Boolean(n));
  const out: ReportFlag[] = [];
  for (const s of splitSentences(p.text, "prose")) {
    for (const finding of negativeFindings(s.text)) {
      if (hookEnabled(NEGATIVE_FINDING_ANCHOR) && negativeRecorded(finding, cited)) continue;
      const flag = makeFlag({
        code: "TERM_NOT_IN_SOURCE",
        severity: "warning",
        sectionKey,
        paragraphId: p.id,
        evidence: `no ${finding}`,
        message: `“No ${finding}” is not found in the cited note – check it. A clinical negative needs a note that records it; otherwise remove it or cite the note that does.`,
      });
      flag.ackPolicy = "member";
      out.push(flag);
    }
  }
  return out;
}
