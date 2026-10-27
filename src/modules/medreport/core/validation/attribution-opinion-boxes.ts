/**
 * The positive rule for opinion places (plan WB design 3, C-ATTR-1): in a clinician_opinion box, an opinion-labelled
 * box ("Prognosis", "Clinical impression", "Expected recovery time") or any paragraph whose basis is a recorded opinion,
 * drafted text may only give what a clinician recorded. Each sentence is
 * - a framed quotation ("<Name> recorded on <date>: “…”") whose quoted words are word for word in one sentence of a
 *   cited note that clinician wrote (normalised, note shorthand written out), or
 * - a claim every clause of which one sentence of a cited note holds – every content word, the note's hedges kept, the
 *   same negation, no stronger modality, a goal still a goal (attribution-anchor.ts anchorClause) – by the clinician
 *   the sentence names when it names one ("In my opinion …" is the approving clinician's own notes).
 * - or what the record holds outright: every content word in a cited record source (a computed fact, the registration
 *   record) or in the record's account of the incident (its mechanism, type and the referral's reason) – "following
 *   the lifting incident at work on 12/03/2026";
 * - or a conjunct that judges nothing: no opinion cue (a recovery, prognosis, cause, fitness, need, advice, a modal, a
 *   diagnosis, "consistent with …" together with its object) and no evaluative word (well, good, excellent, progress,
 *   new, satisfactory, steady …) – a plain description ("Outcome scores taken then were Neck
 *   Disability Index 42% …", "No further supervised sessions were planned."), which the figure, term and clinical
 *   negative checks read.
 * Anything else blocks (check-WB M5: "He is doing well.", "Excellent progress.", "Normal function.", "His back is as
 * good as new.", "consistent with a lumbar disc prolapse" in a prognosis box no cited note supports). Requiring a
 * one-sentence anchor for every conjunct, evaluative or not, blocked 13 faithful recorded demo drafts and the API
 * suites' approved forms (the incident account, outcome scores, the home programme, "no further sessions were
 * planned"), and requiring a share of its words in the cited sources blocked faithful expansions of note shorthand, so
 * what needs an anchor is recognised by its opinion or evaluative words – a wider list than the phrase patterns.
 * Sentences the opinion-language check already flags (a listed phrase no note holds) are left to it; a misquotation
 * always blocks here.
 *
 * Drafted text: never acknowledged – "Use the note's words" (attribution-fixes.ts) writes the framed quotation where it
 * fits the box; otherwise the box's gap stays for the approving clinician. Text a person edited or wrote: the
 * approving clinician may acknowledge it (ackPolicy "approver"); the approver's own words are not checked (WC stamps
 * who wrote what).
 *
 * Registered in registry.ts (VALIDATORS "attribution-opinion-boxes"). Owner: WB – docs/bh2-ownership.json.
 */
import { formatUkDate } from "../dates";
import type { EpisodeBundle, Note, Paragraph, ReportFlag, ReportSection } from "../types";
import { anchorClaim, claimSegments, quotedVerbatim, type NoteAnchor } from "./attribution-anchor";
import { claimRuns, clinicianNames, type DraftSentence } from "./attribution-text";
import { isOpinionPlace } from "./attribution-colleague-named";
import { getValidationContext, hasText, makeFlag, voiceOwnerOf } from "./context";
import { APPROVER_ACCEPTANCE, authorshipOf, judgeParagraphOpinions, keptDraftedMessage, sentenceSha } from "./opinion-language";
import { ackPolicyOf } from "./acknowledge";
import { hookEnabled } from "./hooks";
import type { Validator } from "./registry";
import { normaliseForMatch } from "./text";
import { canonicalRanges, contentStems, covers, hasOpinionCue, noteSentences, quoteOutside, sameName, stem, stemsMatch } from "./attribution-text";

export interface OpinionPlaceSentence {
  sentence: DraftSentence;
  /** What holds it: the note sentence (an anchor), "record" (a computed fact or the registration record), or null. */
  anchor: NoteAnchor | "record" | null;
  /** A framed quotation whose quoted words are not in the named clinician's cited notes. */
  misquote: boolean;
  /** The opinion-language check flags a phrase in it already. */
  flaggedByPhrase: boolean;
  /** Fix round 1 (R1T-WB-08): the conjuncts no cited note holds that give an opinion (normalised), for the acceptance offer. */
  openSegments?: string[];
}

/**
 * A work-status or return conjunct (fix round 1, R1T-WB-08): what the approver may accept as their own note's words
 * (Khuram 26/10/2026 – a drafted return-to-work or work-status line their own note records). Never a prediction, a
 * need or advice (a modal), never a restriction to come.
 */
const WORK_STATUS = /\b(?:work|working|worked|works|duties|duty|job|shifts?|hours|role|employment|off work|back at work|desk)\b/;
const PREDICTS = /\b(?:will|would|shall|should|can|could|may|might|must|ought|needs?|needed|requires?|required|expect\w*|anticipat\w*|likely|plan\w*|aim\w*|goal\w*|advis\w*|recommend\w*|until|unless|if|when|once|after)\b/;

/**
 * The approver's own cited note that records a work-status conjunct: one sentence of it, not in the plan field and not a
 * goal or question, that holds two thirds of the conjunct's content words and is itself about work – or null.
 */
export function ownNoteRecordingWork(segment: string, notes: readonly Note[]): { note: Note; sentence: string } | null {
  if (!WORK_STATUS.test(segment) || PREDICTS.test(segment)) return null;
  const want = contentStems(segment);
  if (want.length < 2) return null;
  for (const n of notes) {
    for (const ns of noteSentences(n)) {
      if (ns.field === "plan" || ns.field === "history" || ns.goalLabel || ns.question || !WORK_STATUS.test(ns.norm)) continue;
      const held = want.filter((w) => ns.stems.some((h) => stemsMatch(w, h))).length;
      if (held * 3 >= want.length * 2) return { note: n, sentence: ns.text };
    }
  }
  return null;
}

/** Whether the approver accepted this work-status conjunct of `sentence` as their own note's words (ReportSection.accepted). */
function workStatusAccepted(section: ReportSection, report: Parameters<typeof judgeParagraphOpinions>[0]["report"], segment: string, sentence: string, cited: readonly Note[]): boolean {
  if (!hookEnabled(APPROVER_ACCEPTANCE)) return false;
  const approver = report.approver;
  if (!approver || !section.accepted?.length) return false;
  const sha = sentenceSha(sentence);
  return section.accepted.some((a) => {
    if (a.check !== "OPINION_LANGUAGE" || normaliseForMatch(a.phrase) !== segment || a.sentenceSha !== sha) return false;
    if (a.by.memberId !== approver.memberId || !a.by.canSign || !a.noteId) return false;
    const note = cited.find((n) => n.id === a.noteId);
    return Boolean(note) && sameName(note!.author.name, approver.name) && ownNoteRecordingWork(segment, [note!]) !== null;
  });
}

/** Words that judge (an evaluation): a conjunct with one says more than a description of the notes. */
const EVALUATIVE = new Set(
  [
    "well", "good", "great", "excellent", "fine", "poor", "bad", "progress", "progressing", "new", "strong", "stronger", "weaker", "healthy",
    "satisfactory", "favourable", "encouraging", "reassuring", "successful", "effective", "optimistic", "pessimistic", "serious",
    "remarkable", "steady", "stable", "perfect", "ok", "okay",
  ].map(stem),
);
// Whole words only, and not here: a test result ("positive flexion-rotation test", "a normal neurological
// examination"), a grade the notes and outcome bands give ("mild", "moderate", "minimal disability"), a term
// ("functional capacity", "occupational health", "weakness", "stability exercises") – findings a plain description may
// carry; the opinions among them ("normal function", "fully functional") are phrase patterns of opinion-language.ts.

/**
 * Whether a normalised conjunct has an evaluative word (EVALUATIVE, by stem). Fix round 1 (R1T-WB-06): "progressed" as
 * the clinician's act on the treatment ("he progressed the loading", "the programme was progressed to functional
 * strengthening") is what was done, not an evaluation of the patient's progress – "good progress", "progressing well"
 * still are.
 */
export function isEvaluative(norm: string): boolean {
  const acts = norm.replace(/\b(?:was |were |been |had |has |have )?progressed (?=(?:to|onto|the|his|her|their|treatment|him|exercises?|loading|strengthening|programme|home)\b)/g, " ");
  return contentStems(acts).some((w) => EVALUATIVE.has(w));
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
    const open = hits.filter((h) => !h.anchor && !h.accepted);
    const flaggedByPhrase = open.length > 0;
    const holder = s.holder ? (s.holder.kind === "named" ? s.holder.name : (owner?.name ?? null)) : undefined;
    if (s.quote) {
      const qn = canonicalRanges(normaliseForMatch(s.quote.text));
      const at = s.norm.indexOf(qn);
      const outside = at >= 0 ? quoteOutside(s.norm, at, at + qn.length) : "";
      const anchor = holder === null ? null : quotedVerbatim(s.quote.norm, cited, holder ?? null, outside);
      out.push({ sentence: s, anchor, misquote: !anchor, flaggedByPhrase });
      continue;
    }
    // Conjunct by conjunct: every segment with content words must be held by a cited note sentence of the holder, or by
    // the record (a cited record source, the incident's account); only a segment with no content word of its own (a
    // frame, a date, a name) needs nothing. A frame inside the claim ("…, and on 05/08/2026 Tom Ellis, physiotherapist,
    // recorded …") starts a run in that clinician's words, anchored to their notes (fix round 1).
    let anchor: NoteAnchor | "record" | null = null;
    let all = true;
    let unflagged = false;
    const openSegments: string[] = [];
    const segments: Array<{ text: string; content: boolean; anchor: NoteAnchor | null }> = [];
    for (const run of claimRuns(s.claim, people, s.holder)) {
      const runHolder = run.holder ? (run.holder.kind === "named" ? run.holder.name : (owner?.name ?? null)) : undefined;
      if (runHolder === null) {
        segments.push(...claimSegments(normaliseForMatch(run.text), ignore).segs.map((g) => ({ text: g.text, content: contentStems(g.text, ignore).length > 0, anchor: null as NoteAnchor | null })));
      } else segments.push(...anchorClaim({ clause: run.text, notes: cited, holder: runHolder ?? null, ignore, context: s.norm }).segments);
    }
    const claimed = { segments };
    for (const seg of claimed.segments) {
      if (!seg.content) continue;
      if (seg.anchor) {
        anchor = anchor ?? seg.anchor;
        continue;
      }
      const stems = contentStems(seg.text, ignore);
      if (input.records.some((r) => covers(stems, contentStems(r, ignore)).ok)) {
        anchor = anchor ?? "record";
        continue;
      }
      // A plain description – it judges nothing (see the file header).
      if (!hasOpinionCue(seg.text) && !isEvaluative(seg.text)) continue;
      // The approver's acceptance of their own note's work-status line (R1T-WB-08).
      if (workStatusAccepted(input.section, input.report, seg.text, s.text, cited)) {
        anchor = anchor ?? "record";
        continue;
      }
      all = false;
      openSegments.push(seg.text);
      // A segment the opinion-language check flags a phrase in is left to it; any other unsupported segment is this
      // rule's, even beside a flagged phrase elsewhere in the sentence (check-WB: "No restrictions were recorded; his
      // presentation was consistent with a lumbar disc prolapse").
      if (!open.some((h) => seg.text.includes(h.phrase))) unflagged = true;
    }
    out.push({ sentence: s, anchor: all ? (anchor ?? "record") : null, misquote: false, flaggedByPhrase: flaggedByPhrase && !unflagged, openSegments });
  }
  return out;
}

/** The record's own account of the incident (normalised): its date, type and mechanism, and the referral's reason. */
function incidentAccount(bundle: Pick<EpisodeBundle, "incident" | "referral">): string {
  const i = bundle.incident;
  const date = i?.date ? formatUkDate(i.date) : "";
  return normaliseForMatch([i?.mechanism, i?.type, date, bundle.referral?.reason].filter(Boolean).join(" ; "));
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
    const who = authorshipOf(p, input.report, section);
    if (who === "approver" || who === "record") continue;
    const records = [
      ...p.sourceIds.filter((id) => !/^N-\d+$/.test(id)).map((id) => normaliseForMatch(ctx.sourceTexts.get(id) ?? "")),
      incidentAccount(input.bundle),
    ].filter(Boolean);
    const judged = judgeOpinionPlace({ paragraph: p, section, report: input.report, notes: input.bundle.notes, people, owner: owner?.name.trim() ? owner : null, records });
    const bad = judged.filter((j) => (j.misquote || !j.anchor) && !(j.flaggedByPhrase && !j.misquote));
    if (bad.length === 0) continue;
    // The flag shows the sentence that gives an opinion when there is one (a plain unsupported sentence beside it is
    // reported by the same flag).
    const worst = bad.find((j) => j.misquote) ?? bad.find((j) => hasOpinionCue(j.sentence.norm)) ?? bad[0];
    const first = worst.sentence.text.trim();
    const evidence = first.length > 80 ? `${first.slice(0, 77)}…` : first;
    const flag = makeFlag({
      code: "OPINION_LANGUAGE",
      severity: "blocking",
      sectionKey: section.key,
      paragraphId: p.id,
      evidence,
      message: worst.misquote
        ? `This answer quotes words (“${worst.sentence.quote?.text ?? ""}”) as ${worst.sentence.framedBy ? `${worst.sentence.framedBy}'s` : "a clinician's"} that are not what ${worst.sentence.framedBy ? `${worst.sentence.framedBy}'s cited note records` : "the cited note records"}: the note does not hold them, or holds them only with words the quotation leaves out (a “not”, a hedge, a condition, or whose words they are). In an opinion box drafted text may only quote what the clinician recorded – use the note's words, or the approving clinician writes it.`
        : who === "drafted"
          ? `In an opinion box drafted text may only give what a clinician recorded, and no cited note records this (“${evidence}”). Use the note's words, or the approving clinician writes the answer.`
          : `No cited note records this opinion (“${evidence}”). If it is the approving clinician's own opinion, they acknowledge it with a reason; otherwise reword it.`,
    });
    flag.ackPolicy = who === "drafted" ? "never" : "approver";
    // R1T-WB-L1: drafted wording kept in a person's edit cannot be acknowledged – say what clears it instead.
    if (who !== "drafted" && !worst.misquote && ackPolicyOf(flag, input.report) === "never") flag.message = keptDraftedMessage(`No cited note records this opinion (“${evidence}”).`);
    flags.push(flag);
  }
  return flags;
};
