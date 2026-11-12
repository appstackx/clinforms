/**
 * The installable staff app's service worker (12/11/2026, tracker xt05). What it does and never does:
 * src/lib/pwa/service-worker.ts. Registered with scope /app by src/components/pwa/clinic-app.ts from the clinic area only.
 *
 *   ClinDesk's hosts, app on   the worker
 *   ClinDesk's hosts, app off  the self-removing worker (kill switch: CLINFORMS_PWA=off or the brand's installableApp
 *                              removed) – deletes its caches, unregisters, reloads the pages (docs/production-architecture.md §9)
 *   ClinForms' hosts           404 (never had it)
 */
import { APP_ICONS } from "@/lib/pwa/manifest";
import { serviceWorkerKillSource, serviceWorkerSource } from "@/lib/pwa/service-worker";
import { currentBrand } from "@/server/brand";
import { currentInstallableApp, currentServiceWorkerKind } from "@/server/pwa";

export const dynamic = "force-dynamic";

/** The deployment's commit names the worker's cache (a new deployment = a clean cache); "local" elsewhere. */
function version(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 24) || "local";
}

const js = (source: string) =>
  new Response(source, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      // Browsers check the worker for updates at least daily regardless; no-cache makes every check reach the server.
      "cache-control": "no-cache",
      "x-robots-tag": "noindex, nofollow",
    },
  });

export function GET(): Response {
  const kind = currentServiceWorkerKind();
  if (kind === "none") return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const app = currentInstallableApp();
  if (kind === "remove" || !app) return js(serviceWorkerKillSource());
  return js(
    serviceWorkerSource({
      version: version(),
      app: { name: app.name, themeColor: currentBrand().themeColor, backgroundColor: app.backgroundColor },
      icons: APP_ICONS.map((i) => i.src),
    }),
  );
}
