/**
 * The installable staff app's web app manifest (12/11/2026, tracker xt05) – per brand host: the clinic brand's
 * (ClinDesk) on its hosts; 404 on ClinForms' hosts, which never advertise ClinDesk's app. Content: src/lib/pwa/manifest.ts.
 * Outside /app on purpose: browsers fetch a manifest without cookies, so it must not sit behind the sign-in redirect.
 */
import { webAppManifest } from "@/lib/pwa/manifest";
import { currentBrand } from "@/server/brand";

export const dynamic = "force-dynamic";

export function GET(): Response {
  const manifest = webAppManifest(currentBrand());
  if (!manifest) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      // Short: the same URL answers differently per host, and a brand change should reach installed apps soon.
      "cache-control": "public, max-age=3600",
      vary: "host",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
