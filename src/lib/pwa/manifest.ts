/**
 * The installable staff app (12/11/2026, tracker xt05 "Phone app – installable web app first"): the web app manifest
 * per brand host. Pure and browser-safe (no env, no request): src/app/clindesk.webmanifest/route.ts serves it for the
 * request's brand, and the clinic area's layout links it (src/app/app/clinic/layout.tsx).
 *
 * Only a brand with `installableApp` (src/lib/brand.ts – the clinic brand, ClinDesk) gets a manifest: on ClinForms' hosts
 * the manifest URL answers 404 and no page links it, so ClinForms never advertises ClinDesk's app.
 *
 * The app is the clinic staff area: it opens at /app/clinic and its scope is /app (the clinic area, the account pages it
 * links to and the add-on). Signed-out pages (/login …) are outside the scope: the installed app shows them with the
 * small in-app browser bar, which is what a sign-in should look like anyway.
 */
import type { Brand } from "../brand";

/** Where the manifest is served (outside /app: browsers fetch it without cookies, so it must not need a session). */
export const MANIFEST_PATH = "/clindesk.webmanifest";
/** The installed app's start page and scope. */
export const APP_START_URL = "/app/clinic";
export const APP_SCOPE = "/app";
/** The home-screen icons, rendered from the ClinDesk mark (public/clindesk/favicon.svg) by scripts/pwa/gen-icons.cjs. */
export const APP_ICON_DIR = "/clindesk/app";
export const APP_ICONS = [
  { src: `${APP_ICON_DIR}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
  { src: `${APP_ICON_DIR}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
  { src: `${APP_ICON_DIR}/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
] as const;

export interface WebAppManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: string;
  dir: "ltr";
  start_url: string;
  scope: string;
  display: "standalone";
  orientation: "any";
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
}

/** The environment switch that withdraws the installable app everywhere (rollback without a code change). */
export const PWA_ENV = "CLINFORMS_PWA";

/**
 * The brands whose hosts have EVER served the app's service worker. On these hosts /clindesk-sw.js never answers 404:
 * with the app switched off it serves the self-removing worker (src/lib/pwa/service-worker.ts serviceWorkerKillSource),
 * so phones that installed it lose it on their next visit. ClinForms' hosts never had it and stay 404.
 */
export const PWA_HOST_BRANDS: readonly Brand["id"][] = ["clinic"];

/**
 * The host brand's installable app, or null when it has none OR it is switched off (CLINFORMS_PWA=off). Pure: the server
 * passes process.env (src/server/pwa.ts).
 */
export function installableAppFor(
  brand: Pick<Brand, "installableApp">,
  env: Readonly<Record<string, string | undefined>>,
): Brand["installableApp"] {
  if ((env[PWA_ENV] ?? "").trim().toLowerCase() === "off") return null;
  return brand.installableApp;
}

/**
 * What /clindesk-sw.js serves for a request: "app" (the worker), "remove" (the self-removing worker – the app is off on a
 * host that once had it), or "none" (404 – ClinForms' hosts).
 */
export function serviceWorkerKind(brand: Pick<Brand, "id" | "installableApp">, env: Readonly<Record<string, string | undefined>>): "app" | "remove" | "none" {
  if (installableAppFor(brand, env)) return "app";
  return PWA_HOST_BRANDS.includes(brand.id) ? "remove" : "none";
}

/** The manifest for a brand's hosts, or null when the brand has no installable app (ClinForms). */
export function webAppManifest(brand: Pick<Brand, "installableApp" | "themeColor">): WebAppManifest | null {
  const app = brand.installableApp;
  if (!app) return null;
  return {
    id: APP_START_URL,
    name: app.name,
    short_name: app.shortName,
    description: `${app.name} for clinic staff: diary, patients, notes, billing and messages`,
    lang: "en-GB",
    dir: "ltr",
    start_url: APP_START_URL,
    scope: APP_SCOPE,
    display: "standalone",
    orientation: "any",
    theme_color: brand.themeColor,
    background_color: app.backgroundColor,
    icons: APP_ICONS.map((icon) => ({ ...icon })),
  };
}

/**
 * The installability criteria a browser checks on the manifest (Chrome's / Lighthouse's "installable manifest" audit):
 * a name or short name, a start URL inside the scope, a standalone-type display, and a 192px and a 512px PNG icon, plus a
 * maskable one for Android. Returns the unmet criteria (empty = installable as far as the manifest goes).
 */
export function installabilityProblems(manifest: Partial<WebAppManifest> | null | undefined): string[] {
  if (!manifest) return ["no manifest"];
  const problems: string[] = [];
  if (!manifest.name && !manifest.short_name) problems.push("name or short_name");
  if (manifest.short_name && manifest.short_name.length > 12) problems.push("short_name longer than 12 characters");
  if (!manifest.start_url) problems.push("start_url");
  if (!manifest.display || !["standalone", "fullscreen", "minimal-ui"].includes(manifest.display)) problems.push("display");
  const scope = manifest.scope ?? "/";
  if (manifest.start_url && !manifest.start_url.startsWith(scope)) problems.push("start_url outside scope");
  const icons = manifest.icons ?? [];
  const png = (size: string, purpose: string) =>
    icons.some((i) => i.type === "image/png" && i.sizes.split(/\s+/).includes(size) && (i.purpose ?? "any").split(/\s+/).includes(purpose));
  if (!png("192x192", "any")) problems.push("192x192 PNG icon");
  if (!png("512x512", "any")) problems.push("512x512 PNG icon");
  if (!png("512x512", "maskable")) problems.push("maskable 512x512 PNG icon");
  if (!manifest.theme_color) problems.push("theme_color");
  if (!manifest.background_color) problems.push("background_color");
  return problems;
}
