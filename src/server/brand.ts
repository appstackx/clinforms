/** The brand of the current request (by its Host header) – server components only. Config: src/lib/brand.ts. */
import "server-only";
import { headers } from "next/headers";
import { brandForHost, type Brand } from "../lib/brand";

export function currentBrand(): Brand {
  try {
    const h = headers();
    // x-forwarded-host first: Next's own re-render after a server action's redirect is fetched from the server's
    // internal origin (next start: http://localhost:<port>) with the original request's headers, so only
    // x-forwarded-host still names the host the person is on (set by Vercel's edge, or by Next itself from Host).
    // Presentation only – links and the origin check never use it (src/server/auth/config.ts requestBrand).
    return brandForHost(h.get("x-forwarded-host")?.split(",")[0] || h.get("host"));
  } catch {
    return brandForHost(null);
  }
}

/** The page that picks the clinic brand's start page after sign-in (src/app/app/start). */
export const APP_START_PATH = "/app/start";

/**
 * Where a member lands after signing in, setting up two-step verification, accepting an invitation or switching
 * clinic: /app on ClinForms' hosts (as before); on the clinic brand's host /app/start, which opens the clinic area
 * when the clinic has the clinic package.
 */
export function landingPath(): string {
  return currentBrand().id === "clinic" ? APP_START_PATH : "/app";
}
