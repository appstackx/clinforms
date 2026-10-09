"use client";

/**
 * Drafting mode: GET /health (cached once per page load) and the header badge with the live passcode
 * field (customer-facing wording: core/wording.ts WORDING.mode). The passcode is kept in sessionStorage for this tab only (ui/store.ts setPasscode) and is
 * checked by the server on the first live call.
 *
 * Owner: studio-a agent.
 */
import { useCallback, useEffect, useState } from "react";
import { FlaskConical, KeyRound, Zap } from "lucide-react";
import type { HealthResponse } from "../../../api/contract";
import { api } from "../../api-client";
import { WORDING } from "../../wording";
import { getPasscode, setPasscode, STORE_EVENT } from "../../store";
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
import { FieldLabel, Notice } from "./ui-bits";

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

export interface AiModeState {
  health: HealthResponse | null;
  /** /health failed (the badge then shows WORDING.mode.unknown). */
  error: boolean;
  /** A passcode is stored for this tab. */
  hasPasscode: boolean;
  /** Live drafting and form reading will be used (server allows it and a passcode is stored). */
  expectLive: boolean;
}

/** /health plus the stored passcode, kept in sync with the store. */
export function useAiMode(): AiModeState {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState(false);
  const [hasPasscode, setHasPasscode] = useState(false);

  useEffect(() => {
    let live = true;
    loadHealth().then(
      (h) => live && setHealth(h),
      () => live && setError(true),
    );
    const sync = () => setHasPasscode(Boolean(getPasscode()));
    sync();
    window.addEventListener(STORE_EVENT, sync);
    return () => {
      live = false;
      window.removeEventListener(STORE_EVENT, sync);
    };
  }, []);

  return { health, error, hasPasscode, expectLive: Boolean(health?.liveAiAvailable && hasPasscode) };
}

/** Header badge: drafting mode, with a dialog to enter or clear the live passcode. */
export function AiModeBadge({ className }: { className?: string }) {
  const { health, error, hasPasscode, expectLive } = useAiMode();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) setValue("");
  }, []);

  const w = WORDING.mode;
  const label = !health
    ? error
      ? w.unknown
      : w.checking
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
            onSubmit={(e) => {
              e.preventDefault();
              setPasscode(value.trim() || null);
              setOpen(false);
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
                onChange={(e) => setValue(e.target.value)}
                placeholder={hasPasscode ? "Passcode stored – enter a new one" : "Enter passcode"}
              />
              <Button type="submit" size="sm" className="h-10 shrink-0" disabled={!value.trim()}>
                <KeyRound className="mr-1.5 h-4 w-4" aria-hidden />
                {w.useLive}
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Checked by the server on the first live request. Live drafting is rate limited. Fictional data only.
            </p>
          </form>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          {hasPasscode ? (
            <Button
              variant="outline"
              onClick={() => {
                setPasscode(null);
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
