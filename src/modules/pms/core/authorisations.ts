/**
 * Treatment authorisations (pure): what is left, whether it can still be used, and the warnings the diary and
 * billing show ("expires in 5 days", "1 session left").
 */
import type { AuthorisationStatus } from "./types";

export interface AuthorisationLike {
  status: AuthorisationStatus;
  sessionsAuthorised: number | null;
  valueAuthorisedPence: number | null;
  sessionsUsed: number;
  valueUsedPence: number;
  validFrom: string | null;
  expiresOn: string | null;
}

export type AuthorisationState = "active" | "not_started" | "expired" | "exhausted" | "cancelled";

export interface AuthorisationView {
  state: AuthorisationState;
  /** null = no session limit. */
  sessionsLeft: number | null;
  /** null = no value limit. */
  valueLeftPence: number | null;
  /** Whole days until the expiry date (0 = expires today); null when there is none. */
  daysToExpiry: number | null;
  warnings: ("expires_soon" | "few_sessions_left" | "little_value_left")[];
}

export const EXPIRY_WARNING_DAYS = 14;

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** today = "YYYY-MM-DD" (UK). */
export function authorisationView(a: AuthorisationLike, today: string): AuthorisationView {
  const sessionsLeft = a.sessionsAuthorised === null ? null : Math.max(0, a.sessionsAuthorised - a.sessionsUsed);
  const valueLeftPence = a.valueAuthorisedPence === null ? null : Math.max(0, a.valueAuthorisedPence - a.valueUsedPence);
  const daysToExpiry = a.expiresOn ? dayNumber(a.expiresOn) - dayNumber(today) : null;
  let state: AuthorisationState = "active";
  if (a.status === "cancelled") state = "cancelled";
  else if (daysToExpiry !== null && daysToExpiry < 0) state = "expired";
  else if (a.validFrom && a.validFrom > today) state = "not_started";
  else if (sessionsLeft === 0 || valueLeftPence === 0) state = "exhausted";
  const warnings: AuthorisationView["warnings"] = [];
  if (state === "active") {
    if (daysToExpiry !== null && daysToExpiry <= EXPIRY_WARNING_DAYS) warnings.push("expires_soon");
    if (sessionsLeft !== null && sessionsLeft <= 1) warnings.push("few_sessions_left");
    if (valueLeftPence !== null && a.valueAuthorisedPence !== null && valueLeftPence <= a.valueAuthorisedPence * 0.15) warnings.push("little_value_left");
  }
  return { state, sessionsLeft, valueLeftPence, daysToExpiry, warnings };
}

/** Whether a session (and its price) can be charged to the authorisation today. */
export function canUseAuthorisation(a: AuthorisationLike, today: string, pricePence = 0): boolean {
  const view = authorisationView(a, today);
  if (view.state !== "active") return false;
  if (view.sessionsLeft !== null && view.sessionsLeft < 1) return false;
  if (view.valueLeftPence !== null && view.valueLeftPence < pricePence) return false;
  return true;
}
