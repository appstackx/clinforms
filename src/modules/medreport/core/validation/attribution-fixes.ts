/**
 * WB's one-click fixes (plan WB designs 5, 10 and 12; seam "fix-generators-and-anchor", bh2-base2).
 *
 * ATTRIBUTION_FIX_GENERATORS – listed once for WD's engine (ui/components/review/fixes.ts offeredFixes / planFix, WD
 * design 6), which checks every proposal against its rules before offering it (I8). All additive or whole-sentence:
 * - "attribution-prefix": a colleague's finding or opinion drafted without their name gets it – "Tom Ellis recorded that
 *   he is fit …", or in a compact cell "Full and pain-free (Tom Ellis)." – only where every content word of the sentence
 *   is in that colleague's cited note (attribution-anchor.ts anchorClause), so the attribution is true.
 * - "use-note-words": the same sentence replaced by a framed quotation of the note's own clause, "Tom Ellis recorded:
 *   “in my opinion he is fit for a phased return to normal duties over 2 weeks”." – only where the quotation fits the
 *   box (a text box, not a compact cell or a tick's supporting text), holds the drafted sentence's content and adds no
 *   figure. A misquotation or a draft that strengthens the note is never "corrected" by a click: the approver words it.
 * - "name-instead": "Name Tom Ellis instead" (core/voice.ts nameInsteadClinician – only when every cited note is his
 *   and no first-person opinion wording is present; drafted and edited text).
 * - "remove-commentary": whole sentences of commentary about the notes (draft-fit/commentary.ts) are taken out – never
 *   the box's only text, never a clinical negative.
 * No subject is ever substituted otherwise, and no date is added (figures after = before).
 *
 * Who may apply them: the attribution fixes are the approving clinician's (WC design 4); they are offered only on a
 * report drafted in the approver's own voice (report.author is the approver) – on a staff-prepared report or one drafted
 * for another clinician every attribution is the approver's to word (a safe default the corpus pins, ATT-staff-01,
 * ATT-signer-02).
 *
 * Also here:
 * - "Accept as the note's words" (design 5, Khuram 26/10/2026): the approver – and only the approver – accepts, one phrase
 *   at a time, a drafted work-status or return line told as a past narrative ("taking 3 days off work before returning to
 *   normal duties") whose cited note is the approver's own and records that return; the offer shows the note sentence.
 *   Recorded in ReportSection.accepted {check, phrase, sentenceSha, noteId, by, at} – hashed – and in the activity log.
 *   Nothing else is ever accepted: any other drafted opinion is quoted or written by the approver.
 * - "Remove the note link" (B3-6): on text the approver edited that holds their own opinion ("In my opinion …") and also
 *   cites a colleague's note, the colleague's note is unlinked (approver only; another source must remain).
 * - offeredFixes(report, {actor, form, template}) – every fix above offered to `actor`, as the review applies it (the
 *   corpus harness and the review read it; WD's engine supersedes the bridge in ui/components/review/fixes.ts).
 *
 * Pure; browser and server. Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import { compactPlace } from "../forms/answer-shape";
import type { Actor } from "../actor";
import type { FixGenerator, FixInput, FixProposal } from "../fix-types";
import { removeSentences } from "../text/sentences";
import type { FormDefinition, Note, Paragraph, Report, ReportFlag, ReportSection, ReportTemplate } from "../types";
import { OWN_OPINION, nameInsteadClinician, sameClinician, speaksInFirstPerson } from "../voice";
import { anchorClause } from "./attribution-anchor";
import { colleaguesCited, namesClinician, unattributedSentences } from "./attribution-colleague-named";
import { defaultVoiceOwner } from "./attribution-owner";
import { clinicianNames, noteSentences, sameName, type DraftSentence } from "./attribution-text";
import { commentarySentences } from "./draft-fit/commentary";
import { defineHook, hookEnabled } from "./hooks";
import { judgeParagraphOpinions, narratedReturn, noteRecordsReturn, sentenceSha } from "./opinion-language";
import { noteSourceText } from "./sources";
import { normaliseForMatch } from "./text";
import { expandNoteShorthand } from "../voice";

/** Ledger hook: the commentary removal ("Remove the comment") – never a clinical negative, never the box's only text. */
export const REMOVE_COMMENTARY = defineHook("remove-absence");

/* ------------------------------------------------------------------------------------------------
 * Who may apply
 * ----------------------------------------------------------------------------------------------*/

/** The actor is the report's approving clinician (who may sign). */
export function isApprover(report: Pick<Report, "approver">, actor: Pick<Actor, "memberId" | "canSign"> | null | undefined): boolean {
  return Boolean(actor && report.approver && actor.canSign && actor.memberId === report.approver.memberId);
}

/** The draft was written in the approving clinician's own voice (report.author is the approver). */
function draftedForApprover(report: Pick<Report, "author" | "approver">): boolean {
  const owner = defaultVoiceOwner(report);
  return Boolean(owner && report.author && sameClinician(report.author, owner));
}

/* ------------------------------------------------------------------------------------------------
 * Text helpers
 * ----------------------------------------------------------------------------------------------*/

const FIGURE = /\d+(?:[.,:/]\d+)*/g;

/** Whether every figure of `after` was in `before` (as a multiset). */
function figuresKept(before: string, after: string): boolean {
  const pool: string[] = [...(before.match(FIGURE) ?? [])];
  for (const f of after.match(FIGURE) ?? []) {
    const i = pool.indexOf(f);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

/** "He is fit …" → "he is fit …" (a capitalised common first word only – names, titles and acronyms stay). */
function lowerFirst(text: string, people: readonly string[]): string {
  const first = /^(\S+)/.exec(text)?.[1] ?? "";
  if (!/^[A-Z][a-z'’-]*,?$/.test(first) || /^(?:I|Mr|Mrs|Ms|Miss|Mx|Dr)$/.test(first.replace(/[,.]$/, ""))) return text;
  if (people.some((p) => text.startsWith(p))) return text;
  if (/^[A-Z][a-z]+ [A-Z][a-z]/.test(text) && !/^(?:He|She|They|His|Her|Their|The|There|It|This|That|These|Those|No|A|An|In|On|At|With|After|Before)\b/.test(text)) return text;
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/** The section's form field (form reports). */
function fieldOf(section: ReportSection, form: Pick<FormDefinition, "fields"> | null | undefined) {
  return form?.fields.find((f) => f.id === section.key);
}

/** The sentence with the colleague named: "Tom Ellis recorded that …", or "… (Tom Ellis)." in a compact place. */
function attributed(s: DraftSentence, name: string, compact: boolean, people: readonly string[]): string {
  const text = s.text.trim();
  if (compact) {
    const m = /^(.*?)([.!?]*)$/.exec(text) as RegExpExecArray;
    return `${m[1]} (${name})${m[2] || ""}`;
  }
  const lead = /^(On \d{2}\/\d{2}\/\d{4},?\s+|At (?:the |his |her |their )?(?:[a-z-]+ ){0,2}?(?:assessment|review|appointment|session|visit|discharge)(?: on \d{2}\/\d{2}\/\d{4})?,?\s+)/.exec(text);
  const body = lead ? text.slice(lead[0].length) : text;
  return `${lead ? lead[0] : ""}${name} recorded that ${lowerFirst(body, people)}`;
}

/** The clause of a note sentence that holds a drafted claim, as the note writes it (shorthand written out, label dropped). */
function noteClauseFor(note: Note, claimStems: (c: string) => boolean): { text: string; noteId: string } | null {
  for (const s of noteSentences(note)) {
    if (s.field === "history" || s.question) continue;
    const parts = s.text.split(/\s*;\s*/);
    for (const raw of [s.text, ...parts]) {
      const written = expandNoteShorthand(raw).replace(/^[A-Za-z][A-Za-z /-]{0,30}:\s+/, "").replace(/[.!]+$/, "").trim();
      if (written && claimStems(written)) return { text: written, noteId: note.id };
    }
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * The generators
 * ----------------------------------------------------------------------------------------------*/

interface Attribution {
  sentence: DraftSentence;
  colleague: string;
  notes: Note[];
}

/** The unattributed sentences of a flagged drafted paragraph whose content the named colleague's notes hold (the attribution is true). */
function trueAttributions(input: FixInput, form: Pick<FormDefinition, "fields"> | null): Attribution[] | null {
  const { report, section, paragraph: p, flag, actor } = input;
  if (!flag || flag.code !== "OTHER_CLINICIAN_VOICE" || !/^unattributed /.test(flag.evidence ?? "") || flag.paragraphId !== p.id) return null;
  if (p.origin !== "ai" || !isApprover(report, actor) || !draftedForApprover(report)) return null;
  // The first person is the voice check's ("Name X instead"); a sentence that already names a clinician is the
  // wrong-clinician check's – neither is fixed by adding a name in front.
  if (speaksInFirstPerson(p.text)) return null;
  const bundle = report.bundleSnapshot;
  const owner = defaultVoiceOwner(report);
  const people = clinicianNames(bundle);
  const label = fieldOf(section, form)?.label ?? "";
  const found = unattributedSentences({ paragraph: p, section, bundle, owner, label });
  if (found.length === 0) return null;
  const colleagues = colleaguesCited(p, bundle, owner);
  const out: Attribution[] = [];
  for (const f of found) {
    if (f.colleagues.length !== 1 || people.some((n) => namesClinician(f.sentence.text, n))) return null;
    const c = colleagues.find((x) => sameName(x.name, f.colleagues[0]));
    if (!c) return null;
    const ignore = { people: people.map((x) => x.toLowerCase()) };
    const clauses = f.sentence.clauses.length ? f.sentence.clauses : [f.sentence.claim];
    if (!clauses.every((cl) => anchorClause({ clause: cl, notes: c.notes, holder: c.name, ignore }))) return null;
    out.push({ sentence: f.sentence, colleague: c.name, notes: c.notes });
  }
  return out;
}

function replaceSentences(text: string, edits: ReadonlyArray<{ start: number; end: number; text: string }>): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = `${out.slice(0, e.start)}${e.text}${out.slice(e.end)}`;
  return out;
}

function proposal(generator: string, input: FixInput, label: string, after: string, removedSpans: FixProposal["removedSpans"] = []): FixProposal | null {
  if (after === input.paragraph.text || !after.trim()) return null;
  return {
    generator,
    ...(input.flag ? { flagId: input.flag.id } : {}),
    sectionKey: input.section.key,
    paragraphId: input.paragraph.id,
    label,
    before: input.paragraph.text,
    after,
    removedSpans,
    ackPolicy: "approver",
  };
}

/** Context the generators read beyond FixInput (the form map, for compact places). */
let generatorForm: Pick<FormDefinition, "fields"> | null = null;

/** "<Name> recorded that …" / "… (<Name>)." – see the file header. */
export const attributionPrefix: FixGenerator = (input) => {
  const found = trueAttributions(input, generatorForm);
  if (!found) return null;
  const people = clinicianNames(input.report.bundleSnapshot);
  const compact = Boolean(compactPlace(fieldOf(input.section, generatorForm)));
  const after = replaceSentences(input.paragraph.text, found.map((f) => ({ start: f.sentence.start, end: f.sentence.end, text: attributed(f.sentence, f.colleague, compact, people) })));
  if (!figuresKept(input.paragraph.text, after)) return null;
  const names = Array.from(new Set(found.map((f) => f.colleague)));
  return proposal("attribution-prefix", input, `Name ${names.join(" and ")}`, after);
};

/** "Use the note's words": a framed quotation of the colleague's note clause – see the file header. */
export const useNoteWords: FixGenerator = (input) => {
  const field = fieldOf(input.section, generatorForm);
  if (compactPlace(field) || (input.section.answer && input.section.answer.kind !== "text")) return null;
  const found = trueAttributions(input, generatorForm);
  if (!found) return null;
  const people = clinicianNames(input.report.bundleSnapshot);
  const ignore = { people: people.map((x) => x.toLowerCase()) };
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const f of found) {
    const claimNorm = (c: string) => {
      const clauses = f.sentence.clauses.length ? f.sentence.clauses : [f.sentence.claim];
      const quoteNote: Note = { id: "N-000", date: "2000-01-01", type: "other", author: { name: f.colleague, hcpc: "" }, subjective: c, objective: "", assessment: "", plan: "" };
      return clauses.every((cl) => anchorClause({ clause: cl, notes: [quoteNote], holder: f.colleague, ignore }));
    };
    let quote: { text: string; noteId: string } | null = null;
    for (const n of f.notes) {
      quote = noteClauseFor(n, claimNorm);
      if (quote) break;
    }
    if (!quote) return null;
    edits.push({ start: f.sentence.start, end: f.sentence.end, text: `${f.colleague} recorded: “${quote.text}”.` });
  }
  const after = replaceSentences(input.paragraph.text, edits);
  if (!figuresKept(input.paragraph.text, after)) return null;
  return proposal("use-note-words", input, "Use the note's words", after);
};

/** "Name X instead" as a proposal for WD's engine (the review offers it through ui/components/review/fixes.ts too). */
export const nameInstead: FixGenerator = (input) => {
  const { report, paragraph: p, flag, actor } = input;
  if (!flag || flag.code !== "OTHER_CLINICIAN_VOICE" || flag.paragraphId !== p.id || !isApprover(report, actor)) return null;
  const fix = nameInsteadClinician(p, report.bundleSnapshot, defaultVoiceOwner(report));
  return fix ? proposal("name-instead", input, `Name ${fix.name} instead`, fix.text) : null;
};

/** Whole sentences of commentary about the notes – never the box's only text, never a clinical negative. */
export const removeCommentary: FixGenerator = (input) => {
  const { section, paragraph: p, flag, actor } = input;
  if (!hookEnabled(REMOVE_COMMENTARY)) return null;
  if (!flag || flag.code !== "DRAFT_FIT" || flag.evidence !== "comment" || flag.paragraphId !== p.id) return null;
  if (actor.role === "staff" && section.kind === "clinician_opinion") return null;
  const found = commentarySentences(p.text);
  if (found.length === 0) return null;
  const starts = new Set(found.map((f) => f.start));
  const { after, removedSpans } = removeSentences(p.text, (span) => starts.has(span.start));
  const others = section.paragraphs.some((q) => q.id !== p.id && q.text.trim());
  if (!after.trim() && !others) return null;
  return proposal("remove-commentary", input, found.length === 1 ? "Remove the comment" : "Remove the comments", after.trim() ? after : "", removedSpans.map((r) => ({ start: r.start, end: r.end })));
};

/** WB's generators, in the order the review lists them (WD's engine reads this list). */
export const ATTRIBUTION_FIX_GENERATORS: readonly FixGenerator[] = [attributionPrefix, useNoteWords, nameInstead, removeCommentary];

/* ------------------------------------------------------------------------------------------------
 * Applying a proposal (until WD's engine applies them: ui/components/review/fixes.ts applyFixProposal)
 * ----------------------------------------------------------------------------------------------*/

function touchParagraph(report: Report, key: string, paragraphId: string, fn: (p: Paragraph) => Paragraph | null, at: string): Report {
  return {
    ...report,
    updatedAt: at,
    sections: report.sections.map((s) =>
      s.key !== key ? s : { ...s, paragraphs: s.paragraphs.flatMap((p) => (p.id !== paragraphId ? [p] : ((q) => (q ? [q] : []))(fn(p)))) },
    ),
  };
}

/** Apply a proposal while the paragraph still reads `before`: the text becomes `after`, the paragraph keeps its origin and records the fix. */
export function applyAttributionProposal(report: Report, proposal: FixProposal, actor: Actor, now?: Date): Report {
  const at = (now ?? new Date()).toISOString();
  const section = report.sections.find((s) => s.key === proposal.sectionKey);
  const p = section?.paragraphs.find((x) => x.id === proposal.paragraphId);
  if (!section || !p || p.text !== proposal.before) return report;
  const next = touchParagraph(
    report,
    proposal.sectionKey,
    proposal.paragraphId,
    (q) => (proposal.after.trim() ? { ...q, text: proposal.after, fixes: [...(q.fixes ?? []), { kind: proposal.generator, by: actor, at }] } : null),
    at,
  );
  return { ...next, activity: [...next.activity, { at, actor: actor.name, action: "fix_applied", detail: `${proposal.sectionKey}: ${proposal.label} (one click; drafted text, still checked).` }] };
}

/* ------------------------------------------------------------------------------------------------
 * "Accept as the note's words" (design 5)
 * ----------------------------------------------------------------------------------------------*/

export interface NoteWordsOffer {
  sectionKey: string;
  paragraphId: string;
  /** The drafted phrase (normalised) and the sentence it is in, as written. */
  phrase: string;
  sentence: string;
  /** The approver's own note that records it, and its sentence (shown with the offer). */
  noteId: string;
  noteSentence: string;
  label: string;
}

/** The phrases the approver may accept as their own note's words on this report (none for anyone else). */
export function noteWordsOffers(report: Report, actor: Pick<Actor, "memberId" | "canSign"> | null | undefined): NoteWordsOffer[] {
  if (!isApprover(report, actor) || !report.approver) return [];
  const approver = report.approver;
  const bundle = report.bundleSnapshot;
  const people = clinicianNames(bundle);
  const owner = defaultVoiceOwner(report);
  const out: NoteWordsOffer[] = [];
  for (const section of report.sections) {
    for (const p of section.paragraphs) {
      if (p.origin !== "ai" || !p.text.trim()) continue;
      const own = p.sourceIds
        .map((id) => bundle.notes.find((n) => n.id === id))
        .filter((n): n is Note => Boolean(n) && sameName(n!.author.name, approver.name));
      if (own.length === 0) continue;
      for (const { sentence, hits } of judgeParagraphOpinions({ paragraph: p, section, report, notes: bundle.notes, people, owner })) {
        const open = hits.filter((h) => !h.anchor && !h.accepted);
        // One phrase at a time, and only when it is the sentence's only open phrase: a need, plan or prediction beside it is not accepted.
        if (open.length !== 1) continue;
        const h = open[0];
        if (h.label !== "return to normal work or activity" || !narratedReturn(h.hit)) continue;
        const note = own.find((n) => noteRecordsReturn(h.hit, normaliseForMatch(noteSourceText(n))));
        if (!note) continue;
        const words = h.phrase.split(/\s+/).pop() ?? "";
        const noteSentence = noteSentences(note).find((s) => s.norm.includes(words))?.text ?? noteSentences(note)[0]?.text ?? "";
        out.push({ sectionKey: section.key, paragraphId: p.id, phrase: h.phrase, sentence: sentence.text, noteId: note.id, noteSentence, label: `Accept as my note's words (“${noteSentence}”)` });
      }
    }
  }
  return out;
}

/** Record the approver's acceptance of one offered phrase (ReportSection.accepted, hashed; the activity log). */
export function acceptNoteWords(report: Report, offer: Pick<NoteWordsOffer, "sectionKey" | "paragraphId" | "phrase" | "sentence" | "noteId" | "noteSentence">, actor: Actor, now?: Date): Report {
  if (!isApprover(report, actor)) return report;
  const at = (now ?? new Date()).toISOString();
  const entry = { check: "OPINION_LANGUAGE", phrase: offer.phrase, sentenceSha: sentenceSha(offer.sentence), noteId: offer.noteId, by: actor, at, reason: `The note's words: “${offer.noteSentence}”.` };
  return {
    ...report,
    updatedAt: at,
    sections: report.sections.map((s) => (s.key === offer.sectionKey ? { ...s, accepted: [...(s.accepted ?? []), entry] } : s)),
    activity: [...report.activity, { at, actor: actor.name, action: "note_words_accepted", detail: `${offer.sectionKey}: accepted “${offer.phrase}” as the words of ${offer.noteId} (“${offer.noteSentence}”).` }],
  };
}

/* ------------------------------------------------------------------------------------------------
 * "Remove the note link" (B3-6)
 * ----------------------------------------------------------------------------------------------*/

/** The colleague notes an approver-edited paragraph with the approver's own opinion may be unlinked from, or null. */
export function noteLinkToRemove(report: Report, section: ReportSection, p: Paragraph, flag: ReportFlag | undefined, actor: Pick<Actor, "memberId" | "canSign">): string[] | null {
  if (!flag || flag.code !== "OTHER_CLINICIAN_VOICE" || flag.paragraphId !== p.id || p.origin !== "edited" || !isApprover(report, actor)) return null;
  if (!OWN_OPINION.test(p.text)) return null;
  const owner = defaultVoiceOwner(report);
  const colleagues = colleaguesCited(p, report.bundleSnapshot, owner).flatMap((c) => c.notes.map((n) => n.id));
  const rest = p.sourceIds.filter((id) => !colleagues.includes(id));
  return colleagues.length > 0 && rest.length > 0 ? colleagues : null;
}

export function removeNoteLink(report: Report, key: string, paragraphId: string, ids: readonly string[], actor: Actor, now?: Date): Report {
  const at = (now ?? new Date()).toISOString();
  const next = touchParagraph(report, key, paragraphId, (q) => ({ ...q, sourceIds: q.sourceIds.filter((id) => !ids.includes(id)) }), at);
  return { ...next, activity: [...next.activity, { at, actor: actor.name, action: "edited", detail: `${key}: unlinked ${ids.join(", ")} – the approving clinician's own opinion, not that note's.` }] };
}

/* ------------------------------------------------------------------------------------------------
 * Every WB fix offered to an actor (the review and the corpus harness read this)
 * ----------------------------------------------------------------------------------------------*/

export interface OfferedAttributionFix {
  kind: string;
  label: string;
  /** The box it changes. */
  key: string;
  apply(report: Report): Report;
}

/**
 * Every WB one-click fix offered to `actor` on `report` (its flags already validated), each with its own apply. "Name X
 * instead" is offered by the review's own nameClinicianFix (ui/components/review/fixes.ts) and is not repeated here.
 */
export function offeredFixes(report: Report, ctx: { actor: Actor; form?: FormDefinition | null; template?: ReportTemplate }): OfferedAttributionFix[] {
  const out: OfferedAttributionFix[] = [];
  generatorForm = ctx.form ?? null;
  try {
    for (const section of report.sections) {
      for (const p of section.paragraphs) {
        for (const flag of report.flags.filter((f) => f.paragraphId === p.id && !f.acknowledged)) {
          for (const gen of [attributionPrefix, useNoteWords, removeCommentary]) {
            const prop = gen({ report, section, paragraph: p, flag, actor: ctx.actor });
            if (prop && !out.some((o) => o.kind === prop.generator && o.key === prop.sectionKey)) {
              out.push({ kind: prop.generator, label: prop.label, key: prop.sectionKey, apply: (r) => applyAttributionProposal(r, prop, ctx.actor) });
            }
          }
          const unlink = noteLinkToRemove(report, section, p, flag, ctx.actor);
          if (unlink && !out.some((o) => o.kind === "remove-note-link" && o.key === section.key)) {
            out.push({ kind: "remove-note-link", label: "Remove the note link", key: section.key, apply: (r) => removeNoteLink(r, section.key, p.id, unlink, ctx.actor) });
          }
        }
      }
    }
  } finally {
    generatorForm = null;
  }
  for (const offer of noteWordsOffers(report, ctx.actor)) {
    out.push({ kind: "accept-note-words", label: offer.label, key: offer.sectionKey, apply: (r) => acceptNoteWords(r, offer, ctx.actor) });
  }
  return out;
}
