/**
 * The possessive of an organisation's name (fix round 2, B1-20): "Bodycare Clinics'", "Physio Services'" – a name
 * ending in a plural takes only an apostrophe – and "Proclaim Care's", "10Bridge's", "Ascenti's" otherwise. Pure; no
 * imports (wording.ts uses it).
 */
export function possessive(name: string): string {
  const n = name.trim();
  const last = /([A-Za-z]+)\W*$/.exec(n)?.[1] ?? "";
  // A plural last word: "Clinics", "Services", "Partners" – not "Express", "Ellis", "Status", "Bus".
  const plural = last.length > 3 && /s$/.test(last) && !/(?:ss|us|is|ys)$/i.test(last) && n.endsWith(last);
  return plural ? `${n}'` : `${n}'s`;
}

/**
 * Fix round 3 (B2-32): "<name>'s <noun>" – or, for a name that ends in a bracket ("TPN (The Physiotherapy Network)",
 * "Harbourside Case Management (fictional)"), where "'s" cannot go, "the <noun> from <name>" (or "of", by `prep`).
 */
export function namedThing(name: string, noun: string, prep: "from" | "of" = "from"): string {
  const n = name.trim();
  return /\)$/.test(n) ? `the ${noun} ${prep} ${n}` : `${possessive(n)} ${noun}`;
}

/** namedThing() at the start of a sentence ("The reference from TPN (…)", "Bodycare Clinics' reference"). */
export function NamedThing(name: string, noun: string, prep: "from" | "of" = "from"): string {
  const t = namedThing(name, noun, prep);
  return t.charAt(0).toUpperCase() + t.slice(1);
}
