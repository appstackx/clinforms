import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImportBatchScreen } from "@/components/pms/integration/import-batch";
import { SetupHeader, SetupPage } from "@/components/pms/reporting/setup-kit";
import { requireClinicActor } from "@/server/pms/actor";
import { importViewFor } from "@/server/pms/integration/import-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Import data" };

/** /app/clinic/setup/import/[batchId] – one import: match columns, check, import, done and undo (settings.import). */
export default async function ImportBatchPage({ params }: { params: { batchId: string } }) {
  const actor = await requireClinicActor({ permission: "settings.import" });
  const view = await importViewFor(actor, params.batchId);
  if (!view.ok) notFound();
  return (
    <SetupPage>
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href="/app/clinic/setup" className="text-primary-strong underline underline-offset-2">
          Set-up
        </Link>{" "}
        /{" "}
        <Link href="/app/clinic/setup/import" className="text-primary-strong underline underline-offset-2">
          Import data
        </Link>{" "}
        / {view.value.kindLabel}
      </nav>
      <SetupHeader
        title="Import from your previous system"
        description={`${view.value.kindLabel}${view.value.fileName ? ` · ${view.value.fileName}` : ""} · ${view.value.rowCount.toLocaleString("en-GB")} rows · ${view.value.headers.length} columns`}
      />
      <ImportBatchScreen view={view.value} basePath="/app/clinic/setup/import" patientsHref="/app/clinic/patients" />
    </SetupPage>
  );
}
