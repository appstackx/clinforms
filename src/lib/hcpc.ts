/**
 * HCPC registration numbers: a 2–3 letter profession prefix and 4–6 digits (physiotherapists: "PH" + digits,
 * e.g. PH123456). Format check only – it does not look the number up on the HCPC register.
 *
 * Demo clinics (clinic_plan.demo_clinic, set by ClinForms platform staff only) also accept the made-up format
 * PH-DEMO-NN (src/modules/medreport/core/demo-clinic.ts) – a real clinic never does: isValidHcpc() refuses it, and
 * POST /sign refuses to approve with one outside a demo clinic.
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
 * A member's signing number as it is stored: a registration number (normalised, e.g. "PH123456") in any clinic, or –
 * in a demo clinic only – a made-up demo number ("PH-DEMO-01"). null when the value is not accepted here. The caller
 * reads `demoClinic` on the server (the clinic's plan), never from the form.
 */
export function signingNumberFor(value: string, opts: { demoClinic: boolean }): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const demo = normaliseDemoHcpc(raw);
  if (demo) return opts.demoClinic ? demo : null;
  return isValidHcpc(raw) ? normaliseHcpc(raw) : null;
}
