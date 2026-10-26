/**
 * The positive rule for opinion places (plan WB design 3, C-ATTR-1): in a clinician_opinion box, an opinion-labelled
 * box ("Prognosis", "Clinical impression", "Expected recovery time") or any paragraph whose basis is a recorded opinion,
 * drafted text may only give what a clinician recorded. Each sentence is
 * - a framed quotation ("<Name> recorded on <date>: “…”") whose quoted words are word for word in one sentence of a
 *   cited note that clinician wrote (normalised, note shorthand written out), or
 * - a claim every clause of which one sentence of a cited note holds – every content word, the note's hedges kept, the
 *   same negation, no stronger modality, a goal still a goal (attribution-anchor.ts anchorClause) – by the clinician
 *   the sentence names when it names one ("In my opinion …" is the approving clinician's own notes).
 * Anything else blocks – including an opinion in wording no pattern lists ("He has made a good recovery", "The outlook
 * is good") – so recall does not depend on the phrase list. Sentences the opinion-language check already flags (a
 * listed phrase no note holds) are left to it; a misquotation always blocks here.
 *
 * Drafted text: never acknowledged – "Use the note's words" (attribution-fixes.ts) writes the framed quotation where it
 * fits the box; otherwise the box's gap stays for the approving clinician. Text a person edited or wrote: the
 * approving clinician may acknowledge it (ackPolicy "approver"); the approver's own words are not checked (WC stamps
 * who wrote what).
 *
 * Registered in registry.ts (VALIDATORS "attribution-opinion-boxes"). Owner: WB – docs/bh2-ownership.json.
 */
import type { Note, Paragraph, ReportFlag, ReportSection } from "../types";
import { anchorClaim, quotedVerbatim, type NoteAnchor } from "./attribution-anchor";
import { clinicianNames, type DraftSentence } from "./attribution-text";
import { isOpinionPlace } from "./attribution-colleague-named";
import { getValidationContext, hasText, makeFlag, voiceOwnerOf } from "./context";
import { authorshipOf, judgeParagraphOpinions } from "./opinion-language";
import type { Validator } from "./registry";
import { normaliseForMatch } from "./text";
import { contentStems, covers, hasOpinionCue, segmentsOf } from "./attribution-text";

export interface OpinionPlaceSentence {
  sentence: DraftSentence;
  /** What holds it: the note sentence (an anchor), "record" (a computed fact or the registration record), or null. */
  anchor: NoteAnchor | "record" | null;
  /** A framed quotation whose quoted words are not in the named clinician's cited notes. */
  misquote: boolean;
  /** The opinion-language check flags a phrase in it already. */
  flaggedByPhrase: boolean;
}

/** Judge every sentence of a paragraph in an opinion place (see the file header). */
export function judgeOpinionPlace(input: {
  paragraph: Pick<Paragraph, "text" | "sourceIds">;
  section: ReportSection;
  report: Parameters<typeof judgeParagraphOpinions>[0]["report"];
  notes: readonly Note[];
  people: readonly string[];
  owner: { name: string } | null;
  /** The text of each cited record source that is not a note (FACT-*, REG), normalised. */
  records: readonly string[];
}): OpinionPlaceSentence[] {
  const { paragraph: p, notes, people, owner } = input;
  const cited = p.sourceIds.filter((id) => /^N-\d+$/.test(id)).map((id) => notes.find((n) => n.id === id)).filter((n): n is Note => Boolean(n));
  const judged = judgeParagraphOpinions({ paragraph: p, section: input.section, report: input.report, notes, people, owner });
  const ignore = { people: people.map((x) => x.toLowerCase()) };
  const out: OpinionPlaceSentence[] = [];
  for (const { sentence: s, hits } of judged) {
    const flaggedByPhrase = hits.some((h) => !h.anchor && !h.accepted);
    const holder = s.holder ? (s.holder.kind === "named" ? s.holder.name : (owner?.name ?? null)) : undefined;
    if (s.quote) {
      const anchor = holder === null ? null : quotedVerbatim(s.quote.norm, cited, holder ?? null);
      out.push({ sentence: s, anchor, misquote: !anchor, flaggedByPhrase });
      continue;
    }
    // Conjunct by conjunct: a segment with opinion content (an opinion cue – a recovery, prognosis, cause, fitness, need,
    // advice, a modal or a diagnosis) must be held by a cited note sentence of the holder, or by a cited record source
    // (a computed fact, the registration record); a segment that only describes needs nothing.
    let anchor: NoteAnchor | "record" | null = null;
    let all = true;
    const claimed = holder === null ? { segments: segmentsOf(normaliseForMatch(s.claim)).map((g) => ({ text: g.text, content: true, anchor: null as NoteAnchor | null })) } : anchorClaim({ clause: s.claim, notes: cited, holder: holder ?? null, ignore });
    for (const seg of claimed.segments) {
      if (!seg.content || !hasOpinionCue(seg.text)) continue;
      if (seg.anchor) {
        anchor = anchor ?? seg.anchor;
        continue;
      }
      const stems = contentStems(seg.text, ignore);
      if (input.records.some((r) => covers(stems, contentStems(r, ignore)).ok)) {
        anchor = anchor ?? "record";
        continue;
      }
      all = false;
    }
    out.push({ sentence: s, anchor: all ? (anchor ?? "record") : null, misquote: false, flaggedByPhrase });
  }
  return out;
}

export const validateOpinionBoxQuotes: Validator = (input) => {
  const ctx = getValidationContext(input);
  const owner = voiceOwnerOf(input);
  const people = clinicianNames(input.bundle);
  const flags: ReportFlag[] = [];
  for (const { paragraph: p, section } of ctx.paragraphs) {
    if (!hasText(p)) continue;
    // A structured answer's paragraphs are supporting text (not printed): the answer itself is checked elsewhere.
    if (section.answer && section.answer.kind !== "text" && p.basis !== "clinician_opinion_recorded") continue;
    const label = input.form?.fields.find((f) => f.id === section.key)?.label ?? "";
    if (!isOpinionPlace(section, p, label)) continue;
    const who = authorshipOf(p, input.report);
    if (who === "approver" || who === "record") continue;
    const records = p.sourceIds.filter((id) => !/^N-\d+$/.test(id)).map((id) => normaliseForMatch(ctx.sourceTexts.get(id) ?? "")).filter(Boolean);
    const judged = judgeOpinionPlace({ paragraph: p, section, report: input.report, notes: input.bundle.notes, people, owner: owner?.name.trim() ? owner : null, records });
    const bad = judged.filter((j) => (j.misquote || !j.anchor) && !(j.flaggedByPhrase && !j.misquote));
    if (bad.length === 0) continue;
    const first = bad[0].sentence.text.trim();
    const evidence = first.length > 80 ? `${first.slice(0, 77)}…` : first;
    const flag = makeFlag({
      code: "OPINION_LANGUAGE",
      severity: "blocking",
      sectionKey: section.key,
      paragraphId: p.id,
      evidence,
      message: bad[0].misquote
        ? `This answer quotes words (“${bad[0].sentence.quote?.text ?? ""}”) that the cited note does not hold. In an opinion box drafted text may only quote what the clinician recorded – use the note's words, or the approving clinician writes it.`
        : who === "drafted"
          ? `In an opinion box drafted text may only give what a clinician recorded, and no cited note records this (“${evidence}”). Use the note's words, or the approving clinician writes the answer.`
          : `No cited note records this opinion (“${evidence}”). If it is the approving clinician's own opinion, they acknowledge it with a reason; otherwise reword it.`,
    });
    flag.ackPolicy = who === "drafted" ? "never" : "approver";
    flags.push(flag);
  }
  return flags;
};
