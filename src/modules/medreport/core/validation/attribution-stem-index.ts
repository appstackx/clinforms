/**
 * Fix round 2 (R2-SEC-1): the stem lookups of the colleague-named check (attribution-colleague-named.ts), indexed so the
 * work is near-linear in the size of the body instead of drafted sentences × note sentences.
 *
 * - StemSet: "does any of these stems match `w`" (stemsMatch) in O(|w|) – an exact set and a set of the stems' prefixes
 *   (4 letters or more). Used for a paragraph's cited record sources (computed once, not once per wanted stem).
 * - noteStemIndex(note): an inverted index of a note's sentences (history left out, as bestNoteSentence skips it) by
 *   their plain stems (plainStemsOf), built once per note. bestIndexed(stems, notes) gives exactly what the original
 *   scan gave – the sentence with the largest share of `stems`, on a tie the better field rank, then the first in note
 *   order – by counting through the posting lists. A query stem whose postings are long (a word in most sentences) is
 *   not walked per query: the sentences only it and other long-list stems reach are ranked once per combination of
 *   those stems and reused; the few sentences a short-list stem reaches are counted exactly.
 *
 * Pure; browser and server. Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Note } from "../types";
import { noteSentences, plainStemsOf, stemsMatch, type NoteSentence } from "./attribution-text";

/** stemsMatch's prefix rule applies to a stem of at least this many letters that does not start with a figure. */
const PREFIX_MIN = 4;
const prefixable = (w: string) => w.length >= PREFIX_MIN && !/^\d/.test(w);

/** A set of stems answering "does any of them match `w`" (stemsMatch(w, h) for some h) without a scan. */
export class StemSet {
  private readonly exact = new Set<string>();
  /** Every proper prefix (PREFIX_MIN letters or more) of a prefixable stem. */
  private readonly prefixes = new Set<string>();

  constructor(stems: readonly string[]) {
    for (const h of stems) {
      this.exact.add(h);
      if (prefixable(h)) for (let k = PREFIX_MIN; k < h.length; k++) this.prefixes.add(h.slice(0, k));
    }
  }

  get size(): number {
    return this.exact.size;
  }

  /** Exactly `Array.from(stems).some((h) => stemsMatch(w, h))`. */
  matches(w: string): boolean {
    const { exact } = this;
    if (exact.has(w) || exact.has(`${w}e`) || (w.endsWith("e") && exact.has(w.slice(0, -1)))) return true;
    if (!prefixable(w)) return false;
    // A longer stem that starts with w, or a shorter one (PREFIX_MIN letters or more) that w starts with.
    if (this.prefixes.has(w)) return true;
    for (let k = PREFIX_MIN; k < w.length; k++) if (exact.has(w.slice(0, k))) return true;
    return false;
  }
}

/** bestNoteSentence's tie rank: the plan, then the patient's own report, then other, then a finding. */
export const fieldRank = (f: NoteSentence["field"]): number => (f === "plan" ? 0 : f === "subjective" ? 1 : f === "other" ? 2 : 3);

/** A list of sentence indices (ascending, unique). */
interface Postings {
  readonly list: Int32Array;
}

/**
 * What a query stem matches, split by the length of the index lists it draws on: `short` – the sentences from lists of
 * SHORT_POSTINGS or fewer (walked per query); `long` – the union of the longer lists (shared by every stem drawing on the
 * same ones, never walked per query).
 */
interface StemMatch {
  readonly short: Int32Array;
  readonly long: Postings | null;
}

/** Index lists this long or shorter are walked per query; longer ones are ranked once per combination (see header). */
const SHORT_POSTINGS = 64;
/** Bound on each per-note memo (cleared when full: a cache, never a different answer). */
const MEMO_MAX = 4_096;
const EMPTY = new Int32Array(0);

/** One note's sentences (history left out) and their inverted stem index. */
export class NoteStemIndex {
  readonly sentences: NoteSentence[] = [];
  readonly rank: Uint8Array;
  /** Index of the first sentence with the lowest rank (the original scan's pick when no sentence holds any stem). */
  readonly zeroBest: number;
  private readonly exact = new Map<string, number[]>();
  private readonly prefix = new Map<string, number[]>();
  private readonly longUnions = new Map<string, Postings>();
  private readonly byStem = new Map<string, StemMatch | null>();
  private readonly ranked = new Map<string, Int32Array>();
  private readonly ids = new WeakMap<Postings, number>();
  private nextId = 0;
  private readonly count: Int32Array;
  private readonly scratch: Int32Array;

  constructor(note: Note) {
    for (const s of noteSentences(note)) if (s.field !== "history") this.sentences.push(s);
    const n = this.sentences.length;
    this.rank = new Uint8Array(n);
    this.count = new Int32Array(n);
    this.scratch = new Int32Array(n);
    let zero = -1;
    for (let j = 0; j < n; j++) {
      const s = this.sentences[j];
      this.rank[j] = fieldRank(s.field);
      if (zero < 0 || this.rank[j] < this.rank[zero]) zero = j;
      for (const h of plainStemsOf(s)) {
        push(this.exact, h, j);
        if (prefixable(h)) for (let k = PREFIX_MIN; k < h.length; k++) push(this.prefix, h.slice(0, k), j);
      }
    }
    this.zeroBest = zero;
  }

  /** The sentences holding a stem `w` matches (stemsMatch), or null when none does. */
  match(w: string): StemMatch | null {
    const hit = this.byStem.get(w);
    if (hit !== undefined) return hit;
    const keys: string[] = [];
    const add = (k: string) => {
      if (this.exact.has(k) && !keys.includes(`e:${k}`)) keys.push(`e:${k}`);
    };
    add(w);
    add(`${w}e`);
    if (w.endsWith("e")) add(w.slice(0, -1));
    if (prefixable(w)) {
      if (this.prefix.has(w)) keys.push(`p:${w}`);
      for (let k = PREFIX_MIN; k < w.length; k++) add(w.slice(0, k));
    }
    let out: StemMatch | null = null;
    if (keys.length > 0) {
      const shortLists: Array<readonly number[]> = [];
      const longKeys: string[] = [];
      for (const k of keys) {
        const list = this.listOf(k);
        if (list.length <= SHORT_POSTINGS) shortLists.push(list);
        else longKeys.push(k);
      }
      out = { short: shortLists.length ? union(shortLists) : EMPTY, long: longKeys.length ? this.longUnion(longKeys) : null };
    }
    if (this.byStem.size >= MEMO_MAX) this.byStem.clear();
    this.byStem.set(w, out);
    return out;
  }

  private listOf(key: string): readonly number[] {
    return (key.startsWith("e:") ? this.exact : this.prefix).get(key.slice(2)) ?? [];
  }

  /** The union of the long lists `keys` name, built once per set of keys. */
  private longUnion(keys: string[]): Postings {
    keys.sort();
    const key = keys.join("\u0000");
    let out = this.longUnions.get(key);
    if (!out) {
      out = { list: union(keys.map((k) => this.listOf(k))) };
      if (this.longUnions.size >= MEMO_MAX) this.longUnions.clear();
      this.longUnions.set(key, out);
    }
    return out;
  }

  /**
   * The best sentence for `stems`: the most stems matched (each query stem once per sentence), then the lowest rank,
   * then the first – with its matched count; null when the note has no sentence (history aside).
   */
  best(stems: readonly string[]): { index: number; count: number } | null {
    const n = this.sentences.length;
    if (n === 0) return null;
    const parts: StemMatch[] = [];
    for (const w of stems) {
      const m = this.match(w);
      if (m) parts.push(m);
    }
    const better = (c: number, j: number, bc: number, bj: number) => c > bc || (c === bc && (this.rank[j] < this.rank[bj] || (this.rank[j] === this.rank[bj] && j < bj)));
    let bestJ = -1;
    let bestC = 0;
    // The sentences a short list reaches: counted exactly (a long list the same stem draws on counts only if the short
    // ones did not already).
    const { count } = this;
    const touched: number[] = [];
    for (const part of parts) {
      const list = part.short;
      for (let i = 0; i < list.length; i++) {
        const j = list[i];
        if (count[j] === 0) touched.push(j);
        count[j] += 1;
      }
    }
    for (const j of touched) {
      let c = count[j];
      for (const part of parts) if (part.long && !has(part.short, j) && has(part.long.list, j)) c += 1;
      if (bestJ < 0 || better(c, j, bestC, bestJ)) {
        bestJ = j;
        bestC = c;
      }
    }
    // Every other sentence is reached by long lists only: the best of them by that count, ranked once per combination.
    const mult = new Map<Postings, number>();
    for (const part of parts) if (part.long) mult.set(part.long, (mult.get(part.long) ?? 0) + 1);
    if (mult.size > 0) {
      const order = this.rankedFor(mult);
      for (let i = 0; i < order.length; i += 2) {
        const j = order[i];
        if (count[j] !== 0) continue;
        const c = order[i + 1];
        if (bestJ < 0 || better(c, j, bestC, bestJ)) {
          bestJ = j;
          bestC = c;
        }
        break;
      }
    }
    for (const j of touched) count[j] = 0;
    if (bestJ < 0) return { index: this.zeroBest, count: 0 };
    return { index: bestJ, count: bestC };
  }

  /** The sentences the long lists reach, best first (count desc, rank, index), as [index, count] pairs. */
  private rankedFor(mult: ReadonlyMap<Postings, number>): Int32Array {
    const key = Array.from(mult, ([p, m]) => `${this.idOf(p)}x${m}`)
      .sort()
      .join(",");
    const hit = this.ranked.get(key);
    if (hit) return hit;
    const { scratch } = this;
    const touched: number[] = [];
    for (const [p, m] of Array.from(mult)) {
      const list = p.list;
      for (let i = 0; i < list.length; i++) {
        const j = list[i];
        if (scratch[j] === 0) touched.push(j);
        scratch[j] += m;
      }
    }
    touched.sort((a, b) => scratch[b] - scratch[a] || this.rank[a] - this.rank[b] || a - b);
    const out = new Int32Array(touched.length * 2);
    touched.forEach((j, i) => {
      out[2 * i] = j;
      out[2 * i + 1] = scratch[j];
    });
    for (const j of touched) scratch[j] = 0;
    if (this.ranked.size >= 256) this.ranked.clear();
    this.ranked.set(key, out);
    return out;
  }

  private idOf(p: Postings): number {
    let id = this.ids.get(p);
    if (id === undefined) {
      id = this.nextId++;
      this.ids.set(p, id);
    }
    return id;
  }
}

function push(map: Map<string, number[]>, key: string, j: number): void {
  const list = map.get(key);
  if (!list) map.set(key, [j]);
  else if (list[list.length - 1] !== j) list.push(j);
}

/** The sorted union of ascending index lists. */
function union(lists: ReadonlyArray<readonly number[]>): Int32Array {
  const all: number[] = [];
  for (const l of lists) for (const j of l) all.push(j);
  all.sort((a, b) => a - b);
  const out: number[] = [];
  for (const j of all) if (out.length === 0 || out[out.length - 1] !== j) out.push(j);
  return Int32Array.from(out);
}

/** Whether ascending `list` holds `j` (binary search). */
function has(list: Int32Array, j: number): boolean {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = list[mid];
    if (v === j) return true;
    if (v < j) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

const NOTE_INDEX = new WeakMap<Note, NoteStemIndex>();

/** A note's stem index, built once per note object (as noteSentences caches its sentences). */
export function noteStemIndex(note: Note): NoteStemIndex {
  let idx = NOTE_INDEX.get(note);
  if (!idx) {
    idx = new NoteStemIndex(note);
    NOTE_INDEX.set(note, idx);
  }
  return idx;
}

/**
 * The note sentence (among `notes`, in order) that holds the largest share of `stems`, with that share – exactly the
 * original scan (attribution-colleague-named.ts bestNoteSentence before fix round 2): on a tie the lower field rank, then
 * the first. `stems` deduplicated (contentStems). A note cited twice is read once (its second reading never wins a tie).
 */
export function bestIndexed(stems: readonly string[], notes: readonly Note[]): { sentence: NoteSentence; share: number } | null {
  if (stems.length === 0) return null;
  let best: { idx: NoteStemIndex; index: number; count: number } | null = null;
  const seen = new Set<Note>();
  for (const note of notes) {
    if (seen.has(note)) continue;
    seen.add(note);
    const idx = noteStemIndex(note);
    const b = idx.best(stems);
    if (!b) continue;
    if (!best || b.count > best.count || (b.count === best.count && idx.rank[b.index] < best.idx.rank[best.index])) best = { idx, index: b.index, count: b.count };
  }
  return best ? { sentence: best.idx.sentences[best.index], share: best.count / stems.length } : null;
}

/** Exactly `want.filter((w) => contentStemsOfText.some((h) => stemsMatch(w, h))).length / want.length` (0 for none). */
export function shareIn(want: readonly string[], set: StemSet): number {
  return want.length ? want.filter((w) => set.matches(w)).length / want.length : 0;
}

/** For tests: the reference match (one scan). */
export function scanMatches(w: string, stems: readonly string[]): boolean {
  return stems.some((h) => stemsMatch(w, h));
}
