/**
 * OTHER_CLINICIAN_VOICE (Blue Heart fix round 1, B0-1; bh2 plan WB designs 6 and 7): the form is the approving
 * clinician's own report, so "I", "me", "my" – and "we", "us", "our" (C-ATTR-7) – are theirs. A paragraph that speaks
 * in the first person while it cites a note another clinician wrote presents that clinician's assessment and opinions
 * as the approver's own, even though the citation is right.
 *
 * - The voice owner is the report's approving clinician (context.ts voiceOwnerOf → attribution-owner.ts), at review,
 *   /validate and /sign alike; /render passes the receipt's signer. No owner (no approving clinician chosen): strict
 *   mode – every cited note counts as another clinician's, and the flag is worded for the approving clinician.
 * - Licence (i): the first person is allowed only when every cited note is the owner's (C-ATTR-3 – no exception for a
 *   paragraph that names the colleague beside the owner's "I"). core/voice.ts otherCliniciansInFirstPerson.
 * - Licence (ii): a possessive or object use only ("while covering my annual leave", "told me") over a note that
 *   mentions the owner by name or initials ("Covering Sarah Reid's annual leave", "covering SR AL") may be
 *   acknowledged by the approving clinician, also on drafted text (B2-3) – never a subject "I <verb>", never a
 *   clinical act or opinion of the owner's ("my assessment", "my opinion"). Ledger hook "use-my-name" (the round-3
 *   "Use my name" rewrite is gone; this acknowledgement is what replaces it).
 * - Otherwise: drafted text ("ai") is blocking and never acknowledged – "Name X instead" (core/voice.ts
 *   nameInsteadClinician) or a rewrite; text a person edited or wrote is blocking and only the approving clinician may
 *   acknowledge it with a reason (ackPolicy "approver").
 * - B1-14, kept: "I treated Mr Ellery for 7 sessions" when some of them were another clinician's.
 *
 * Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Clinician, EpisodeBundle, Note, Paragraph, ReportFlag } from "../types";
import { formatUkDate } from "../dates";
import { firstPersonUses, namesPerson, otherCliniciansInFirstPerson, sameClinician } from "../voice";
import { noteMentions } from "./attribution-text";
import { getValidationContext, hasText, makeFlag, voiceOwnerOf } from "./context";
import { defineHook, hookEnabled } from "./hooks";
import { authorshipOf } from "./opinion-language";
import type { ValidatorInput } from "./registry";

/** Ledger hook: licence (ii) – the approver may acknowledge a possessive that matches their name in the cited note. */
export const POSSESSIVE_LICENCE = defineHook("use-my-name");

/** "Tom Ellis" / "Tom Ellis and Priya Shah". */
function names(list: string[]): string {
  return list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** The owner's clinical acts and opinions: "my assessment", "my opinion" – never covered by the possessive licence. */
const OWN_ACT_POSSESSIVE = /^(?:my|our)\s+(?:(?:clinical|professional|initial|discharge|final|latest)\s+)?(?:assessment|opinion|view|examination|findings?|impression|diagnosis|treatment|advice|recommendation|review|notes?|plan|expectation|session|care|observation)\b/i;

export interface VoiceIssue {
  /** The other clinicians whose notes the paragraph cites while it speaks in the first person. */
  others: string[];
  /** Licence (ii) applies: possessive or object uses only, the cited notes mention the owner – the approver may acknowledge. */
  possessiveLicence: boolean;
}

/** Whether the paragraph's first person goes against the voice owner, and whether licence (ii) may cover it. */
export function voiceIssue(p: Pick<Paragraph, "text" | "sourceIds">, bundle: Pick<EpisodeBundle, "notes">, owner: Clinician | null): VoiceIssue | null {
  const others = otherCliniciansInFirstPerson(p, bundle, owner);
  if (!others) return null;
  let possessiveLicence = false;
  if (owner?.name.trim() && hookEnabled(POSSESSIVE_LICENCE)) {
    const uses = firstPersonUses(p.text);
    // "told me", "reported to me": the owner took the history – a clinical act, never the possessive licence.
    const heardIt = (index: number) => /\b(?:told|said to|reported to|explained to|described to|showed|asked)\s+$/i.test(p.text.slice(Math.max(0, index - 16), index));
    const onlyPossessive =
      uses.length > 0 &&
      uses.every((u) => (u.kind === "possessive" && !OWN_ACT_POSSESSIVE.test(p.text.slice(u.index))) || (u.kind === "object" && !heardIt(u.index)));
    if (onlyPossessive) {
      const cited = p.sourceIds
        .map((id) => bundle.notes.find((n) => n.id === id))
        .filter((n): n is Note => Boolean(n))
        .filter((n) => !sameClinician(n.author, owner));
      possessiveLicence = cited.length > 0 && cited.every((n) => noteMentions(n, owner.name));
    }
  }
  return { others, possessiveLicence };
}

/* A first-person count of sessions (fix round 2, B1-14) ---------------------------------------- */

const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const TITLED = "(?:Mr|Mrs|Ms|Miss|Dr|Mx)\\.? [A-Z][\\w'’-]+";
const FIRST_PERSON_COUNT = new RegExp(
  `\\bI (?:have )?(?:treated|saw|have seen|have treated|assessed and treated|provided (?:physiotherapy|treatment) (?:to|for))\\s+(${TITLED}|him|her|them|the (?:client|patient|claimant|employee))\\s+(?:for|over|in|across|on)\\s+(\\d{1,2}|${Object.keys(COUNT_WORDS).join("|")})\\s+((?:treatment |physiotherapy )?(?:sessions?|appointments?|treatments?|occasions?)(?: of physiotherapy)?)`,
  "i",
);

/** "I treated Mr Ellery for 7 sessions…" → { count: 7, phrase } – a first-person count of sessions – or null. */
export function firstPersonSessionCount(text: string): { count: number; phrase: string } | null {
  const m = FIRST_PERSON_COUNT.exec(text);
  if (!m) return null;
  const count = /^\d+$/.test(m[2]) ? Number(m[2]) : COUNT_WORDS[m[2].toLowerCase()];
  return count ? { count, phrase: m[0] } : null;
}

/**
 * How many attended sessions the owner saw the patient for: attended appointments whose note (or clinician) is the
 * owner's. Null when the record does not say who saw the patient at its appointments.
 */
export function ownersAttendedSessions(bundle: Pick<EpisodeBundle, "appointments" | "notes">, owner: Pick<Clinician, "name"> & { hcpc?: string | null }): { own: number; others: Array<{ date: string; name: string }> } | null {
  const attended = bundle.appointments.filter((a) => a.status === "ATT");
  const who = attended.map((a) => a.clinician ?? bundle.notes.find((n) => n.id === a.noteId)?.author ?? null);
  if (attended.length === 0 || who.some((w) => w === null)) return null;
  const others = attended.flatMap((a, i) => (who[i] && !sameClinician(who[i] as Clinician, owner) ? [{ date: a.date, name: (who[i] as Clinician).name }] : []));
  return { own: attended.length - others.length, others };
}

export function validateClinicianVoice(input: ValidatorInput): ReportFlag[] {
  // The run's voice owner (context.ts voiceOwnerOf): the approving clinician, or null – strict mode.
  const owner = voiceOwnerOf(input);
  const strict = !owner?.name.trim();
  const ctx = getValidationContext(input);
  const flags: ReportFlag[] = [];
  for (const { paragraph: p, section } of ctx.paragraphs) {
    if (!hasText(p)) continue;
    const who = authorshipOf(p, input.report, section);
    if (who === "approver" || who === "record") continue;
    const issue = voiceIssue(p, input.bundle, strict ? null : owner);
    if (!issue) {
      // B1-14: "I treated Mr Ellery for 7 sessions" when one of the 7 was another clinician's.
      const count = owner && !strict ? firstPersonSessionCount(p.text) : null;
      const sessions = count && owner ? ownersAttendedSessions(input.bundle, owner) : null;
      if (count && sessions && count.count > sessions.own && sessions.others.length > 0) {
        const seen = sessions.others.map((o) => `${o.name} (${formatUkDate(o.date)})`).join(", ");
        const flag = makeFlag({
          code: "OTHER_CLINICIAN_VOICE",
          severity: "blocking",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: `sessions ${count.count}`,
          message: `This answer says “${count.phrase}”, but ${count.count - sessions.own === 1 ? "one of them was" : `${count.count - sessions.own} of them were`} with another clinician – ${seen}. On the signed form ${count.count === 1 ? "it reads" : "they all read"} as yours. Make the patient the subject (“… attended ${count.count} sessions”), or count only your own.`,
        });
        flag.ackPolicy = who === "drafted" ? "never" : "approver";
        flags.push(flag);
      }
      continue;
    }
    const whoText = names(issue.others);
    const named = issue.others.every((n) => namesPerson(p.text, n));
    const yours = strict ? "the approving clinician's" : "yours";
    const message = issue.possessiveLicence
      ? `This answer says “my”, “me” or “our” beside ${whoText}'s note, which mentions you (“${firstPersonUses(p.text)[0]?.word ?? "my"} …”). On the signed form those words read as ${yours}. The approving clinician confirms they are their own account (acknowledge with a reason), or rewrite it.`
      : strict
        ? `This answer speaks in the first person (“I”, “me”, “my”, “we”, “our”) and cites a note written by ${whoText}. No approving clinician is chosen yet, so the approving clinician must check whose words these are: name ${issue.others.length === 1 ? whoText : "the clinician"} instead, or rewrite it.`
        : named
          ? `This answer names ${whoText}, who wrote the note it cites, and also says “I”, “me”, “my”, “we” or “our”. On the signed form those words read as yours. ${who === "drafted" ? "Rewrite it so it is clear who did what." : "Rewrite it so it is clear who did what, or acknowledge it if those words are your own account."}`
          : who === "drafted"
            ? `This answer speaks in the first person (“I”, “me”, “my”, “we”, “our”), but the note it cites was written by ${whoText}. On the signed form it would read as your own. Name ${issue.others.length === 1 ? whoText : "the clinician"} instead, or rewrite it in your own words.`
            : `This answer speaks in the first person (“I”, “me”, “my”, “we”, “our”), but the note it cites was written by ${whoText}. On the signed form it reads as your own. Name ${issue.others.length === 1 ? whoText : "the clinician"} instead, or acknowledge it if it is your own account.`;
    const flag = makeFlag({ code: "OTHER_CLINICIAN_VOICE", severity: "blocking", sectionKey: section.key, paragraphId: p.id, evidence: whoText, message });
    flag.ackPolicy = issue.possessiveLicence || who !== "drafted" ? "approver" : "never";
    flags.push(flag);
  }
  return flags;
}
