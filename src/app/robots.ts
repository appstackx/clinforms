import type { MetadataRoute } from "next";
import { APP_AREA_PREFIXES, AUTH_PATHS, SITE_URL } from "@/lib/site";

/**
 * /robots.txt – the public website is crawlable; the app, the APIs, the public demo and the sign-in pages
 * are not (they also send X-Robots-Tag: noindex / robots metadata).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Prefix rules: "/reports" also covers "/reports/…".
      disallow: [...APP_AREA_PREFIXES, ...AUTH_PATHS, "/ingest"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
