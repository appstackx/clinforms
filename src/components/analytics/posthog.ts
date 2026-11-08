/**
 * Product analytics client (browser only), only when NEXT_PUBLIC_POSTHOG_KEY is set. Two modes (consent.ts
 * analyticsMode, chosen by analytics-provider.tsx):
 * - "stats": cookieless usage statistics on the public website pages for every visitor who has not turned them off
 *   (PECR Sched. A1 statistical purposes) – persistence "memory": no cookies, no localStorage, nothing kept after the
 *   page closes; only STATS_EVENTS leave;
 * - "full": the visitor allowed analytics cookies – the same library switches to localStorage persistence and every
 *   allow-listed event may be sent.
 *
 * Settings: EU cloud through our own /ingest proxy (next.config.mjs rewrites), no autocapture, no session
 * recording, no heatmaps, no surveys, no remote configuration, no extra scripts, never analytics cookies, and every
 * event passes filterOutgoingEvent() (events.ts) before it is sent.
 * No request batching: each allowed event is sent when it is captured, so nothing captured while consent was
 * given is still queued (and sent on the next flush or on page unload) after the visitor withdraws it.
 *
 * Use `track(event, props)` for product events (allow-listed names and properties only).
 */
import type { PostHog } from "posthog-js";
import { filterOutgoingEvent, hasGclid, isAnalyticsEvent, isStatsEvent, sanitizeProps, type AnalyticsEvent, type AnalyticsProps, type OutgoingEvent } from "./events";

let instance: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;
/**
 * Our own record of the visitor's consent for this page. Every send path checks it (track, page views and
 * before_send), so nothing leaves after a withdrawal even though the library's own opt-out state is reset.
 */
let enabled = false;
/** True while running cookieless statistics (no consent): memory persistence and STATS_EVENTS only. */
let statsOnly = true;

/** "stats" → memory persistence (no device storage); "full" → localStorage (after cookie consent). */
export type StartMode = "stats" | "full";

export function persistenceFor(mode: StartMode): "memory" | "localStorage" {
  return mode === "full" ? "localStorage" : "memory";
}

/** The library's init options (pure; tested in posthog.test.ts). */
export function posthogInitConfig(mode: StartMode, apiHostValue: string) {
  return {
    api_host: apiHostValue,
    // Send each event at once: a batch queued before a withdrawal would otherwise leave after it.
    request_batching: false,
    ui_host: "https://eu.posthog.com",
    persistence: persistenceFor(mode),
    person_profiles: "identified_only" as const,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    rageclick: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    mask_personal_data_properties: true,
    respect_dnt: true,
  };
}

function apiHost(): string {
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  return host && host.trim() ? host.trim().replace(/\/+$/, "") : "/ingest";
}

/**
 * Starts analytics in `mode` (idempotent; switches mode when called again). Resolves to null when analytics is not
 * configured or fails to load.
 */
export function startAnalytics(mode: StartMode = "full"): Promise<PostHog | null> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof window === "undefined") return Promise.resolve(null);
  enabled = true;
  statsOnly = mode === "stats";
  if (instance) {
    // Mode change, or started again after a stop in this page: storage per mode, then opt in.
    if (mode === "stats") clearAnalyticsStorage();
    instance.set_config({ disable_persistence: false, persistence: persistenceFor(mode) });
    // The library's own opt-in is stored in localStorage: only with cookie consent.
    if (mode === "full" && instance.has_opted_out_capturing()) instance.opt_in_capturing({ captureEventName: false });
    return Promise.resolve(instance);
  }
  if (!loading) {
    const siteOrigin = window.location.origin;
    const initialMode = mode;
    // Cookieless: remove anything an earlier visit left (e.g. a stored opt-out), so nothing is read or kept.
    if (mode === "stats") clearAnalyticsStorage();
    loading = import("posthog-js")
      .then(({ default: posthog }) => {
        posthog.init(key, {
          ...posthogInitConfig(initialMode, apiHost()),
          // Library logs in the browser console, for checking a setup (never set in production).
          debug: process.env.NEXT_PUBLIC_POSTHOG_DEBUG === "1",
          before_send: (event) =>
            enabled ? (filterOutgoingEvent(event as OutgoingEvent | null, siteOrigin, { statsOnly }) as typeof event) : null,
        });
        instance = posthog;
        if (initialMode === "full" && posthog.has_opted_out_capturing()) posthog.opt_in_capturing({ captureEventName: false });
        // Stopped while the library was loading: stop at once; mode changed meanwhile: apply it.
        if (!enabled) stopAnalytics();
        else if (persistenceFor(statsOnly ? "stats" : "full") !== persistenceFor(initialMode)) {
          posthog.set_config({ persistence: persistenceFor(statsOnly ? "stats" : "full") });
        }
        return posthog;
      })
      .catch(() => {
        loading = null;
        return null;
      });
  }
  return loading;
}

/** Stops analytics (statistics turned off, consent withdrawn, or a page without statistics) and removes what it stored in this browser. */
export function stopAnalytics(): void {
  enabled = false;
  if (instance) {
    try {
      // No library opt-out (it would write to localStorage): our `enabled` flag makes before_send drop everything.
      instance.reset();
      instance.set_config({ disable_persistence: true, persistence: "memory" });
    } catch {
      // ignore: storage may be unavailable
    }
  }
  clearAnalyticsStorage();
}

/** Removes the analytics library's localStorage / sessionStorage entries and cookies (ph_* / __ph_*). */
export function clearAnalyticsStorage(): void {
  if (typeof window === "undefined") return;
  const isOurs = (key: string) => key.startsWith("ph_") || key.startsWith("__ph");
  for (const store of [safeStorage("localStorage"), safeStorage("sessionStorage")]) {
    if (!store) continue;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && isOurs(key)) keys.push(key);
    }
    keys.forEach((key) => store.removeItem(key));
  }
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name && isOurs(name)) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }
}

function safeStorage(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

/**
 * Records one product event (allow-listed name and properties only; anything else is dropped).
 * A no-op until the visitor has allowed analytics.
 */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (!isAnalyticsEvent(event)) return;
  const clean = sanitizeProps(props);
  const send = (ph: PostHog | null) => {
    // Clicks that leave the page (plain links) go by beacon, so the request survives the navigation.
    const leaving = event === "cta_clicked" || event === "cross_site_clicked";
    if (enabled && ph && (!statsOnly || isStatsEvent(event))) ph.capture(event, clean, leaving ? { transport: "sendBeacon" } : undefined);
  };
  if (instance) send(instance);
  else if (loading) void loading.then(send);
}

/** Records a page view of the current page (the caller checks it is a public page): UTM via the URL, has_gclid only. */
export function capturePageview(): void {
  if (enabled && instance) {
    instance.capture("$pageview", { has_gclid: hasGclid(window.location.search) });
  }
}

/** Whether analytics is currently running (any mode). */
export function analyticsRunning(): boolean {
  return enabled;
}

/**
 * ClinDesk's demo form posts to a server action that redirects to /demo/thanks only once the request is stored. The
 * form notes the submit here, in memory only (the redirect is a client navigation, so the note survives it, and no
 * device storage is used); the thank-you page then records `form_submitted` once if the note is fresh.
 */
let demoSubmitAt = 0;

export function noteDemoFormSubmit(): void {
  demoSubmitAt = Date.now();
}

export function trackDemoFormAccepted(now: number = Date.now()): void {
  const at = demoSubmitAt;
  demoSubmitAt = 0;
  if (at && now - at <= 10 * 60 * 1000) track("form_submitted", { area: "marketing", form: "demo_request" });
}
