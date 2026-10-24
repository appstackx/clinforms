/**
 * Where portal emails go (contract §11). The ONLY provider in this build is the outbox: a message is stored
 * (recipient and body encrypted) and listed for the clinic's administrators under Online booking → Messages –
 * nothing is sent. CLINIC_EMAIL_PROVIDER unset or "outbox" → the outbox; any other value is refused (falls back
 * to the outbox and logs it) until a real provider is added behind this interface, in test mode first.
 */
import "server-only";
import { logAuthEvent } from "../../email/log";

export interface PortalMailer {
  /** Stored as the message's provider. */
  readonly provider: string;
  /** The status a stored message gets ("outbox" = kept, not sent). */
  readonly status: "outbox" | "sent";
  /** True when messages only sit in the outbox (screens say so). */
  readonly testMode: boolean;
}

const OUTBOX: PortalMailer = { provider: "outbox", status: "outbox", testMode: true };

let warned = false;

export function portalMailer(env: Readonly<Record<string, string | undefined>> = process.env): PortalMailer {
  const name = (env.CLINIC_EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (name === "" || name === "outbox") return OUTBOX;
  if (!warned) {
    logAuthEvent("pms.portal.email_provider_unknown", { provider: name.slice(0, 40) });
    warned = true;
  }
  return OUTBOX;
}
