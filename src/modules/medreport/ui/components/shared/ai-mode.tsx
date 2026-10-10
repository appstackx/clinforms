"use client";

/**
 * Drafting mode: GET /health (cached once per page load) and the header badge with the live passcode
 * field (customer-facing wording: core/wording.ts WORDING.mode). The passcode is checked by the server
 * (POST /passcode/check) BEFORE it is kept in sessionStorage for this tab (ui/store.ts setPasscode); a stored
 * one is re-checked once per page load. Live drafting – the badge, livePossible() and the passcode the API
 * client sends – only ever follows a passcode the server accepted on this page load (ui/passcode-check.ts,
 * api-client.ts `passcodeVerifier`). PasscodeNotice is the one-line notice when a stored passcode is refused
 * (e.g. rotated) or cannot be checked.
 * Tenant mode (a clinic's own Studio): no badge and no passcode – drafting follows the clinic's setting
 * (HostHooks.clinic.draftingEnabled) and the member's sign-in.
 *
 * Owner: studio-a agent.
 */
import { useCallback, useEffect, useState } from "react";
import { FlaskConical, Info, KeyRound, X, Zap } from "lucide-react";
import type { HealthResponse } from "../../../api/contract";
import { api, passcodeVerifier } from "../../api-client";
import { useHostHooks } from "../../host-hooks";
import { passcodeCheckMessage, type PasscodeState } from "../../passcode-check";
import { WORDING } from "../../wording";
import { STORE_EVENT } from "../../store";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  cn,
} from "../../primitives";
import { FieldLabel, Notice, Spinner } from "./ui-bits";

let healthPromise: Promise<HealthResponse> | null = null;

function loadHealth(): Promise<HealthResponse> {
  if (!healthPromise) {
    healthPromise = api.health();
    healthPromise.catch(() => {
      healthPromise = null;
    });
  }
  return healthPromise;
}

/** Server render and first client render: nothing known yet (sessionStorage is read after mount). */
const INITIAL_PASSCODE: PasscodeState = { status: "none", notice: null };

/** The passcode's state for this tab; in demo mode, starts this page load's re-check of a stored passcode. */
function usePasscodeState(enabled: boolean): PasscodeState {
  const [state, setState] = useState<PasscodeState>(INITIAL_PASSCODE);
  useEffect(() => {
    if (!enabled) return;
    const sync = () => setState(passcodeVerifier.getState());
    sync();
    const unsubscribe = passcodeVerifier.subscribe(sync);
    window.addEventListener(STORE_EVENT, sync);
    void passcodeVerifier.recheckStored();
    return () => {
      unsubscribe();
      window.removeEventListener(STORE_EVENT, sync);
    };
  }, [enabled]);
  return state;
}

export interface AiModeState {
  health: HealthResponse | null;
  /** /health failed (the badge then shows WORDING.mode.unknown). */
  error: boolean;
  /** A passcode is stored for this tab (verified or not). */
  hasPasscode: boolean;
  /** Demo mode: the stored passcode's check (ui/passcode-check.ts PasscodeStatus); "none" in tenant mode. */
  passcodeStatus: PasscodeState["status"];
  /**
   * Live drafting and form reading will be used: the server allows it and – in the demo – the server accepted
   * the stored passcode on this page load (never for an unchecked or refused one).
   */
  expectLive: boolean;
  /**
   * Whether to ask for drafting where no prepared answers exist (read when the drafting starts): the demo
   * needs a passcode the server accepted; a clinic's Studio needs drafting switched on for the clinic.
   */
  livePossible(): boolean;
  /**
   * Just before a run of live calls (completing a form): livePossible(), and in the demo the server re-confirms
   * the passcode first (ui/passcode-check.ts reconfirm – one request, no live call). A passcode refused since it
   * was checked (rotated) is removed and the run goes in demo mode – one wrong guess, not one per drafting group.
   */
  confirmLive(): Promise<boolean>;
}

/** /health plus the passcode's check, kept in sync with the store. */
export function useAiMode(): AiModeState {
  const { mode, clinic } = useHostHooks();
  const tenant = mode === "tenant";
  const tenantDrafting = tenant && clinic?.draftingEnabled === true;
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState(false);
  const passcode = usePasscodeState(!tenant);

  useEffect(() => {
    let live = true;
    loadHealth().then(
      (h) => live && setHealth(h),
      () => live && setError(true),
    );
    return () => {
      live = false;
    };
  }, []);

  const verified = passcode.status === "verified";
  return {
    health,
    error,
    hasPasscode: passcode.status !== "none",
    passcodeStatus: tenant ? "none" : passcode.status,
    expectLive: Boolean(health?.liveAiAvailable && (tenant ? tenantDrafting : verified)),
    livePossible: () => (tenant ? tenantDrafting : Boolean(passcodeVerifier.verifiedPasscode())),
    confirmLive: () => (tenant ? Promise.resolve(tenantDrafting) : passcodeVerifier.reconfirm()),
  };
}

/** Header badge: drafting mode, with a dialog to enter (checked by the server first) or clear the live passcode. */
export function AiModeBadge({ className }: { className?: string }) {
  const { health, error, hasPasscode, passcodeStatus, expectLive } = useAiMode();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) {
      setValue("");
      setMessage(null);
    }
  }, []);

  const submit = useCallback(async () => {
    const typed = value.trim();
    if (!typed || checking) return;
    setChecking(true);
    setMessage(null);
    try {
      const outcome = await passcodeVerifier.submit(typed);
      const text = passcodeCheckMessage(outcome);
      if (text === null) {
        setValue("");
        setOpen(false);
      } else {
        setMessage(text);
      }
    } finally {
      setChecking(false);
    }
  }, [value, checking]);

  const w = WORDING.mode;
  const label = !health
    ? error
      ? w.unknown
      : w.checking
    : passcodeStatus === "checking" && health.liveAiAvailable
      ? w.checking
      : expectLive
        ? w.live
        : health.liveAiAvailable
          ? w.demoPasscodeAvailable
          : w.demo;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2",
            expectLive
              ? "border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
            className,
          )}
          aria-label={w.ariaLabel(label)}
          data-drafting-mode={expectLive ? "live" : "demo"}
        >
          {expectLive ? <Zap className="h-3.5 w-3.5" aria-hidden /> : <FlaskConical className="h-3.5 w-3.5" aria-hidden />}
          <span className="whitespace-nowrap">
            <span className="sm:hidden">{label.split(" · ")[0]}</span>
            <span className="hidden sm:inline">{label}</span>
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{w.dialogTitle}</DialogTitle>
          <DialogDescription>{w.dialogDescription}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-slate-500">Server mode</dt>
          <dd className="font-medium text-slate-900">{health ? (health.aiMode === "live" ? "Live allowed" : "Demo only") : "–"}</dd>
          {w.showTechnicalDetails ? (
            <>
              <dt className="text-slate-500">Model</dt>
              <dd className="font-mono text-xs leading-5 text-slate-900">{health?.model ?? "–"}</dd>
              <dt className="text-slate-500">Prompt version</dt>
              <dd className="text-slate-900">{health?.promptVersion ?? "–"}</dd>
            </>
          ) : null}
          <dt className="text-slate-500">This tab</dt>
          <dd className="font-medium text-slate-900">{expectLive ? w.thisTabLive : w.thisTabDemo}</dd>
        </dl>
        {health && !health.liveAiAvailable ? (
          <Notice tone="info" title={w.liveNotConfiguredTitle}>
            {w.liveNotConfiguredBody}
          </Notice>
        ) : (
          <form
            className="space-y-2"
            aria-busy={checking}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <FieldLabel htmlFor="medreport-passcode" hint="(kept in this tab only)">
              {w.passcodeLabel}
            </FieldLabel>
            <div className="flex gap-2">
              <Input
                id="medreport-passcode"
                type="password"
                autoComplete="off"
                value={value}
                readOnly={checking}
                aria-invalid={message ? true : undefined}
                aria-describedby={message ? "medreport-passcode-message" : undefined}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (message) setMessage(null);
                }}
                placeholder={passcodeStatus === "verified" ? "Passcode stored – enter a new one" : "Enter passcode"}
              />
              <Button type="submit" size="sm" className="h-10 shrink-0" disabled={!value.trim() || checking}>
                {checking ? (
                  <Spinner className="text-current" label={w.passcodeChecking} />
                ) : (
                  <>
                    <KeyRound className="mr-1.5 h-4 w-4" aria-hidden />
                    {w.useLive}
                  </>
                )}
              </Button>
            </div>
            {message ? (
              <p id="medreport-passcode-message" role="alert" className="text-sm font-medium text-red-700" data-passcode-message="">
                {message}
              </p>
            ) : null}
            <p className="text-xs text-slate-500">{w.passcodeHint}</p>
          </form>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          {hasPasscode ? (
            <Button
              variant="outline"
              disabled={checking}
              onClick={() => {
                passcodeVerifier.clear();
                setOpen(false);
              }}
            >
              {w.switchToDemo}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One-line notice under the Studio header (demo mode) when this page load's re-check refused the stored passcode
 * (it was removed – e.g. rotated) or could not check it (the tab stays in demo mode). Dismissible.
 */
export function PasscodeNotice({ className }: { className?: string }) {
  const { notice } = usePasscodeState(true);
  if (!notice) return null;
  const w = WORDING.mode;
  return (
    <div
      role="status"
      data-passcode-notice={notice}
      className={cn("flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-900", className)}
    >
      <Info className="h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">{notice === "rejected" ? w.passcodeRejectedNotice : w.passcodeUncheckedNotice}</p>
      <button
        type="button"
        onClick={() => passcodeVerifier.dismissNotice()}
        className="rounded p-0.5 text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
        aria-label={w.dismissNotice}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
