import { EmptyState, SectionHeader, TableBox, TD, TH } from "@/components/pms/records/ui";
import { describeRecordsDetail } from "@/modules/pms/records/copy";
import { loadActivityLookups, presentActivity } from "@/server/admin/activity";
import { formatUkDateTime } from "@/modules/pms/core/access";
import { requireClinicActor } from "@/server/pms/actor";
import { redactClinicalDetail } from "@/server/pms/records/history-service";
import { patientOr404 } from "@/server/pms/records/record";
import { listPatientHistory } from "@/server/repos/pms/records/history";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "History" }, "patients.view");

/**
 * Who did what with this patient's record, newest first: registration and changes, cases and authorisations, notes
 * written, signed, amended and OPENED, outcome measures, files attached and downloaded, exports. From the clinic's
 * append-only audit log (ids and counts only – no patient details are stored there).
 */
export default async function PatientHistoryPage({ params }: { params: { patientId: string } }) {
  const actor = await requireClinicActor({ permission: "patients.view" });
  const patient = await patientOr404(actor, params.patientId);
  const ctx = actor.repo();
  // Reception sees what happened and when; the details of rows about clinical records need clinical.view.
  const entries = redactClinicalDetail(await listPatientHistory(ctx, actor.tenantId, patient.id, { limit: 300 }), actor.can("clinical.view"));
  const lookups = await loadActivityLookups(ctx.db, { tenantId: actor.tenantId, organizationId: actor.organizationId, role: actor.role, userId: actor.userId }, entries);
  const rows = presentActivity(entries, lookups);
  return (
    <>
      <SectionHeader title="History" description="Everything done with this record, newest first – including who opened its clinical notes. The latest 300 entries." />
      {rows.length === 0 ? (
        <EmptyState title="Nothing recorded yet" />
      ) : (
        <TableBox caption="History of this record">
          <thead className="bg-[#F8FAFC]">
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
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className={`${TD} whitespace-nowrap tabular-nums`}>{formatUkDateTime(r.at)}</td>
                <td className={TD}>{r.who}</td>
                <td className={TD}>{r.label}</td>
                <td className={`${TD} text-[#334155]`}>{describeRecordsDetail(r.action, entries[i].detail) ?? r.detail ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </TableBox>
      )}
    </>
  );
}
