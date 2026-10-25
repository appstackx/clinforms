/**
 * Demo clinics (the host's clinic_plan.demo_clinic = 1, switched on and off by ClinForms platform staff only –
 * `npm run admin:set-demo-clinic` or /app/platform; never by a clinic's own owner or administrators).
 *
 * A demo clinic is an ordinary clinic account that holds MADE-UP data only. It works exactly like a customer's
 * clinic (sign-in, members, forms, drafting, approval), with three differences – all decided by the SERVER from the
 * clinic's plan, never by the browser:
 *
 * - A banner on every clinic page and Studio page ("Demo clinic – made-up data only").
 * - Every output carries a demonstration notice (demoOutputNotice below): the draft preview, the Word / PDF files
 *   (referrer's form, its PDF copy, a portal question set's summary, a built-in report) and copied answers.
 * - Members' signing details may hold the made-up PH-DEMO-NN numbers (Sarah Reid PH-DEMO-01, Tom Ellis PH-DEMO-02 …),
 *   and a member with one may approve. Anywhere else – any real clinic – such a number is refused: the members page
 *   will not save it (src/lib/hcpc.ts signingNumberFor) and POST /sign refuses to approve with it
 *   (403 DEMO_NUMBER_NOT_ALLOWED), so a made-up number never ends up on a real clinic's form.
 *
 * Pure and browser-safe (no env, no Node built-ins).
 */
import { WORDING } from "./wording";

/** PH-DEMO-NN, also typed with spaces, without hyphens or in small letters ("ph demo 01", "PHDEMO01"). */
const DEMO_HCPC_LOOSE = /^PH-?DEMO-?(\d{2})$/;

/** "PH-DEMO-01" for any accepted spelling of a made-up demo number, else null. */
export function normaliseDemoHcpc(value: string | null | undefined): string | null {
  const m = DEMO_HCPC_LOOSE.exec(
    String(value ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, "")
      .toUpperCase(),
  );
  return m ? `PH-DEMO-${m[1]}` : null;
}

/** Whether a number is a made-up demo number (PH-DEMO-NN) – accepted in a demo clinic only. */
export function isDemoHcpc(value: string | null | undefined): boolean {
  return normaliseDemoHcpc(value) !== null;
}

/**
 * The notice an output carries: in a demo clinic the form's own demonstration notice when it has one (a public
 * insurer form used in a demo), else the demo clinic notice; outside a demo clinic only the form's own notice, as
 * before (undefined for an ordinary form – ordinary clinics are unchanged).
 */
export function demoOutputNotice(form: { demoNotice?: string | null } | null | undefined, demoClinic: boolean): string | undefined {
  const own = form?.demoNotice?.replace(/\s+/g, " ").trim();
  if (own) return own;
  return demoClinic ? WORDING.demoClinic.outputNotice : undefined;
}
