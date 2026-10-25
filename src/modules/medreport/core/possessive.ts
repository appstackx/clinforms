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
