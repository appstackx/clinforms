/**
 * M10 H2: who may read a ClinForms report drafted from the clinic system's own record (connector "native").
 *
 * Such a report keeps a frozen copy of the bundle it was drafted from (`bundleSnapshot`): for a member with
 * clinical.view that copy holds signed notes and outcome scores, and an approved form holds the clinician's answers.
 * ClinForms itself lets any member of the clinic read any stored report – so, for these reports only, the clinic
 * system's own rule applies: a native report with clinical content (notes or outcome scores in its snapshot, or
 * approved) is readable only by a member whose clinic-system access includes clinical.view (`resolveMemberAccess`:
 * role → clinic override → own exception → locks). A native report without clinical content (reception started it:
 * no clinical prefill) stays readable, so reception can still complete the forms they start. Every other report
 * – every connector but "native", every clinic without the clinic system – is untouched.
 *
 * Wired into medreport through MedreportDeps.mayReadReport / restrictsReports (src/app/api/_medreport-glue.ts).
 */
import "server-only";
import type { Actor } from "../../modules/medreport/auth/actor";
import type { Report } from "../../modules/medreport/core/types";
import type { DbContext } from "../repos/context";
import { resolveMemberAccess } from "./access";
import { NATIVE_CONNECTOR_ID } from "./integration/bundle";

/** The parts of a report this rule looks at (a stored report may be read with a looser schema). */
type ReportFacts = Pick<Report, "tenantId" | "status"> & {
  episodeRef?: { connectorId?: string } | null;
  bundleSnapshot?: { source?: { connectorId?: string } | null; notes?: readonly unknown[] | null; outcomeMeasures?: readonly unknown[] | null } | null;
};

export function isNativeReport(report: ReportFacts): boolean {
  return report.bundleSnapshot?.source?.connectorId === NATIVE_CONNECTOR_ID || report.episodeRef?.connectorId === NATIVE_CONNECTOR_ID;
}

/** A native report holding clinical content: notes or outcome scores in its snapshot, or approved. */
export function nativeReportIsClinical(report: ReportFacts): boolean {
  if (!isNativeReport(report)) return false;
  const snap = report.bundleSnapshot;
  return report.status === "signed" || (snap?.notes?.length ?? 0) > 0 || (snap?.outcomeMeasures?.length ?? 0) > 0;
}

/** The member's clinic-system access (default: resolveMemberAccess on the app's database). */
export type ClinicalAccessReader = (tenantId: string, userId: string, role: string) => Promise<boolean>;

export function clinicalAccessFrom(db: () => DbContext): ClinicalAccessReader {
  return async (tenantId, userId, role) => {
    const access = await resolveMemberAccess(db(), tenantId, userId, role);
    return access.active && access.can("clinical.view");
  };
}

/** MedreportDeps.mayReadReport: true for every report but a native one with clinical content read without clinical.view. */
export async function mayReadNativeReport(actor: Pick<Actor, "tenantId" | "userId" | "role">, report: ReportFacts, clinicalAccess: ClinicalAccessReader): Promise<boolean> {
  if (!nativeReportIsClinical(report)) return true;
  if (!actor.userId || actor.tenantId !== report.tenantId) return false;
  return clinicalAccess(actor.tenantId, actor.userId, actor.role);
}
