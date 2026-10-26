/**
 * DRAFT_FIT part "repeat" (B0-16, B2-7; bh2 WD design 7): drafted wording that repeats what another box already says.
 *
 * Advisory: a warning on the later box ("This repeats what “History of the incident” says in this report"), never a
 * block – except an identical name cell in numbered rows ("Activity 2" = "Activity 1" = "Running"), which blocks and
 * may be acknowledged with a reason (ackPolicy "member").
 *
 * How two sentences are compared (the shared tokenizer, core/text/sentences.ts – never a split inside "8.0"):
 * - the words: only alphabetic content words count – no figures, dates, units, frequency words, names, titles, or the
 *   reporting frame ("On 18/03/2026 Sarah Reid, physiotherapist, recorded that …" against "Mr Testcase reported that …"
 *   is a repeat, B3-11 (b)); the shorter sentence has at least 5 words and 3 content words, and at least 0.8 of its
 *   content words are in the other sentence;
 * - the figures (bh2 WD review M1): two sentences that say different figures are never a repeat – "flexion limited by
 *   50%" and "flexion limited by 10%", pain "7/10" and "2/10", "2–3 times a week" and "3–4 times a week" (B3-11) each
 *   report a different measurement. The figures other than dates of one sentence must all be in the other (as a
 *   multiset: "PSFS 2.7" is repeated inside "PSFS from 2.7 to 5.3", never by "PSFS 5.3"); when both sentences are
 *   dated, they must share a date (two dated observations of the same finding are two time points). Which of the two
 *   may be removed is the one-click engine's rule: only a sentence whose every figure and date its twin also says;
 * - never across an initial / current / now / at-discharge pair of questions (R-regression-4, AC-DRF-6) – the two
 *   labels name different time points and otherwise ask the same thing ("Which symptoms were there on the first
 *   visit?" / "Which symptoms are there today?", "Sleep quality on presentation" / "Sleep quality on discharge"); never between
 *   the columns of numbered rows ("Session 1 – date", "Session 2 – date"), never between compact values (a cell's
 *   value is not a sentence).
 * Messages name the other box by its printed label, and say "in this report" on a built-in report (R-regression-7).
 *
 * The one-click "Remove the repeated sentence" (ui/components/review/fixes.ts, generator "repeat-removal") is built
 * from repeatedSentences() – each with the earlier sentence it repeats (its twin) – and offered only when the engine's
 * rules hold (whole sentences; the twin still prints and says every figure and date the removed sentence says; never
 * the box's only answering sentence; never a sentence left without the clinician or date it relied on – B3-2, B3-5,
 * R-regression-3).
 *
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import { compactPlace } from "../../forms/answer-shape";
import { figuresOf, splitSentences, sentenceKey, type SentenceSpan } from "../../text/sentences";
import { defineHook } from "../hooks";
import type { EpisodeBundle, FormDefinition, Paragraph, ReportFlag, ReportSection } from "../../types";
import { makeFlag } from "../context";
import type { DraftFitPart } from "../draft-fit";
import type { ValidatorInput } from "../registry";

/**
 * Ledger hook "repeat-removal" (one-click, ledger.json): the one-click "Remove the repeated sentence" built from
 * repeatedSentences(). Registered here (loaded with the validators); ui/components/review/fixes.ts offers the fix only
 * while hookEnabled(REPEAT_REMOVAL_HOOK).
 */
export const REPEAT_REMOVAL_HOOK = defineHook("repeat-removal");

const STOPWORDS = new Set(
  (
    "a an the and or but nor so yet of to in on at for with by from into onto upon over under about after before since until than then also as " +
    "is are was were be been being am has have had having do does did done will would shall should can could may might must " +
    "he she they it we you i him her them us me his hers its their theirs our ours my mine your yours this that these those there here " +
    "who whom whose which what when where why how all any both each either neither every some such same other another more most less " +
    "very just only still even again further once up down out off own too if while during per via etc mr mrs ms mx dr miss prof"
  ).split(/\s+/),
);
/** The reporting frame: who said or recorded it, and their job title – not what was said. */
const FRAME = new Set(
  (
    "recorded records record reported reports report told tells tell stated states state described describes describe documented documents " +
    "noted notes observed observes said says explained explains confirmed confirms mentioned mentions advised advises found finds assessed assesses " +
    "physiotherapist physiotherapists physio senior extended scope clinical specialist mcsp clinician clinicians therapist"
  ).split(/\s+/),
);
/** Units, frequency and time words: two different values share them ("2–3 times a week", "3–4 times a week"). */
const MEASURE = new Set(
  (
    "times time daily weekly monthly fortnightly nightly hourly day days week weeks wk wks month months year years yr yrs hour hours hr hrs " +
    "minute minutes min mins second seconds km kg cm mm m g mg ml percent per cent degrees x twice once thrice"
  ).split(/\s+/),
);

/** Words of the people in the record (clinicians, the patient): names are not what a sentence says. */
export function nameWords(bundle: Pick<EpisodeBundle, "clinicians" | "notes" | "registration"> | undefined): Set<string> {
  const out = new Set<string>();
  const add = (s: string | undefined) => {
    for (const w of (s ?? "").toLowerCase().match(/[a-z]+/g) ?? []) if (w.length > 1) out.add(w);
  };
  if (!bundle) return out;
  for (const c of bundle.clinicians ?? []) add(c.name);
  for (const n of bundle.notes ?? []) add(n.author?.name);
  add(bundle.registration?.firstName);
  add(bundle.registration?.lastName);
  add(bundle.registration?.fullName);
  return out;
}

/** The alphabetic words of a sentence. */
export function alphaWords(sentence: string): string[] {
  return sentence.toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/g) ?? [];
}

/** The content words of a sentence (see the header). */
export function contentWords(sentence: string, names: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of alphaWords(sentence)) {
    const w = raw.replace(/['’]s$/, "");
    if (w.length < 2 || STOPWORDS.has(w) || FRAME.has(w) || MEASURE.has(w) || names.has(w)) continue;
    out.add(w);
  }
  return out;
}

/** A figure that is a date ("06/05/2026", "6.5.26", "2026-05-06"). */
const DATE_FIGURE = /^(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})$/;

/** The figures of a sentence, split into its dates and its other figures (measurements, scores, counts). */
export function figuresByKind(sentence: string): { dates: string[]; values: string[] } {
  const all = figuresOf(sentence);
  return { dates: all.filter((f) => DATE_FIGURE.test(f)), values: all.filter((f) => !DATE_FIGURE.test(f)).sort() };
}

/** Whether every item of `a` is in `b` (multisets). */
function within(a: readonly string[], b: readonly string[]): boolean {
  const pool = [...b];
  for (const x of a) {
    const i = pool.indexOf(x);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

/**
 * Whether two sentences can report the same thing by their figures (see the header): the figures other than dates of
 * one all in the other, and – when both are dated – a date in common.
 */
export function sameFigures(a: string, b: string): boolean {
  const x = figuresByKind(a);
  const y = figuresByKind(b);
  if (!within(x.values, y.values) && !within(y.values, x.values)) return false;
  if (x.dates.length > 0 && y.dates.length > 0 && !x.dates.some((d) => y.dates.indexOf(d) >= 0)) return false;
  return true;
}

/** Whether two sentences say the same thing (see the header). */
export function sentencesRepeat(a: string, b: string, names: ReadonlySet<string>): boolean {
  const [short, long] = alphaWords(a).length <= alphaWords(b).length ? [a, b] : [b, a];
  if (alphaWords(short).length < 5) return false;
  if (!sameFigures(a, b)) return false;
  const ws = contentWords(short, names);
  const wl = contentWords(long, names);
  if (ws.size < 3 || wl.size < 3) return false;
  let shared = 0;
  ws.forEach((w) => {
    if (wl.has(w)) shared++;
  });
  return shared / Math.min(ws.size, wl.size) >= 0.8;
}

const TIME_WORDS =
  /\b(?:at (?:the )?(?:first|initial|final|latest|last|most recent) (?:assessment|appointment|session|review|visit)|at (?:the )?(?:assessment|discharge|start|end|outset|presentation|review)|on (?:discharge|admission|referral|presentation|assessment)|at the end of treatment|so far|to date|initial(?:ly)?|first|now|current(?:ly)?|latest|final|present(?:ly)?|presenting|presentation|today|pre[- ]?(?:injury|accident|incident)|before|after|baseline|start|end|onset|outset|admission|referral|intake|original(?:ly)?|recent(?:ly)?|since|discharge|assessment|previous(?:ly)?)\b/gi;

/** A label without its time point: "Lumbar flexion – at first assessment" and "Lumbar flexion – now" give the same. */
function withoutTimePoint(label: string): string {
  return label.toLowerCase().replace(TIME_WORDS, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** The time point words of a label ("on the first visit" → first; "today" → today). */
function timeWordsOf(label: string): Set<string> {
  const out = new Set<string>();
  for (const m of label.toLowerCase().match(new RegExp(TIME_WORDS.source, "gi")) ?? []) out.add(m.replace(/\s+/g, " ").trim());
  return out;
}

/** Words of a question that do not say what it asks about ("What were …", "Please describe the patient's …"). */
const QUESTION_FRAME = new Set(
  "a an the and or of to in on at for with by from as is are was were be been has have had do does did what which when how who please describe give state detail details list any patient patients patient's claimant client s his her their its".split(" "),
);

/** A word without its common endings ("planned" → plan, "symptoms" → symptom), for comparing two labels. */
function stem(w: string): string {
  const s = w.replace(/(?:ning|ned|ing|ed|es|s)$/, "");
  return s.length >= 3 ? s : w;
}

/** What a label asks about, its time point and the question's frame aside (as word stems). */
function labelSubject(label: string): Set<string> {
  return new Set(withoutTimePoint(label).split(" ").filter((w) => w && !QUESTION_FRAME.has(w)).map(stem));
}

/**
 * Two boxes that ask the same question at two time points (an initial / current pair, R-regression-4, AC-DRF-6): the
 * same label once the time words are taken out ("Lumbar flexion – at first assessment" / "Lumbar flexion – now"), or two
 * labels that each name a different time point and otherwise ask about the same thing – the same subject words, or
 * mostly the same ("Which symptoms were there on the first visit?" / "Which symptoms are there today?", "Outline the
 * client's condition when first seen" / "Outline the client's condition today", "Sleep quality on presentation" /
 * "Sleep quality on discharge"). In doubt the pair is not compared: a repeat is only advice.
 */
export function timePointPair(a: string, b: string): boolean {
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return false;
  const x = withoutTimePoint(a);
  const y = withoutTimePoint(b);
  if (x !== "" && x === y) return true;
  const ta = timeWordsOf(a);
  const tb = timeWordsOf(b);
  if (ta.size === 0 || tb.size === 0) return false;
  if (ta.size === tb.size && Array.from(ta).every((w) => tb.has(w))) return false;
  const sa = labelSubject(a);
  const sb = labelSubject(b);
  if (sa.size === 0 && sb.size === 0) return true;
  const shared = Array.from(sa).filter((w) => sb.has(w)).length;
  const union = new Set([...Array.from(sa), ...Array.from(sb)]).size;
  return union > 0 && shared / union >= 0.5;
}

/** "Activity 2 – frequency" → {stem "activity#– frequency", n 2, column "– frequency"}; null when not a numbered row. */
function numberedRow(title: string): { group: string; n: number; column: string } | null {
  const m = /^(.*?)(\d+)(\D*)$/.exec(title.trim());
  if (!m || m[1].trim() === "") return null;
  return { group: `${m[1].trim().toLowerCase()}#${m[3].trim().toLowerCase()}`, n: Number(m[2]), column: m[3].trim().toLowerCase() };
}

/** Columns of numbered rows that are compared only as name cells (or never). */
function sameNumberedColumn(a: string, b: string): boolean {
  const x = numberedRow(a);
  const y = numberedRow(b);
  return Boolean(x && y && x.group === y.group && x.n !== y.n);
}

/** Two numbered-row name cells that mostly say the same item: one's words all in the other's, or most of them shared. */
function rowRepeats(a: string, b: string): boolean {
  const wa = new Set(alphaWords(a).filter((w) => w.length > 2 && !STOPWORDS.has(w)));
  const wb = new Set(alphaWords(b).filter((w) => w.length > 2 && !STOPWORDS.has(w)));
  if (wa.size === 0 || wb.size === 0) return false;
  const shared = Array.from(wa).filter((w) => wb.has(w)).length;
  return shared === Math.min(wa.size, wb.size) || shared / Math.max(wa.size, wb.size) >= 0.6;
}

/** A sentence of a drafted answer that repeats one of an earlier box. */
export interface RepeatedSentence {
  /** The later box and its paragraph. */
  key: string;
  paragraphId: string;
  sentence: SentenceSpan;
  /** The earlier box (and paragraph) that already says it, and the sentence there that says it (its twin). */
  of: { key: string; title: string; paragraphId: string; sentence: string };
}

interface Printed {
  section: ReportSection;
  paragraph: Paragraph;
  compact: boolean;
}

/** The drafted (origin "ai") printed text answers of the report, in document order. */
function printedDrafts(sections: readonly ReportSection[], form: Pick<FormDefinition, "fields"> | null | undefined): Printed[] {
  const fields = new Map((form?.fields ?? []).map((f) => [f.id, f] as const));
  const out: Printed[] = [];
  for (const s of sections) {
    if (s.answer && s.answer.kind !== "text") continue; // a yes/no, date or choice prints its value, not this text
    for (const p of s.paragraphs) {
      if (p.origin !== "ai" || !p.text.trim()) continue;
      out.push({ section: s, paragraph: p, compact: compactPlace(fields.get(s.fieldId ?? s.key)) !== null });
    }
  }
  return out;
}

/**
 * Every drafted sentence that repeats a sentence of an EARLIER box (document order), with the box it repeats. Paired
 * time points, numbered-row columns and compact values are never compared.
 */
export function repeatedSentences(
  report: { sections: readonly ReportSection[]; bundleSnapshot?: EpisodeBundle },
  form?: Pick<FormDefinition, "fields"> | null,
): RepeatedSentence[] {
  const names = nameWords(report.bundleSnapshot);
  const drafts = printedDrafts(report.sections, form);
  const out: RepeatedSentence[] = [];
  const order = new Map(report.sections.map((s, i) => [s.key, i] as const));
  for (const later of drafts) {
    if (later.compact) continue;
    for (const sentence of splitSentences(later.paragraph.text)) {
      for (const e of drafts) {
        if (e.compact || (order.get(e.section.key) ?? 0) >= (order.get(later.section.key) ?? 0)) continue;
        if (timePointPair(e.section.title, later.section.title) || sameNumberedColumn(e.section.title, later.section.title)) continue;
        const twin = splitSentences(e.paragraph.text).find((t) => sentencesRepeat(t.text, sentence.text, names));
        if (!twin) continue;
        out.push({ key: later.section.key, paragraphId: later.paragraph.id, sentence, of: { key: e.section.key, title: e.section.title.trim(), paragraphId: e.paragraph.id, sentence: twin.text } });
        break;
      }
    }
  }
  return out;
}

/** A paragraph that repeats, word for word, an earlier paragraph of the same box (a drafted duplicate). */
export function duplicateParagraphs(sections: readonly ReportSection[]): Array<{ key: string; paragraphId: string; of: string }> {
  const out: Array<{ key: string; paragraphId: string; of: string }> = [];
  for (const s of sections) {
    const seen = new Map<string, string>();
    for (const p of s.paragraphs) {
      if (!p.text.trim()) continue;
      const k = sentenceKey(p.text).toLowerCase();
      const first = seen.get(k);
      if (first && p.origin === "ai") out.push({ key: s.key, paragraphId: p.id, of: first });
      else if (!first) seen.set(k, p.id);
    }
  }
  return out;
}

/** The printed name of a box in a message: “History of the incident (as reported)”. */
function labelOf(title: string): string {
  return `“${title.trim()}”`;
}

export function repeatsPart(input: ValidatorInput): DraftFitPart {
  return {
    finish() {
      const flags: ReportFlag[] = [];
      const sections = input.report.sections ?? [];
      const builtIn = !input.report.form;
      const where = builtIn ? " in this report" : "";

      // 1. Sentences that repeat an earlier box (advisory): one warning per paragraph, naming the boxes.
      const repeats = repeatedSentences(input.report, input.form ?? null);
      const byParagraph = new Map<string, RepeatedSentence[]>();
      for (const r of repeats) byParagraph.set(r.paragraphId, [...(byParagraph.get(r.paragraphId) ?? []), r]);
      byParagraph.forEach((list) => {
        const r = list[0];
        const boxes = Array.from(new Set(list.map((x) => labelOf(x.of.title))));
        const excerpt = r.sentence.text.length > 90 ? `${r.sentence.text.slice(0, 87).trimEnd()}…` : r.sentence.text;
        flags.push(
          makeFlag({
            code: "DRAFT_FIT",
            severity: "warning",
            sectionKey: r.key,
            paragraphId: r.paragraphId,
            evidence: `repeat ${r.of.key}`,
            message: `This repeats what ${boxes.join(" and ")} says${where}: “${excerpt}” – remove it here if it is printed twice, or keep both.`,
          }),
        );
      });

      // 2. A drafted paragraph that is word for word an earlier paragraph of the same box.
      for (const d of duplicateParagraphs(sections)) {
        flags.push(
          makeFlag({
            code: "DRAFT_FIT",
            severity: "warning",
            sectionKey: d.key,
            paragraphId: d.paragraphId,
            evidence: `duplicate ${d.of}`,
            message: "This paragraph is printed twice in this box – remove the second copy.",
          }),
        );
      }

      // 3. Numbered rows (B0-16, B1-4): the name cells ("Activity 2" against "Activity 1"). An identical name blocks – it
      //    may be kept with a reason; one that mostly repeats an earlier row is a warning. Frequency, status and date
      //    columns are never compared.
      const rows = new Map<string, Array<{ s: ReportSection; n: number; text: string }>>();
      for (const s of sections) {
        const row = numberedRow(s.title);
        if (!row || row.column !== "") continue;
        if (s.answer && s.answer.kind !== "text") continue;
        const p = s.paragraphs.find((x) => x.origin === "ai" && x.text.trim());
        if (!p) continue;
        rows.set(row.group, [...(rows.get(row.group) ?? []), { s, n: row.n, text: s.paragraphs.map((x) => x.text).join(" ") }]);
      }
      const same = (a: string, b: string) => sentenceKey(a).toLowerCase().replace(/[.\s]+$/, "") === sentenceKey(b).toLowerCase().replace(/[.\s]+$/, "");
      rows.forEach((list) => {
        list.sort((a, b) => a.n - b.n);
        list.forEach((row, i) => {
          const earlier = list.slice(0, i);
          const identical = earlier.find((e) => e.text.trim() !== "" && same(e.text, row.text));
          const similar = identical ? undefined : earlier.find((e) => rowRepeats(e.text, row.text));
          const hit = identical ?? similar;
          if (!hit) return;
          const p = row.s.paragraphs.find((x) => x.origin === "ai" && x.text.trim());
          const flag = makeFlag({
            code: "DRAFT_FIT",
            severity: identical ? "blocking" : "warning",
            sectionKey: row.s.key,
            ...(p && { paragraphId: p.id }),
            evidence: `repeat ${hit.s.key}`,
            message: identical
              ? `${labelOf(row.s.title)} names the same item as ${labelOf(hit.s.title)} – give the next item the notes record, leave it blank, or keep it with a reason.`
              : `This repeats ${labelOf(hit.s.title)} (${hit.s.key}) – give the next item the notes record, or leave it blank.`,
          });
          if (identical) flag.ackPolicy = "member";
          flags.push(flag);
        });
      });
      return flags;
    },
  };
}
