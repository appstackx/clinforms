/**
 * Edge middleware: an OPTIMISTIC cookie check only (Next 14 runs middleware on the Edge runtime – no
 * database). The real checks (session, two-step verification, clinic membership) run in Node, in the /app
 * layouts and every server action (src/server/auth/session.ts).
 *
 *   /app/**          no session cookie → /login?next=…; otherwise pass the path on to the layout
 *   auth pages       noindex header
 *   public pages     unchanged on ClinForms' hosts; on a host whose brand has no public site (src/lib/brand.ts,
 *                    e.g. a future second domain for the clinic system) → the brand's sign-in / app start page
 *
 * The matcher deliberately does NOT include /api, /reports or /pms-sandbox (the public demo and the
 * sandbox's own server-to-server calls must never be redirected).
 */
import { NextResponse, type NextRequest } from "next/server";
import { brandForHost } from "@/lib/brand";
import { hasSessionCookie } from "@/lib/session-cookie";

/** The public website's pages (src/app/(marketing)). */
export const PUBLIC_SITE_PATHS = ["/", "/demo", "/privacy", "/cookies", "/terms", "/security", "/request-access"] as const;

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  if ((PUBLIC_SITE_PATHS as readonly string[]).includes(pathname)) {
    const brand = brandForHost(req.headers.get("host") ?? req.nextUrl.host);
    if (brand.publicSite) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = hasSessionCookie(req.cookies) ? brand.appHome : "/login";
    url.search = hasSessionCookie(req.cookies) ? "" : `?next=${encodeURIComponent(brand.appHome)}`;
    return NextResponse.redirect(url);
  }
  if (pathname === "/app" || pathname.startsWith("/app/")) {
    if (!hasSessionCookie(req.cookies)) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(url);
    }
    const forwarded = new Headers(req.headers);
    forwarded.set("x-clinforms-path", pathname + search);
    const res = NextResponse.next({ request: { headers: forwarded } });
    res.headers.set("x-robots-tag", "noindex, nofollow");
    return res;
  }
  const res = NextResponse.next();
  res.headers.set("x-robots-tag", "noindex, nofollow");
  return res;
}

export const config = {
  matcher: ["/app", "/app/:path*", "/login", "/two-factor", "/accept-invite", "/reset-password", "/", "/demo", "/privacy", "/cookies", "/terms", "/security", "/request-access"],
};
