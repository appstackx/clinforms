/**
 * Edge middleware: an OPTIMISTIC cookie check only (Next 14 runs middleware on the Edge runtime – no
 * database). The real checks (session, two-step verification, clinic membership) run in Node, in the /app
 * layouts and every server action (src/server/auth/session.ts).
 *
 *   /app/**          no session cookie → /login?next=…; otherwise pass the path on to the layout
 *   auth pages       noindex header
 *   ClinDesk site    on the clinic brand's hosts (src/lib/brand.ts: clindesk.co.uk, clinic.localhost) the public
 *                    paths are rewritten to ClinDesk's own website (src/app/clindesk-site); /request-access goes to
 *                    /demo. The internal folder itself answers 404 on every host, so it is only reachable this way.
 *   ClinForms site   on ClinForms' hosts the matcher does not match its public pages at all (as before the clinic
 *                    system); the code below passes them through regardless.
 *
 * The matcher deliberately does NOT include /api, /pms-sandbox or /reports/… (the public demo and the sandbox's
 * own server-to-server calls must never be redirected); /reports itself is matched only on the clinic brand's
 * hosts (ClinDesk's "Referrer reports" page).
 */
import { NextResponse, type NextRequest } from "next/server";
import { brandForHost } from "@/lib/brand";
import { hasSessionCookie } from "@/lib/session-cookie";

/** ClinForms' public website pages (src/app/(marketing)). */
export const PUBLIC_SITE_PATHS = ["/", "/demo", "/privacy", "/cookies", "/terms", "/security", "/request-access"] as const;

/** ClinDesk's public website (src/app/clindesk-site): served on the clinic brand's hosts at these paths. */
export const CLINDESK_SITE_PATHS = [
  "/",
  "/features",
  "/reports",
  "/pricing",
  "/switching",
  "/security",
  "/demo",
  "/demo/thanks",
  "/privacy",
  "/terms",
  "/cookies",
  "/accessibility",
  "/robots.txt",
  "/sitemap.xml",
] as const;

/** ClinForms pages without a ClinDesk twin: sent to the ClinDesk page that does the same job. */
export const CLINDESK_REDIRECTS: Readonly<Record<string, string>> = { "/request-access": "/demo" };

/** The internal route folder of ClinDesk's website (never served under this name). */
export const CLINDESK_INTERNAL_PREFIX = "/clindesk-site";

/** Where a blocked internal path is rewritten to: a path no route matches, so the app's own 404 page answers. */
const NOT_FOUND_PATH = "/_clindesk-not-found";

/** The internal path for a ClinDesk page ("/" → "/clindesk-site", "/features" → "/clindesk-site/features"). */
export function clindeskInternalPath(pathname: string): string {
  return pathname === "/" ? CLINDESK_INTERNAL_PREFIX : `${CLINDESK_INTERNAL_PREFIX}${pathname}`;
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  if (pathname === CLINDESK_INTERNAL_PREFIX || pathname.startsWith(`${CLINDESK_INTERNAL_PREFIX}/`)) {
    const url = req.nextUrl.clone();
    url.pathname = NOT_FOUND_PATH;
    url.search = "";
    const res = NextResponse.rewrite(url);
    res.headers.set("x-robots-tag", "noindex, nofollow");
    return res;
  }
  const brand = brandForHost(req.headers.get("host") ?? req.nextUrl.host);
  if (brand.publicSite === "clindesk") {
    if ((CLINDESK_SITE_PATHS as readonly string[]).includes(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = clindeskInternalPath(pathname);
      return NextResponse.rewrite(url);
    }
    const to = CLINDESK_REDIRECTS[pathname];
    if (to) {
      const url = req.nextUrl.clone();
      url.pathname = to;
      url.search = "";
      return NextResponse.redirect(url, 308);
    }
  }
  if ((PUBLIC_SITE_PATHS as readonly string[]).includes(pathname)) return NextResponse.next();
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

/*
 * The matcher: main's coverage (/app and the auth pages), the internal ClinDesk folder (blocked on every host), and
 * ClinDesk's public paths ONLY on the clinic brand's hosts (on ClinForms' own hosts the public site never runs the
 * middleware, exactly as before the clinic system). Next reads this object statically, so the host pattern is
 * written out here: it must list every host (and dev host) of every brand whose publicSite is "clindesk" in
 * src/lib/brand.ts, dots escaped, joined with "|" – src/server/auth/middleware.test.ts fails until it does. Matched
 * against the Host header without its port.
 */
export const config = {
  matcher: [
    "/app",
    "/app/:path*",
    "/login",
    "/two-factor",
    "/accept-invite",
    "/reset-password",
    "/clindesk-site",
    "/clindesk-site/:path*",
    { source: "/", has: [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }] },
    { source: "/features", has: [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }] },
    { source: "/reports", has: [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }] },
    { source: "/pricing", has: [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }] },
    { source: "/switching", has: [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }] },
    { source: "/security", has: [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }] },
    { source: "/demo", has: [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }] },
    { source: "/demo/thanks", has: [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }] },
    { source: "/privacy", has: [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }] },
    { source: "/terms", has: [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }] },
    { source: "/cookies", has: [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }] },
    { source: "/accessibility", has: [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }] },
    { source: "/robots.txt", has: [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }] },
    { source: "/sitemap.xml", has: [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }] },
    { source: "/request-access", has: [{ type: "host", value: "clindesk\\.co\\.uk|www\\.clindesk\\.co\\.uk|clinic\\.localhost" }] },
  ],
};
