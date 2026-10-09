/**
 * Fictional clinic and clinicians for the simulated TM3 sandbox.
 * HCPC-style numbers use the obviously invalid demo format PH-DEMO-0n.
 *
 * Owner: sandbox/fixtures agent.
 */
import type { SimClinician } from "../wire-types";

export const SIM_CLINIC = {
  name: "Riverside Physiotherapy (fictional)",
  town: "Milton Keynes",
} as const;

export const SARAH_REID: SimClinician = {
  name: "Sarah Reid",
  hcpc: "PH-DEMO-01",
  role: "Senior Physiotherapist, MCSP",
};

export const TOM_ELLIS: SimClinician = {
  name: "Tom Ellis",
  hcpc: "PH-DEMO-02",
  role: "Physiotherapist, MCSP",
};

export const SIM_CLINICIANS: SimClinician[] = [SARAH_REID, TOM_ELLIS];
