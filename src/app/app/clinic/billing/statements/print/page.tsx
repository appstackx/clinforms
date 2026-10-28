import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BILLING_PATH } from "@/components/pms/billing/format";
import { PRINT_CSS, PrintStatementSheet } from "@/components/pms/billing/print-sheets";
import { PrintToolbar } from "@/components/pms/billing/print-toolbar";
import { EmailStatementButton } from "@/components/pms/comms/billing-buttons";
import { addDaysIso } from "@/modules/pms/billing/status";
import { ukToday } from "@/modules/pms/core/text";
import { requireClinicActor } from "@/server/pms/actor";
import { statementFor } from "@/server/pms/billing/views";
import { getPmsSettings } from "@/server/repos/pms/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Statement" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * /app/clinic/billing/statements/print?patient=<id>|account=<id>&from&until (design round 3 "Print – patient
 * statement A4"). Default period: the last 90 days.
 */
export default async function PrintStatementPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "billing.view" });
  const today = ukToday();
  const until = /^\d{4}-\d{2}-\d{2}$/.test(one(searchParams.until)) ? one(searchParams.until) : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(one(searchParams.from)) ? one(searchParams.from) : addDaysIso(until, -90);
  const patient = one(searchParams.patient);
  const account = one(searchParams.account);
  if (!patient && !account) notFound();
  const r = await statementFor(actor, patient ? { patientId: patient } : { payerReferrerId: account }, from, until);
  if (!r.ok) notFound();
  const settings = await getPmsSettings(actor.repo(), actor.tenantId);
  return (
    <div className="flex flex-col gap-4">
      <style>{PRINT_CSS}</style>
      <PrintToolbar backHref={`${BILLING_PATH}?tab=statements`} backLabel="Back to statements" />
      {actor.can("messages.send") ? (
        <div className="print-toolbar mx-auto flex w-full max-w-[794px] justify-end">
          <EmailStatementButton who={patient ? { patientId: patient } : { payerReferrerId: account }} from={from} until={until} />
        </div>
      ) : null}
      <div className="print-root overflow-x-auto">
        <div className="mx-auto w-fit shadow-[0_8px_24px_rgba(15,23,42,0.12)]">
          <PrintStatementSheet clinic={r.value.clinic} statement={r.value.statement} printedBy={r.value.printedBy} printedAt={r.value.printedAt} demo={settings.isDemo} />
        </div>
      </div>
    </div>
  );
}
