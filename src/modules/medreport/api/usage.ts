import "server-only";

/**
 * Usage counting from the Report API handlers (25/10/2026 – packages and usage). The handlers call recordUsage()
 * after the action itself has succeeded (or, for a live drafting call, failed after the drafting service was
 * called): POST /drafts (drafting_call), POST /sign (report_approved), POST /forms/analyse (form_read), the store's
 * report create (report_started) and a question set's first store (question_set_created).
 *
 * Rules:
 * - clinic members only – the public demo (actor via "demo") never counts, and nor does a host without
 *   deps.usage;
 * - never fails and never holds the request up for long: an error is logged (event, kind, error name only) and
 *   the action's response goes out as usual; a write that takes longer than USAGE_WAIT_MS is left to finish in
 *   the background (the host's write is atomic and retry-safe, so a late or repeated write never counts twice);
 * - ids, counts and token totals only – never patient data.
 *
 * Owner: API slice.
 */
import type { TokenUsage } from "../core/types";
import type { Actor } from "../auth/actor";
import type { MedreportDeps, UsageEvent } from "./deps";
import { logEvent } from "./http";

/** How long a handler waits for the usage write before answering anyway. */
export const USAGE_WAIT_MS = 4_000;

export async function recordUsage(deps: MedreportDeps, actor: Pick<Actor, "via" | "tenantId">, event: UsageEvent): Promise<void> {
  if (actor.via === "demo" || !deps.usage) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const write = deps.usage.record(actor.tenantId, event).catch((err: unknown) => {
      logEvent("usage_record_failed", { kind: event.kind, error: err instanceof Error ? err.name : "error" });
    });
    const waited = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), USAGE_WAIT_MS);
    });
    if ((await Promise.race([write.then(() => "done" as const), waited])) === "late") {
      logEvent("usage_record_slow", { kind: event.kind, ms: USAGE_WAIT_MS });
    }
  } catch (err) {
    logEvent("usage_record_failed", { kind: event.kind, error: err instanceof Error ? err.name : "error" });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Token usage carried by a drafting error, when the drafting service answered before the call failed. */
export function usageOfError(err: unknown): { usage?: TokenUsage; model?: string } {
  if (!err || typeof err !== "object") return {};
  const e = err as { usage?: unknown; model?: unknown };
  const usage = e.usage && typeof e.usage === "object" ? (e.usage as TokenUsage) : undefined;
  return { ...(usage ? { usage } : {}), ...(typeof e.model === "string" ? { model: e.model } : {}) };
}
