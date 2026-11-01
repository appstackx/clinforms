/**
 * The account hold: a payment for the clinic's plan is overdue AND the grace period (7 days) has passed.
 *
 * Khuram 01/11/2026 – a hold NEVER blocks clinical work. Clinical notes (write, sign, amend), appointments and the
 * diary, patient records, patient billing, letters, the patient portal and messages to patients all keep working.
 * Only these are paused until the payment is made:
 *   - admin settings other than billing: the clinic system's set-up (settings.setup), message templates
 *     (messages.templates), member access (settings.members), the clinic's own settings and API keys;
 *   - new staff invitations;
 *   - data imports (settings.import);
 *   - marketing messages (purpose "marketing") – anything bulk or promotional;
 *   - report drafting / ClinForms generation (the Report API's 403 PAYMENT_OVERDUE – the module's clinic profile).
 * Paying and "Manage billing" always work. Never a hold while ClinForms staff manage the clinic by hand (override), for
 * a test-mode subscription once live billing is on, or when the table cannot be read (fail open).
 */
import type { Kysely } from "kysely";
import type { Database } from "../db/schema";
import { readClinicSubscription, type ClinicSubscription } from "../repos/clinic-subscription";
import { billingLiveRequired } from "../pms/comms/credits/card-payments";

export type AccountHold = { held: false } | { held: true; since: string };

/** Pure: whether this subscription holds the account at `now`. */
export function holdOf(sub: ClinicSubscription | null, now: Date, env: Readonly<Record<string, string | undefined>> = process.env): AccountHold {
  if (!sub || sub.override || sub.state !== "past_due" || !sub.graceUntil) return { held: false };
  if (sub.mode === "test" && billingLiveRequired(env)) return { held: false };
  return Date.parse(sub.graceUntil) <= now.getTime() ? { held: true, since: sub.graceUntil } : { held: false };
}

/** The clinic's hold now; never throws (fail open). */
export async function accountHold(db: Kysely<Database>, tenantId: string, now: Date = new Date()): Promise<AccountHold> {
  try {
    return holdOf(await readClinicSubscription({ db }, tenantId), now);
  } catch {
    return { held: false };
  }
}

/** Clinic-system permissions paused while the account is on hold (everything else – all clinical work – carries on). */
export const HOLD_PAUSED_PERMISSIONS: ReadonlySet<string> = new Set(["settings.setup", "settings.import", "settings.members", "messages.templates"]);

export function pausedByHold(permission: string): boolean {
  return HOLD_PAUSED_PERMISSIONS.has(permission);
}

export const HOLD_MESSAGE =
  "This is paused because a payment for your plan is overdue. Clinical work – notes, the diary, patient records, letters and messages to patients – carries on as normal. The clinic owner can pay under Plan and billing.";

/** The refusal for a paused action, or null (no hold). For server actions outside the clinic system's actor. */
export async function holdRefusal(db: Kysely<Database>, tenantId: string, now: Date = new Date()): Promise<string | null> {
  return (await accountHold(db, tenantId, now)).held ? HOLD_MESSAGE : null;
}
