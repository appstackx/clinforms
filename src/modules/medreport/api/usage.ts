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
 * - never fails and never holds the request up for long: an error is logged (event, kind, clinic and report ids, error
 *   name only) and the action's response goes out as usual; a write that takes longer than USAGE_WAIT_MS is left to
 *   finish in the background (the host's write is atomic and retry-safe, so a late or repeated write never counts twice);
 * - ids, counts and token totals only – never patient data.
 *
 * Which report an event is about (fix 25/10/2026 – the report id and "amends" come from the browser, so on their own
 * they could keep reports out of the allowance): every report event also carries `episodeFp`, worked out HERE on the
 * server from what the request is actually about – the clinic, the episode it points at (connector, patient and
 * episode ids), the template or form, and the patient's name and date of birth from the record. It is a keyed
 * fingerprint (HMAC-SHA256 with a server-only purpose key, 22 characters): it identifies nobody and cannot be
 * reversed. The host keys each report's usage row by (clinic, report id, fingerprint), and accepts "amends" only for
 * an approved report with the SAME fingerprint – so drafting another patient or another form under a report id that
 * already counted, or naming an unrelated approved report as the one amended, counts as a new report.
 * Report ids that are not the Studio's own (rpt_…) are stored as a keyed hash (usageReportKey), never as sent.
 *
 * Owner: API slice.
 */
import { createHmac } from "node:crypto";
import { signingKey } from "../config.server";
import type { EpisodeBundle, EpisodeRef, Report, TokenUsage } from "../core/types";
import type { Actor } from "../auth/actor";
import type { MedreportDeps, UsageEvent } from "./deps";
import { logEvent } from "./http";

/** How long a handler waits for the usage write before answering anyway. */
export const USAGE_WAIT_MS = 4_000;

/** Report ids as the Studio makes them (core/ids.ts createId("rpt")): stored as they are. */
const STUDIO_REPORT_ID = /^rpt_[A-Za-z0-9_-]{1,100}$/;

/**
 * The id the usage counters keep for a report: the Studio's own ids as they are; anything else (another client, an
 * id that might hold a name or an email) as "h_" + a keyed hash – the same id always gives the same key, so it still
 * counts once, and nothing readable is stored.
 */
export function usageReportKey(id: string | undefined): string | undefined {
  if (typeof id !== "string" || id === "") return undefined;
  if (STUDIO_REPORT_ID.test(id)) return id;
  return `h_${createHmac("sha256", signingKey("usage-report")).update(id, "utf8").digest("base64url").slice(0, 32)}`;
}

/** What a report is about, for its usage fingerprint. */
export interface UsageEpisode {
  connectorId: string;
  patientId: string;
  episodeId: string;
  templateId: string;
  patientName?: string;
  dob?: string;
}

const norm = (s: string | undefined) =>
  String(s ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

/**
 * The report's usage fingerprint (see the header). "" when it cannot be worked out (no signing secret – then
 * approvals fail too); the host still counts, only without the binding.
 */
export function usageEpisodeFp(tenantId: string, e: UsageEpisode): string {
  try {
    const material = JSON.stringify(["usage-episode/v1", tenantId, e.connectorId, e.patientId, e.episodeId, e.templateId, norm(e.patientName), norm(e.dob)]);
    return createHmac("sha256", signingKey("usage-episode")).update(material, "utf8").digest("base64url").slice(0, 22);
  } catch (err) {
    logEvent("usage_fp_unavailable", { error: err instanceof Error ? err.name : "error" });
    return "";
  }
}

/** POST /drafts: the episode of the bundle being drafted (the Studio sends the report's own bundle snapshot). */
export function usageEpisodeOfBundle(bundle: EpisodeBundle, templateId: string): UsageEpisode {
  return {
    connectorId: bundle.source.connectorId,
    patientId: bundle.source.externalPatientId,
    episodeId: bundle.source.externalEpisodeId,
    templateId,
    patientName: bundle.registration.fullName,
    dob: bundle.registration.dob,
  };
}

/** POST /sign and the store's report create: the report's own episode (report.episodeRef = its bundle's source ids). */
export function usageEpisodeOfReport(report: Pick<Report, "templateId" | "bundleSnapshot"> & { episodeRef: EpisodeRef }): UsageEpisode {
  return {
    connectorId: report.episodeRef.connectorId,
    patientId: report.episodeRef.patientId,
    episodeId: report.episodeRef.episodeId,
    templateId: report.templateId,
    patientName: report.bundleSnapshot.registration.fullName,
    dob: report.bundleSnapshot.registration.dob,
  };
}

/** The event as the host stores it: report ids through usageReportKey. */
function withUsageKeys(event: UsageEvent): UsageEvent {
  switch (event.kind) {
    case "drafting_call": {
      const { reportId, amendsReportId, ...rest } = event;
      const r = usageReportKey(reportId);
      const a = usageReportKey(amendsReportId);
      return { ...rest, ...(r ? { reportId: r } : {}), ...(a ? { amendsReportId: a } : {}) };
    }
    case "report_started": {
      const { reportId, amendsReportId, ...rest } = event;
      const a = usageReportKey(amendsReportId);
      return { ...rest, reportId: usageReportKey(reportId) ?? reportId, ...(a ? { amendsReportId: a } : {}) };
    }
    case "report_approved": {
      const { reportId, amendsReportId, ...rest } = event;
      const a = usageReportKey(amendsReportId);
      return { ...rest, reportId: usageReportKey(reportId) ?? reportId, ...(a ? { amendsReportId: a } : {}) };
    }
    default:
      return event;
  }
}

/** Ids for the log lines (never patient data): a report id only in the Studio's form or as its keyed hash. */
function logIds(actor: Pick<Actor, "tenantId">, event: UsageEvent): Record<string, string | undefined> {
  const reportId = "reportId" in event ? event.reportId : undefined;
  const report = reportId === undefined ? undefined : STUDIO_REPORT_ID.test(reportId) || /^h_[A-Za-z0-9_-]{32}$/.test(reportId) ? reportId : "(other)";
  return { kind: event.kind, tenant: actor.tenantId, report };
}

export async function recordUsage(deps: MedreportDeps, actor: Pick<Actor, "via" | "tenantId">, event: UsageEvent): Promise<void> {
  if (actor.via === "demo" || !deps.usage) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stored: UsageEvent = event;
  try {
    stored = withUsageKeys(event);
    const write = deps.usage.record(actor.tenantId, stored).catch((err: unknown) => {
      logEvent("usage_record_failed", { ...logIds(actor, stored), error: err instanceof Error ? err.name : "error" });
    });
    const waited = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), USAGE_WAIT_MS);
    });
    if ((await Promise.race([write.then(() => "done" as const), waited])) === "late") {
      logEvent("usage_record_slow", { ...logIds(actor, stored), ms: USAGE_WAIT_MS });
    }
  } catch (err) {
    logEvent("usage_record_failed", { ...logIds(actor, stored), error: err instanceof Error ? err.name : "error" });
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
