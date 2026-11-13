/**
 * GET /app/clinic/setup/card-payments/connect – the owner's "Connect" / "Continue set-up" button and the provider's
 * refresh address: makes the clinic's connected account (once) and sends the owner to the provider's own onboarding
 * pages (a fresh, single-use link every time). The owner only; 404 while card payments are off.
 */
import { NextResponse } from "next/server";
import { clinicActionActor } from "@/server/pms/actor";
import { connectAccountFor, mayManageCards } from "@/server/pms/billing/connect/service";
import { cardPaymentsAvailable, trustedOrigin } from "@/server/pms/billing/connect/screen";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const notFound = () => new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  if (!cardPaymentsAvailable()) return notFound();
  const actor = await clinicActionActor({ permission: "settings.owner" });
  if ("error" in actor || !mayManageCards(actor)) return notFound();
  const origin = trustedOrigin();
  const page = `${origin}/app/clinic/setup/card-payments`;
  const r = await connectAccountFor(actor, { refreshUrl: `${page}/connect`, returnUrl: `${page}?returned=1` });
  if (!r.ok) return NextResponse.redirect(`${page}?error=${encodeURIComponent("connect")}`, { status: 303, headers: { "cache-control": "no-store" } });
  return NextResponse.redirect(r.value.url, { status: 303, headers: { "cache-control": "no-store" } });
}
