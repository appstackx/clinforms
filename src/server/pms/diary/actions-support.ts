/**
 * What the diary's server actions answer (src/app/app/clinic/diary/**\/actions.ts) and the small helpers that
 * turn repository outcomes into it: plain messages for clashes, a stale screen, a refused input. Server only.
 */
import "server-only";
import type { z } from "zod";
import { fieldErrors } from "../../../modules/pms/core/schemas";
import { CLASH_LABELS, DIARY_COPY, WARNING_LABELS } from "../../../modules/pms/diary/copy";
import type { DiaryClash } from "../../../modules/pms/diary/rules";
import { formatDayShort, formatLondonTime, londonDate } from "../../../modules/pms/diary/time";
import type { DiaryActionResult, DiarySaveResult, DiaryWarning } from "../../../modules/pms/diary/types";
import { logAuthEvent } from "../../email/log";
import { RepoInputError } from "../../repos/context";

export type { DiaryActionResult };

export function clashMessages(clashes: readonly (DiaryClash & { date?: string })[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of clashes) {
    const when = `${formatDayShort(londonDate(c.startsAt))} ${formatLondonTime(c.startsAt)}–${formatLondonTime(c.endsAt)}`;
    const text = `${CLASH_LABELS[c.resource]}${c.withKind === "block" ? " (blocked time)" : ""}: ${when}.`;
    if (!seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
  }
  return out.slice(0, 12);
}

export function warningMessages(warnings: readonly DiaryWarning[]): string[] {
  return Array.from(new Set(warnings)).map((w) => WARNING_LABELS[w]);
}

/** A zod failure as the action's answer (messages next to the fields). */
export function invalid(error: z.ZodError): DiaryActionResult {
  return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(error) };
}

/** A move / status / details outcome as the action's answer. */
export function fromSaveResult(result: DiarySaveResult, okMessage: string): DiaryActionResult {
  if (result.ok) return { ok: true, message: okMessage, warnings: warningMessages(result.warnings), itemId: result.item.id };
  if (result.reason === "conflict") return { ok: false, error: DIARY_COPY.conflict, conflict: true };
  if (result.reason === "not_found") return { ok: false, error: DIARY_COPY.notFound, conflict: true };
  return { ok: false, error: "That time is not free.", clashes: clashMessages(result.clashes) };
}

/** Runs the work; a refused input becomes its message, anything else a plain "try again" (logged by name only). */
export async function diaryAction(name: string, work: () => Promise<DiaryActionResult>): Promise<DiaryActionResult> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof RepoInputError) return { ok: false, error: err.message };
    logAuthEvent("pms.diary.action_failed", { action: name, error: err instanceof Error ? err.name : "error" });
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
