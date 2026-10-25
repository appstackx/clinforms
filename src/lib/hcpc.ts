/**
 * HCPC registration numbers: a 2–3 letter profession prefix and 4–6 digits (physiotherapists: "PH" + digits,
 * e.g. PH123456). Format check only – it does not look the number up on the HCPC register.
 *
 * Demonstration clinics (clinic_profile.demo_clinic, set by ClinForms platform staff only) also accept the obviously
 * invalid demonstration format PH-DEMO-0N (src/modules/medreport/core/demo-clinic.ts) – never an ordinary clinic.
 */
import { normaliseDemoHcpc } from "../modules/medreport/core/demo-clinic";

export const HCPC_PATTERN = /^[A-Z]{2,3}\d{4,6}$/;

export function normaliseHcpc(value: string): string {
  return value.replace(/[\s-]+/g, "").toUpperCase();
}

export function isValidHcpc(value: string): boolean {
  return HCPC_PATTERN.test(normaliseHcpc(value));
}

/**
 * A member's signing number as stored: a registration number (normalised, e.g. "PH123456") anywhere, or – in a
 * demonstration clinic only – a demonstration number ("PH-DEMO-01"). null when the value is not acceptable here.
 */
export function signingNumberFor(value: string, opts: { demoClinic: boolean }): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const demo = normaliseDemoHcpc(raw);
  if (demo) return opts.demoClinic ? demo : null;
  return isValidHcpc(raw) ? normaliseHcpc(raw) : null;
}
