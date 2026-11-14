"use server";
/**
 * Text credits – server actions (Messages → Text credits). Each one: the member, the clinic's package and
 * messages.send first (contract §6), then src/server/pms/comms/credits/views.ts, which allows buying, the card and
 * automatic top-up to the clinic's OWNER and ADMINS only. The checkout's return address is this deployment's own
 * origin (the request's, when it is one of the app's own – else the configured one).
 */
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { isAllowedAppOrigin } from "@/server/auth/config";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { commsLinkOrigin } from "@/server/pms/comms/links";
import { CREDITS_PAGE_PATH } from "@/server/pms/comms/credits/notify";
import { cardPaymentsFromEnv, removeCardFor, saveAutoTopupFor, startCardSetup, startPackCheckout } from "@/server/pms/comms/credits/views";

export type CreditsActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

function ownOrigin(): string {
  const origin = headers().get("origin");
  return origin && isAllowedAppOrigin(origin) ? new URL(origin).origin : commsLinkOrigin();
}

const key = () => `credits-${randomBytes(12).toString("base64url")}`;

/** Buy a pack: the card payment page's address (the browser goes there). */
export async function buyCreditsAction(pack: string, saveCard: boolean): Promise<CreditsActionResult<{ url: string }>> {
  const actor = await clinicActionActor({ permission: "messages.send", allowAfterTrial: true });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const p = cardPaymentsFromEnv();
  const r = await startPackCheckout(actor, { pack: String(pack).slice(0, 20), saveCard: saveCard === true, origin: ownOrigin(), idempotencyKey: key() }, p.ok ? p.payments : null);
  return r.ok ? { ok: true, url: r.value.url } : { ok: false, error: r.error };
}

/** Save a card for automatic top-up: the card payment page in "save a card" mode. */
export async function saveCardAction(): Promise<CreditsActionResult<{ url: string }>> {
  const actor = await clinicActionActor({ permission: "messages.send", allowAfterTrial: true });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const p = cardPaymentsFromEnv();
  const r = await startCardSetup(actor, { origin: ownOrigin(), idempotencyKey: key() }, p.ok ? p.payments : null);
  return r.ok ? { ok: true, url: r.value.url } : { ok: false, error: r.error };
}

export async function saveAutoTopupAction(input: { enabled: boolean; threshold: number; pack: string }): Promise<CreditsActionResult<{ message: string }>> {
  const actor = await clinicActionActor({ permission: "messages.send", allowAfterTrial: true });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await saveAutoTopupFor(actor, { enabled: input?.enabled === true, threshold: Number(input?.threshold), pack: String(input?.pack ?? "").slice(0, 20) });
  if (r.ok) revalidatePath(CREDITS_PAGE_PATH);
  return r.ok ? { ok: true, message: r.value.message } : { ok: false, error: r.error };
}

export async function removeCardAction(): Promise<CreditsActionResult<{ message: string }>> {
  const actor = await clinicActionActor({ permission: "messages.send", allowAfterTrial: true });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await removeCardFor(actor);
  if (r.ok) revalidatePath(CREDITS_PAGE_PATH);
  return r.ok ? { ok: true, message: r.value.message } : { ok: false, error: r.error };
}
