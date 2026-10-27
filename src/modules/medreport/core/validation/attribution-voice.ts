/**
 * The first person, clause by clause (fix round 1, R1T-WB-09 – Khuram's E7/E8 decision of 26/10/2026: the physio is
 * never forced to retype a faithful paragraph). Licence (i) read the whole paragraph: the approver's "I" was allowed only
 * when every cited note was theirs, so "On 15/07/2026 I recorded … On 05/08/2026 Tom Ellis, physiotherapist, recorded …"
 * – every clause naming the right clinician – blocked "never". Now each first-person use is judged in its own clause:
 * - it is the voice owner's when the clause says what the owner's own notes say: its date (or the sentence's date before
 *   it) is a date of one of the owner's cited notes and not only a colleague's, and no colleague's cited note holds its
 *   content better than the owner's do; with no date, no colleague's note holds most of its content better;
 * - it is a colleague's when the clause gives a colleague's note in the owner's voice: a date only a colleague's cited
 *   note has ("On 05/08/2026 I recorded mobilisations …" over Tom Ellis's note of that date), or content a colleague's
 *   note holds and the owner's do not ("…, when I found lumbar movement full and pain-free" over his discharge note);
 * - in a sentence that names the colleague, a possessive or object use ("Tom Ellis, covering my annual leave, recorded …",
 *   "… while covering my annual leave") stays for licence (ii) (validation/voice.ts: the approver may acknowledge it
 *   when the note names them) – never renamed by a click – and a subject "I" in the clause that names them is never
 *   licensed ("Tom Ellis and I assessed …").
 * A paragraph citing none of the owner's notes has no licensed first person at all (licence (i) as before), and strict
 * mode (no owner) is unchanged. Every clause that names a colleague in the third person is attributed (the
 * colleague-named check reads it).
 *
 * Pure; browser and server. Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import { splitSentences } from "../text/sentences";
import type { Clinician, EpisodeBundle, Note, Paragraph } from "../types";
import { firstPersonUses, namesPerson, sameClinician, type FirstPersonUse } from "../voice";
import { contentStems, noteSentences, stemsMatch } from "./attribution-text";
import { normaliseForMatch } from "./text";

/** A first-person clause that is not the voice owner's own account. */
export interface ColleagueClause {
  /** The clause's offsets in the paragraph text. */
  start: number;
  end: number;
  /** Its first-person uses (offsets in the paragraph text). */
  uses: FirstPersonUse[];
  /** The colleagues whose note it gives in the owner's voice (by date, content or name). */
  colleagues: string[];
  /** The clause names a colleague (licence (ii) may cover a possessive or object use there). */
  namesColleague: boolean;
  /**
   * The clause is partly the owner's own account too – its dates are both the owner's and a colleague's ("I repeated soft
   * tissue release on 22/07/2026 and on 05/08/2026" over Sarah Reid's note of 22/07 and Tom Ellis's of 05/08): it is
   * flagged, and no one-click renames it (the owner's part would be renamed with it).
   */
  mixed?: boolean;
}

const UK_DATE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;
/** Where a sentence splits into clauses: ; and the conjunctions that start a new clause (as attribution-text's claims split). */
const CLAUSE_EDGE = /\s*;\s*|,\s+(?=(?:and|but|so|while|whereas|although|though|because|as|since|which|when|then|on \d{2}\/\d{2}\/\d{4})\b)|\s+(?=(?:and|but)\s+(?:he|she|they|his|her|their|i|we|it|the|on|at|by)\b)|\s+(?=(?:because|although|whereas|while|when)\b)/g;
/** A clause with no subject of its own that only adds a date to the clause before it: "… on 22/07/2026 and on 05/08/2026". */
const DATE_CONTINUATION = /^(?:and|or)?\s*(?:then\s+|again\s+|also\s+)?on \d{2}\/\d{2}\/\d{4}\s*(?:[.;,]\s*)?$/i;

/** Frame and reporting words that say nothing about whose finding it is. */
const FRAME_WORDS = /\b(?:recorded|noted|documented|wrote|stated|reported|found|measured|assessed|examined|observed|explained|advised|treated|discharged|reviewed|gave|provided|repeated|added|progressed|told|said|in|my|our|notes?|plan|assessment|review|session|appointment)\b/g;

function isoOf(m: RegExpExecArray | RegExpMatchArray): string {
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** The best share of `stems` one sentence of `notes` holds (history fields left out). */
function bestShare(stems: readonly string[], notes: readonly Note[]): number {
  if (stems.length === 0) return 0;
  let best = 0;
  for (const n of notes) {
    for (const s of noteSentences(n)) {
      if (s.field === "history") continue;
      const share = stems.filter((w) => s.stems.some((h) => stemsMatch(w, h))).length / stems.length;
      if (share > best) best = share;
    }
  }
  return best;
}

/** The clauses of one sentence: [start, end) offsets in the sentence. */
function clausesOf(sentence: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let last = 0;
  for (const m of Array.from(sentence.matchAll(CLAUSE_EDGE))) {
    const at = m.index ?? 0;
    if (at > last) out.push({ start: last, end: at });
    last = at + m[0].length;
  }
  if (last < sentence.length) out.push({ start: last, end: sentence.length });
  return out;
}

/**
 * The first-person clauses of a drafted paragraph that are not the voice owner's own account (see the file header), or
 * null when every first-person use is the owner's. The paragraph must cite at least one note of the owner's and one of a
 * colleague's – otherwise licence (i) decides on its own (core/voice.ts otherCliniciansInFirstPerson).
 */
export function firstPersonOverColleagues(
  p: Pick<Paragraph, "text" | "sourceIds">,
  bundle: Pick<EpisodeBundle, "notes">,
  owner: Pick<Clinician, "name"> & { hcpc?: string | null },
): ColleagueClause[] | null {
  const uses = firstPersonUses(p.text);
  if (uses.length === 0) return null;
  const cited = p.sourceIds
    .filter((id) => /^N-\d+$/.test(id))
    .map((id) => bundle.notes.find((n) => n.id === id))
    .filter((n): n is Note => Boolean(n));
  const own = cited.filter((n) => sameClinician(n.author, owner));
  const others = cited.filter((n) => !sameClinician(n.author, owner));
  if (own.length === 0 || others.length === 0) return null;
  const colleagues = Array.from(new Set(others.map((n) => n.author.name.trim()))).filter(Boolean);
  const people = [owner.name, ...colleagues].map((x) => x.toLowerCase());
  const out: ColleagueClause[] = [];
  for (const sent of splitSentences(p.text, "prose")) {
    const inSentence = uses.filter((u) => u.index >= sent.start && u.index < sent.end);
    if (inSentence.length === 0) continue;
    const dates = Array.from(sent.text.matchAll(UK_DATE), (m) => ({ at: sent.start + (m.index ?? 0), iso: isoOf(m) }));
    const sentenceNames = colleagues.filter((n) => namesPerson(sent.text, n));
    const parts = clausesOf(sent.text);
    for (let i = 0; i < parts.length; i++) {
      const c = parts[i];
      const start = sent.start + c.start;
      let end = sent.start + c.end;
      const here = inSentence.filter((u) => u.index >= start && u.index < end);
      if (here.length === 0) continue;
      // "… and on 05/08/2026": the same "I", another date – read with this clause.
      while (i + 1 < parts.length && DATE_CONTINUATION.test(sent.text.slice(parts[i + 1].start, parts[i + 1].end))) {
        i++;
        end = sent.start + parts[i].end;
      }
      const text = p.text.slice(start, end);
      const named = colleagues.filter((n) => namesPerson(text, n));
      // The colleague named in the clause, or – for a possessive or object use – anywhere in the sentence: licence (ii)'s.
      const possessiveOnly = here.every((u) => u.kind !== "subject");
      // "The treatment recorded in my notes and in Tom Ellis's note of 05/08/2026 was …": the sentence says which notes
      // are whose – "my notes" is the owner's own cited notes beside the colleague's, each named (fix round 1).
      if (possessiveOnly && here.every((u) => /^(?:my|our)\s+(?:own\s+)?(?:notes?|records?)\b/i.test(p.text.slice(u.index))) && sentenceNames.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}['’]s\\s+(?:own\\s+)?(?:notes?|records?)\\b`, "i").test(sent.text))) continue;
      if (named.length > 0 || (possessiveOnly && sentenceNames.length > 0)) {
        out.push({ start, end, uses: here, colleagues: named.length > 0 ? named : sentenceNames, namesColleague: true });
        continue;
      }
      // The clause's date: its own, else the sentence's last date before it ("On 05/08/2026 I recorded …"), else the
      // sentence's first date.
      const ownDates = dates.filter((d) => d.at >= start && d.at < end);
      const before = dates.filter((d) => d.at < start);
      const when = ownDates.length ? ownDates.map((d) => d.iso) : before.length ? [before[before.length - 1].iso] : dates.length ? [dates[0].iso] : [];
      const ownDated = when.some((d) => own.some((n) => n.date === d));
      // A date only a colleague's cited note has (not one of the owner's too).
      const colleagueDated = colleagues.filter((name) => when.some((d) => !own.some((n) => n.date === d) && others.some((n) => n.date === d && n.author.name.trim() === name)));
      // Its content, frame words aside; a clause that says little of its own ("I recorded that") is read with the rest
      // of its sentence.
      const clauseStems = contentStems(normaliseForMatch(text).replace(FRAME_WORDS, " "), { people });
      const stems = clauseStems.length >= 2 ? clauseStems : contentStems(normaliseForMatch(p.text.slice(start, sent.end)).replace(FRAME_WORDS, " "), { people });
      const ownShare = bestShare(stems, own);
      const byContent = colleagues.filter((name) => {
        const share = bestShare(stems, others.filter((n) => n.author.name.trim() === name));
        return ownDated ? share >= 0.75 && share > ownShare + 0.25 : share >= 0.5 && share > ownShare;
      });
      // Dated to the owner's note and to a colleague's only: partly each one's – flagged, never renamed by a click.
      if (ownDated && colleagueDated.length > 0) {
        out.push({ start, end, uses: here, colleagues: colleagueDated, namesColleague: false, mixed: true });
        continue;
      }
      const theirs = !ownDated && colleagueDated.length > 0 ? colleagueDated : byContent;
      if (theirs.length > 0) out.push({ start, end, uses: here, colleagues: theirs, namesColleague: false });
    }
  }
  return out.length > 0 ? out : null;
}
