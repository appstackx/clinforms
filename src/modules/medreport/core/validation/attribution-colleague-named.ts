/**
 * A colleague's finding or opinion names that colleague (plan WB design 8; N-ATTR-1, B2-2): every finding, opinion or
 * plan a drafted sentence takes from another clinician's note names that clinician in the same sentence – "On
 * 06/05/2026 Tom Ellis recorded …", "Priya Shah's assessment (01/09/2026): …", or in a compact cell a short suffix
 * "(Tom Ellis, 06/05/2026)" – or follows a sentence that named them with "He recorded …". Otherwise the approver's
 * signed form presents it as their own.
 *
 * - Keyed on the cited notes' authors against the voice owner (the approving clinician; none chosen: every author –
 *   strict mode), never on the drafted basis label. What the sentence takes from the note is read from the note
 *   itself: the note sentence that holds most of its content words – a finding, opinion or plan when that is in the
 *   note's objective, assessment or plan; the patient's own report (subjective) needs no clinician's name. A sentence
 *   no note sentence holds needs the name when it gives an opinion (a listed opinion phrase).
 * - A drafted sentence that names two clinicians as the joint subject of one act ("Tom Ellis and Sarah Reid assessed…")
 *   blocks: the notes say who did what.
 * - OTHER_CLINICIAN_VOICE, blocking. Drafted text: never acknowledged – the one-click "Tom Ellis recorded that …"
 *   prefix or "(Tom Ellis)" suffix (attribution-fixes.ts), or "Use the note's words". Text a person edited or wrote:
 *   only the approving clinician may acknowledge it (ackPolicy "approver").
 *
 * Registered in registry.ts (VALIDATORS "attribution-colleague-named"). Owner: WB – docs/bh2-ownership.json.
 */
import type { EpisodeBundle, Note, Paragraph, ReportFlag, ReportSection } from "../types";
import { sameClinician } from "../voice";
import { clinicianNames, contentStems, draftSentences, noteSentences, plainStemsOf, segmentsOf, stemsMatch, type DraftSentence, type NoteSentence } from "./attribution-text";
import { getValidationContext, hasText, makeFlag, voiceOwnerOf } from "./context";
import { authorshipOf, rawOpinionHits } from "./opinion-language";
import { voiceIssue } from "./voice";
import { commentarySentences } from "./draft-fit/commentary";
import type { Validator } from "./registry";
import { escapeRegExp, normaliseForMatch } from "./text";

/** Whether `text` names `name`, in full or by title and surname ("Ms Shah"). */
export function namesClinician(text: string, name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (new RegExp(`\\b${escapeRegExp(n).replace(/ /g, "\\s+")}\\b`, "i").test(text)) return true;
  const surname = n.split(/\s+/).pop() ?? "";
  return surname.length > 1 && new RegExp(`\\b(?:Dr|Mr|Mrs|Ms|Miss|Mx)\\.? ${escapeRegExp(surname)}\\b`).test(text);
}

/**
 * "He recorded …" / "She also noted …": a clinician's act whose subject is the clinician the last sentence named – after a
 * lead date or occasion too ("On 20/10/2026 she recorded a plan …", harden-WB).
 */
const PRONOUN_ACT = /^(?:(?:on \d{1,2}\/\d{1,2}\/\d{2,4}|on (?:the same|that) (?:date|day)|(?:at|by) (?:the |that |this |his |her |their )?(?:[a-z-]+ ){0,2}(?:assessment|review|appointment|session|visit|consultation|discharge)(?: on \d{1,2}\/\d{1,2}\/\d{2,4})?),?\s+)?(?:in (?:his|her|their) (?:[a-z-]+ ){0,2}(?:assessment|note|notes|review|examination)(?: (?:of|on) (?:the same date|that date|that day|\d{1,2}\/\d{1,2}\/\d{2,4}))?,?\s+)?(?:(?:he|she|they)\s+(?:also\s+|then\s+|later\s+|again\s+)?(?:recorded|noted|documented|found|assessed|examined|measured|observed|advised|discharged|treated|reviewed|explained|reassured|referred|wrote|described|planned|progressed|taught|issued)|(?:his|her|their)\s+(?:[a-z-]+\s+){0,2}(?:assessment|findings?|opinion|impression|examination|plan|advice|diagnosis|view|recommendations?)|(?:the same|that|this|his|her|their)\s+(?:[a-z-]+\s+)?(?:note|notes|record|assessment))\b/i;

/** The opinion box test (design 3): a clinician_opinion box, an opinion-labelled box, or a paragraph whose basis is a recorded opinion. */
export function isOpinionPlace(section: Pick<ReportSection, "kind" | "title" | "key">, p: Pick<Paragraph, "basis">, label = ""): boolean {
  if (section.kind === "clinician_opinion" || p.basis === "clinician_opinion_recorded") return true;
  return /\b(?:opinion|prognos\w*|impression|diagnos\w*|expected recovery|recovery time)\b/i.test(`${section.title} ${label}`);
}

/** The note sentence (among `notes`) that holds the largest share of `stems`, with that share. */
export function bestNoteSentence(stems: readonly string[], notes: readonly Note[]): { sentence: NoteSentence; share: number } | null {
  if (stems.length === 0) return null;
  let best: { sentence: NoteSentence; share: number } | null = null;
  // On a tie the treatment and advice given (the plan) or the patient's own report wins over a finding: a treatment
  // summary naming the muscles treated is not the palpation finding that names them too.
  const rank = (f: NoteSentence["field"]) => (f === "plan" ? 0 : f === "subjective" ? 1 : f === "other" ? 2 : 3);
  for (const note of notes) {
    for (const s of noteSentences(note)) {
      if (s.field === "history") continue;
      // The words as written (fix round 1: plainStemsOf – the anchors' canonical synonyms never decide whose it is).
      const have = plainStemsOf(s);
      const share = stems.filter((w) => have.some((h) => stemsMatch(w, h))).length / stems.length;
      if (!best || share > best.share || (share === best.share && rank(s.field) < rank(best.sentence.field))) best = { sentence: s, share };
    }
  }
  return best;
}

/** What a drafted sentence needs: the colleagues it takes a finding, opinion or plan from without naming them. */
export function unnamedColleagues(input: {
  sentence: DraftSentence;
  /** The clinician the paragraph's previous sentence named, alone (for "He recorded …"). */
  lastNamed: string | null;
  colleagues: ReadonlyArray<{ name: string; notes: Note[] }>;
  /** Every note the paragraph cites (any author) and the text of the record sources it cites (normalised). */
  cited: readonly Note[];
  records: readonly string[];
  people: readonly string[];
  opinionPlace: boolean;
}): string[] {
  const { sentence: s, lastNamed, colleagues, people } = input;
  const out: string[] = [];
  const ignore = { people: people.map((x) => x.toLowerCase()) };
  const stems = contentStems(s.norm, ignore, { canonical: false });
  if (stems.length === 0) return out;
  const pronounAct = PRONOUN_ACT.test(s.text.trim());
  const hits = rawOpinionHits(s.norm).length > 0;
  // Conjunct by conjunct, where each part comes from: the cited source sentence that holds most of it (any cited note,
  // or a cited record source). A part a colleague's objective or assessment holds is their finding or opinion; their
  // plan (treatment, advice given) and the patient's own report need no clinician's name unless the sentence gives an
  // opinion (a listed phrase) or it is in an opinion place; a part the record or the owner's own note holds needs none.
  const from = new Map<string, boolean>();
  /** Whose part was only a finding or a plan (objective, plan) – the parts a paragraph's lead attribution carries on. */
  const continuable = new Map<string, boolean>();
  const share = (want: readonly string[], text: string) => (want.length ? want.filter((w) => contentStems(text, ignore, { canonical: false }).some((h) => stemsMatch(w, h))).length / want.length : 0);
  const classify = (best: { sentence: NoteSentence; share: number }): void => {
    const c = colleagues.find((x) => x.notes.some((n) => n.id === best.sentence.noteId));
    if (!c) return;
    const f = best.sentence.field;
    if (f === "objective" || f === "assessment" || ((f === "plan" || f === "other") && (hits || input.opinionPlace)) || (f === "subjective" && input.opinionPlace && hits)) {
      from.set(c.name, true);
      const plain = !hits && (f === "objective" || f === "plan" || f === "other");
      continuable.set(c.name, (continuable.get(c.name) ?? true) && plain);
    }
  };
  // The sentence as a whole first: the cited source sentence that holds most of it (any cited note, or a record source).
  const whole = bestNoteSentence(stems, input.cited);
  // The cited record sources together (several FACT-outcomes, the registration record).
  const records = input.records.join("\n");
  const wholeRecord = records ? share(stems, records) : 0;
  if (whole && whole.share >= 0.5 && whole.share > wholeRecord) classify(whole);
  else if (wholeRecord < 0.5) {
    // No one sentence holds it: its well-held conjuncts (3+ content words, three quarters in one sentence) say whose
    // finding each is; with none of those, an opinion phrase makes it every colleague's to name.
    let placed = false;
    for (const seg of segmentsOf(s.claim || s.norm)) {
      const segStems = contentStems(seg.text, ignore, { canonical: false });
      if (segStems.length < 3) continue;
      const best = bestNoteSentence(segStems, input.cited);
      const rec = records ? share(segStems, records) : 0;
      if (best && best.share >= 0.75 && best.share > rec) {
        placed = true;
        classify(best);
      }
    }
    if (!placed && (hits || (input.opinionPlace && (whole?.share ?? 0) > 0))) for (const c of colleagues) from.set(c.name, true);
  }
  // A finding (no opinion phrase, held by the colleague's objective) after a sentence that named them as its recorder
  // continues that attribution ("Sarah Reid recorded forward head posture. Cervical movement was flexion 30° …"); an
  // opinion or assessment needs the name – or "He recorded …", "Her assessment was …" – in its own sentence.
  for (const c of colleagues) {
    if (!from.get(c.name)) continue;
    if (namesClinician(s.text, c.name)) continue;
    const continues = lastNamed !== null && lastNamed.toLowerCase() === c.name.toLowerCase();
    if (continues && (pronounAct || continuable.get(c.name) === true)) continue;
    out.push(c.name);
  }
  return out;
}

/** The cited notes of a paragraph, grouped by the clinicians who are not the voice owner. */
export function colleaguesCited(p: Pick<Paragraph, "sourceIds">, bundle: Pick<EpisodeBundle, "notes">, owner: { name: string; hcpc?: string | null } | null): Array<{ name: string; notes: Note[] }> {
  const out: Array<{ name: string; notes: Note[] }> = [];
  for (const id of p.sourceIds) {
    if (!/^N-\d+$/.test(id)) continue;
    const note = bundle.notes.find((n) => n.id === id);
    if (!note || !note.author.name.trim()) continue;
    if (owner?.name.trim() && sameClinician(note.author, owner)) continue;
    const g = out.find((x) => x.name.toLowerCase() === note.author.name.trim().toLowerCase());
    if (g) {
      if (!g.notes.includes(note)) g.notes.push(note);
    } else out.push({ name: note.author.name.trim(), notes: [note] });
  }
  return out;
}

/** "Tom Ellis" / "Tom Ellis and Priya Shah". */
function names(list: readonly string[]): string {
  return list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** The sentences of a paragraph that take a colleague's finding or opinion without naming them, with whom. */
export function unattributedSentences(input: {
  paragraph: Pick<Paragraph, "text" | "sourceIds" | "basis">;
  section: Pick<ReportSection, "kind" | "title" | "key">;
  bundle: Pick<EpisodeBundle, "notes" | "clinicians">;
  owner: { name: string; hcpc?: string | null } | null;
  label?: string;
  /** The normalised text of each cited record source (FACT-*, REG). */
  records?: readonly string[];
}): Array<{ sentence: DraftSentence; colleagues: string[] }> {
  const { paragraph: p, section, bundle, owner } = input;
  const colleagues = colleaguesCited(p, bundle, owner);
  if (colleagues.length === 0) return [];
  const people = clinicianNames(bundle);
  const opinionPlace = isOpinionPlace(section, p, input.label ?? "");
  const cited = p.sourceIds.map((id) => bundle.notes.find((n) => n.id === id)).filter((n): n is Note => Boolean(n));
  const out: Array<{ sentence: DraftSentence; colleagues: string[] }> = [];
  let lastNamed: string | null = null;
  const commentary = new Set(commentarySentences(p.text).map((c) => c.start));
  for (const s of draftSentences(p.text, people)) {
    // Commentary about the notes is draft-fit's warning (commentary.ts), not a finding to attribute.
    const missing = commentary.has(s.start) ? [] : unnamedColleagues({ sentence: s, lastNamed, colleagues, cited, records: input.records ?? [], people, opinionPlace });
    if (missing.length) out.push({ sentence: s, colleagues: missing });
    // The clinician "He recorded …" / "Her assessment …" refers to: the last one named, until another is named.
    const named = people.filter((n) => namesClinician(s.text, n));
    if (named.length === 1) lastNamed = named[0];
    else if (named.length > 1) lastNamed = null;
  }
  return out;
}

/** Two clinicians as the joint subject of one act: "Tom Ellis and Sarah Reid assessed …". */
function jointAct(text: string, people: readonly string[]): [string, string] | null {
  if (people.length < 2) return null;
  const alt = people.map((p) => escapeRegExp(p).replace(/ /g, "\\s+")).join("|");
  const m = new RegExp(`\\b(${alt})(?:,[^,]{0,40},)?\\s+(?:and|with|together with)\\s+(${alt})(?:,[^,]{0,40},)?\\s+(?:jointly\\s+|both\\s+|also\\s+)?(?:recorded|noted|found|assessed|examined|measured|treated|advised|discharged|reviewed|saw)\\b`, "i").exec(text);
  return m && m[1].toLowerCase() !== m[2].toLowerCase() ? [m[1], m[2]] : null;
}

export const validateColleagueNamed: Validator = (input) => {
  const ctx = getValidationContext(input);
  const owner = voiceOwnerOf(input);
  const people = clinicianNames(input.bundle);
  const flags: ReportFlag[] = [];
  for (const { paragraph: p, section } of ctx.paragraphs) {
    if (!hasText(p)) continue;
    const who = authorshipOf(p, input.report, section);
    if (who === "approver" || who === "record") continue;
    const label = input.form?.fields.find((f) => f.id === section.key)?.label ?? "";
    const records = p.sourceIds.filter((id) => !/^N-\d+$/.test(id)).map((id) => normaliseForMatch(ctx.sourceTexts.get(id) ?? "")).filter(Boolean);
    const found = unattributedSentences({ paragraph: p, section, bundle: input.bundle, owner: owner?.name.trim() ? owner : null, label, records });
    // The first person over a colleague's note is the voice check's flag (with "Name X instead"): not raised twice.
    const voiced = voiceIssue(p, input.bundle, owner?.name.trim() ? owner : null)?.others ?? [];
    const missing = Array.from(new Set(found.flatMap((f) => f.colleagues))).filter((n) => !voiced.some((v) => v.toLowerCase() === n.toLowerCase()));
    if (missing.length) {
      const whoText = names(missing);
      const flag = makeFlag({
        code: "OTHER_CLINICIAN_VOICE",
        severity: "blocking",
        sectionKey: section.key,
        paragraphId: p.id,
        evidence: `unattributed ${whoText}`,
        message:
          who === "drafted"
            ? `This answer gives what ${whoText} recorded without naming ${missing.length === 1 ? "them" : "them"}. On the signed form it would read as the approving clinician's own. Name ${missing.length === 1 ? whoText : "the clinician"} in the same sentence (“${missing[0]} recorded that …”, or “(${missing[0]})” in a short answer), or use the note's words.`
            : `This answer gives what ${whoText} recorded without naming ${missing.length === 1 ? "them" : "them"}. Name ${missing.length === 1 ? whoText : "the clinician"} in the same sentence, or – if these are the approving clinician's own words – they acknowledge it with a reason.`,
      });
      flag.ackPolicy = who === "drafted" ? "never" : "approver";
      flags.push(flag);
    }
    const joint = jointAct(p.text, people);
    if (joint) {
      const flag = makeFlag({
        code: "OTHER_CLINICIAN_VOICE",
        severity: "blocking",
        sectionKey: section.key,
        paragraphId: p.id,
        evidence: `joint ${joint[0]} and ${joint[1]}`,
        message: `This answer names ${joint[0]} and ${joint[1]} together for one act. The notes say who did what – name the clinician whose note records it.`,
      });
      flag.ackPolicy = who === "drafted" ? "never" : "approver";
      flags.push(flag);
    }
  }
  return flags;
};
