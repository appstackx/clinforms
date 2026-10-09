"use client";

/**
 * Cookie banner and cookie settings dialog (mounted once in the root layout).
 *
 * - Shown only when this build has optional analytics (NEXT_PUBLIC_POSTHOG_KEY), the visitor has not
 *   chosen yet, the browser sends no Do Not Track / Global Privacy Control signal, and the page is not
 *   part of the app, the public demo or the APIs (those respect a choice made elsewhere but never ask).
 * - "Accept analytics" and "Reject" have equal weight; "Manage" opens the settings dialog, which the
 *   footer's "Cookie settings" link also opens from any page.
 * - Rendered after hydration only (no server markup), so cached pages never show a stale banner.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import { Cookie } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isAppAreaPath } from "@/lib/site";
import {
  analyticsConfigured,
  browserPrivacySignals,
  browserSaveConsent,
  browserStoredConsent,
  onConsentManage,
  optOutSignalled,
  type ConsentChoice,
} from "./consent";

const buttonBase =
  "inline-flex h-10 items-center justify-center rounded-lg px-3 text-sm font-semibold sm:px-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2";
const primaryButton = `${buttonBase} bg-teal-700 text-white hover:bg-teal-800`;
const secondaryButton = `${buttonBase} border border-slate-300 bg-white text-slate-900 hover:bg-slate-50`;

export function ConsentBanner() {
  const pathname = usePathname() ?? "/";
  const [mounted, setMounted] = useState(false);
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [signalled, setSignalled] = useState(false);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    setChoice(browserStoredConsent());
    setSignalled(optOutSignalled(browserPrivacySignals()));
    setMounted(true);
    return onConsentManage(() => setManaging(true));
  }, []);

  const save = useCallback((analytics: boolean) => {
    setChoice(browserSaveConsent(analytics));
    setManaging(false);
  }, []);

  if (!mounted) return null;
  const configured = analyticsConfigured();
  const showBanner = configured && !choice && !signalled && !managing && !isAppAreaPath(pathname);

  return (
    <>
      {showBanner ? (
        <section
          aria-label="Cookie choices"
          className="fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-xl sm:flex-row sm:items-center sm:gap-5 sm:p-5">
            <div className="flex min-w-0 flex-1 gap-3">
              <Cookie className="mt-0.5 hidden h-5 w-5 shrink-0 text-teal-700 sm:block" aria-hidden />
              <p>
                We use strictly necessary cookies to run this site. With your permission we would also like to
                use analytics to see which pages are useful. No advertising cookies.{" "}
                <Link href="/cookies" className="font-medium text-teal-800 underline underline-offset-2 hover:text-teal-900">
                  Cookie policy
                </Link>
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5 sm:gap-2">
              <button type="button" className={primaryButton} onClick={() => save(true)}>
                Accept analytics
              </button>
              <button type="button" className={primaryButton} onClick={() => save(false)}>
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
        configured={configured}
        signalled={signalled}
        initialAnalytics={choice?.analytics ?? false}
        onSave={save}
      />
    </>
  );
}

function CookieSettingsDialog({
  open,
  onOpenChange,
  configured,
  signalled,
  initialAnalytics,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configured: boolean;
  signalled: boolean;
  initialAnalytics: boolean;
  onSave: (analytics: boolean) => void;
}) {
  const [analytics, setAnalytics] = useState(initialAnalytics);
  const switchId = useId();
  const canChoose = configured && !signalled;

  useEffect(() => {
    if (open) setAnalytics(initialAnalytics && canChoose);
  }, [open, initialAnalytics, canChoose]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-white text-slate-900">
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
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={switchId} className="text-sm font-semibold">
                Analytics
              </label>
              <button
                id={switchId}
                type="button"
                role="switch"
                aria-checked={analytics}
                disabled={!canChoose}
                onClick={() => setAnalytics((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  analytics ? "bg-teal-700" : "bg-slate-300"
                }`}
              >
                <span className="sr-only">{analytics ? "On" : "Off"}</span>
                <span
                  aria-hidden
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${analytics ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </button>
            </div>
            <p className="mt-1.5 text-sm text-slate-600">
              {!configured
                ? "This site does not use analytics at the moment."
                : signalled
                  ? "Your browser asks websites not to track you, so analytics stays off."
                  : "Count visits to our public pages and a few product actions, without names, emails or any patient information. Stored in the EU."}
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <button type="button" className={secondaryButton} onClick={() => onSave(false)}>
            Reject all
          </button>
          <button type="button" className={primaryButton} onClick={() => onSave(canChoose && analytics)}>
            Save choices
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
