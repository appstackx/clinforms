/**
 * The public demo's live drafting passcode in the Studio: checked by the server (POST /passcode/check) BEFORE
 * it is kept, and a stored one re-checked once per page load. Pure logic – no React, no fetch, no storage of
 * its own: the dialog and badge (components/shared/ai-mode.tsx) and the default API client (api-client.ts
 * `passcodeVerifier`) share one instance; tests inject the check and the storage.
 *
 * - submit(value): stores the passcode and marks it verified ONLY when the server answers 204. A refused
 *   passcode is never stored (a passcode stored before stays as it was).
 * - recheckStored(): once per page load (cached, like /health). A stored passcode the server refuses (401 –
 *   e.g. it was rotated) is removed and the notice "rejected" is raised. One that cannot be checked (429,
 *   network, server error) stays stored but UNVERIFIED, with the notice "unchecked". 503 (no live drafting on
 *   this deployment) leaves it unverified without a notice – the badge already says demo mode.
 * - verifiedPasscode(): the stored passcode only when the server accepted it on this page load. It is the only
 *   passcode the default API client sends, and the only one that makes the badge show live drafting.
 * - reject(passcode): a live call that carried the verified passcode was refused (401 – e.g. the passcode was
 *   rotated while this tab was open): it is removed, the badge returns to demo mode and the notice "rejected" is
 *   raised, so no later call sends it again (api-client.ts calls this).
 * - reconfirm(): before a run of live calls (completing a form, a batch, redrafting), the verified passcode is
 *   checked once more – one request, no live call – so a rotated passcode costs one wrong guess, not one per
 *   drafting group, and the run goes in demo mode instead of failing.
 * - A passcode with a character outside printable ASCII (a long dash or curly quote pasted from an e-mail) can
 *   never be sent in a request header: it is refused as not recognised without a request.
 *
 * Tenant mode (a clinic's own Studio) has no passcode and never uses this.
 *
 * Owner: studio-a agent.
 */
import { WORDING } from "./wording";

export type PasscodeCheckOutcome =
  | { kind: "verified" }
  /** 401 PASSCODE_INVALID */
  | { kind: "invalid" }
  /** 401 PASSCODE_REQUIRED (nothing typed) */
  | { kind: "required" }
  /** A character no passcode has (outside printable ASCII, e.g. a long dash or curly quote): nothing was sent. */
  | { kind: "unsupported" }
  /** 429: locked out after wrong passcodes; `minutes` rounded up, at least 1. */
  | { kind: "locked"; retryAfterSeconds: number; minutes: number }
  /** 503 LIVE_AI_UNAVAILABLE: no live drafting on this deployment. */
  | { kind: "unavailable" }
  /** The server could not be reached. */
  | { kind: "network" }
  /** Anything else (no demo session, server error…). */
  | { kind: "error" };

/** The lock-out window when a 429 carries no Retry-After (auth/passcode.ts PASSCODE_FAILURE_WINDOW_MS). */
const DEFAULT_LOCK_SECONDS = 10 * 60;

/** What a failed check carries (an ApiError from api-client.ts – read by shape so this file stays pure). */
interface CheckFailure {
  status?: unknown;
  code?: unknown;
  retryAfterSeconds?: unknown;
}

/** A failed POST /passcode/check (ApiError or anything thrown) → what the dialog says. */
export function classifyPasscodeCheckError(err: unknown): PasscodeCheckOutcome {
  const e = (err && typeof err === "object" ? err : {}) as CheckFailure;
  const status = typeof e.status === "number" ? e.status : undefined;
  const code = typeof e.code === "string" ? e.code : "";
  if (status === 0 || code === "NETWORK_ERROR") return { kind: "network" };
  if (status === 401 && code === "PASSCODE_INVALID") return { kind: "invalid" };
  if (status === 401 && code === "PASSCODE_REQUIRED") return { kind: "required" };
  if (status === 429) {
    const seconds = typeof e.retryAfterSeconds === "number" && e.retryAfterSeconds > 0 ? Math.ceil(e.retryAfterSeconds) : DEFAULT_LOCK_SECONDS;
    return { kind: "locked", retryAfterSeconds: seconds, minutes: Math.max(1, Math.ceil(seconds / 60)) };
  }
  if (status === 503 && code === "LIVE_AI_UNAVAILABLE") return { kind: "unavailable" };
  return { kind: "error" };
}

/**
 * Whether a passcode can be sent at all: printable ASCII only (a request header cannot carry other characters,
 * and a passcode never has them – they come from pasting text that was auto-corrected, e.g. "–" for "-").
 */
export function isSendablePasscode(passcode: string): boolean {
  return /^[\x20-\x7E]+$/.test(passcode);
}

/** What the dialog shows after a check: null when the passcode was accepted (the dialog closes). */
export function passcodeCheckMessage(outcome: PasscodeCheckOutcome): string | null {
  const w = WORDING.mode;
  switch (outcome.kind) {
    case "verified":
      return null;
    case "invalid":
    case "required":
      return w.passcodeNotRecognised;
    case "unsupported":
      return w.passcodeUnsupportedCharacters;
    case "locked":
      return w.passcodeLocked(outcome.minutes);
    case "unavailable":
      return w.passcodeLiveUnavailable;
    case "network":
      return w.passcodeNetworkError;
    default:
      return w.passcodeCheckFailed;
  }
}

/**
 * - none:       no passcode stored in this tab
 * - checking:   a stored passcode waits for (or is in) this page load's re-check
 * - verified:   the server accepted the stored passcode on this page load
 * - unverified: a passcode is stored but the server has not accepted it on this page load
 */
export type PasscodeStatus = "none" | "checking" | "verified" | "unverified";

/** A one-line notice after the page-load re-check: "rejected" (removed) or "unchecked" (kept, not used). */
export type PasscodeNotice = "rejected" | "unchecked" | null;

export interface PasscodeState {
  status: PasscodeStatus;
  notice: PasscodeNotice;
}

export interface PasscodeVerifierDeps {
  /** POST /passcode/check with this passcode: resolves on 204, rejects (ApiError) otherwise. */
  check(passcode: string): Promise<void>;
  /** The passcode stored for this tab (ui/store.ts getPasscode). */
  getStored(): string | null;
  /** Store or clear it (ui/store.ts setPasscode). */
  setStored(passcode: string | null): void;
}

export interface PasscodeVerifier {
  getState(): PasscodeState;
  /** Called on every change of the state; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** The dialog: check `value` with the server; stored (and verified) only when accepted. */
  submit(value: string): Promise<PasscodeCheckOutcome>;
  /** Re-check the stored passcode – at most once per page load (the same promise afterwards). */
  recheckStored(): Promise<PasscodeState>;
  /** The stored passcode when the server accepted it on this page load, else null. */
  verifiedPasscode(): string | null;
  /**
   * A call carrying `passcode` was refused (401 PASSCODE_INVALID / PASSCODE_REQUIRED). When it is the verified
   * passcode, it is removed (badge: demo mode; notice "rejected"); true then. Any other passcode: nothing changes.
   */
  reject(passcode: string): boolean;
  /**
   * Check the verified passcode again (before a run of live calls; concurrent callers share one request). False
   * when there is none, when the server now refuses it (it is removed, as reject()) or has no live drafting;
   * true when accepted – or when the check could not tell (network, lock-out, server error): the live calls then
   * decide, as they would without this check.
   */
  reconfirm(): Promise<boolean>;
  /** "Switch to demo mode": forget the passcode. */
  clear(): void;
  dismissNotice(): void;
}

export function createPasscodeVerifier(deps: PasscodeVerifierDeps): PasscodeVerifier {
  /** The passcode the server accepted on this page load (it counts only while it is the stored one). */
  let verified: string | null = null;
  let notice: PasscodeNotice = null;
  let recheck: Promise<PasscodeState> | null = null;
  let recheckDone = false;
  let confirming: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();

  const stored = (): string | null => {
    try {
      return deps.getStored() || null;
    } catch {
      return null;
    }
  };

  function getState(): PasscodeState {
    const current = stored();
    const status: PasscodeStatus = !current ? "none" : current === verified ? "verified" : recheckDone ? "unverified" : "checking";
    return { status, notice };
  }

  function emit(): void {
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch {
        // a listener's failure never stops the others
      }
    }
  }

  function verifiedPasscode(): string | null {
    const current = stored();
    return current && current === verified ? current : null;
  }

  function reject(passcode: string): boolean {
    if (!passcode || passcode !== verified) return false;
    verified = null;
    if (stored() === passcode) deps.setStored(null);
    notice = "rejected";
    emit();
    return true;
  }

  return {
    getState,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async submit(value) {
      const passcode = value.trim();
      if (!passcode) return { kind: "required" };
      if (!isSendablePasscode(passcode)) return { kind: "unsupported" };
      try {
        await deps.check(passcode);
      } catch (err) {
        return classifyPasscodeCheckError(err);
      }
      verified = passcode;
      notice = null;
      deps.setStored(passcode);
      emit();
      return { kind: "verified" };
    },

    recheckStored() {
      if (recheck) return recheck;
      recheck = (async () => {
        const passcode = stored();
        if (!passcode || passcode === verified) {
          recheckDone = true;
          emit();
          return getState();
        }
        emit(); // "checking"
        let outcome: PasscodeCheckOutcome;
        if (!isSendablePasscode(passcode)) {
          // Stored by an older Studio that kept any passcode: it can never be sent, so it is refused unsent.
          outcome = { kind: "unsupported" };
        } else {
          try {
            await deps.check(passcode);
            outcome = { kind: "verified" };
          } catch (err) {
            outcome = classifyPasscodeCheckError(err);
          }
        }
        recheckDone = true;
        // A passcode entered in the dialog meanwhile wins: only the one that was checked is acted on.
        if (stored() === passcode) {
          if (outcome.kind === "verified") verified = passcode;
          else if (outcome.kind === "invalid" || outcome.kind === "required" || outcome.kind === "unsupported") {
            deps.setStored(null);
            notice = "rejected";
          } else if (outcome.kind !== "unavailable") notice = "unchecked";
        }
        emit();
        return getState();
      })();
      return recheck;
    },

    verifiedPasscode,

    reject,

    reconfirm() {
      if (confirming) return confirming;
      const passcode = verifiedPasscode();
      if (!passcode) return Promise.resolve(false);
      const run = (async () => {
        try {
          await deps.check(passcode);
        } catch (err) {
          const outcome = classifyPasscodeCheckError(err);
          if (outcome.kind === "invalid" || outcome.kind === "required") reject(passcode);
          else if (outcome.kind === "unavailable") return false;
        }
        // A passcode accepted in the dialog meanwhile counts; "Switch to demo mode" meanwhile does too.
        return verifiedPasscode() !== null;
      })();
      confirming = run;
      void run.finally(() => {
        if (confirming === run) confirming = null;
      });
      return run;
    },

    clear() {
      verified = null;
      notice = null;
      deps.setStored(null);
      emit();
    },

    dismissNotice() {
      if (notice === null) return;
      notice = null;
      emit();
    },
  };
}
