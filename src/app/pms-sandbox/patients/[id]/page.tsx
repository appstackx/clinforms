import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PRODUCT } from "@/modules/medreport/config.public";
import {
  SIM_APPOINTMENTS,
  SIM_CLINICIANS,
  SIM_EPISODES,
  SIM_NOTES,
  SIM_OUTCOME_MEASURES,
  SIM_PATIENTS,
} from "@/sandbox/tm3-sim/fixtures";
import { fullName } from "@/sandbox/tm3-sim/ui/format";
import { PatientRecord, type EpisodeRecord } from "@/sandbox/tm3-sim/ui/patient-record";
import { launchReportAction } from "../../actions";

type Props = { params: { id: string } };

function findPatient(id: string) {
  return SIM_PATIENTS.find((p) => p.id === id);
}

export function generateMetadata({ params }: Props): Metadata {
  const patient = findPatient(params.id);
  return { title: patient ? `${fullName(patient)} · Patient record` : "Patient not found" };
}

/**
 * /pms-sandbox/patients/[id] – simulated clinic patient record (demo scaffolding, not the product).
 *
 * Owner: sandbox agent.
 */
export default function SandboxPatientPage({ params }: Props) {
  const patient = findPatient(params.id);
  if (!patient) notFound();

  const episodes: EpisodeRecord[] = SIM_EPISODES.filter((e) => e.patient_id === patient.id)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map((episode) => ({
      episode,
      notes: SIM_NOTES.filter((n) => n.episode_id === episode.id),
      appointments: SIM_APPOINTMENTS.filter((a) => a.episode_id === episode.id),
      outcomeMeasures: SIM_OUTCOME_MEASURES.filter((m) => m.episode_id === episode.id),
    }));

  return (
    <PatientRecord
      appName={PRODUCT.name}
      patient={patient}
      episodes={episodes}
      clinicians={SIM_CLINICIANS}
      launch={launchReportAction}
    />
  );
}
