import { CLINDESK_PAGES, CLINDESK_SITE_URL } from "@/lib/clindesk/site";
import { APP_AREA_PREFIXES, AUTH_PATHS } from "@/lib/site";

/**
 * /robots.txt on ClinDesk's hosts (src/middleware.ts rewrites it here; clinforms.co.uk keeps src/app/robots.ts). The
 * website is crawlable; the app, the APIs, the sign-in pages and the thank-you page are not.
 */
export const dynamic = "force-static";

export function GET(): Response {
  const disallow = [...APP_AREA_PREFIXES.filter((p) => p !== "/reports"), "/reports/", ...AUTH_PATHS, "/ingest", ...CLINDESK_PAGES.filter((p) => !p.indexed).map((p) => p.path)];
  const body = ["User-Agent: *", "Allow: /", ...disallow.map((p) => `Disallow: ${p}`), "", `Host: ${CLINDESK_SITE_URL}`, `Sitemap: ${CLINDESK_SITE_URL}/sitemap.xml`, ""].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
