/**
 * OTHER_CLINICIAN_VOICE (Blue Heart fix round 1, B0-1): the form is the signing clinician's own report, so "I", "me"
 * and "my" are theirs. A drafted paragraph that says "told me", "My assessment" or "in my opinion" while it cites a
 * note another clinician wrote presents that clinician's assessment and opinions as the signer's own – the attribution
 * rule ("opinions are attributed to the clinician who recorded them") is broken even though the citation is right.
 *
 * - Blocking. On drafted text ("ai") it cannot be acknowledged: name the clinician ("Name Tom Ellis instead", the
 *   review's one-click rewrite – core/voice.ts nameClinicianInstead) or rewrite it. On edited text the clinician may
 *   acknowledge it with a reason (for example, they saw the patient too).
 * - Whose note is whose: each cited note's author against report.author (core/voice.ts otherCliniciansInFirstPerson;
 *   the same HCPC number, else the same name). A report with no author (built-in templates, a draft staff prepared)
 *   is checked against the signer instead, at approval (api/handlers/sign.ts, core/voice.ts unsignableFirstPerson).
 *
 * Owner: ai agent.
 */
import type { ReportFlag } from "../types";
import { authorsAttendedSessions, firstPersonSessionCount, namesPerson, otherCliniciansInFirstPerson } from "../voice";
import { formatUkDate } from "../dates";
import { getValidationContext, hasText, makeFlag } from "./context";
import type { ValidatorInput } from "./index";

/** "Tom Ellis" / "Tom Ellis and Priya Shah". */
function names(list: string[]): string {
  return list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export function validateClinicianVoice(input: ValidatorInput): ReportFlag[] {
  const author = input.report.author;
  if (!author?.name.trim()) return [];
  const ctx = getValidationContext(input);
  const flags: ReportFlag[] = [];
  for (const { paragraph: p, section } of ctx.paragraphs) {
    if ((p.origin !== "ai" && p.origin !== "edited") || !hasText(p)) continue;
    const others = otherCliniciansInFirstPerson(p, input.bundle, author);
    // Fix round 2 (B1-14): "I treated Mr Ellery for 7 sessions" when one of the 7 was another clinician's.
    const count = others ? null : firstPersonSessionCount(p.text);
    const sessions = count ? authorsAttendedSessions(input.bundle, author) : null;
    if (count && sessions && count.count > sessions.own && sessions.others.length > 0) {
      const seen = sessions.others.map((o) => `${o.name} (${formatUkDate(o.date)})`).join(", ");
      flags.push(
        makeFlag({
          code: "OTHER_CLINICIAN_VOICE",
          severity: "blocking",
          sectionKey: section.key,
          paragraphId: p.id,
          evidence: `sessions ${count.count}`,
          message: `This answer says “${count.phrase}”, but ${count.count - sessions.own === 1 ? "one of them was" : `${count.count - sessions.own} of them were`} with another clinician – ${seen}. On the signed form ${count.count === 1 ? "it reads" : "they all read"} as yours. Make the patient the subject (“… attended ${count.count} sessions”), or count only your own.`,
        }),
      );
      continue;
    }
    if (!others) continue;
    const who = names(others);
    // Named already ("Tom Ellis covered my leave"): whose "I" or "my" it is needs the clinician, not a rewrite.
    const named = others.every((n) => namesPerson(p.text, n));
    flags.push(
      makeFlag({
        code: "OTHER_CLINICIAN_VOICE",
        severity: "blocking",
        sectionKey: section.key,
        paragraphId: p.id,
        evidence: who,
        message: named
          ? `This answer names ${who}, who wrote the note it cites, and also says “I”, “me” or “my”. On the signed form those words read as yours. ${
              p.origin === "ai" ? "Rewrite it so it is clear who did what." : "Rewrite it so it is clear who did what, or acknowledge it if those words are your own account."
            }`
          : p.origin === "ai"
            ? `This answer says “I”, “me” or “my”, but the note it cites was written by ${who}. On the signed form it would read as your own. Name ${others.length === 1 ? who : "the clinician"} instead, or rewrite it in your own words.`
            : `This answer says “I”, “me” or “my”, but the note it cites was written by ${who}. On the signed form it reads as your own. Name ${others.length === 1 ? who : "the clinician"} instead, or acknowledge it if it is your own account.`,
      }),
    );
  }
  return flags;
}
