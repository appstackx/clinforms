"use client";

/**
 * ClinForms' cookie banner and cookie settings dialog (mounted once in the root layout). ClinDesk's hosts get their
 * own, in ClinDesk's design (src/components/clindesk/cookie-consent.tsx, mounted in its site layout), so this one
 * renders nothing there.
 *
 * - Shown only when this page has something optional to offer (product analytics when NEXT_PUBLIC_POSTHOG_KEY is set;
 *   advertising measurement – src/components/ads), the visitor has not chosen yet, the browser sends no Do Not Track /
 *   Global Privacy Control signal, and the page is not part of the app, the sign-in pages, the public demo or the APIs
 *   (those respect a choice made elsewhere but never ask).
 * - "Accept" and "Reject" have equal weight; "Manage" opens the settings dialog (one switch per purpose), which the
 *   footer's "Cookie settings" link also opens from any page.
 * - Rendered after hydration only (no server markup), so cached pages never show a stale banner.
 * - Keyboard: mounted FIRST in <body> (the first Tab reaches it, before the skip link); while it shows, the page gets
 *   a bottom scroll-padding of its height so a focused element is never hidden behind it; it stays mounted while
 *   "Manage" is open, so closing the dialog returns focus to the Manage button.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Cookie } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { brandForHost } from "@/lib/brand";
import { showsConsentBanner } from "@/lib/site";
import type { ConsentPurposes } from "./consent";
import { useConsent } from "./use-consent";

const buttonBase =
  "inline-flex h-10 items-center justify-center rounded-lg px-3 text-sm font-semibold sm:px-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2";
const primaryButton = `${buttonBase} bg-teal-700 text-white hover:bg-teal-800`;
const secondaryButton = `${buttonBase} border border-slate-300 bg-white text-slate-900 hover:bg-slate-50`;

/** What the banner asks for, in words, for the purposes this page offers. */
export function bannerAsk(purposes: ConsentPurposes): string {
  const parts = [
    ...(purposes.analytics ? ["analytics to see which pages are useful"] : []),
    ...(purposes.ads ? ["Google’s advertising cookies to see whether our adverts lead to requests for access"] : []),
  ];
  return `We use strictly necessary cookies to run this site. With your permission we would also like to use ${parts.join(", and ")}.`;
}

export function ConsentBanner() {
  const pathname = usePathname() ?? "/";
  const { mounted, choice, signalled, purposes, undecided, managing, setManaging, save } = useConsent();
  const [otherSite, setOtherSite] = useState(false);
  useEffect(() => setOtherSite(brandForHost(window.location.host).publicSite === "clindesk"), []);

  const showBanner = undecided && !otherSite && showsConsentBanner(pathname);
  const bannerRef = useRef<HTMLElement | null>(null);

  // Keep focused elements clear of the fixed banner (WCAG 2.4.11): scroll-padding-bottom = the banner's height.
  useEffect(() => {
    const el = bannerRef.current;
    if (!showBanner || !el) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.scrollPaddingBottom = `${Math.ceil(el.getBoundingClientRect().height)}px`;
    };
    apply();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.scrollPaddingBottom = "";
    };
  }, [showBanner]);

  if (!mounted || otherSite) return null;

  return (
    <>
      {showBanner ? (
        <section ref={bannerRef} aria-label="Cookie choices" className="fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-xl sm:flex-row sm:items-center sm:gap-5 sm:p-5">
            <div className="flex min-w-0 flex-1 gap-3">
              <Cookie className="mt-0.5 hidden h-5 w-5 shrink-0 text-teal-700 sm:block" aria-hidden />
              <p>
                {bannerAsk(purposes)}{" "}
                <Link href="/cookies" className="font-medium text-teal-800 underline underline-offset-2 hover:text-teal-900">
                  Cookie policy
                </Link>
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5 sm:gap-2">
              <button type="button" className={primaryButton} onClick={() => save({ analytics: true, ads: true })}>
                Accept
              </button>
              <button type="button" className={primaryButton} onClick={() => save({ analytics: false, ads: false })}>
                Reject
              </button>
              <button type="button" className={`${buttonBase} !px-2 text-teal-800 underline underline-offset-2 hover:text-teal-900`} onClick={() => setManaging(true)}>
                Manage
              </button>
            </div>
          </div>
        </section>
      ) : null}
      <CookieSettingsDialog
        open={managing}
        onOpenChange={setManaging}
        purposes={purposes}
        signalled={signalled}
        initial={{ analytics: choice?.analytics ?? false, ads: choice?.ads ?? false }}
        onSave={save}
      />
    </>
  );
}

function CookieSettingsDialog({
  open,
  onOpenChange,
  purposes,
  signalled,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purposes: ConsentPurposes;
  signalled: boolean;
  initial: ConsentPurposes;
  onSave: (purposes: ConsentPurposes) => void;
}) {
  const [analytics, setAnalytics] = useState(initial.analytics);
  const [ads, setAds] = useState(initial.ads);
  // What opened the dialog (the banner's Manage button, a footer or policy link): focus goes back there on close.
  const opener = useRef<HTMLElement | null>(null);
  const canAnalytics = purposes.analytics && !signalled;
  const canAds = purposes.ads && !signalled;

  useEffect(() => {
    if (open) {
      setAnalytics(initial.analytics && canAnalytics);
      setAds(initial.ads && canAds);
    }
  }, [open, initial.analytics, initial.ads, canAnalytics, canAds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-lg overflow-y-auto bg-white text-slate-900"
        onOpenAutoFocus={() => {
          const el = document.activeElement;
          opener.current = el instanceof HTMLElement && el !== document.body ? el : null;
        }}
        onCloseAutoFocus={(event) => {
          const el = opener.current;
          opener.current = null;
          if (el && document.contains(el)) {
            event.preventDefault();
            el.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Cookie settings</DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            Choose which cookies this site may use. You can change your mind at any time from the
            &ldquo;Cookie settings&rdquo; link at the bottom of every page.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Strictly necessary</h3>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">Always on</span>
            </div>
            <p className="mt-1.5 text-sm text-slate-600">
              Remember your cookie choice, keep you signed in, and let the demo keep its fictional records
              in your browser. The site cannot work without them.
            </p>
          </div>
          <PurposeSwitch
            label="Analytics"
            checked={analytics}
            disabled={!canAnalytics}
            onToggle={() => setAnalytics((v) => !v)}
            description={
              !purposes.analytics
                ? "This site does not use analytics at the moment."
                : signalled
                  ? "Your browser asks websites not to track you, so analytics stays off."
                  : "Count visits to our public pages and a few product actions, without names, emails or any patient information. Stored in the EU."
            }
          />
          <PurposeSwitch
            label="Advertising"
            checked={ads}
            disabled={!canAds}
            onToggle={() => setAds((v) => !v)}
            description={
              !purposes.ads
                ? "This site does not use advertising cookies."
                : signalled
                  ? "Your browser asks websites not to track you, so advertising cookies stay off."
                  : "Google’s advertising cookies, on our public pages only, tell us whether people who clicked one of our adverts went on to request access. Nothing you type in our forms is sent, and they are never used in the application or the demo."
            }
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <button type="button" className={secondaryButton} onClick={() => onSave({ analytics: false, ads: false })}>
            Reject all
          </button>
          <button type="button" className={primaryButton} onClick={() => onSave({ analytics: canAnalytics && analytics, ads: canAds && ads })}>
            Save choices
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PurposeSwitch({
  label,
  checked,
  disabled,
  onToggle,
  description,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  description: string;
}) {
  const switchId = useId();
  const descriptionId = useId();
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={switchId} className="text-sm font-semibold">
          {label}
        </label>
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-describedby={descriptionId}
          disabled={disabled}
          onClick={onToggle}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            checked ? "bg-teal-700" : "bg-slate-300"
          }`}
        >
          <span className="sr-only">{checked ? "On" : "Off"}</span>
          <span
            aria-hidden
            className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`}
          />
        </button>
      </div>
      <p id={descriptionId} className="mt-1.5 text-sm text-slate-600">
        {description}
      </p>
    </div>
  );
}
