"use client";

/**
 * On ClinDesk's /demo/thanks only: sends the "Demo request" conversion once when this tab's demo form was just sent
 * with advertising consent (src/components/ads/google-ads.ts reportDemoConversionFromNote). The page is reached only
 * through the server's redirect after it stored the request; opening it any other way sends nothing. Also records the
 * usage-statistics event `form_submitted` (demo_request) when this tab's form was just sent. Renders nothing.
 */
import { useEffect } from "react";
import { reportDemoConversionFromNote } from "@/components/ads/google-ads";
import { trackDemoFormAccepted } from "@/components/analytics/posthog";

export function DemoConversion() {
  useEffect(() => {
    reportDemoConversionFromNote();
    trackDemoFormAccepted();
  }, []);
  return null;
}
