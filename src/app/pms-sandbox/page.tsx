import type { Metadata } from "next";
import { Info } from "lucide-react";
import Link from "next/link";
import { SIM_DEMO_CASES, SIM_EPISODES, SIM_PATIENTS } from "@/sandbox/tm3-sim/fixtures";
import { ageOn } from "@/sandbox/tm3-sim/ui/format";
import { PatientList, type PatientListRow } from "@/sandbox/tm3-sim/ui/patient-list";

/** A title template does not apply to the segment that defines it, so set the full title here. */
export const metadata: Metadata = { title: { absolute: "Patients · Simulated TM3 sandbox" } };

/**
 * /pms-sandbox – patient list of the simulated clinic system (demo scaffolding, not the product).
 * The clinic system's own UI reads its own records directly; ClinForms reads them over the
 * simulated API.
 *
 * Owner: sandbox agent.
 */
export default function SandboxPatientsPage() {
  const rows: PatientListRow[] = SIM_PATIENTS.map((p) => {
    const episodes = SIM_EPISODES.filter((e) => e.patient_id === p.id).sort((a, b) =>
      a.start_date.localeCompare(b.start_date),
    );
    const latest = episodes[episodes.length - 1];
    return {
      id: p.id,
      title: p.title,
      firstName: p.first_name,
      lastName: p.last_name,
      dateOfBirth: p.date_of_birth,
      age: ageOn(p.date_of_birth),
      postcode: p.address.postcode,
      town: p.address.town,
      episode: latest
        ? {
            title: latest.title,
            status: latest.status,
            startDate: latest.start_date,
            referralSource: latest.referral.source_type,
            organisation: latest.referral.organisation_name,
          }
        : null,
    };
  });

  const megan = SIM_DEMO_CASES["megan-hart"].patientId;
  const daniel = SIM_DEMO_CASES["daniel-brooks"].patientId;

  return (
    <div className="space-y-5">
      <PatientList rows={rows} />
      <aside className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-slate-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" aria-hidden />
        <p>
          <span className="font-medium text-slate-900">Demo cases: </span>
          <Link
            href={`/pms-sandbox/patients/${megan}`}
            className="font-medium text-blue-800 underline underline-offset-2 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            Megan Hart
          </Link>{" "}
          (road traffic accident, solicitor referral) and{" "}
          <Link
            href={`/pms-sandbox/patients/${daniel}`}
            className="font-medium text-blue-800 underline underline-offset-2 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            Daniel Brooks
          </Link>{" "}
          (lifting injury at work, employer referral). The other patients are registered only. Every name,
          organisation and record here is fictional.
        </p>
      </aside>
    </div>
  );
}
