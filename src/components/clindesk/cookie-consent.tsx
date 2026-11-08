"use client";

/**
 * ClinDesk's cookie banner and cookie settings (clindesk.co.uk), in the site's own design (styles/consent.css). Mounted
 * once, first, in the site layout (src/app/clindesk-site/layout.tsx); the root layout's ClinForms banner renders
 * nothing on ClinDesk's hosts. The consent rules, cookie and events are shared with ClinForms
 * (src/components/consent). Since 08/11/2026: cookieless usage statistics are on by default for every visitor, with a
 * one-click "Turn off statistics" in the banner and a "Usage statistics" switch in the settings; the optional purposes
 * are analytics cookies (statistics may recognise a returning browser) and advertising measurement.
 *
 * - "Accept" and "Reject" look the same (same button style, same size, side by side); "Cookie settings" opens the
 *   settings, which the footer's "Cookie settings" link also opens from any page.
 * - Not shown when the browser sends Do Not Track / Global Privacy Control (treated as "no"), or before hydration
 *   (no server markup: without JavaScript nothing optional can load either).
 * - The settings are a native modal <dialog>: focus moves into it and stays there, Escape closes it, and focus returns
 *   to what opened it. While the banner shows, the page gets a bottom scroll-padding of its height (WCAG 2.4.11).
 */
import { useEffect, useId, useRef, useState } from "react";
import { useConsent } from "@/components/consent/use-consent";

export const CLINDESK_STATS_NOTICE = "We count visits and clicks to improve this website – no cookies, nothing stored on your device.";

export const CLINDESK_BANNER_TEXT =
  "We use the cookies this site needs to work. With your permission we’d also like to use analytics cookies, so those statistics can recognise a returning browser, and Google’s advertising cookies, to see whether our adverts lead to demo bookings.";

export function ClindeskCookieConsent() {
  const { mounted, choice, signalled, purposes, undecided, managing, setManaging, save, statsOn, setStats } = useConsent();
  const bannerRef = useRef<HTMLElement | null>(null);
  const showBanner = undecided;

  useEffect(() => {
    const el = bannerRef.current;
    if (!showBanner || !el) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.scrollPaddingBottom = `${Math.ceil(el.getBoundingClientRect().height) + 8}px`;
    };
    apply();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.scrollPaddingBottom = "";
    };
  }, [showBanner]);

  if (!mounted) return null;

  return (
    <div className="cd-site cd-consent-root">
      {showBanner ? (
        <section ref={bannerRef} className="cd-consent" aria-label="Cookie choices">
          <div className="cd-consent-card">
            {purposes.analytics ? (
              <p className="cd-consent-text">
                {statsOn ? CLINDESK_STATS_NOTICE : "Usage statistics are off."}{" "}
                <button type="button" className="cd-consent-manage" onClick={() => setStats(!statsOn)}>
                  {statsOn ? "Turn off statistics" : "Turn statistics back on"}
                </button>
              </p>
            ) : null}
            <p className="cd-consent-text">
              {CLINDESK_BANNER_TEXT}{" "}
              <a className="cd-consent-link" href="/cookies">
                Cookie policy
              </a>
            </p>
            <div className="cd-consent-actions">
              <button type="button" className="btn btn-pine cd-consent-btn" onClick={() => save({ analytics: true, ads: true })}>
                Accept
              </button>
              <button type="button" className="btn btn-pine cd-consent-btn" onClick={() => save({ analytics: false, ads: false })}>
                Reject
              </button>
              <button type="button" className="cd-consent-manage" onClick={() => setManaging(true)}>
                Cookie settings
              </button>
            </div>
          </div>
        </section>
      ) : null}
      <ClindeskCookieSettings
        open={managing}
        onClose={() => setManaging(false)}
        available={purposes.ads}
        statsAvailable={purposes.analytics}
        signalled={signalled}
        initialAds={choice?.ads ?? false}
        initialStats={statsOn}
        initialAnalytics={choice?.analytics ?? false}
        onSave={(ads, stats, analytics) => {
          save({ analytics: stats && analytics, ads });
          if (purposes.analytics && !signalled) setStats(stats);
        }}
      />
    </div>
  );
}

function ClindeskCookieSettings({
  open,
  onClose,
  available,
  statsAvailable,
  signalled,
  initialAds,
  initialStats,
  initialAnalytics,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  available: boolean;
  statsAvailable: boolean;
  signalled: boolean;
  initialAds: boolean;
  initialStats: boolean;
  initialAnalytics: boolean;
  onSave: (ads: boolean, stats: boolean, analytics: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const opener = useRef<Element | null>(null);
  const [ads, setAds] = useState(initialAds);
  const [stats, setStatsSwitch] = useState(initialStats);
  const [analytics, setAnalytics] = useState(initialAnalytics);
  const canChoose = available && !signalled;
  const canStats = statsAvailable && !signalled;
  const statsId = useId();
  const statsDescId = useId();
  const analyticsId = useId();
  const analyticsDescId = useId();
  const titleId = useId();
  const descId = useId();
  const switchId = useId();
  const switchDescId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      setAds(initialAds && canChoose);
      setStatsSwitch(initialStats && canStats);
      setAnalytics(initialAnalytics && canStats);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialAds, canChoose, initialStats, initialAnalytics, canStats]);

  // Escape (the dialog's own "cancel") and any other close: tell the parent, return focus to the opener.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onDialogClose = () => {
      onClose();
      const el = opener.current as HTMLElement | null;
      if (el && typeof el.focus === "function" && document.contains(el)) el.focus();
    };
    dialog.addEventListener("close", onDialogClose);
    return () => dialog.removeEventListener("close", onDialogClose);
  }, [onClose]);

  return (
    <dialog ref={ref} className="cd-cookie-dialog" aria-labelledby={titleId} aria-describedby={descId}>
      <h2 className="display-m cd-cookie-title" id={titleId}>
        Cookie settings
      </h2>
      <p className="cd-cookie-intro" id={descId}>
        Choose which cookies this site may use. You can change your mind at any time from the &ldquo;Cookie settings&rdquo;
        link at the bottom of every page.
      </p>
      <div className="cd-cookie-group">
        <div className="cd-cookie-row">
          <h3 className="cd-cookie-h">Strictly necessary</h3>
          <span className="cd-cookie-always">Always on</span>
        </div>
        <p className="cd-cookie-desc">
          Remember your cookie choice and keep clinic users signed in. The site cannot work without them.
        </p>
      </div>
      <div className="cd-cookie-group">
        <div className="cd-cookie-row">
          <label className="cd-cookie-h" htmlFor={statsId}>
            Usage statistics
          </label>
          <button
            id={statsId}
            type="button"
            role="switch"
            className="cd-switch"
            aria-checked={stats}
            aria-describedby={statsDescId}
            disabled={!canStats}
            onClick={() => {
              if (stats) setAnalytics(false);
              setStatsSwitch((v) => !v);
            }}
          >
            <span className="vh">{stats ? "On" : "Off"}</span>
            <span className="cd-switch-knob" aria-hidden="true" />
          </button>
        </div>
        <p className="cd-cookie-desc" id={statsDescId}>
          {!statsAvailable
            ? "This site does not count visits at the moment."
            : signalled
              ? "Your browser asks websites not to track you, so usage statistics stay off."
              : "On unless you turn it off. We count visits and clicks on this website to improve it – no cookies, nothing stored on your device, never used for advertising. Our provider (PostHog, EU) processes this for us only."}
        </p>
      </div>
      <div className="cd-cookie-group">
        <div className="cd-cookie-row">
          <label className="cd-cookie-h" htmlFor={analyticsId}>
            Analytics cookies
          </label>
          <button
            id={analyticsId}
            type="button"
            role="switch"
            className="cd-switch"
            aria-checked={analytics}
            aria-describedby={analyticsDescId}
            disabled={!canStats || !stats}
            onClick={() => setAnalytics((v) => !v)}
          >
            <span className="vh">{analytics ? "On" : "Off"}</span>
            <span className="cd-switch-knob" aria-hidden="true" />
          </button>
        </div>
        <p className="cd-cookie-desc" id={analyticsDescId}>
          {signalled
            ? "Your browser asks websites not to track you, so analytics stays off."
            : "Lets the statistics recognise this browser on a later visit (stored in your browser), without names, emails or any patient information. Stored in the EU."}
        </p>
      </div>
      <div className="cd-cookie-group">
        <div className="cd-cookie-row">
          <label className="cd-cookie-h" htmlFor={switchId}>
            Advertising
          </label>
          <button
            id={switchId}
            type="button"
            role="switch"
            className="cd-switch"
            aria-checked={ads}
            aria-describedby={switchDescId}
            disabled={!canChoose}
            onClick={() => setAds((v) => !v)}
          >
            <span className="vh">{ads ? "On" : "Off"}</span>
            <span className="cd-switch-knob" aria-hidden="true" />
          </button>
        </div>
        <p className="cd-cookie-desc" id={switchDescId}>
          {!available
            ? "This site does not use advertising cookies."
            : signalled
              ? "Your browser asks websites not to track you, so advertising cookies stay off."
              : "Google’s advertising cookies, on this website only, tell us whether people who clicked one of our adverts went on to book a demo. Nothing you type in our forms is sent, and they are never used in the application or on patient pages."}
        </p>
      </div>
      <div className="cd-cookie-actions">
        <button type="button" className="btn btn-outline cd-consent-btn" onClick={() => onSave(false, stats, false)}>
          Reject all cookies
        </button>
        <button type="button" className="btn btn-pine cd-consent-btn" onClick={() => onSave(canChoose && ads, stats, canStats && stats && analytics)}>
          Save choices
        </button>
      </div>
    </dialog>
  );
}
