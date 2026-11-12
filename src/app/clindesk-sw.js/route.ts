/**
 * The installable staff app's service worker (12/11/2026, tracker xt05), served on the clinic brand's hosts only (404 on
 * ClinForms' hosts). What it does and never does: src/lib/pwa/service-worker.ts. Registered with scope /app by
 * src/components/pwa/clinic-app.ts from the clinic area only.
 */
import { APP_ICONS } from "@/lib/pwa/manifest";
import { serviceWorkerSource } from "@/lib/pwa/service-worker";
import { currentBrand } from "@/server/brand";

export const dynamic = "force-dynamic";

/** The deployment's commit names the worker's cache (a new deployment = a clean cache); "local" elsewhere. */
function version(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 24) || "local";
}

export function GET(): Response {
  const brand = currentBrand();
  if (!brand.installableApp) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const source = serviceWorkerSource({
    version: version(),
    app: { name: brand.installableApp.name, themeColor: brand.themeColor, backgroundColor: brand.installableApp.backgroundColor },
    icons: APP_ICONS.map((i) => i.src),
  });
  return new Response(source, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      // Browsers check the worker for updates at least daily regardless; no-cache makes every check reach the server.
      "cache-control": "no-cache",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
