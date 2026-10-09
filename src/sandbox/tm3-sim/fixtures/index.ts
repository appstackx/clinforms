/**
 * Fictional sandbox data. Clinic: Riverside Physiotherapy (fictional), Milton Keynes. HCPC-style numbers
 * use the invalid demo format PH-DEMO-01.
 *
 *   sim-pat-001  Megan Hart      episode sim-ep-1001  RTA / WAD II, Harrow & Pike Solicitors (fictional)
 *   sim-pat-002  Daniel Brooks   episode sim-ep-1002  lifting injury, Ashby Freight Ltd (fictional)
 *   sim-pat-003  Aisha Rahman    registration only
 *   sim-pat-004  George Whitfield registration only
 *   sim-pat-005  Chloe Bennett   registration only
 *
 * Arrays are in chronological order; the handlers page and filter them, and the module's mapper sorts
 * notes itself, so order here is not load-bearing.
 *
 * Owner: sandbox/fixtures agent.
 */
import type { SimAppointment, SimEpisode, SimNote, SimOutcomeMeasure, SimPatient } from "../wire-types";
import {
  DANIEL_BROOKS_APPOINTMENTS,
  DANIEL_BROOKS_EPISODE,
  DANIEL_BROOKS_NOTES,
  DANIEL_BROOKS_OUTCOME_MEASURES,
  DANIEL_BROOKS_PATIENT,
} from "./daniel-brooks";
import { FILLER_PATIENTS } from "./fillers";
import {
  MEGAN_HART_APPOINTMENTS,
  MEGAN_HART_EPISODE,
  MEGAN_HART_NOTES,
  MEGAN_HART_OUTCOME_MEASURES,
  MEGAN_HART_PATIENT,
} from "./megan-hart";

export { SIM_CLINIC, SIM_CLINICIANS, SARAH_REID, TOM_ELLIS } from "./clinic";
export { MEGAN_HART_PATIENT_ID, MEGAN_HART_EPISODE_ID } from "./megan-hart";
export { DANIEL_BROOKS_PATIENT_ID, DANIEL_BROOKS_EPISODE_ID } from "./daniel-brooks";

export const SIM_PATIENTS: SimPatient[] = [MEGAN_HART_PATIENT, DANIEL_BROOKS_PATIENT, ...FILLER_PATIENTS];
export const SIM_EPISODES: SimEpisode[] = [MEGAN_HART_EPISODE, DANIEL_BROOKS_EPISODE];
export const SIM_NOTES: SimNote[] = [...MEGAN_HART_NOTES, ...DANIEL_BROOKS_NOTES];
export const SIM_APPOINTMENTS: SimAppointment[] = [...MEGAN_HART_APPOINTMENTS, ...DANIEL_BROOKS_APPOINTMENTS];
export const SIM_OUTCOME_MEASURES: SimOutcomeMeasure[] = [
  ...MEGAN_HART_OUTCOME_MEASURES,
  ...DANIEL_BROOKS_OUTCOME_MEASURES,
];

/** Demo case slugs → wire IDs (used by scripts/medreport/dev-bundles.ts and the sandbox UI). */
export const SIM_DEMO_CASES = {
  "megan-hart": { patientId: "sim-pat-001", episodeId: "sim-ep-1001" },
  "daniel-brooks": { patientId: "sim-pat-002", episodeId: "sim-ep-1002" },
} as const;
export type SimDemoCaseSlug = keyof typeof SIM_DEMO_CASES;

/** Everything the simulated API holds for one episode (same filtering the handlers apply). */
export function simEpisodeData(episodeId: string):
  | {
      patient: SimPatient;
      episode: SimEpisode;
      notes: SimNote[];
      appointments: SimAppointment[];
      outcomeMeasures: SimOutcomeMeasure[];
    }
  | undefined {
  const episode = SIM_EPISODES.find((e) => e.id === episodeId);
  if (!episode) return undefined;
  const patient = SIM_PATIENTS.find((p) => p.id === episode.patient_id);
  if (!patient) return undefined;
  return {
    patient,
    episode,
    notes: SIM_NOTES.filter((n) => n.episode_id === episodeId),
    appointments: SIM_APPOINTMENTS.filter((a) => a.episode_id === episodeId),
    outcomeMeasures: SIM_OUTCOME_MEASURES.filter((m) => m.episode_id === episodeId),
  };
}
