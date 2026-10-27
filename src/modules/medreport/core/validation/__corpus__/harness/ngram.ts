/**
 * Safety corpus: the third-party wording check. Committed corpus and fixture text may not share 4 or more consecutive
 * words with a referrer's own forms (their maps hold the printed labels, guidance and options). The maps are
 * gitignored, so the check runs locally, env-gated (third-party-wording.test.ts); this module is the pure part.
 *
 * Words are lower-cased letter/digit runs. A shared 4-gram made only of very common words ("of the right knee" is
 * not), or listed in ngram-ignore.json with a reason, is not a finding. ClinForms' own product wording (strings the
 * product writes into maps, e.g. "chosen by the physiotherapist") is excluded by passing it as `ownWording`.
 *
 * Pure.
 */

export const NGRAM = 4;

const COMMON = new Set(
  "a an and are as at be been by for from had has have he her his i if in is it its may me my no not of on or our she so that the their them they this to was we were what when which who will with you your".split(
    " ",
  ),
);

export function words(text: string): string[] {
  return (text.toLowerCase().normalize("NFKC").match(/[a-z0-9]+/g) ?? []).filter(Boolean);
}

export function ngrams(text: string, n = NGRAM): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

function onlyCommon(gram: string): boolean {
  return gram.split(" ").every((w) => COMMON.has(w) || /^\d+$/.test(w));
}

/** Every string leaf of a JSON value (labels, guidance, options, notes …). */
export function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) stringLeaves(v, out);
  return out;
}

export interface Overlap {
  gram: string;
  where: string;
}

/**
 * The 4-grams `candidate` texts share with the `thirdParty` texts, less common-word grams, ignored grams and grams of
 * ClinForms' own wording.
 */
export function sharedNgrams(
  candidate: ReadonlyArray<{ where: string; text: string }>,
  thirdParty: readonly string[],
  opts: { ignore?: readonly string[]; ownWording?: readonly string[] } = {},
): Overlap[] {
  const theirs = new Set<string>();
  for (const t of thirdParty) ngrams(t).forEach((g) => theirs.add(g));
  const own = new Set<string>();
  for (const t of opts.ownWording ?? []) ngrams(t).forEach((g) => own.add(g));
  const ignore = new Set((opts.ignore ?? []).map((g) => words(g).join(" ")));
  const out: Overlap[] = [];
  const seen = new Set<string>();
  for (const c of candidate) {
    for (const g of Array.from(ngrams(c.text))) {
      if (!theirs.has(g) || onlyCommon(g) || ignore.has(g) || own.has(g)) continue;
      const k = `${g}\u0000${c.where}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ gram: g, where: c.where });
    }
  }
  return out;
}
