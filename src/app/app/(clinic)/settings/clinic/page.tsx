import type { Metadata } from "next";
import { Notice, PageHeader, Panel } from "@/components/account/shell";
import { isManager } from "@/server/auth/roles";
import { requireAppContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getClinicProfile } from "@/server/repos/clinic-profile";
import { ClinicProfileForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clinic details" };

export default async function ClinicSettingsPage() {
  const { membership } = await requireAppContext();
  const profile = await getClinicProfile({ db: getDb() }, membership.tenantId);
  const editable = isManager(membership.role);
  return (
    <>
      <PageHeader title="Clinic details" description="These details are written into the referrer forms your clinic completes." />
      <Panel>
        {!editable ? (
          <div className="mb-4">
            <Notice>Only the clinic&apos;s owners and administrators can change these details.</Notice>
          </div>
        ) : null}
        <ClinicProfileForm
          editable={editable}
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
