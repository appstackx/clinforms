/**
 * Advertising measurement: the Google tag for the ClinDesk Google Ads account, and its ONE conversion, "Demo request".
 * Spec: companies/clindesk-growth/agents/google-ads/outputs/TRACKING-HANDOFF.md (Khuram, 31/10/2026).
 *
 * Rules (tested in google-ads.test.ts):
 * - PUBLIC website pages only, on both brands: ClinForms' site (src/app/(marketing)) and ClinDesk's site
 *   (src/app/clindesk-site). Never the app (/app), the public demo (/reports, /pms-sandbox), the sign-in pages
 *   (/login, /accept-invite …), a clinic's patient pages (/clinics) or the APIs. The tag component is mounted only in
 *   those two layouts, and AdsRouteGuard (root layout) reloads the page if a client-side navigation ever leaves them
 *   with the tag loaded, so a loaded tag never stays on an app page.
 * - Nothing is loaded from Google until the visitor accepts advertising cookies (consent.ts `ads`). When they do, the
 *   Consent Mode v2 defaults (all four signals denied) are queued FIRST, then the update to granted, then the tag's
 *   own set-up – so the tag never runs without a consent state. Withdrawing consent sends the update back to denied
 *   and removes the tag's first-party cookies (_gcl_*).
 * - The conversion is sent only by the two demo forms after the server accepted the request (reportDemoConversion),
 *   with send_to / value / currency and NOTHING else: no form values, names, emails or patient data, and no enhanced
 *   conversions (allow_enhanced_conversions: false; the forms are no longer on the page when it is sent).
 *
 * Pure helpers first (no window); browser helpers below must only run in effects and event handlers.
 */
import { brandForHost } from "@/lib/brand";
import { adsAllowed, adsAllowedOnHost, browserPrivacySignals, browserStoredConsent } from "@/components/consent/consent";

/** The Google tag (Google Ads account "ClinDesk", 167-279-0431). Not a secret: it is in every page that loads it. */
export const GOOGLE_ADS_TAG_ID = "AW-18548610866";

/** The "Demo request" conversion: exactly these parameters, nothing else. */
export const DEMO_CONVERSION = Object.freeze({
  send_to: "AW-18548610866/p4GXCKPR1K8dELKu1YxF",
  value: 1.0,
  currency: "GBP",
});

/** Cross-domain measurement between the two public sites (the tag's linker). */
export const LINKER_DOMAINS = Object.freeze(["clindesk.co.uk", "clinforms.co.uk"] as const);

export const GTAG_SCRIPT_SRC = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_TAG_ID}`;

/**
 * Public website pages, per site – the same lists as src/middleware.ts (PUBLIC_SITE_PATHS, CLINDESK_SITE_PATHS minus
 * the robots/sitemap files); google-ads.test.ts holds them equal. Kept here because the middleware module is not
 * browser code.
 */
export const CLINFORMS_TAG_PATHS = Object.freeze(["/", "/demo", "/privacy", "/cookies", "/terms", "/security", "/request-access"] as const);
export const CLINDESK_TAG_PATHS = Object.freeze([
  "/",
  "/features",
  "/reports",
  "/pricing",
  "/switching",
  "/security",
  "/demo",
  "/demo/thanks",
  "/tour",
  "/privacy",
  "/terms",
  "/cookies",
  "/accessibility",
] as const);

/** True only for a public website page of the host's own brand (on ClinForms' hosts /reports is the demo: no tag). */
export function adsTagAllowed(host: string | null | undefined, pathname: string): boolean {
  const brand = brandForHost(host);
  if (!brand.ads) return false;
  const paths: readonly string[] = brand.publicSite === "clindesk" ? CLINDESK_TAG_PATHS : CLINFORMS_TAG_PATHS;
  return paths.includes(pathname);
}

export type ConsentSignal = "granted" | "denied";
export interface ConsentSignals {
  ad_storage: ConsentSignal;
  ad_user_data: ConsentSignal;
  ad_personalization: ConsentSignal;
  analytics_storage: ConsentSignal;
}

/** Consent Mode v2: all four signals follow the visitor's advertising choice. */
export function consentSignals(granted: boolean): ConsentSignals {
  const v: ConsentSignal = granted ? "granted" : "denied";
  return { ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v };
}

/** The tag's set-up, in order: denied defaults → (granted update) → js → config. */
export function gtagSetupCommands(granted: boolean, now: Date = new Date()): unknown[][] {
  return [
    ["consent", "default", { ...consentSignals(false), wait_for_update: 500 }],
    ...(granted ? [["consent", "update", consentSignals(true)]] : []),
    ["js", now],
    ["config", GOOGLE_ADS_TAG_ID, { linker: { domains: [...LINKER_DOMAINS] }, allow_enhanced_conversions: false }],
  ];
}

/** First-party cookies the tag sets on our domain (removed when consent is withdrawn). */
export function isGoogleAdsCookie(name: string): boolean {
  return name.startsWith("_gcl_") || name.startsWith("_gac_");
}

/** Domain attributes a cookie for `host` may have been set with ("clindesk.co.uk" → ["clindesk.co.uk", "co.uk"]). */
export function cookieDomainCandidates(host: string): string[] {
  const labels = host.split(":")[0].toLowerCase().split(".").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join("."));
  return out;
}

/** sessionStorage key: "a demo form was just sent with advertising consent" (ClinDesk's form → its thank-you page). */
export const DEMO_SENT_KEY = "clindesk_demo_sent";
/** How long the thank-you page accepts that note (the redirect takes a second; 10 minutes is generous). */
export const DEMO_SENT_MAX_AGE_MS = 10 * 60 * 1000;

/** Whether a stored "demo sent" note (a millisecond timestamp) is fresh enough to count. */
export function demoSentNoteValid(value: string | null, now: number): boolean {
  if (!value || !/^\d{13}$/.test(value)) return false;
  const at = Number(value);
  return at <= now + 5_000 && now - at <= DEMO_SENT_MAX_AGE_MS;
}

// ---- browser-only helpers -------------------------------------------------------------------------

type Gtag = (...args: unknown[]) => void;
interface AdsWindow extends Window {
  dataLayer?: unknown[];
  gtag?: Gtag;
  /** Set once the tag's set-up has been queued (the script itself is rendered by GoogleAdsTag). */
  __clinformsAdsTag?: { granted: boolean };
}

function adsWindow(): AdsWindow | null {
  return typeof window === "undefined" ? null : (window as AdsWindow);
}

/** The visitor allowed advertising cookies, the browser sends no opt-out signal, and this is a tag page. */
export function adsActiveHere(): boolean {
  const w = adsWindow();
  if (!w) return false;
  return (
    adsAllowedOnHost(w.location.host) &&
    adsTagAllowed(w.location.host, w.location.pathname) &&
    adsAllowed(browserStoredConsent(), browserPrivacySignals())
  );
}

/** Whether the tag's set-up has run in this page (then its script is, or is being, loaded). */
export function adsTagStarted(): boolean {
  return Boolean(adsWindow()?.__clinformsAdsTag);
}

/**
 * Queues the tag's set-up with consent granted (idempotent; afterwards only the consent update is sent). Call only
 * when adsActiveHere() – GoogleAdsTag then renders the script.
 */
export function grantAds(): void {
  const w = adsWindow();
  if (!w) return;
  if (!w.gtag) {
    w.dataLayer = w.dataLayer || [];
    // gtag.js reads the `arguments` object itself – pushing an array does not work.
    w.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer!.push(arguments);
    };
  }
  if (!w.__clinformsAdsTag) {
    for (const command of gtagSetupCommands(true)) w.gtag(...command);
    w.__clinformsAdsTag = { granted: true };
    return;
  }
  if (!w.__clinformsAdsTag.granted) {
    w.gtag("consent", "update", consentSignals(true));
    w.__clinformsAdsTag.granted = true;
  }
}

/** Consent withdrawn (or refused): signals back to denied if the tag is in the page, and its cookies removed. */
export function revokeAds(): void {
  const w = adsWindow();
  if (!w) return;
  if (w.gtag && w.__clinformsAdsTag?.granted) {
    w.gtag("consent", "update", consentSignals(false));
    w.__clinformsAdsTag.granted = false;
  }
  clearGoogleAdsCookies();
}

/** Removes the tag's first-party cookies, whatever Domain attribute they were set with. */
export function clearGoogleAdsCookies(): void {
  const w = adsWindow();
  if (!w) return;
  const names = w.document.cookie
    .split(";")
    .map((part) => part.split("=")[0]?.trim())
    .filter((name): name is string => Boolean(name) && isGoogleAdsCookie(name));
  for (const name of names) {
    w.document.cookie = `${name}=; Max-Age=0; Path=/`;
    for (const domain of cookieDomainCandidates(w.location.hostname)) {
      w.document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${domain}`;
    }
  }
}

/**
 * Sends the "Demo request" conversion – call ONLY after the server accepted a demo / access request, once per
 * accepted submission. A no-op without advertising consent or off the tag's pages. Returns whether it was sent.
 */
export function reportDemoConversion(): boolean {
  if (!adsActiveHere()) return false;
  grantAds();
  const w = adsWindow();
  if (!w?.gtag) return false;
  w.gtag("event", "conversion", { ...DEMO_CONVERSION });
  return true;
}

function sessionStore(): Storage | null {
  try {
    return adsWindow()?.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** ClinDesk's form, on submit: note (only with advertising consent) that a demo request is on its way. */
export function noteDemoSent(): void {
  if (!adsActiveHere()) return;
  try {
    sessionStore()?.setItem(DEMO_SENT_KEY, String(Date.now()));
  } catch {
    // storage unavailable: no conversion, nothing else changes
  }
}

/** ClinDesk's form, when the server answered with errors instead: forget the note. */
export function forgetDemoSent(): void {
  try {
    sessionStore()?.removeItem(DEMO_SENT_KEY);
  } catch {
    // ignore
  }
}

/**
 * ClinDesk's thank-you page (reached only through the server's redirect after it stored the request): sends the
 * conversion once if the form left a fresh note in this tab. The note is removed first, so a reload, a second effect
 * run or a later visit never counts again.
 */
export function reportDemoConversionFromNote(now: number = Date.now()): boolean {
  const store = sessionStore();
  let value: string | null = null;
  try {
    value = store?.getItem(DEMO_SENT_KEY) ?? null;
    store?.removeItem(DEMO_SENT_KEY);
  } catch {
    return false;
  }
  if (!demoSentNoteValid(value, now)) return false;
  return reportDemoConversion();
}
