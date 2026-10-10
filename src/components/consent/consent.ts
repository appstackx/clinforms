/**
 * Cookie consent: the visitor's choice is kept in ONE first-party, strictly necessary cookie,
 * `clinforms_consent` (6 months). Nothing optional (analytics) runs until it says "analytics allowed",
 * and a Do Not Track or Global Privacy Control signal from the browser counts as a refusal.
 *
 * The parse/serialise helpers are pure (tested in consent.test.ts); the `browser*` helpers touch
 * document.cookie / navigator and must only run in the browser (effects and event handlers).
 *
 * Cookie value: `v1.a1.20261009` – version, analytics allowed (a1) or refused (a0), date of the choice.
 */

export const CONSENT_COOKIE = "clinforms_consent";
/** 6 months, in seconds (the cookie's Max-Age). */
export const CONSENT_MAX_AGE_SECONDS = 182 * 24 * 60 * 60;
/** Bump to ask everyone again (e.g. when a new optional category is added). */
export const CONSENT_VERSION = 1;

/** Window events: a choice was saved / someone asked to reopen the cookie settings. */
export const CONSENT_CHANGE_EVENT = "clinforms:consent-change";
export const CONSENT_MANAGE_EVENT = "clinforms:consent-manage";

export interface ConsentChoice {
  version: number;
  analytics: boolean;
  /** Date of the choice, YYYY-MM-DD. */
  date: string;
}

const VALUE_PATTERN = /^v(\d{1,3})\.a([01])\.(\d{4})(\d{2})(\d{2})$/;

export function serializeConsent(choice: ConsentChoice): string {
  return `v${choice.version}.a${choice.analytics ? 1 : 0}.${choice.date.replace(/-/g, "")}`;
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
  const date = `${m[3]}-${m[4]}-${m[5]}`;
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return null;
  return { version, analytics: m[2] === "1", date };
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

/** Analytics may run only with a stored "allowed" choice and no opt-out signal. */
export function analyticsAllowed(choice: ConsentChoice | null, signals: PrivacySignals): boolean {
  return choice?.analytics === true && !optOutSignalled(signals);
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

/** Saves a choice in the consent cookie and tells the page (analytics starts or stops at once). */
export function browserSaveConsent(analytics: boolean): ConsentChoice {
  const choice: ConsentChoice = { version: CONSENT_VERSION, analytics, date: todayIso() };
  document.cookie = consentCookieString(choice, { secure: window.location.protocol === "https:" });
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: choice }));
  return choice;
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
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}
