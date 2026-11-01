"use client";

/**
 * On ClinDesk's /demo/thanks only: sends the "Demo request" conversion once when this tab's demo form was just sent
 * with advertising consent (src/components/ads/google-ads.ts reportDemoConversionFromNote). The page is reached only
 * through the server's redirect after it stored the request; opening it any other way sends nothing. Renders nothing.
 */
import { useEffect } from "react";
import { reportDemoConversionFromNote } from "@/components/ads/google-ads";

export function DemoConversion() {
  useEffect(() => {
    reportDemoConversionFromNote();
  }, []);
  return null;
}
