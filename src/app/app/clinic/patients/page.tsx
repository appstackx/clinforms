import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/account/shell";
import { EmptyState, LinkButton, Pill, TableBox, TD, TH } from "@/components/pms/records/ui";
import { formatUkDate, ukToday } from "@/modules/pms/core/text";
import { ageOn } from "@/modules/pms/records/form-values";
import type { PatientStatus } from "@/modules/pms/core/types";
import { requireClinicActor } from "@/server/pms/actor";
import { PATIENTS_PATH, patientPath } from "@/server/pms/records/record";
import { searchPatients } from "@/server/repos/pms/patients";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Patients" };

const PAGE_SIZE = 25;
const STATUSES: { value: PatientStatus | "any"; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "deceased", label: "Deceased" },
  { value: "any", label: "All" },
];
const SELECT =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30";
const PAGER =
  "inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700";

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** /app/clinic/patients – find a patient by name, number, phone, date of birth or email. */
export default async function PatientsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "patients.view" });
  const q = one(searchParams.q).slice(0, 120);
  const statusParam = one(searchParams.status);
  const status = (STATUSES.some((s) => s.value === statusParam) ? statusParam : "active") as PatientStatus | "any";
  const page = Math.max(1, Math.min(400, Math.floor(Number(one(searchParams.page)) || 1)));
  const rows = await searchPatients(actor.repo(), actor.tenantId, { q, status, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE });
  const more = rows.length > PAGE_SIZE;
  const patients = rows.slice(0, PAGE_SIZE);
  const today = ukToday();
  const href = (p: number) => `${PATIENTS_PATH}?${new URLSearchParams({ ...(q ? { q } : {}), ...(status !== "active" ? { status } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Patients" description="Find a patient by name, patient number, phone number, date of birth or email address." />
        {actor.can("patients.edit") ? <LinkButton href={`${PATIENTS_PATH}/new`}>Register a patient</LinkButton> : null}
      </div>

      <form method="get" action={PATIENTS_PATH} role="search" className="mb-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <div className="space-y-1.5">
          <label htmlFor="patient-search" className="block text-sm font-medium text-slate-800">
            Find a patient
          </label>
          <input
            id="patient-search"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={120}
            autoComplete="off"
            aria-describedby="patient-search-hint"
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
          />
          <p id="patient-search-hint" className="text-xs text-slate-600">
            For example: Hart, 1042, 07700 900123, 22/11/1991
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="patient-status" className="block text-sm font-medium text-slate-800">
            Records
          </label>
          <select id="patient-status" name="status" defaultValue={status} className={SELECT}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 sm:mb-[1.375rem]"
        >
          Search
        </button>
      </form>

      {patients.length === 0 ? (
        <EmptyState
          title={q ? "No patient matches your search" : "No patients yet"}
          action={actor.can("patients.edit") ? <LinkButton href={`${PATIENTS_PATH}/new`}>Register a patient</LinkButton> : undefined}
        >
          {q ? "Check the spelling, or search by patient number or date of birth instead." : status !== "active" ? "No records with this status." : "Registered patients appear here."}
        </EmptyState>
      ) : (
        <>
          <p className="mb-2 text-sm text-slate-600" aria-live="polite">
            {q ? `Patients matching “${q}”` : "Patients"} – page {page}
          </p>
          <TableBox caption="Patients">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className={TH}>
                  No.
                </th>
                <th scope="col" className={TH}>
                  Name
                </th>
                <th scope="col" className={TH}>
                  Date of birth
                </th>
                <th scope="col" className={TH}>
                  Mobile
                </th>
                <th scope="col" className={TH}>
                  Postcode
                </th>
                <th scope="col" className={TH}>
                  Last seen
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {patients.map((p) => {
                const age = ageOn(p.dateOfBirth, today);
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className={`${TD} tabular-nums text-slate-700`}>{p.patientNumber}</td>
                    <td className={TD}>
                      <Link href={patientPath(p.id)} className="rounded font-medium text-teal-800 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
                        {p.lastName}, {p.firstName}
                        {p.preferredName && p.preferredName !== p.firstName ? ` (${p.preferredName})` : ""}
                      </Link>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {p.hasAlerts ? <Pill tone="red">Alerts</Pill> : null}
                        {p.legalHold ? <Pill tone="amber">On hold</Pill> : null}
                        {p.status !== "active" ? <Pill>{p.status === "archived" ? "Archived" : "Deceased"}</Pill> : null}
                      </span>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {formatUkDate(p.dateOfBirth)}
                      {age !== null ? <span className="text-slate-600"> ({age})</span> : null}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{p.phoneMobile ?? ""}</td>
                    <td className={`${TD} whitespace-nowrap`}>{p.postcode ?? ""}</td>
                    <td className={`${TD} whitespace-nowrap`}>{formatUkDate(p.lastSeenOn)}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableBox>
          {page > 1 || more ? (
            <nav aria-label="Pages of patients" className="mt-4 flex gap-2">
              {page > 1 ? (
                <Link href={href(page - 1)} className={PAGER}>
                  Previous
                </Link>
              ) : null}
              {more ? (
                <Link href={href(page + 1)} className={PAGER}>
                  Next
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
