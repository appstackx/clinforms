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
  if (profile?.productReadOnly) {
    logEvent("clinic_product_read_only_refused", { action });
    throw new HttpError(403, WORDING.server.access.readOnlyTitle, { code: "READ_ONLY", detail: profile.productReadOnly });
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

/** A reservation of one free report (release it when the live call failed without cost). */
export interface TrialReportHold {
  release(): Promise<void>;
}

/**
 * 13/11/2026 – a self-serve free trial's reports (ClinicProfile.trialReports): before a LIVE drafting call (only live
 * drafting costs money) one free report is RESERVED for the report, atomically (deps.usage.reserveTrialReport), so
 * parallel drafts can never draft more than the allowance. Once they are all used or reserved, drafting answers for a
 * report that has not counted is refused with 403 TRIAL_REPORTS_USED ("buy the Reports add-on to continue"). Allowed
 * without a new reservation: a report that already counted or holds one (it never counts twice), and an AMENDMENT of a
 * counted report (it never counts – review item 13). The public demo is never affected. Returns the hold to release
 * when the call fails without cost, or null.
 */
export async function holdTrialReport(actor: Actor, deps: MedreportDeps, report: { reportId?: string; amendsReportId?: string; episodeFp?: string }): Promise<TrialReportHold | null> {
  if (actor.via === "demo" || !deps.clinicProfile) return null;
  const profile = await deps.clinicProfile(actor.tenantId);
  const t = profile?.trialReports;
  if (!t) return null;
  const fp = report.episodeFp ?? "";
  const refuse = () => {
    logEvent("clinic_trial_reports_refused", { included: t.included });
    return new HttpError(403, WORDING.server.access.trialReportsUsedTitle, { code: "TRIAL_REPORTS_USED", detail: WORDING.server.access.trialReportsUsed(t.included, t.addon) });
  };
  const counted = async (id: string | undefined) => {
    const key = usageReportKey(id);
    if (!key || !deps.usage?.reportCounted) return false;
    try {
      return await deps.usage.reportCounted(actor.tenantId, key, fp);
    } catch {
      return false; // cannot tell: treated as not counted (the reservation below decides)
    }
  };
  if ((await counted(report.amendsReportId)) || (await counted(report.reportId))) return null;
  if (t.used >= t.included) throw refuse();
  if (!deps.usage?.reserveTrialReport) return null;
  // No report id (counts as a report of its own): a key of this call.
  const key = usageReportKey(report.reportId) ?? `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  let r: "reserved" | "held" | "full";
  try {
    r = await deps.usage.reserveTrialReport(actor.tenantId, key, fp);
  } catch {
    throw refuse(); // fail closed: drafting costs money
  }
  if (r === "full") throw refuse();
  if (r === "held") return null;
  const usage = deps.usage;
  return { release: async () => void (await usage.releaseTrialReport?.(actor.tenantId, key, fp).catch(() => undefined)) };
}
