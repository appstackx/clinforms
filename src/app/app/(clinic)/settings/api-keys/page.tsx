import type { Metadata } from "next";
import { Notice, PageHeader, Panel } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { listClinicMembers } from "@/server/auth/membership";
import { isManager } from "@/server/auth/roles";
import { requireAppContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { ukDateTime } from "@/server/email/templates";
import { listPartnerKeys } from "@/server/repos/partner-keys";
import { revokeApiKey } from "./actions";
import { CreateKeyForm } from "./forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const { membership } = await requireAppContext();
  if (!isManager(membership.role)) {
    return (
      <>
        <PageHeader title="API keys" />
        <Notice>Only the clinic&apos;s owners and administrators can see and manage API keys.</Notice>
      </>
    );
  }
  const db = getDb();
  const [keys, members] = await Promise.all([listPartnerKeys({ db }, membership.tenantId), listClinicMembers(db, membership.organizationId)]);
  const nameOf = (userId: string | null) => members.find((m) => m.userId === userId)?.name ?? "a former member";
  return (
    <>
      <PageHeader
        title="API keys"
        description="API keys will let your practice-management system connect to ClinForms. No connection uses them yet."
      />
      <Panel title="Create a key" className="mb-6">
        <CreateKeyForm />
      </Panel>
      <Panel title="Keys">
        {keys.length === 0 ? (
          <p className="text-sm text-slate-600">No keys yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {k.name} <span className="font-mono text-xs text-slate-500">…{k.last4}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    Created {ukDateTime(k.createdAt)} by {nameOf(k.createdBy)}
                    {k.revokedAt ? ` · revoked ${ukDateTime(k.revokedAt)}` : ""}
                  </p>
                </div>
                {k.revokedAt ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Revoked</span>
                ) : (
                  <form action={revokeApiKey}>
                    <input type="hidden" name="id" value={k.id} />
                    <SubmitButton variant="danger" className="h-8 px-2.5 text-xs" pendingText="Revoking…" confirmText={`Revoke the key "${k.name}"? Anything using it stops working.`}>
                      Revoke
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
