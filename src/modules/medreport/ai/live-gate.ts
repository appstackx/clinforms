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
 * Owner: ai agent.
 */
import { HEADERS } from "../api/contract";
import { problem } from "../api/http";
import { checkLivePasscode, takeLiveCall } from "../auth/passcode";
import { liveAiAvailable } from "../config.server";
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
