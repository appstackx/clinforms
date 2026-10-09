/**
 * Pure formatting helpers shared by the Studio screens (no React).
 *
 * Owner: studio-a agent.
 */
import { ApiError } from "../../api-client";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Plural helper: plural(3, "note") → "3 notes". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A plain-English message for any error (API problem details first). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = err.problem.issues?.slice(0, 3).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
    const base = err.problem.detail ?? err.problem.title;
    return issues?.length ? `${base} (${issues.join("; ")})` : base;
  }
  if (err instanceof DOMException && err.name === "AbortError") return "Cancelled.";
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

