import type { MetadataRoute } from "next";
import { LEGAL_LAST_UPDATED, PRIVACY_LAST_UPDATED, PUBLIC_PAGES, absoluteUrl } from "@/lib/site";
import { DEMO_VIDEO } from "@/lib/site/demo-video";

/** The day a page last changed: the demo page by its cut, the privacy policy by its own date, the rest by the legal pages' date. */
function lastModified(path: string): string {
  if (path === "/demo") return DEMO_VIDEO.publishedOn;
  if (path === "/privacy") return PRIVACY_LAST_UPDATED;
  return LEGAL_LAST_UPDATED;
}

/** /sitemap.xml – the public marketing and legal pages only. */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((page) => ({
    url: absoluteUrl(page.path),
    lastModified: lastModified(page.path),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
