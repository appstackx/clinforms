/**
 * The portal's emails go through comms (one message log, one outbox screen – K2-BOOK-004): a sign-in link is the
 * "portal_link" message, written from the clinic's template ("Patient portal sign-in"), to the address on the
 * patient's record, outbox / test providers only. Booking confirmations, cancellation and "moved" notices are the
 * diary's appointment messages (comms plans them through the diary hook) – not sent from here.
 */
import "server-only";
import type { PmsActor } from "../../../modules/pms/core/types";
import { formatUkTime } from "../../../modules/pms/portal/time";
import type { RepoContext } from "../../repos/context";
import { logAuthEvent } from "../../email/log";
import { dispatchDepsFromEnv, sendDocumentMessage } from "../comms/dispatch";

/** "15 minutes (at 10:57)" / "72 hours (until 31/10 at 10:42)" – the {{portal.expires}} merge field. */
export function expiryWords(now: Date, expiresAt: string): string {
  const minutes = Math.round((Date.parse(expiresAt) - now.getTime()) / 60_000);
  if (minutes < 120) return `${minutes} minutes (at ${formatUkTime(expiresAt)})`;
  const d = new Date(expiresAt);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit" }).format(d);
  return `${Math.round(minutes / 60)} hours (until ${day} at ${formatUkTime(expiresAt)})`;
}

/** Emails a sign-in link to the patient (address on the record). Never throws; answers whether it was written. */
export async function sendPortalLinkEmail(ctx: RepoContext, tenantId: string, patientId: string, link: string, expiresAt: string, now: Date, actor: PmsActor): Promise<boolean> {
  try {
    const r = await sendDocumentMessage(
      ctx,
      tenantId,
      { kind: "portal_link", channel: "email", patientId, to: { kind: "patient" }, values: { "portal.link": link, "portal.expires": expiryWords(now, expiresAt) }, documentType: null, documentId: null },
      actor,
      dispatchDepsFromEnv(process.env),
    );
    return r.ok;
  } catch (err) {
    logAuthEvent("pms.portal.link_email_failed", { error: err instanceof Error ? err.name : "error" });
    return false;
  }
}
