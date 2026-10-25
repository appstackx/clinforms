/**
 * Which referrer form to complete for an episode: the referral's referrer's own form when the library
 * holds one. Matching is deliberately conservative – the same organisation name, then at least two
 * distinctive words in common, and only then a choice remembered for this referrer ("Harrow & Pike Solicitors" ↔
 * "Harrow & Pike Medico-Legal"). One shared word ("Northfield Freight" ↔ "Northfield Assurance") is
 * not enough; staff then choose, and the choice is remembered for that referrer in this browser.
 *
 * Pure apart from the small storage helpers at the end: localStorage in the demo (wrapped in try/catch), the
 * clinic's settings through ui/store.ts in a clinic's own Studio (server store, wave 2).
 *
 * Owner: studio-a agent.
 */
import { STORAGE_PREFIX } from "../../../config.public";
import { distinctiveTokens, normaliseOrgName } from "../../../core/forms";
import type { EpisodeBundle, FormDefinition, InstructingParty } from "../../../core/types";
import { getStoreMode, getStoredReferrerLinks, saveReferrerLinks } from "../../store";

export { distinctiveTokens, normaliseOrgName } from "../../../core/forms";

export type MatchReason = "remembered" | "same_name" | "similar_name";

/**
 * Fix round 1 (B0-20): whether a form is an initial assessment or a discharge / final report, from its title – a
 * referrer usually sends both, so a choice is remembered for each. Null for anything else (progress, interim, portal).
 */
export type ReportKind = "initial" | "discharge";

export function reportKindOf(title: string): ReportKind | null {
  const t = (title ?? "").toLowerCase();
  if (/\b(?:discharge|final|end of treatment|eots|closing)\b/.test(t)) return "discharge";
  if (/\binitial\b|\bassessment\b/.test(t)) return "initial";
  return null;
}

/** What the notes cover: a discharge (the episode closed, or a discharge note), only the first assessment, or neither. */
export function notesReportKind(bundle: Pick<EpisodeBundle, "notes" | "episodeStatus">): ReportKind | null {
  if (bundle.episodeStatus === "discharged" || bundle.notes.some((n) => n.type === "discharge")) return "discharge";
  if (bundle.notes.length > 0 && bundle.notes.every((n) => n.type === "initial_assessment")) return "initial";
  return null;
}

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
  /** Fix round 1 (B0-20): what the notes cover – a form of the other kind is never chosen for them. */
  kind: ReportKind | null = null,
): FormMatch | null {
  const fits = (f: FormDefinition) => !kind || reportKindOf(f.title) === null || reportKindOf(f.title) === kind;
  // The referrer's own form (by name) always wins: a form used once for a different purpose (e.g. an
  // insurer's form for a solicitor's client) must not become this referrer's default. Of its own forms, the one of
  // the notes' kind (its discharge report for notes that run to discharge).
  const target = normaliseOrgName(party.name);
  const own = forms.filter((f) => normaliseOrgName(f.referrer.name) === target);
  const same = own.find(fits) ?? (kind ? undefined : own[0]);
  if (same) return { form: same, reason: "same_name" };

  const tokens = distinctiveTokens(party.name);
  let best: { form: FormDefinition; score: number } | null = null;
  for (const form of forms) {
    if (!fits(form)) continue;
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
    if (remembered && fits(remembered)) return { form: remembered, reason: "remembered" };
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
  // A clinic's Studio keeps them in the clinic's settings (server store), never in browser storage.
  const stored = getStoredReferrerLinks();
  if (stored) return { ...stored };
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(REFERRER_LINKS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The link key: the referrer's name, and (fix round 1, B0-20) the kind of report ("harbourside case management#initial"). */
function linkKey(referrerName: string, kind: ReportKind | null): string {
  const name = normaliseOrgName(referrerName);
  return name && kind ? `${name}#${kind}` : name;
}

/** The form chosen last time for this referrer – for this kind of report first, then for any (older choices). */
export function getRememberedFormId(referrerName: string, kind: ReportKind | null = null): string | null {
  const links = readLinks();
  const id = links[linkKey(referrerName, kind)] ?? links[linkKey(referrerName, null)];
  return typeof id === "string" ? id : null;
}

export function rememberFormForReferrer(referrerName: string, formId: string, kind: ReportKind | null = null): void {
  const keys = Array.from(new Set([linkKey(referrerName, null), linkKey(referrerName, kind)])).filter(Boolean);
  if (getStoreMode() === "server") {
    const links = readLinks();
    if (keys.some((k) => links[k] !== formId)) saveReferrerLinks({ ...links, ...Object.fromEntries(keys.map((k) => [k, formId])) });
    return;
  }
  try {
    const links = readLinks();
    for (const k of keys) links[k] = formId;
    window.localStorage.setItem(REFERRER_LINKS_KEY, JSON.stringify(links));
  } catch {
    // ignore (private window / storage blocked)
  }
}

/**
 * The line under "Referred by …" on "Which referrer form?" (fix round 1, B0-20): neutral, naming each form's provider –
 * a referrer's case may use several providers' forms, and several providers print the same title.
 */
export function formChoiceNote(input: {
  party: Pick<InstructingParty, "name">;
  match: FormMatch | null;
  selected: FormDefinition | null;
  kind: ReportKind | null;
}): string {
  const { party, match, selected, kind } = input;
  const named = (f: FormDefinition) => `${f.referrer.name}'s “${f.title}”`;
  const covers = kind === "discharge" ? " These notes run to discharge." : kind === "initial" ? " These notes cover the initial assessment." : "";
  if (!match) {
    return selected
      ? `${named(selected)} is selected. It will be remembered for ${party.name}.${covers}`
      : `No form in the library is linked to this referrer yet. Choose the form they sent – it will be remembered for them.${covers}`;
  }
  const why = match.reason === "remembered" ? `Last time, ${party.name}'s case used ${named(match.form)}.` : `${named(match.form)}: ${matchReasonLabel(match.reason).toLowerCase()}.`;
  if (!selected || selected.id === match.form.id) return `${why}${covers}`;
  return `${why} You have chosen ${named(selected)} this time.${covers}`;
}
