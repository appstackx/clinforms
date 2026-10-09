/**
 * Which referrer form to complete for an episode: the referral's referrer's own form when the library
 * holds one. Matching is deliberately conservative – the same organisation name, then at least two
 * distinctive words in common, and only then a choice remembered for this referrer ("Harrow & Pike Solicitors" ↔
 * "Harrow & Pike Medico-Legal"). One shared word ("Northfield Freight" ↔ "Northfield Assurance") is
 * not enough; staff then choose, and the choice is remembered for that referrer in this browser.
 *
 * Pure apart from the small localStorage helpers at the end (wrapped in try/catch).
 *
 * Owner: studio-a agent.
 */
import { STORAGE_PREFIX } from "../../../config.public";
import { distinctiveTokens, normaliseOrgName } from "../../../core/forms";
import type { FormDefinition, InstructingParty } from "../../../core/types";

export { distinctiveTokens, normaliseOrgName } from "../../../core/forms";

export type MatchReason = "remembered" | "same_name" | "similar_name";

export interface FormMatch {
  form: FormDefinition;
  reason: MatchReason;
}

/**
 * The default form for this referral among `forms` (normally the confirmed ones), or null.
 * `rememberedFormId` is the form staff chose last time for this referrer (see getRememberedFormId).
 */
export function matchReferrerForm(
  party: Pick<InstructingParty, "name">,
  forms: readonly FormDefinition[],
  rememberedFormId?: string | null,
): FormMatch | null {
  // The referrer's own form (by name) always wins: a form used once for a different purpose (e.g. an
  // insurer's form for a solicitor's client) must not become this referrer's default.
  const target = normaliseOrgName(party.name);
  const same = forms.find((f) => normaliseOrgName(f.referrer.name) === target);
  if (same) return { form: same, reason: "same_name" };

  const tokens = distinctiveTokens(party.name);
  let best: { form: FormDefinition; score: number } | null = null;
  for (const form of forms) {
    const theirs = new Set(distinctiveTokens(form.referrer.name));
    const score = tokens.filter((t) => theirs.has(t)).length;
    if (score >= 2 && (!best || score > best.score || (score === best.score && form.updatedAt > best.form.updatedAt))) {
      best = { form, score };
    }
  }
  if (best) return { form: best.form, reason: "similar_name" };

  // No form carries the referrer's name: the one staff chose for this referrer before, if any.
  if (rememberedFormId) {
    const remembered = forms.find((f) => f.id === rememberedFormId);
    if (remembered) return { form: remembered, reason: "remembered" };
  }
  return null;
}

export function matchReasonLabel(reason: MatchReason): string {
  switch (reason) {
    case "remembered":
      return "Used for this referrer before";
    case "same_name":
      return "This referrer's own form";
    case "similar_name":
      return "Matches the referrer on the referral";
  }
}

/* Remembered choices (per referrer name, this browser) ---------------------------------------- */

export const REFERRER_LINKS_KEY = `${STORAGE_PREFIX}referrer-form-links`;

function readLinks(): Record<string, string> {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(REFERRER_LINKS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function getRememberedFormId(referrerName: string): string | null {
  const id = readLinks()[normaliseOrgName(referrerName)];
  return typeof id === "string" ? id : null;
}

export function rememberFormForReferrer(referrerName: string, formId: string): void {
  try {
    const links = readLinks();
    links[normaliseOrgName(referrerName)] = formId;
    window.localStorage.setItem(REFERRER_LINKS_KEY, JSON.stringify(links));
  } catch {
    // ignore (private window / storage blocked)
  }
}
