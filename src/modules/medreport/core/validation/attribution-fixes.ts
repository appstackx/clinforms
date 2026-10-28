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
 * Who may apply them: the attribution fixes are the approving clinician's (WC design 4) – and theirs alone, whoever
 * prepared the report (fix round 1, R1T-WB-10: on a staff-prepared report or one drafted for another clinician the
 * drafted text speaks in the approver's voice too, and only the approver can apply a fix, so the gate on report.author
 * added no safety; never offered to staff – ATT-nameinstead-05).
 *
 * Fix round 1 (R1T-WB-11, Khuram's E7/E8 decision – the physio is never forced to retype a faithful paragraph): every
 * unattributed colleague sentence is named in one click when each of its conjuncts is held by that colleague's cited
 * notes (anchorClaim – one note sentence each, not one for the whole sentence), its pronoun subject or possessive
 * ("His assessment was …", "She recorded …") becoming the name; and "Name <clinician>" in the clauses of a mixed paragraph
 * that give a colleague's note in the approver's "I" (nameInClauses – the approver's own clauses stay as drafted). A fix
 * is offered only when, applied, it names every flagged sentence (it clears the flag – I8).
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
import { OWN_OPINION, nameClinicianInstead, nameInsteadClinician, sameClinician, speaksInFirstPerson } from "../voice";
import { anchorClaim, anchorClause } from "./attribution-anchor";
import { firstPersonOverColleagues } from "./attribution-voice";
import { colleaguesCited, isOpinionPlace, namesClinician, unattributedSentences } from "./attribution-colleague-named";
import { judgeOpinionPlace, ownNoteRecordingWork } from "./attribution-opinion-boxes";
import { defaultVoiceOwner } from "./attribution-owner";
import { clinicianNames, contentStems, hasOpinionCue, noteSentences, sameName, stanceOf, stemsMatch, type DraftSentence } from "./attribution-text";
import { commentarySentences } from "./draft-fit/commentary";
import { defineHook, hookEnabled } from "./hooks";
import { RETURN_LABEL, judgeParagraphOpinions, narratedReturn, noteRecordsReturn, sentenceSha } from "./opinion-language";
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

/** Named tests and scales a sentence may start with: proper nouns, never lower-cased (fix round 1, R1T-WB-11). */
const EPONYMS = /^(?:Lachman|McMurray|Apley|Thessaly|Phalen|Tinel|Spurling|Hawkins|Kennedy|Neer|Speed|Yergason|Thomas|Trendelenburg|Gaenslen|Patrick|FABER|Faber|Ober|Finkelstein|Valsalva|Romberg|Babinski|Hoffmann|Waddell|Oswestry|Beighton|Kemp|Lasegue|Slump|Adson|Allen|Roos|Wright|Jobe|Gerber|Ely|Noble|Clarke|Hughston)\b/;

/** "He is fit …" → "he is fit …" (a capitalised common first word only – names, titles, named tests and acronyms stay). */
function lowerFirst(text: string, people: readonly string[]): string {
  const first = /^(\S+)/.exec(text)?.[1] ?? "";
  if (!/^[A-Z][a-z'’-]*,?$/.test(first) || /^(?:I|Mr|Mrs|Ms|Miss|Mx|Dr)$/.test(first.replace(/[,.]$/, "")) || EPONYMS.test(text) || /^[A-Z][a-z]+['’]s\b/.test(text)) return text;
  if (people.some((p) => text.startsWith(p))) return text;
  if (/^[A-Z][a-z]+ [A-Z][a-z]/.test(text) && !/^(?:He|She|They|His|Her|Their|The|There|It|This|That|These|Those|No|A|An|In|On|At|With|After|Before)\b/.test(text)) return text;
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/** The section's form field (form reports). */
function fieldOf(section: ReportSection, form: Pick<FormDefinition, "fields"> | null | undefined) {
  return form?.fields.find((f) => f.id === section.key);
}

/** A finite verb (a clause, not a noun phrase): an auxiliary or modal, a regular past, or a common irregular past. */
const FINITE_VERB = /\b(?:is|are|was|were|has|have|had|did|does|do|can|could|will|would|should|may|might|must|[a-z]{3,}ed|felt|went|saw|gave|took|made|said|told|ran|kept|got|came|began|fell|found|showed|shows|reports|describes|walks|works|lives|plays|runs)\b/i;

/** The sentence with the colleague named: "Tom Ellis recorded that …", or "… (Tom Ellis)." in a compact place. */
function attributed(s: DraftSentence, name: string, compact: boolean, people: readonly string[]): string {
  const text = s.text.trim();
  if (compact) {
    const m = /^(.*?)([.!?]*)$/.exec(text) as RegExpExecArray;
    return `${m[1]} (${name})${m[2] || ""}`;
  }
  // The lead date or occasion, read greedily ("At the initial assessment on 01/09/2026"), with its comma or colon (fix
  // round 1: "On 13/10/2026: a request to …" – after a colon the rest is what was recorded, not a clause).
  const leadM = /^((?:On \d{2}\/\d{2}\/\d{4}|At (?:the |my |his |her |their )?(?:[a-z-]+ ){0,2}(?:assessment|review|appointment|session|visit|discharge)(?: on \d{2}\/\d{2}\/\d{4})?))([,:]?)\s+/.exec(text);
  const lead = leadM ? [leadM[2] === ":" ? `${leadM[1]} ` : leadM[0]] : null;
  const recordedWhat = Boolean(leadM && leadM[2] === ":");
  const body = leadM ? text.slice(leadM[0].length) : text;
  // "She recorded a plan …": a record or clinical act no patient does – the pronoun is the colleague, so name them in its
  // place, never "Priya Shah recorded that she recorded …" (harden-WB). Any other verb ("she described", "he found") may
  // be the patient's, so the sentence keeps its own subject after "<Name> recorded that".
  const pronoun = /^(?:He|She|They)(?=\s+(?:also\s+|then\s+|later\s+|again\s+)?(?:recorded|documented|assessed|examined|measured|discharged|reviewed|noted|advised|explained|planned|progressed|treated|referred|observed)\b)/.exec(body);
  if (pronoun) return `${lead ? lead[0] : ""}${name}${body.slice(pronoun[0].length)}`;
  // Fix round 1 (R1T-WB-11): "His assessment was …", "Her findings were …", "In his assessment of the same date he
  // recorded …" – the colleague's own act by its possessive; the name takes its place ("Tom Ellis's assessment was …").
  const possessive = /^(In )?(?:His|Her|Their|his|her|their)(?=\s+(?:[a-z-]+\s+){0,2}(?:assessment|findings?|opinion|impression|examination|plan|advice|diagnosis|view|recommendations?|notes?|review)\b)/.exec(body);
  if (possessive && (possessive[1] || /^[A-Z]/.test(body))) return `${lead ? lead[0] : ""}${possessive[1] ?? ""}${name}'s${body.slice(possessive[0].length)}`;
  // "Assessment on 08/09/2026: …" – the occasion's label becomes the colleague's ("Tom Ellis's assessment on 08/09/2026: …").
  const label = /^(Initial |Discharge |Follow-up |Final |Clinical )?(Assessment|Review|Examination|Impression|Diagnosis|Findings?)\b(?=[^:.]{0,30}:)/.exec(body);
  if (label) return `${lead ? lead[0] : ""}${name}'s ${`${label[1] ?? ""}${label[2]}`.toLowerCase()}${body.slice(label[0].length)}`;
  // R1T-WB-L3: no doubled "recorded" ("Tom Ellis recorded that outcome measures recorded were …" → "… measures were …").
  const once = body.replace(/^((?:[A-Z][a-z]+|[a-z]+)(?: [a-z-]+){0,3}) recorded (were|was)\b/, "$1 $2");
  // A sentence with no verb of its own ("Tenderness in the left lumbar paraspinal muscles at L4–L5.") is what was
  // recorded – "Tom Ellis recorded tenderness in …", never "recorded that tenderness in …".
  return `${lead ? lead[0] : ""}${name} recorded ${recordedWhat || !FINITE_VERB.test(once) ? "" : "that "}${lowerFirst(once, people)}`;
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

/**
 * Whether the colleague's cited notes hold a drafted clause: one note sentence holds it all (anchorClause), or – a clause
 * that joins two of the note's sentences or lists several of its items (R1T-WB-11) – each of its conjuncts with content is
 * held by one of them (anchorClaim, the same stance tests per conjunct).
 */
function clauseHeld(clause: string, notes: readonly Note[], holder: string, ignore: { people: string[] }, context: string): boolean {
  if (anchorClause({ clause, notes, holder, ignore, context })) return true;
  const claimed = anchorClaim({ clause, notes, holder, ignore, context });
  const content = claimed.segments.filter((g) => g.content);
  if (content.length > 0 && content.every((g) => g.anchor !== null)) return true;
  // A plain description – no opinion cue, no negation – that one sentence of the colleague's notes holds most of (two
  // thirds of its content words, any field: the patient's report, the social history): naming the colleague says whose
  // note it comes from ("walking the dog in shorter walks than usual at present" over "Walks the dog every day (shorter
  // walks at present)"). An opinion, a negative or a hedge is named only where it anchors.
  const norm = normaliseForMatch(clause);
  if (hasOpinionCue(norm) || stanceOf(norm).negated || stanceOf(norm).hedges.length > 0) return false;
  const want = contentStems(norm, ignore);
  if (want.length < 2) return false;
  return notes.some((n) => noteSentences(n).some((s) => want.filter((w) => s.stems.some((h) => stemsMatch(w, h))).length * 3 >= want.length * 2));
}

/** The unattributed sentences of a flagged drafted paragraph whose content the named colleague's notes hold (the attribution is true). */
function trueAttributions(input: FixInput, form: Pick<FormDefinition, "fields"> | null): Attribution[] | null {
  const { report, section, paragraph: p, flag, actor } = input;
  if (!flag || flag.code !== "OTHER_CLINICIAN_VOICE" || !/^unattributed /.test(flag.evidence ?? "") || flag.paragraphId !== p.id) return null;
  // R1T-WB-10: the approver's, whoever prepared the report (never staff's – isApprover). Also on a paragraph a person
  // edited (fix round 1): after "Name X instead" a paragraph is "edited" yet keeps its drafted words, so neither an
  // acknowledgement (drafted residue) nor a retype may be the only way to name the colleague in its other sentence – the
  // name added is checked against the colleague's notes exactly as on drafted text.
  if ((p.origin !== "ai" && p.origin !== "edited") || !isApprover(report, actor)) return null;
  const bundle = report.bundleSnapshot;
  const owner = defaultVoiceOwner(report);
  const people = clinicianNames(bundle);
  const label = fieldOf(section, form)?.label ?? "";
  const found = unattributedSentences({ paragraph: p, section, bundle, owner, label });
  if (found.length === 0) return null;
  const colleagues = colleaguesCited(p, bundle, owner);
  // A compact cell ("Running", "Lumbar spine") that cites one colleague's notes only (R1T-WB-11): the suffix "(Name)"
  // names the source the cell cites – its few words are a value from that note, not a sentence to anchor.
  const cited = p.sourceIds.filter((id) => /^N-\d+$/.test(id));
  const compactOne = Boolean(compactPlace(fieldOf(section, form))) && colleagues.length === 1 && cited.length > 0 && cited.every((id) => colleagues[0].notes.some((n) => n.id === id));
  const out: Attribution[] = [];
  for (const f of found) {
    // The first person is the voice check's ("Name X instead", nameInClauses); a sentence that already names a
    // clinician is the wrong-clinician check's – neither is fixed by adding a name in front.
    if (f.colleagues.length !== 1 || people.some((n) => namesClinician(f.sentence.text, n)) || speaksInFirstPerson(f.sentence.text)) return null;
    const c = colleagues.find((x) => sameName(x.name, f.colleagues[0]));
    if (!c) return null;
    const ignore = { people: people.map((x) => x.toLowerCase()) };
    const clauses = f.sentence.clauses.length ? f.sentence.clauses : [f.sentence.claim];
    if (!compactOne && !clauses.every((cl) => clauseHeld(cl, c.notes, c.name, ignore, f.sentence.norm))) return null;
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
  const found = trueAttributions(input, input.form ?? generatorForm);
  if (!found) return null;
  const people = clinicianNames(input.report.bundleSnapshot);
  const compact = Boolean(compactPlace(fieldOf(input.section, input.form ?? generatorForm)));
  const after = replaceSentences(input.paragraph.text, found.map((f) => ({ start: f.sentence.start, end: f.sentence.end, text: attributed(f.sentence, f.colleague, compact, people) })));
  if (!figuresKept(input.paragraph.text, after)) return null;
  const names = Array.from(new Set(found.map((f) => f.colleague)));
  return proposal("attribution-prefix", input, `Name ${names.join(" and ")}`, after);
};

/** "Use the note's words": a framed quotation of the colleague's note clause – see the file header. */
export const useNoteWords: FixGenerator = (input) => {
  const field = fieldOf(input.section, input.form ?? generatorForm);
  if (compactPlace(field) || (input.section.answer && input.section.answer.kind !== "text")) return null;
  const found = trueAttributions(input, input.form ?? generatorForm);
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

/**
 * "Name <clinician>" in a mixed paragraph (fix round 1, R1T-WB-09 / R1T-WB-11): the clauses whose first person gives a
 * colleague's note (validation/attribution-voice.ts firstPersonOverColleagues – by its date or content) get the
 * colleague's name in place of "I" / "my" / "me" (core/voice.ts nameClinicianInstead, clause by clause); the approver's
 * own clauses stay as drafted. Offered only on drafted text, to the approver, when every such clause has one colleague
 * and can be renamed (a past-tense act, no first-person opinion wording, the colleague not named there already – a
 * possessive beside the colleague's name is licence (ii)'s, acknowledged by the approver) and the result has no such
 * clause left (it clears the flag). The whole-paragraph "Name X instead" (every cited note X's) is nameInstead's.
 */
export const nameInClauses: FixGenerator = (input) => {
  const { report, paragraph: p, flag, actor } = input;
  if (!flag || flag.code !== "OTHER_CLINICIAN_VOICE" || flag.paragraphId !== p.id || /^(?:unattributed|names|joint|sessions|dates) /.test(flag.evidence ?? "")) return null;
  if (p.origin !== "ai" || !isApprover(report, actor)) return null;
  const owner = defaultVoiceOwner(report);
  if (!owner?.name.trim()) return null;
  const clauses = firstPersonOverColleagues(p, report.bundleSnapshot, owner);
  if (!clauses) return null;
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const c of clauses) {
    // A possessive or object only ("my annual leave", "told me") may be the approver's own – never renamed by a click.
    if (c.namesColleague || c.mixed || c.colleagues.length !== 1 || !c.uses.some((u) => u.kind === "subject")) return null;
    const renamed = nameClinicianInstead(p.text.slice(c.start, c.end), c.colleagues[0]);
    if (!renamed) return null;
    edits.push({ start: c.start, end: c.end, text: renamed });
  }
  const after = replaceSentences(p.text, edits);
  if (firstPersonOverColleagues({ ...p, text: after }, report.bundleSnapshot, owner)) return null;
  if (!figuresKept(p.text, after)) return null;
  const names = Array.from(new Set(clauses.map((c) => c.colleagues[0])));
  return proposal("name-instead", input, `Name ${names.join(" and ")}`, after);
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
export const ATTRIBUTION_FIX_GENERATORS: readonly FixGenerator[] = [attributionPrefix, useNoteWords, nameInClauses, nameInstead, removeCommentary];

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
        if (h.label !== RETURN_LABEL || !narratedReturn(h.hit)) continue;
        const note = own.find((n) => noteRecordsReturn(h.hit, normaliseForMatch(noteSourceText(n))));
        if (!note) continue;
        const words = h.phrase.split(/\s+/).pop() ?? "";
        const noteSentence = noteSentences(note).find((s) => s.norm.includes(words))?.text ?? noteSentences(note)[0]?.text ?? "";
        out.push({ sectionKey: section.key, paragraphId: p.id, phrase: h.phrase, sentence: sentence.text, noteId: note.id, noteSentence, label: `Accept as my note's words (“${noteSentence}”)` });
      }
      // Fix round 1 (R1T-WB-08): the same offer where the opinion-box rule (D7) blocks the approver's own recorded
      // work-status or return line – one conjunct, the sentence's only open one, that one of the approver's own cited
      // notes records (not its plan, not a prediction): "told me … took 3 days off work and then returned to normal
      // duties with breaks from the desk" in a work-status box.
      if (!isOpinionPlace(section, p) || !report.flags.some((f) => f.paragraphId === p.id && f.code === "OPINION_LANGUAGE" && !f.acknowledged)) continue;
      for (const j of judgeOpinionPlace({ paragraph: p, section, report, notes: bundle.notes, people, owner, records: [] })) {
        if (j.anchor || j.misquote || j.flaggedByPhrase || (j.openSegments ?? []).length !== 1) continue;
        const segment = (j.openSegments ?? [])[0];
        const found = ownNoteRecordingWork(segment, own);
        if (!found) continue;
        // The phrase as the sentence writes it (the reducer stores it only when the sentence holds it word for word).
        const at = j.sentence.text.toLowerCase().indexOf(segment);
        if (at < 0) continue;
        const phrase = j.sentence.text.slice(at, at + segment.length);
        if (out.some((o) => o.paragraphId === p.id && o.sentence === j.sentence.text)) continue;
        out.push({ sectionKey: section.key, paragraphId: p.id, phrase, sentence: j.sentence.text, noteId: found.note.id, noteSentence: found.sentence, label: `Accept as my note's words (“${found.sentence}”)` });
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
 * WB's one-click actions that are not text fixes (a FixProposal is a text before/after): "Accept as my note's words"
 * (ReportSection.accepted) and "Remove the note link" (Paragraph.sourceIds). Any review engine that lists one-click
 * fixes lists these too – WD's offeredFixes in ui/components/review/fixes.ts concatenates them with the generators'
 * proposals (check-WB minor 6: without them Khuram's one-click acceptance disappears).
 */
export function attributionActions(report: Report, ctx: { actor: Actor }): OfferedAttributionFix[] {
  const out: OfferedAttributionFix[] = [];
  for (const section of report.sections) {
    for (const p of section.paragraphs) {
      for (const flag of report.flags.filter((f) => f.paragraphId === p.id && !f.acknowledged)) {
        const unlink = noteLinkToRemove(report, section, p, flag, ctx.actor);
        if (unlink && !out.some((o) => o.kind === "remove-note-link" && o.key === section.key)) {
          out.push({ kind: "remove-note-link", label: "Remove the note link", key: section.key, apply: (r) => removeNoteLink(r, section.key, p.id, unlink, ctx.actor) });
        }
      }
    }
  }
  for (const offer of noteWordsOffers(report, ctx.actor)) {
    out.push({ kind: "accept-note-words", label: offer.label, key: offer.sectionKey, apply: (r) => acceptNoteWords(r, offer, ctx.actor) });
  }
  return out;
}

/**
 * Every WB one-click fix offered to `actor` on `report` (its flags already validated), each with its own apply: the
 * generators' proposals (ATTRIBUTION_FIX_GENERATORS but "Name X instead", which the review's own nameClinicianFix in
 * ui/components/review/fixes.ts offers) and attributionActions.
 */
export function offeredFixes(report: Report, ctx: { actor: Actor; form?: FormDefinition | null; template?: ReportTemplate }): OfferedAttributionFix[] {
  const out: OfferedAttributionFix[] = [];
  generatorForm = ctx.form ?? null;
  try {
    for (const section of report.sections) {
      for (const p of section.paragraphs) {
        for (const flag of report.flags.filter((f) => f.paragraphId === p.id && !f.acknowledged)) {
          for (const gen of [attributionPrefix, useNoteWords, nameInClauses, removeCommentary]) {
            const prop = gen({ report, section, paragraph: p, flag, actor: ctx.actor });
            if (prop && !out.some((o) => o.kind === prop.generator && o.key === prop.sectionKey)) {
              out.push({ kind: prop.generator, label: prop.label, key: prop.sectionKey, apply: (r) => applyAttributionProposal(r, prop, ctx.actor) });
            }
          }
        }
      }
    }
  } finally {
    generatorForm = null;
  }
  const actions = attributionActions(report, ctx);
  // The order the review lists them: the text fixes, "Remove the note link", then the acceptances.
  return [...out, ...actions];
}
