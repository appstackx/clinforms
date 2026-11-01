"use server";
/** Hides the clinic-system offer on the Overview for this browser (src/lib/clindesk-offer.ts). Signed-in members only. */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { CLINDESK_OFFER_COOKIE, CLINDESK_OFFER_COOKIE_DAYS } from "@/lib/clindesk-offer";
import { actionContext } from "@/server/auth/session";

export async function hideClinDeskOfferAction(): Promise<void> {
  const ctx = await actionContext();
  if ("error" in ctx) return;
  cookies().set(CLINDESK_OFFER_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/app", maxAge: CLINDESK_OFFER_COOKIE_DAYS * 86_400, secure: process.env.NODE_ENV === "production" && !/^http:\/\//.test(process.env.BETTER_AUTH_URL ?? "") });
  revalidatePath("/app");
}
