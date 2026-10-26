/**
 * DRAFT_FIT part "repeat" (B0-16, B2-7; bh2 WD design 7): drafted wording that repeats what another box already says.
 *
 * Advisory: a warning on the later box ("This repeats what “History of the incident” says in this report"), never a
 * block – except an identical name cell in numbered rows ("Activity 2" = "Activity 1" = "Running"), which blocks and
 * may be acknowledged with a reason (ackPolicy "member").
 *
 * How two sentences are compared (the shared tokenizer, core/text/sentences.ts – never a split inside "8.0"):
 * - only alphabetic content words count: no figures, dates, units, frequency words ("2–3 times a week" against "3–4
 *   times a week" is not a repeat, B3-11), names, titles, or the reporting frame ("On 18/03/2026 Sarah Reid,
 *   physiotherapist, recorded that …" against "Mr Testcase reported that …" is a repeat, B3-11 (b));
 * - the shorter sentence has at least 5 words and 3 content words, and at least 0.8 of its content words are in the
 *   other sentence;
 * - never across an initial / current / now / at-discharge pair of the same question (R-regression-4), never between
 *   the columns of numbered rows ("Session 1 – date", "Session 2 – date"), never between compact values (a cell's
 *   value is not a sentence).
 * Messages name the other box by its printed label, and say "in this report" on a built-in report (R-regression-7).
 *
 * The one-click "Remove the repeated sentence" (ui/components/review/fixes.ts, generator "repeat-removal") is built
 * from repeatedSentences() and offered only when the engine's rules hold (whole sentences, figures kept, never the
 * box's only answering sentence, never an orphaned "He recorded …" – B3-2, B3-5, R-regression-3).
 *
 * Owner: WD (drafting and text edits) – docs/bh2-ownership.json.
 */
import { compactPlace } from "../../forms/answer-shape";
import { splitSentences, sentenceKey, type SentenceSpan } from "../../text/sentences";
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

/** Whether two sentences say the same thing (see the header). */
export function sentencesRepeat(a: string, b: string, names: ReadonlySet<string>): boolean {
  const [short, long] = alphaWords(a).length <= alphaWords(b).length ? [a, b] : [b, a];
  if (alphaWords(short).length < 5) return false;
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
  /\b(?:at (?:the )?(?:first|initial|final|latest|last) (?:assessment|appointment|session|review)|at (?:the )?(?:assessment|discharge|start|end|outset)|on (?:discharge|admission|referral)|initial(?:ly)?|first|now|current(?:ly)?|latest|final|present|today|pre[- ]?injury|before|after|baseline|start|end|discharge|assessment|previous(?:ly)?)\b/gi;

/** A label without its time point: "Lumbar flexion – at first assessment" and "Lumbar flexion – now" give the same. */
function withoutTimePoint(label: string): string {
  return label.toLowerCase().replace(TIME_WORDS, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Two boxes that ask the same question at two time points (an initial / current pair). */
export function timePointPair(a: string, b: string): boolean {
  const x = withoutTimePoint(a);
  const y = withoutTimePoint(b);
  return x !== "" && x === y && a.trim().toLowerCase() !== b.trim().toLowerCase();
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
  /** The earlier box (and paragraph) that already says it. */
  of: { key: string; title: string; paragraphId: string };
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
      const earlier = drafts.find(
        (e) =>
          !e.compact &&
          (order.get(e.section.key) ?? 0) < (order.get(later.section.key) ?? 0) &&
          !timePointPair(e.section.title, later.section.title) &&
          !sameNumberedColumn(e.section.title, later.section.title) &&
          splitSentences(e.paragraph.text).some((t) => sentencesRepeat(t.text, sentence.text, names)),
      );
      if (earlier) {
        out.push({ key: later.section.key, paragraphId: later.paragraph.id, sentence, of: { key: earlier.section.key, title: earlier.section.title.trim(), paragraphId: earlier.paragraph.id } });
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
