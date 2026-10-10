import "server-only";

/**
 * The live-AI gate shared by POST /drafts and POST /forms/analyse: decides between live Claude and the
 * demo path, and enforces the passcode (timing-safe, auth/passcode.ts) and the per-instance rate cap.
 *
 * - prefer "demo"            → demo.
 * - prefer "live"            → live; 503 LIVE_AI_UNAVAILABLE if this deployment cannot run live AI.
 * - prefer "auto" (default)  → live when live AI is available AND an x-medreport-passcode header is
 *                              sent; otherwise demo.
 * Live always needs a valid passcode (401 PASSCODE_REQUIRED / PASSCODE_INVALID) and a free slot
 * (429 RATE_LIMITED with retry-after).
 *
 * Wave 2 – chooseAiModeForActor(): the handlers' gate. The public demo (actor via "demo") keeps the
 * passcode, with its guesses and the live cap shared by every instance (auth/passcode.ts). A clinic's
 * signed-in member needs no passcode: live when this deployment can draft (tenantLiveAiAvailable) and the
 * clinic's profile allows it (clinic_profile.drafting_enabled; off without a profile or when it cannot be read), within the
 * clinic's own per-minute and per-day limits (CLINFORMS_TENANT_LIVE_CALLS_PER_MINUTE / _PER_DAY, shared;
 * 429 + retry-after). prefer "live" with drafting switched off → 403 DRAFTING_DISABLED.
 *
 * Owner: ai agent (wave 2 actor gate: API slice).
 */
import { HEADERS } from "../api/contract";
import type { MedreportDeps } from "../api/deps";
import { logEvent, problem } from "../api/http";
import type { Actor } from "../auth/actor";
import { checkLivePasscode, checkLivePasscodeShared, takeDemoLiveCalls, takeLiveCall } from "../auth/passcode";
import { takeSlotsFromAll, type SlotResult } from "../auth/shared-limits";
import { liveAiAvailable, tenantDraftingLimits, tenantLiveAiAvailable } from "../config.server";
import { WORDING } from "../core/wording";

export type LiveGateResult = { ok: true; mode: "live" | "demo" } | { ok: false; response: Response };

export interface LiveGateWording {
  /** WORDING.server.gateActionDraft / gateActionAnalyse (customer-facing: core/wording.ts). */
  action: string;
  /** "use the demo draft" / "use the recorded analysis". */
  alternative: string;
  /** "Too many live drafts". */
  rateTitle: string;
}

export function chooseAiMode(req: Request, prefer: "auto" | "live" | "demo" | undefined, wording: LiveGateWording): LiveGateResult {
  const p = prefer ?? "auto";
  const passcodeSent = Boolean(req.headers.get(HEADERS.passcode)?.trim());
  if (!(p === "live" || (p === "auto" && passcodeSent && liveAiAvailable()))) return { ok: true, mode: "demo" };

  if (!liveAiAvailable()) {
    return {
      ok: false,
      response: problem(503, WORDING.server.liveUnavailableTitle, {
        code: "LIVE_AI_UNAVAILABLE",
        detail: `This deployment runs in demo mode. Please ${wording.alternative} instead.`,
      }),
    };
  }
  const pass = checkLivePasscode(req);
  if (!pass.ok) {
    if (pass.reason === "locked") {
      return {
        ok: false,
        response: problem(429, "Too many wrong passcodes", {
          code: "RATE_LIMITED",
          detail: WORDING.server.liveLocked(Math.ceil(pass.retryAfterSeconds / 60), wording.alternative),
          retryable: true,
          headers: { "retry-after": String(pass.retryAfterSeconds) },
        }),
      };
    }
    if (pass.reason === "missing") {
      return {
        ok: false,
        response: problem(401, "Passcode required", { code: "PASSCODE_REQUIRED", detail: WORDING.server.passcodeRequired(wording.action) }),
      };
    }
    if (pass.reason === "invalid") {
      return {
        ok: false,
        response: problem(401, "Passcode not recognised", { code: "PASSCODE_INVALID", detail: WORDING.server.passcodeInvalid }),
      };
    }
    return {
      ok: false,
      response: problem(503, WORDING.server.liveUnavailableTitle, { code: "LIVE_AI_UNAVAILABLE", detail: WORDING.server.noPasscodeConfigured }),
    };
  }
  const slot = takeLiveCall();
  if (!slot.ok) {
    return {
      ok: false,
      response: problem(429, wording.rateTitle, {
        code: "RATE_LIMITED",
        detail: WORDING.server.liveRateLimited(slot.retryAfterSeconds, wording.alternative),
        retryable: true,
        headers: { "retry-after": String(slot.retryAfterSeconds) },
      }),
    };
  }
  return { ok: true, mode: "live" };
}

/* ------------------------------------------------------------------------------------------------
 * Wave 2: the gate per caller (public demo vs a clinic's member)
 * ----------------------------------------------------------------------------------------------*/

/** The clinic's live limits as counter keys (per minute, per UTC day). */
function tenantLimitKeys(tenantId: string) {
  const limits = tenantDraftingLimits();
  return [
    { key: `tenant:${tenantId}:live:minute`, limit: limits.perMinute, windowMs: 60_000 },
    { key: `tenant:${tenantId}:live:day`, limit: limits.perDay, windowMs: 86_400_000 },
  ];
}

/** Take `n` live calls for this caller: the demo's shared cap, or the clinic's own limits. */
export async function takeLiveCallsFor(actor: Actor, deps: MedreportDeps, n = 1): Promise<SlotResult & { daily?: boolean }> {
  if (actor.via === "demo") {
    const r = await takeDemoLiveCalls(deps, n);
    return r.ok ? { ok: true, count: 0, remaining: r.remaining } : r;
  }
  const keys = tenantLimitKeys(actor.tenantId);
  const r = await takeSlotsFromAll(deps, keys, n);
  return r.ok ? r : { ...r, daily: r.blockedBy === keys[1].key };
}

function limitResponse(actor: Actor, slot: { retryAfterSeconds: number; daily?: boolean }, wording: LiveGateWording): Response {
  if (actor.via === "demo") {
    return problem(429, wording.rateTitle, {
      code: "RATE_LIMITED",
      detail: WORDING.server.liveRateLimited(slot.retryAfterSeconds, wording.alternative),
      retryable: true,
      headers: { "retry-after": String(slot.retryAfterSeconds) },
    });
  }
  return problem(429, WORDING.server.access.clinicLimitTitle, {
    code: "RATE_LIMITED",
    detail: slot.daily ? WORDING.server.access.clinicDailyLimit : WORDING.server.access.clinicMinuteLimit(slot.retryAfterSeconds),
    retryable: !slot.daily,
    headers: { "retry-after": String(slot.retryAfterSeconds) },
  });
}

/**
 * Whether a clinic may draft now: its profile's switch. Off when the clinic has no profile (clinics are created
 * with one, drafting off) or it cannot be read (fix wave 2: fail closed). On only without deps.clinicProfile
 * (a host that has no clinic profiles).
 */
async function clinicDraftingEnabled(actor: Actor, deps: MedreportDeps): Promise<boolean> {
  if (!deps.clinicProfile) return true;
  try {
    const profile = await deps.clinicProfile(actor.tenantId);
    return profile ? profile.draftingEnabled : false;
  } catch (err) {
    logEvent("clinic_profile_unavailable", { error: err instanceof Error ? err.name : "error" });
    return false; // fail closed: never spend a clinic's drafting allowance we cannot check
  }
}

/** Whether live drafting is available to this caller now (health; the Studio's mode badge). */
export async function liveAvailableFor(actor: Actor | null, deps: MedreportDeps): Promise<boolean> {
  if (!actor || actor.via === "demo") return liveAiAvailable();
  return tenantLiveAiAvailable() && (await clinicDraftingEnabled(actor, deps));
}

/**
 * The handlers' gate (POST /drafts, POST /forms/analyse). Demo: chooseAiMode() with the shared passcode
 * counters and cap. Clinic member: see the header.
 */
export async function chooseAiModeForActor(
  req: Request,
  actor: Actor,
  deps: MedreportDeps,
  prefer: "auto" | "live" | "demo" | undefined,
  wording: LiveGateWording,
): Promise<LiveGateResult> {
  const p = prefer ?? "auto";
  if (actor.via === "demo") {
    const passcodeSent = Boolean(req.headers.get(HEADERS.passcode)?.trim());
    if (!(p === "live" || (p === "auto" && passcodeSent && liveAiAvailable()))) return { ok: true, mode: "demo" };
    if (!liveAiAvailable()) {
      return {
        ok: false,
        response: problem(503, WORDING.server.liveUnavailableTitle, {
          code: "LIVE_AI_UNAVAILABLE",
          detail: `This deployment runs in demo mode. Please ${wording.alternative} instead.`,
        }),
      };
    }
    const pass = await checkLivePasscodeShared(req, deps);
    if (!pass.ok) {
      if (pass.reason === "locked") {
        return {
          ok: false,
          response: problem(429, "Too many wrong passcodes", {
            code: "RATE_LIMITED",
            detail: WORDING.server.liveLocked(Math.ceil(pass.retryAfterSeconds / 60), wording.alternative),
            retryable: true,
            headers: { "retry-after": String(pass.retryAfterSeconds) },
          }),
        };
      }
      if (pass.reason === "missing") {
        return { ok: false, response: problem(401, "Passcode required", { code: "PASSCODE_REQUIRED", detail: WORDING.server.passcodeRequired(wording.action) }) };
      }
      if (pass.reason === "invalid") {
        return { ok: false, response: problem(401, "Passcode not recognised", { code: "PASSCODE_INVALID", detail: WORDING.server.passcodeInvalid }) };
      }
      return {
        ok: false,
        response: problem(503, WORDING.server.liveUnavailableTitle, { code: "LIVE_AI_UNAVAILABLE", detail: WORDING.server.noPasscodeConfigured }),
      };
    }
    const slot = await takeLiveCallsFor(actor, deps, 1);
    if (!slot.ok) return { ok: false, response: limitResponse(actor, slot, wording) };
    return { ok: true, mode: "live" };
  }

  // A clinic's signed-in member: no passcode.
  if (p === "demo") return { ok: true, mode: "demo" };
  const live = tenantLiveAiAvailable();
  const enabled = live ? await clinicDraftingEnabled(actor, deps) : false;
  if (p === "auto" && (!live || !enabled)) return { ok: true, mode: "demo" };
  if (!live) {
    return {
      ok: false,
      response: problem(503, WORDING.server.liveUnavailableTitle, { code: "LIVE_AI_UNAVAILABLE", detail: WORDING.server.access.liveNotAvailableForClinic }),
    };
  }
  if (!enabled) {
    return { ok: false, response: problem(403, WORDING.server.access.draftingOffTitle, { code: "DRAFTING_DISABLED", detail: WORDING.server.access.draftingOffDetail }) };
  }
  const slot = await takeLiveCallsFor(actor, deps, 1);
  if (!slot.ok) return { ok: false, response: limitResponse(actor, slot, wording) };
  return { ok: true, mode: "live" };
}
