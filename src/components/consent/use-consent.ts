"use client";

/**
 * The cookie banner's state, shared by both sites' banners (ClinForms: consent-banner.tsx in the root layout; ClinDesk:
 * src/components/clindesk/cookie-consent.tsx in its site layout). Rendered after hydration only (no server markup),
 * so cached pages never show a stale banner.
 */
import { useCallback, useEffect, useState } from "react";
import {
  availablePurposes,
  browserPrivacySignals,
  browserSaveConsent,
  browserSetStats,
  browserStatsOptedOut,
  browserStoredConsent,
  onConsentManage,
  optOutSignalled,
  type ConsentChoice,
  type ConsentPurposes,
} from "./consent";

export interface ConsentControls {
  /** False until the first effect ran (render nothing before). */
  mounted: boolean;
  choice: ConsentChoice | null;
  /** The browser sends Do Not Track / Global Privacy Control: everything optional stays off, no banner. */
  signalled: boolean;
  /** What this page can offer (nothing → no banner). */
  purposes: ConsentPurposes;
  /** The banner should be shown (something to offer, no choice yet, no opt-out signal). Pages still decide where. */
  undecided: boolean;
  managing: boolean;
  setManaging: (open: boolean) => void;
  /** Saves a choice (only purposes this page offers can be "yes") and closes the settings. */
  save: (purposes: ConsentPurposes) => void;
  /**
   * Usage statistics (cookieless, on by default – not a consent purpose): on unless the visitor turned them off or the
   * browser sends an opt-out signal. `setStats(false)` is the one-click opt-out (also withdraws analytics cookies).
   */
  statsOn: boolean;
  setStats: (on: boolean) => void;
}

const NONE: ConsentPurposes = { analytics: false, ads: false };

export function useConsent(): ConsentControls {
  const [mounted, setMounted] = useState(false);
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [signalled, setSignalled] = useState(false);
  const [purposes, setPurposes] = useState<ConsentPurposes>(NONE);
  const [managing, setManaging] = useState(false);
  const [statsOptedOut, setStatsOptedOut] = useState(false);

  useEffect(() => {
    setChoice(browserStoredConsent());
    setStatsOptedOut(browserStatsOptedOut());
    setSignalled(optOutSignalled(browserPrivacySignals()));
    setPurposes(availablePurposes());
    setMounted(true);
    return onConsentManage(() => setManaging(true));
  }, []);

  const save = useCallback(
    (wanted: ConsentPurposes) => {
      setChoice(browserSaveConsent({ analytics: wanted.analytics && purposes.analytics, ads: wanted.ads && purposes.ads }));
      if (wanted.analytics && purposes.analytics) setStatsOptedOut(false);
      setManaging(false);
    },
    [purposes],
  );

  const setStats = useCallback((on: boolean) => {
    browserSetStats(on);
    setStatsOptedOut(!on);
    setChoice(browserStoredConsent());
  }, []);

  const offers = purposes.analytics || purposes.ads;
  const statsOn = purposes.analytics && !signalled && !statsOptedOut;
  return { mounted, choice, signalled, purposes, undecided: mounted && offers && !choice && !signalled, managing, setManaging, save, statsOn, setStats };
}
