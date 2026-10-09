"use client";

/**
 * "Connected apps" card on the simulated patient record. The button launches the product (appName):
 *  1. open a blank tab synchronously in the click handler (so popup blockers allow it);
 *  2. call the server action, which asks the Report API for a launch URL with the partner key;
 *  3. point the new tab at the launch URL – or, if the popup was blocked, navigate this tab.
 *
 * The launch action and the connected app's display name (`appName`, from the product's config) are
 * passed in as props by the page (src/app/pms-sandbox), so the sandbox UI does not import the app or
 * the module.
 *
 * Owner: sandbox agent.
 */
import { useId, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, FileSignature, Loader2 } from "lucide-react";
import type { SimClinician, SimEpisode } from "../wire-types";
import { reportActionLabel } from "./format";

export type LaunchReportInput = { patientId: string; episodeId: string; clinicianHcpc: string };
export type LaunchReportOutcome = { ok: true; launchUrl: string; expiresAt: string } | { ok: false; message: string };
export type LaunchReportFn = (input: LaunchReportInput) => Promise<LaunchReportOutcome>;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function openingHtml(appName: string): string {
  const name = escapeHtml(appName);
  return (
    `<!doctype html><meta charset="utf-8"><title>Opening ${name}…</title>` +
    '<body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;' +
    'font-family:Inter,system-ui,sans-serif;color:#334155;background:#f8fafc">' +
    `<p role="status" style="font-size:15px">Opening ${name}…</p></body>`
  );
}

function openBlankTab(appName: string): Window | null {
  try {
    const tab = window.open("", "_blank");
    if (!tab) return null;
    try {
      tab.opener = null;
      tab.document.open();
      tab.document.write(openingHtml(appName));
      tab.document.close();
    } catch {
      // cosmetic only
    }
    return tab;
  } catch {
    return null;
  }
}

function AppMark() {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white shadow-sm"
      aria-hidden
    >
      <FileSignature className="h-5 w-5" />
    </span>
  );
}

export function ConnectedAppsCard({
  appName,
  patientId,
  episode,
  clinicians,
  launch,
}: {
  /** Display name of the connected app (the product), passed in by the page. */
  appName: string;
  patientId: string;
  episode: SimEpisode | null;
  clinicians: SimClinician[];
  launch: LaunchReportFn;
}) {
  const selectId = useId();
  const [clinicianHcpc, setClinicianHcpc] = useState(episode?.primary_clinician.hcpc ?? clinicians[0]?.hcpc ?? "");
  const [status, setStatus] = useState<"idle" | "pending" | "opened" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const label = episode ? reportActionLabel(episode.referral.source_type) : null;
  const disabledReason = !episode
    ? "Available once the patient has an episode of care with a referral."
    : !label
      ? "Reports are available for solicitor, insurer, case manager and employer referrals."
      : null;

  const onLaunch = () => {
    if (!episode || !label || status === "pending") return;
    setError(null);
    setStatus("pending");
    const tab = openBlankTab(appName);
    launch({ patientId, episodeId: episode.id, clinicianHcpc })
      .then((result) => {
        if (!result.ok) {
          tab?.close();
          setError(result.message);
          setStatus("error");
          return;
        }
        if (tab && !tab.closed) {
          tab.location.href = result.launchUrl;
          setStatus("opened");
        } else {
          window.location.assign(result.launchUrl);
        }
      })
      .catch(() => {
        tab?.close();
        setError(`Could not reach ${appName}. Check your connection and try again.`);
        setStatus("error");
      });
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby={`${selectId}-title`}>
      <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 id={`${selectId}-title`} className="text-sm font-semibold text-slate-900">
          Connected apps
        </h2>
        <p className="mt-0.5 text-xs text-slate-600">Third-party apps authorised for this clinic.</p>
      </div>
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <AppMark />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{appName}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
              Completes the referrer&apos;s own report form (MLC, insurer, case manager or employer) from this
              episode&apos;s registration details, notes and outcome measures, with every answer linked to its source.
            </p>
          </div>
        </div>

        {disabledReason ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{disabledReason}</p>
        ) : (
          <>
            <div>
              <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-slate-700">
                Report author
              </label>
              <select
                id={selectId}
                value={clinicianHcpc}
                onChange={(e) => setClinicianHcpc(e.target.value)}
                disabled={status === "pending"}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30 disabled:opacity-60"
              >
                {clinicians.map((c) => (
                  <option key={c.hcpc} value={c.hcpc}>
                    {c.name} ({c.hcpc})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={onLaunch}
              disabled={status === "pending"}
              aria-describedby={`${selectId}-hint`}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-80"
            >
              {status === "pending" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Opening {appName}…
                </>
              ) : (
                <>
                  {label}
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </>
              )}
            </button>
            <p id={`${selectId}-hint`} className="text-xs text-slate-500">
              Opens in a new tab. The app reads this episode through its authenticated API; nothing is copied by hand.
            </p>
          </>
        )}

        <div aria-live="polite">
          {status === "opened" && (
            <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {appName} opened in a new tab.
            </p>
          )}
        </div>
        {status === "error" && error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
