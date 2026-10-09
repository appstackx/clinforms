import type { MetadataRoute } from "next";
import { LEGAL_LAST_UPDATED, PUBLIC_PAGES, absoluteUrl } from "@/lib/site";

/** /sitemap.xml – the public marketing and legal pages only. */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((page) => ({
    url: absoluteUrl(page.path),
    lastModified: LEGAL_LAST_UPDATED,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
