"use client";

/**
 * Mounted once in the root layout. Starts analytics when (and only when) the visitor's stored choice
 * allows it and NEXT_PUBLIC_POSTHOG_KEY is set, stops it when the choice is withdrawn, and records page
 * views of the public marketing pages. Renders nothing.
 */
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { analyticsAllowed, analyticsConfigured, browserPrivacySignals, browserStoredConsent, onConsentChange } from "../consent/consent";
import { shouldCapturePageview } from "./events";
import { capturePageview, startAnalytics, stopAnalytics } from "./posthog";

export function AnalyticsProvider() {
  const pathname = usePathname() ?? "/";
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!analyticsConfigured()) return;
    let cancelled = false;
    const apply = () => {
      if (analyticsAllowed(browserStoredConsent(), browserPrivacySignals())) {
        void startAnalytics().then((ph) => {
          if (!cancelled) setActive(Boolean(ph));
        });
      } else {
        stopAnalytics();
        setActive(false);
      }
    };
    apply();
    const unsubscribe = onConsentChange(apply);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (active && shouldCapturePageview(pathname)) capturePageview();
  }, [active, pathname]);

  return null;
}
