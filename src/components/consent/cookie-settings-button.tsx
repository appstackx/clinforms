"use client";

/** Footer link that reopens the cookie settings dialog (ConsentBanner listens for the event). */
import { openConsentManager } from "./consent";

export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => openConsentManager()}>
      Cookie settings
    </button>
  );
}
