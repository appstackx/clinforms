/**
 * GET /clinics/<clinic>/booking/<secret> – the "manage this booking" link (M10 L7): the secret is swapped for a cookie
 * (httpOnly, SameSite=Lax, limited to /clinics/<clinic>/booking, until the link expires) and the browser is sent to
 * /clinics/<clinic>/booking/manage – the secret leaves the address bar, the history and any Referer. `?form=<id>`
 * opens one of the booking's forms. A link that does not open a booking goes to the same page, which then answers
 * 404 (no cookie is set), so a wrong link and an expired one look alike.
 */
import { NextResponse } from "next/server";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { manageContext } from "@/server/pms/portal/portal-views";
import { publicClinicFor, publicCtx, setManageCookie } from "@/server/pms/portal/public-page";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { clinicId: string; token: string } }): Promise<Response> {
  const clinic = await publicClinicFor(params.clinicId);
  if (!clinic) return new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const paths = clinicPublicPaths(clinic.tenantId);
  const m = await manageContext(publicCtx(), clinic, decodeURIComponent(params.token));
  const form = new URL(req.url).searchParams.get("form");
  const to = m && form && /^ifr_[0-9A-HJKMNP-TV-Z]{26}$/.test(form) ? paths.manageFormPage(form) : paths.manageHome;
  if (m) setManageCookie(clinic, m.token, m.booking.manageExpiresAt);
  return new NextResponse(null, { status: 303, headers: { location: to, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
