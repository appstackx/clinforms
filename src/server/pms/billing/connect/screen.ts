/**
 * Card payments – what the pages and server actions need around the services: the platform switch, the owner rule,
 * and the trusted origin for the provider's return addresses (the auth setting's allow-list, never a request's own
 * Host header unchecked).
 */
import "server-only";
import { headers } from "next/headers";
import { cardPaymentsSwitchOn } from "../../../../modules/pms/billing/card-payments";
import { appOrigin, baseUrlSetting } from "../../../auth/config";

export function cardPaymentsAvailable(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return cardPaymentsSwitchOn(env);
}

/** This app's origin for links the provider sends people back to. */
export function trustedOrigin(): string {
  let h: Headers | null = null;
  try {
    h = headers();
  } catch {
    h = null;
  }
  return appOrigin(baseUrlSetting(), h).replace(/\/+$/, "");
}

export { mayManageCards } from "./service";
