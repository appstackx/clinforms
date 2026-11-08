/**
 * Cookie consent: the visitor's choice is kept in ONE first-party, strictly necessary cookie,
 * `clinforms_consent` (6 months, host-only – clinforms.co.uk and clindesk.co.uk each keep their own). Nothing optional
 * runs until it says so, and a Do Not Track or Global Privacy Control signal from the browser counts as a refusal.
 *
 * Usage statistics (08/11/2026) are NOT a consent purpose: under the statistical-purposes exemption (PECR Schedule A1,
 * Data (Use and Access) Act 2025, in force 5 Feb 2026) the EU product analytics counts visits to both brands' PUBLIC
 * website pages for every visitor, with no device storage, unless the visitor turns it off (one click, in the banner,
 * the cookie settings or /cookies) or the browser sends Do Not Track / Global Privacy Control. The opt-out is kept in a
 * second strictly necessary cookie, `clinforms_stats` = "off" (12 months, host-only).
 *
 * Two optional purposes, each its own yes/no:
 * - analytics: lets the statistics remember this browser between visits (device storage, localStorage) and count the
 *   few product actions in the app (src/components/analytics), when configured;
 * - ads: the advertising measurement tag (src/components/ads), on both brands' PUBLIC website pages only.
 *
 * The parse/serialise helpers are pure (tested in consent.test.ts); the `browser*` helpers touch
 * document.cookie / navigator and must only run in the browser (effects and event handlers).
 *
 * Cookie value: `v2.a1.m0.20261031` – version, analytics allowed (a1) or refused (a0), advertising measurement allowed
 * (m1) or refused (m0), date of the choice. Version 1 (`v1.a1.20261009`, analytics only) is read as "no choice", so
 * everyone is asked again now that a new purpose exists.
 */
import { brandForHost } from "@/lib/brand";

export const CONSENT_COOKIE = "clinforms_consent";
/** 6 months, in seconds (the cookie's Max-Age). */
export const CONSENT_MAX_AGE_SECONDS = 182 * 24 * 60 * 60;
/** Bump to ask everyone again (e.g. when a new optional category is added). 2 = advertising measurement added. */
export const CONSENT_VERSION = 2;

/** Window events: a choice was saved / someone asked to reopen the cookie settings. */
export const CONSENT_CHANGE_EVENT = "clinforms:consent-change";
export const CONSENT_MANAGE_EVENT = "clinforms:consent-manage";

export interface ConsentChoice {
  version: number;
  analytics: boolean;
  /** Advertising measurement (the ads tag on the public website pages). */
  ads: boolean;
  /** Date of the choice, YYYY-MM-DD. */
  date: string;
}

/** The optional purposes a visitor chooses (what the banner's buttons and the settings switches save). */
export interface ConsentPurposes {
  analytics: boolean;
  ads: boolean;
}

const VALUE_PATTERN = /^v(\d{1,3})\.a([01])\.m([01])\.(\d{4})(\d{2})(\d{2})$/;

export function serializeConsent(choice: ConsentChoice): string {
  return `v${choice.version}.a${choice.analytics ? 1 : 0}.m${choice.ads ? 1 : 0}.${choice.date.replace(/-/g, "")}`;
}

/** The stored choice, or null when missing, malformed or from an older consent version. */
export function parseConsent(value: string | null | undefined): ConsentChoice | null {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const m = VALUE_PATTERN.exec(decoded.trim());
  if (!m) return null;
  const version = Number(m[1]);
  if (version !== CONSENT_VERSION) return null;
  const date = `${m[4]}-${m[5]}-${m[6]}`;
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return null;
  return { version, analytics: m[2] === "1", ads: m[3] === "1", date };
}

/** Reads the consent cookie from a Cookie header / document.cookie string. */
export function readConsentFromCookieString(cookieString: string | null | undefined): ConsentChoice | null {
  if (!cookieString) return null;
  for (const part of cookieString.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === CONSENT_COOKIE) return parseConsent(part.slice(eq + 1).trim());
  }
  return null;
}

/** The Set-Cookie / document.cookie string that stores a choice (first-party, Lax, Secure on https). */
export function consentCookieString(choice: ConsentChoice, options: { secure: boolean }): string {
  return [
    `${CONSENT_COOKIE}=${serializeConsent(choice)}`,
    `Max-Age=${CONSENT_MAX_AGE_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** What the browser tells sites about tracking (subset of Navigator / Window). */
export interface PrivacySignals {
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
  windowDoNotTrack?: string | null;
}

/** True when the browser sends Do Not Track or Global Privacy Control: treated as "analytics refused". */
export function optOutSignalled(signals: PrivacySignals): boolean {
  const dnt = (v: string | null | undefined) => v === "1" || v === "yes";
  return signals.globalPrivacyControl === true || dnt(signals.doNotTrack) || dnt(signals.windowDoNotTrack);
}

/** Analytics with device storage may run only with a stored "allowed" choice and no opt-out signal. */
export function analyticsAllowed(choice: ConsentChoice | null, signals: PrivacySignals): boolean {
  return choice?.analytics === true && !optOutSignalled(signals);
}

/** The advertising measurement tag may load only with a stored "allowed" choice and no opt-out signal. */
export function adsAllowed(choice: ConsentChoice | null, signals: PrivacySignals): boolean {
  return choice?.ads === true && !optOutSignalled(signals);
}

// ---- usage statistics (opt-out) --------------------------------------------------------------------

/** The strictly necessary opt-out cookie for usage statistics ("off"); no cookie = statistics on. */
export const STATS_COOKIE = "clinforms_stats";
/** 12 months, in seconds. */
export const STATS_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Whether a Cookie header / document.cookie string carries the statistics opt-out. */
export function statsOptedOutInCookieString(cookieString: string | null | undefined): boolean {
  if (!cookieString) return false;
  for (const part of cookieString.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === STATS_COOKIE) return part.slice(eq + 1).trim() === "off";
  }
  return false;
}

/** The document.cookie string that stores (off) or removes (on) the statistics opt-out. */
export function statsCookieString(on: boolean, options: { secure: boolean }): string {
  return [
    `${STATS_COOKIE}=${on ? "" : "off"}`,
    `Max-Age=${on ? 0 : STATS_MAX_AGE_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

/** Usage statistics run unless the visitor turned them off or the browser sends an opt-out signal. */
export function statsAllowed(optedOut: boolean, signals: PrivacySignals): boolean {
  return !optedOut && !optOutSignalled(signals);
}

/**
 * What the analytics may do on this page:
 * - "off": nothing loads, nothing is sent (statistics turned off, an opt-out signal, or a page without statistics and
 *   no cookie consent);
 * - "stats": cookieless usage statistics (memory only, no device storage) – public website pages only;
 * - "full": the visitor allowed analytics cookies: statistics remember this browser (localStorage), on every page that
 *   records events (as before 08/11/2026).
 * Turning statistics off wins over an earlier "allow analytics cookies".
 */
export type AnalyticsMode = "off" | "stats" | "full";

export function analyticsMode(input: { choice: ConsentChoice | null; signals: PrivacySignals; statsOptedOut: boolean; statsPage: boolean }): AnalyticsMode {
  if (!statsAllowed(input.statsOptedOut, input.signals)) return "off";
  if (analyticsAllowed(input.choice, input.signals)) return "full";
  return input.statsPage ? "stats" : "off";
}

// ---- browser-only helpers -------------------------------------------------------------------------

export function browserPrivacySignals(): PrivacySignals {
  if (typeof navigator === "undefined") return {};
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const win = typeof window === "undefined" ? undefined : (window as Window & { doNotTrack?: string });
  return {
    doNotTrack: nav.doNotTrack ?? nav.msDoNotTrack ?? null,
    globalPrivacyControl: nav.globalPrivacyControl === true,
    windowDoNotTrack: win?.doNotTrack ?? null,
  };
}

export function browserStoredConsent(): ConsentChoice | null {
  if (typeof document === "undefined") return null;
  return readConsentFromCookieString(document.cookie);
}

/** Saves a choice in the consent cookie and tells the page (analytics and the ads tag start or stop at once). */
export function browserSaveConsent(purposes: ConsentPurposes): ConsentChoice {
  const choice: ConsentChoice = { version: CONSENT_VERSION, analytics: purposes.analytics, ads: purposes.ads, date: todayIso() };
  document.cookie = consentCookieString(choice, { secure: window.location.protocol === "https:" });
  // Allowing analytics cookies turns usage statistics back on.
  if (choice.analytics) document.cookie = statsCookieString(true, { secure: window.location.protocol === "https:" });
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: choice }));
  return choice;
}

export function browserStatsOptedOut(): boolean {
  if (typeof document === "undefined") return false;
  return statsOptedOutInCookieString(document.cookie);
}

/**
 * Turns usage statistics on or off (one click; the analytics stops and clears its storage at once). Turning them off
 * also withdraws an earlier "allow analytics cookies".
 */
export function browserSetStats(on: boolean): void {
  document.cookie = statsCookieString(on, { secure: window.location.protocol === "https:" });
  if (!on) {
    const stored = browserStoredConsent();
    if (stored?.analytics) {
      const choice: ConsentChoice = { ...stored, analytics: false, date: todayIso() };
      document.cookie = consentCookieString(choice, { secure: window.location.protocol === "https:" });
    }
  }
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT));
}

export function onConsentChange(listener: () => void): () => void {
  window.addEventListener(CONSENT_CHANGE_EVENT, listener);
  return () => window.removeEventListener(CONSENT_CHANGE_EVENT, listener);
}

/** Reopens the cookie settings (footer link). */
export function openConsentManager(): void {
  window.dispatchEvent(new CustomEvent(CONSENT_MANAGE_EVENT));
}

export function onConsentManage(listener: () => void): () => void {
  window.addEventListener(CONSENT_MANAGE_EVENT, listener);
  return () => window.removeEventListener(CONSENT_MANAGE_EVENT, listener);
}

/** Analytics is configured for this build (NEXT_PUBLIC_POSTHOG_KEY is inlined at build time). */
export function analyticsConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY) && analyticsAllowedOnHost(typeof window === "undefined" ? null : window.location.host);
}

/** Whether this host's brand uses product analytics at all (src/lib/brand.ts; both brands since 08/11/2026). */
export function analyticsAllowedOnHost(host: string | null): boolean {
  return brandForHost(host).analytics;
}

/** Whether this host's brand may load the advertising measurement tag on its public website pages (both brands). */
export function adsAllowedOnHost(host: string | null): boolean {
  return brandForHost(host).ads;
}

/** The optional purposes this page can offer (what the banner asks about and the settings dialog switches). */
export function availablePurposes(): ConsentPurposes {
  const host = typeof window === "undefined" ? null : window.location.host;
  return { analytics: analyticsConfigured(), ads: adsAllowedOnHost(host) };
}
