import "server-only";

/**
 * What a clinic's account allows right now (10/2026: trials). A clinic whose trial has ended keeps every record it
 * has – reports and forms open, preview, download and export as before, existing drafts can still be edited and
 * approved – but nothing NEW is created: no new report, no drafting from the notes, no uploads (form files and
 * notes), no new form reading or form map, no launch link. Every such endpoint calls assertClinicMayCreate() first:
 *
 *   403 TRIAL_ENDED      "Your trial has ended" – what is not available, what still is, and whom to contact
 *   403 PAYMENT_OVERDUE  "A payment is overdue" (31/10/2026: the plan's payment is past its grace period)
 *
 * The trial comes from the host (MedreportDeps.clinicProfile → ClinicProfile.trial, the host's clinic_plan). The
 * public demo is never affected; a host without clinic profiles has no trials. A profile that cannot be read fails
 * the request (the host's error), never as "allowed".
 *
 * Owner: API slice.
 */
import type { ClinicProfile, MedreportDeps } from "../api/deps";
import { HttpError, logEvent } from "../api/http";
import { usageReportKey } from "../api/usage";
import type { TenantId } from "../core/types";
import { WORDING } from "../core/wording";
import type { Actor } from "./actor";

/** What the caller tried to create, in the words of the refusal. */
export type ClinicCreateAction = "report" | "draft" | "upload" | "notes" | "analyse" | "form" | "launch";

const WHAT: Record<ClinicCreateAction, string> = {
  report: "starting a new report",
  draft: "drafting answers from the notes",
  upload: "uploading files",
  notes: "reading uploaded notes",
  analyse: "reading a new form",
  form: "adding a new form",
  launch: "starting a report from your clinic system",
};

export function trialEndedError(action: ClinicCreateAction, profile: Pick<ClinicProfile, "contactEmail"> | null): HttpError {
  return new HttpError(403, WORDING.server.access.trialEndedTitle, {
    code: "TRIAL_ENDED",
    detail: WORDING.server.access.trialEnded(WHAT[action], profile?.contactEmail),
  });
}

/** The clinic `tenantId` may create something (`action`), or 403 TRIAL_ENDED. */
export async function assertTenantMayCreate(deps: MedreportDeps, tenantId: TenantId, action: ClinicCreateAction): Promise<void> {
  if (!deps.clinicProfile) return;
  const profile = await deps.clinicProfile(tenantId);
  if (profile?.trial?.state === "ended") {
    logEvent("clinic_trial_ended_refused", { action });
    throw trialEndedError(action, profile);
  }
  if (profile?.paymentOverdue) {
    logEvent("clinic_payment_overdue_refused", { action });
    throw new HttpError(403, WORDING.server.access.paymentOverdueTitle, { code: "PAYMENT_OVERDUE", detail: WORDING.server.access.paymentOverdue(WHAT[action]) });
  }
}

/** The caller's clinic may create something; the public demo always may. */
export async function assertClinicMayCreate(actor: Actor, deps: MedreportDeps, action: ClinicCreateAction): Promise<void> {
  if (actor.via === "demo") return;
  await assertTenantMayCreate(deps, actor.tenantId, action);
}

/**
 * 13/11/2026 – a self-serve free trial's reports (ClinicProfile.trialReports): once they are all used, drafting answers
 * for a report that has not counted yet is refused with 403 TRIAL_REPORTS_USED ("buy the Reports add-on to continue").
 * A report already inside the allowance may be drafted again (it never counts twice). Only live drafting costs money,
 * so the caller checks only before a live call. The public demo is never affected.
 */
export async function assertTrialReportsLeft(actor: Actor, deps: MedreportDeps, report: { reportId?: string; episodeFp?: string }): Promise<void> {
  if (actor.via === "demo" || !deps.clinicProfile) return;
  const profile = await deps.clinicProfile(actor.tenantId);
  const t = profile?.trialReports;
  if (!t || t.used < t.included) return;
  const key = usageReportKey(report.reportId);
  if (key && deps.usage?.reportCounted) {
    try {
      if (await deps.usage.reportCounted(actor.tenantId, key, report.episodeFp ?? "")) return;
    } catch {
      // cannot tell: refuse (fail closed – drafting costs money)
    }
  }
  logEvent("clinic_trial_reports_refused", { included: t.included });
  throw new HttpError(403, WORDING.server.access.trialReportsUsedTitle, { code: "TRIAL_REPORTS_USED", detail: WORDING.server.access.trialReportsUsed(t.included, t.addon) });
}
