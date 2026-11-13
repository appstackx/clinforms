/**
 * GET /app/clinic/setup/card-payments/connect – the owner's "Connect" / "Continue set-up" button and the provider's
 * refresh address: makes the clinic's connected account (once) and sends the owner to the provider's own onboarding
 * pages (a fresh, single-use link every time). The owner only; 404 while card payments are off.
 */
import { NextResponse } from "next/server";
import { clinicRoute } from "@/server/pms/http";
import { connectAccountFor, mayManageCards } from "@/server/pms/billing/connect/service";
import { cardPaymentsAvailable, trustedOrigin } from "@/server/pms/billing/connect/screen";

export const dynamic = "force-dynamic";

const notFound = () => new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });

export const GET = clinicRoute({ permission: "settings.owner" }, async (_req, actor) => {
  if (!cardPaymentsAvailable() || !mayManageCards(actor)) return notFound();
  const origin = trustedOrigin();
  const page = `${origin}/app/clinic/setup/card-payments`;
  const r = await connectAccountFor(actor, { refreshUrl: `${page}/connect`, returnUrl: `${page}?returned=1` });
  if (!r.ok) return NextResponse.redirect(`${page}?error=connect`, { status: 303, headers: { "cache-control": "no-store" } });
  return NextResponse.redirect(r.value.url, { status: 303, headers: { "cache-control": "no-store" } });
});
