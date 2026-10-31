"use client";

/**
 * The Google tag, mounted ONLY in the two public website layouts (src/app/(marketing)/layout.tsx and
 * src/app/clindesk-site/layout.tsx – google-ads.test.ts fails if any other file mounts it). It loads nothing until the
 * visitor accepts advertising cookies on this site; then it queues the consent defaults and the set-up
 * (google-ads.ts grantAds) and renders the script. Withdrawing consent sets the signals back to denied and removes the
 * tag's cookies (the script already in the page stays, idle; the next page load has none). Renders nothing else.
 */
import Script from "next/script";
import { useEffect, useState } from "react";
import { onConsentChange } from "@/components/consent/consent";
import { GTAG_SCRIPT_SRC, adsActiveHere, adsTagStarted, grantAds, revokeAds } from "./google-ads";

export function GoogleAdsTag() {
  const [load, setLoad] = useState(false);

  useEffect(() => {
    const apply = () => {
      if (adsActiveHere()) {
        grantAds();
        setLoad(true);
      } else {
        revokeAds();
        // Keep the script element once it was rendered (removing it does not unload the tag).
        setLoad(adsTagStarted());
      }
    };
    apply();
    return onConsentChange(apply);
  }, []);

  return load ? <Script id="google-ads-tag" src={GTAG_SCRIPT_SRC} strategy="afterInteractive" /> : null;
}
