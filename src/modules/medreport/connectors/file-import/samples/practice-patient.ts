/**
 * The practice patient of a clinic's own Studio (16/11/2026, core/practice.ts): the FICTIONAL Priya Nair case
 * (./priya-nair.ts) under the practice ids, in our documented import layout – so it is read exactly like notes a
 * clinic uploads, and a report made from it is recognised as practice (PRACTICE_PATIENT_ID) wherever it is rendered.
 *
 * BROWSER-SAFE plain data.
 */
import { PRACTICE_EPISODE_ID, PRACTICE_PATIENT_ID } from "../../../core/practice";
import type { ImportDocument } from "../format";
import { PRIYA_NAIR_IMPORT } from "./priya-nair";

export const PRACTICE_PATIENT_IMPORT: ImportDocument = {
  ...PRIYA_NAIR_IMPORT,
  patient: { ...PRIYA_NAIR_IMPORT.patient, id: PRACTICE_PATIENT_ID },
  episode: { ...PRIYA_NAIR_IMPORT.episode, id: PRACTICE_EPISODE_ID },
};

/** The practice record as the Studio sends it to POST /connectors/file-import/read (format "json"). */
export const PRACTICE_PATIENT_FILE = {
  format: "json" as const,
  fileName: "practice-patient.json",
  content: `${JSON.stringify(PRACTICE_PATIENT_IMPORT, null, 2)}\n`,
};
