/**
 * Product analytics client (browser only). The analytics library is downloaded and started ONLY after
 * the visitor allows analytics in the cookie banner and only when NEXT_PUBLIC_POSTHOG_KEY is set; before
 * that nothing is loaded and nothing is sent.
 *
 * Settings: EU cloud through our own /ingest proxy (next.config.mjs rewrites), no autocapture, no session
 * recording, no heatmaps, no surveys, no remote configuration, no extra scripts, storage in localStorage
 * (no analytics cookies), and every event passes filterOutgoingEvent() (events.ts) before it is sent.
 * No request batching: each allowed event is sent when it is captured, so nothing captured while consent was
 * given is still queued (and sent on the next flush or on page unload) after the visitor withdraws it.
 *
 * Use `track(event, props)` for product events (allow-listed names and properties only).
 */
import type { PostHog } from "posthog-js";
import { filterOutgoingEvent, isAnalyticsEvent, sanitizeProps, type AnalyticsEvent, type AnalyticsProps, type OutgoingEvent } from "./events";

let instance: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;
/**
 * Our own record of the visitor's consent for this page. Every send path checks it (track, page views and
 * before_send), so nothing leaves after a withdrawal even though the library's own opt-out state is reset.
 */
let enabled = false;

function apiHost(): string {
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  return host && host.trim() ? host.trim().replace(/\/+$/, "") : "/ingest";
}

/** Starts analytics (idempotent). Resolves to null when analytics is not configured or fails to load. */
export function startAnalytics(): Promise<PostHog | null> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof window === "undefined") return Promise.resolve(null);
  enabled = true;
  if (instance) {
    // Consent given again after a withdrawal in this page: storage back on, then opt in.
    instance.set_config({ disable_persistence: false });
    if (instance.has_opted_out_capturing()) instance.opt_in_capturing({ captureEventName: false });
    return Promise.resolve(instance);
  }
  if (!loading) {
    const siteOrigin = window.location.origin;
    loading = import("posthog-js")
      .then(({ default: posthog }) => {
        posthog.init(key, {
          api_host: apiHost(),
          // Send each event at once: a batch queued before a withdrawal would otherwise leave after it.
          request_batching: false,
          ui_host: "https://eu.posthog.com",
          persistence: "localStorage",
          person_profiles: "identified_only",
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
          // Library logs in the browser console, for checking a setup (never set in production).
          debug: process.env.NEXT_PUBLIC_POSTHOG_DEBUG === "1",
          before_send: (event) => (enabled ? (filterOutgoingEvent(event as OutgoingEvent | null, siteOrigin) as typeof event) : null),
        });
        instance = posthog;
        // Consent withdrawn while the library was loading: stop at once.
        if (!enabled) stopAnalytics();
        return posthog;
      })
      .catch(() => {
        loading = null;
        return null;
      });
  }
  return loading;
}

/** Stops analytics after consent is withdrawn and removes what it stored in this browser. */
export function stopAnalytics(): void {
  enabled = false;
  if (instance) {
    try {
      // reset() first: it clears the library's consent state, so opting out must come after it.
      instance.reset();
      instance.opt_out_capturing();
      instance.set_config({ disable_persistence: true });
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
    if (enabled && ph && !ph.has_opted_out_capturing()) ph.capture(event, clean);
  };
  if (instance) send(instance);
  else if (loading) void loading.then(send);
}

/** Records a page view of the current page (the caller checks it is a public page). */
export function capturePageview(): void {
  if (enabled && instance && !instance.has_opted_out_capturing()) instance.capture("$pageview");
}
