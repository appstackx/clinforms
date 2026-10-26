import type { Metadata } from "next";
import { EmptyState, SectionHeader, TableBox, TD, TH } from "@/components/pms/records/ui";
import { describeRecordsDetail } from "@/modules/pms/records/copy";
import { activityTime, loadActivityLookups, presentActivity } from "@/server/admin/activity";
import { requireClinicActor } from "@/server/pms/actor";
import { patientOr404 } from "@/server/pms/records/record";
import { listPatientHistory } from "@/server/repos/pms/records/history";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "History" };

/**
 * Who did what with this patient's record, newest first: registration and changes, cases and authorisations, notes
 * written, signed, amended and OPENED, outcome measures, files attached and downloaded, exports. From the clinic's
 * append-only audit log (ids and counts only – no patient details are stored there).
 */
export default async function PatientHistoryPage({ params }: { params: { patientId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.view" });
  const patient = await patientOr404(actor, params.patientId);
  const ctx = actor.repo();
  const entries = await listPatientHistory(ctx, actor.tenantId, patient.id, { limit: 300 });
  const lookups = await loadActivityLookups(ctx.db, { tenantId: actor.tenantId, organizationId: actor.organizationId, role: actor.role, userId: actor.userId }, entries);
  const rows = presentActivity(entries, lookups);
  return (
    <>
      <SectionHeader title="History" description="Everything done with this record, newest first – including who opened its clinical notes. The latest 300 entries." />
      {rows.length === 0 ? (
        <EmptyState title="Nothing recorded yet" />
      ) : (
        <TableBox caption="History of this record">
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className={TH}>
                When
              </th>
              <th scope="col" className={TH}>
                Who
              </th>
              <th scope="col" className={TH}>
                What
              </th>
              <th scope="col" className={TH}>
                Detail
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className={`${TD} whitespace-nowrap tabular-nums`}>{activityTime(r.at)}</td>
                <td className={TD}>{r.who}</td>
                <td className={TD}>{r.label}</td>
                <td className={`${TD} text-slate-700`}>{describeRecordsDetail(r.action, entries[i].detail) ?? r.detail ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </TableBox>
      )}
    </>
  );
}
