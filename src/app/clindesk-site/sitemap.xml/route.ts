import { CLINDESK_CONTENT } from "@/lib/clindesk/content";
import { ACCESSIBILITY_LAST_UPDATED, CLINDESK_LEGAL_LAST_UPDATED, CLINDESK_PAGES, CLINDESK_SITE_UPDATED, clindeskUrl } from "@/lib/clindesk/site";

/**
 * /sitemap.xml on ClinDesk's hosts (src/middleware.ts rewrites it here; clinforms.co.uk keeps src/app/sitemap.ts):
 * the indexed pages only. Static: it is built with the site, and reading CLINDESK_CONTENT here makes sure the build
 * validates content/clindesk-site.json even if no page were prerendered.
 */
export const dynamic = "force-static";

function lastModified(path: string): string {
  // ClinDesk's own legal text (31/10/2026), not ClinForms' dates.
  if (path === "/privacy" || path === "/terms" || path === "/cookies") return CLINDESK_LEGAL_LAST_UPDATED;
  if (path === "/accessibility") return ACCESSIBILITY_LAST_UPDATED;
  return CLINDESK_SITE_UPDATED;
}

export function GET(): Response {
  void CLINDESK_CONTENT;
  const urls = CLINDESK_PAGES.filter((p) => p.indexed)
    .map(
      (p) =>
        `<url>\n<loc>${clindeskUrl(p.path)}</loc>\n<lastmod>${lastModified(p.path)}</lastmod>\n<changefreq>${p.changeFrequency}</changefreq>\n<priority>${p.priority}</priority>\n</url>`,
    )
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } });
}
