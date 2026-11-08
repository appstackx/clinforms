"use client";

/**
 * /cookies on both sites: the one-click switch for the cookieless usage statistics (on by default). Shows the current
 * state after hydration; one click turns the statistics off (or back on) at once (consent.ts browserSetStats).
 */
import { useEffect, useState } from "react";
import { browserPrivacySignals, browserSetStats, browserStatsOptedOut, onConsentChange, optOutSignalled } from "./consent";

export function StatsToggle({ className }: { className?: string }) {
  const [state, setState] = useState<"loading" | "on" | "off" | "signalled">("loading");

  useEffect(() => {
    const read = () => setState(optOutSignalled(browserPrivacySignals()) ? "signalled" : browserStatsOptedOut() ? "off" : "on");
    read();
    return onConsentChange(read);
  }, []);

  if (state === "loading") return null;
  if (state === "signalled") {
    return <span>Your browser sends a Do Not Track or Global Privacy Control signal, so usage statistics are off.</span>;
  }
  return (
    <span>
      Usage statistics are <strong>{state}</strong> in this browser.{" "}
      <button type="button" className={className} onClick={() => browserSetStats(state === "off")}>
        {state === "on" ? "Turn off usage statistics" : "Turn usage statistics back on"}
      </button>
    </span>
  );
}
