/**
 * GET /api/xero/callback – Xero sends the owner's browser back here after they allowed (or refused) the connection.
 * Needs the same signed-in member and session that pressed Connect (the OAuth state is tied to it and used once);
 * owners and admins only. Ends at Set-up → Xero with ?connected=1 or a plain-English ?error=. 404 while
 * CLINFORMS_XERO is off. Logic and tests: src/server/pms/integration/xero/connect.ts.
 */
import "server-only";
import { NextResponse } from "next/server";
import { clinicActionActor } from "@/server/pms/actor";
import { xeroAvailable, xeroClientFromEnv } from "@/server/pms/integration/xero/config";
import { finishXeroConnect } from "@/server/pms/integration/xero/connect";
import { mayManageXero } from "@/server/pms/integration/xero/screen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = "/app/clinic/setup/xero";

function back(req: Request, query: string): NextResponse {
  const res = NextResponse.redirect(new URL(`${PAGE}?${query}`, req.url), 303);
  res.headers.set("cache-control", "no-store");
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}

export async function GET(req: Request): Promise<Response> {
  if (!xeroAvailable()) return new NextResponse("Not found", { status: 404 });
  const client = xeroClientFromEnv();
  if (!client) return back(req, "error=error");
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor || !mayManageXero(actor)) return back(req, "error=forbidden");
  const result = await finishXeroConnect(actor.repo(), actor.tenantId, client, actor.actor, new URL(req.url).searchParams);
  return back(req, result.ok ? "connected=1" : `error=${result.error}`);
}
