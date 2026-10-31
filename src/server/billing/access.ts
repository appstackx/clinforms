/**
 * The account hold (31/10/2026): a payment for the clinic's plan is overdue AND the grace period (7 days) has passed →
 * the account is READ-ONLY until the payment is made. Records stay readable and downloadable; nothing new can be
 * written (the clinic system's server actions answer "read_only" – src/server/pms/actor.ts; ClinForms' Report API
 * answers 403 PAYMENT_OVERDUE – the module's clinic profile). The Plan and billing page always works, so the owner can
 * pay. Never a hold while ClinForms staff manage the clinic by hand (override), for a test-mode subscription once
 * live billing is on, or when the table cannot be read (fail open: a billing outage never stops clinical work).
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

export const READ_ONLY_MESSAGE = "Your account is read-only because a payment for your plan is overdue. Your records can still be opened. The clinic owner can pay under Plan and billing.";
