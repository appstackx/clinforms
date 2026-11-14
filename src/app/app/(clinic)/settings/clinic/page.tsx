import type { Metadata } from "next";
import { Notice, PageHeader, Panel } from "@/components/account/shell";
import { clinicTrialRunning } from "@/server/admin/clinic-plan";
import { isManager } from "@/server/auth/roles";
import { requireAppContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { hasPackage } from "@/server/pms/entitlements";
import { getClinicProfile } from "@/server/repos/clinic-profile";
import { clinicSignedUpOnline } from "@/server/repos/signup";
import { ClinicProfileForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clinic details" };

export default async function ClinicSettingsPage() {
  const { membership } = await requireAppContext();
  const db = getDb();
  const [profile, trial, reports, selfServe] = await Promise.all([
    getClinicProfile({ db }, membership.tenantId),
    clinicTrialRunning(db, membership.tenantId),
    hasPackage(membership.tenantId, "reports"),
    // 14/11/2026: a clinic that signed up online had drafting switched on at sign-up – the wording says so.
    clinicSignedUpOnline({ db }, membership.tenantId).catch(() => false),
  ]);
  const editable = isManager(membership.role);
  return (
    <>
      <PageHeader title="Clinic details" description={reports ? "These details are written into the referrer forms your clinic completes." : "Your clinic's name, address and contact details."} />
      <Panel>
        {!editable ? (
          <div className="mb-4">
            <Notice>Only the clinic&apos;s owners and administrators can change these details.</Notice>
          </div>
        ) : null}
        <ClinicProfileForm
          editable={editable}
          trial={trial}
          selfServe={selfServe}
          reports={reports}
          values={{
            displayName: profile?.displayName ?? membership.clinicName,
            legalName: profile?.legalName ?? "",
            address: (profile?.address ?? []).join("\n"),
            postcode: profile?.postcode ?? "",
            phone: profile?.phone ?? "",
            email: profile?.email ?? "",
            retentionDays: profile?.retentionDays ?? 365,
            draftingEnabled: profile?.draftingEnabled === true,
          }}
        />
        <p className="mt-6 text-xs text-slate-500">Clinic id: {membership.tenantId} (fixed).</p>
      </Panel>
    </>
  );
}
