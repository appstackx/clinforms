import type { Metadata } from "next";
import Link from "next/link";
import { ImportStart } from "@/components/pms/integration/import-start";
import { ukDateTimeAt } from "@/components/pms/integration/format";
import { SetupHeader, SetupPage } from "@/components/pms/reporting/setup-kit";
import { describeCounts, BATCH_STATUS_LABELS } from "@/modules/pms/integration/import-status";
import { IMPORT_KIND_INFO } from "@/modules/pms/integration/import-kinds";
import { requireClinicActor } from "@/server/pms/actor";
import { listImportsFor } from "@/server/pms/integration/import-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Import data" };

const BASE = "/app/clinic/setup/import";

/**
 * /app/clinic/setup/import – Set-up → Import data (settings.import; design round 2c "Import from previous system"):
 * upload a CSV of patients, cases, appointments or invoices, and the clinic's earlier imports.
 */
export default async function ImportSetupPage() {
  const actor = await requireClinicActor({ permission: "settings.import" });
  const list = await listImportsFor(actor);
  const rows = list.ok ? list.value : [];
  return (
    <SetupPage>
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href="/app/clinic/setup" className="text-primary-strong underline underline-offset-2">
          Set-up
        </Link>{" "}
        / Import data
      </nav>
      <SetupHeader title="Import from your previous system" description="Bring in patients first, then cases and appointments. Each import can be undone for 7 days." />
      <ImportStart basePath={BASE} />
      <section aria-labelledby="imports-title" className="rounded-2xl border border-border bg-white">
        <h2 id="imports-title" className="border-b border-border px-4 py-3 text-sm font-semibold">
          Earlier imports
        </h2>
        {rows.length === 0 ? (
          <p className="px-4 py-3 text-sm text-[#475569]">No imports yet.</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="import-list">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <Link href={`${BASE}/${r.id}`} className="font-medium text-primary-strong underline underline-offset-2">
                  {r.kindLabel} · {ukDateTimeAt(r.createdAt)}
                </Link>
                <span className="text-[#334155]">{BATCH_STATUS_LABELS[r.status]}</span>
                <span className="min-w-0 flex-1 text-right text-[#475569]">{describeCounts(r.counts, IMPORT_KIND_INFO[r.kind].noun)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </SetupPage>
  );
}
