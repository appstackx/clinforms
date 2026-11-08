"use client";

/**
 * Mounted once in the root layout. Decides the analytics mode for this page (consent.ts analyticsMode):
 * - cookieless usage statistics on the public website pages for every visitor who has not turned them off (no device
 *   storage), or analytics with localStorage once the visitor allowed analytics cookies;
 * - nothing at all when statistics are turned off, the browser sends Do Not Track / Global Privacy Control, or the
 *   page is the app, the demo Studio, sign-in, patient pages or an API (unless cookies were allowed, as before).
 * Records page views of the public website pages, and the website's call-to-action clicks, form starts and links
 * between the two brands' sites (one delegated listener each; never a form value). Renders nothing.
 */
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { analyticsConfigured, analyticsMode, browserPrivacySignals, browserStatsOptedOut, browserStoredConsent, onConsentChange } from "../consent/consent";
import { crossSiteTarget, ctaTarget, shouldCapturePageview } from "./events";
import { capturePageview, startAnalytics, stopAnalytics, track } from "./posthog";

/** Forms whose start is recorded: `<form data-analytics-form="request_access">` (events.ts TOKEN_PROPS.form). */
const FORM_ATTR = "data-analytics-form";

export function AnalyticsProvider() {
  const pathname = usePathname() ?? "/";
  const [active, setActive] = useState(false);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const [consentTick, setConsentTick] = useState(0);

  useEffect(() => onConsentChange(() => setConsentTick((n) => n + 1)), []);

  useEffect(() => {
    if (!analyticsConfigured()) return;
    let cancelled = false;
    const mode = analyticsMode({
      choice: browserStoredConsent(),
      signals: browserPrivacySignals(),
      statsOptedOut: browserStatsOptedOut(),
      statsPage: shouldCapturePageview(pathname, window.location.host),
    });
    if (mode === "off") {
      stopAnalytics();
      setActive(false);
    } else {
      void startAnalytics(mode).then((ph) => {
        if (!cancelled) setActive(Boolean(ph));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [pathname, consentTick]);

  useEffect(() => {
    if (active && shouldCapturePageview(pathname, window.location.host)) capturePageview();
  }, [active, pathname]);

  // Website clicks and form starts (track() is a no-op while analytics is off).
  useEffect(() => {
    if (!active) return;
    const started = new Set<string>();
    const onClick = (e: MouseEvent) => {
      if (!shouldCapturePageview(pathRef.current, window.location.host)) return;
      const el = (e.target as Element | null)?.closest?.("a[href], [data-cta]");
      if (!el) return;
      const href = el.getAttribute("href") ?? "";
      const cta = ctaTarget(href, window.location.origin, el.getAttribute("data-cta"));
      if (cta) track("cta_clicked", { area: "marketing", cta_target: cta });
      const other = href ? crossSiteTarget(new URL(href, window.location.href).toString(), window.location.host) : null;
      if (other) track("cross_site_clicked", { area: "marketing", to_site: other });
    };
    const onFocus = (e: FocusEvent) => {
      const form = (e.target as Element | null)?.closest?.(`form[${FORM_ATTR}]`);
      const name = form?.getAttribute(FORM_ATTR);
      if (!name || started.has(name)) return;
      started.add(name);
      track("form_started", { area: "marketing", form: name as "request_access" | "demo_request" });
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("focusin", onFocus, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("focusin", onFocus, true);
    };
  }, [active, pathname]);

  return null;
}
