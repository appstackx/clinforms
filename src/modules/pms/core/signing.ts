/**
 * A member's signing details (Member access → "Signing details"; foundation): the professional register, the
 * registration number on it and whether they may sign clinical notes. Kept on the member's practitioner record –
 * the records module's sign check reads them (no number, or signing switched off: nothing is signed).
 *
 * Formats (format only – nothing is looked up on the register):
 *   HCPC (physiotherapists)  "PH" + 4–6 digits, typed with or without spaces / hyphens, any case ("ph 123456").
 *   Demo clinics only        the made-up PH-DEMO-NN numbers (main's demo rules – the same pattern as
 *                            src/modules/medreport/core/demo-clinic.ts) – refused anywhere else, so a made-up number never reaches a real
 *                            clinic's notes. Whether the clinic is a demo is read on the server, never from the form.
 * Pure and browser-safe.
 */
/** PH-DEMO-NN, also typed with spaces, without hyphens or in small letters – the same rule as main's demo clinics. */
const DEMO_LOOSE = /^PH-?DEMO-?(\d{2})$/;

function normaliseDemoHcpc(value: string): string | null {
  const m = DEMO_LOOSE.exec(value.normalize("NFKC").replace(/\s+/g, "").toUpperCase());
  return m ? `PH-DEMO-${m[1]}` : null;
}

export const REGISTRATION_BODIES = ["HCPC"] as const;
export type RegistrationBody = (typeof REGISTRATION_BODIES)[number];

export const REGISTRATION_BODY_LABELS: Readonly<Record<RegistrationBody, string>> = {
  HCPC: "HCPC (Health and Care Professions Council)",
};

export function isRegistrationBody(value: unknown): value is RegistrationBody {
  return typeof value === "string" && (REGISTRATION_BODIES as readonly string[]).includes(value);
}

/** HCPC physiotherapist numbers: PH and 4–6 digits. */
const HCPC_PH = /^PH\d{4,6}$/;

export interface SigningInput {
  registrationBody: string;
  registrationNumber: string;
  maySign: boolean;
}

export type SigningCheck =
  | { ok: true; value: { registrationBody: RegistrationBody; registrationNumber: string | null; maySign: boolean } }
  | { ok: false; fieldErrors: Partial<Record<keyof SigningInput, string>> };

export const SIGNING_COPY = {
  body: "Choose the register.",
  number: "Enter the HCPC number as PH followed by digits, e.g. PH123456.",
  demoOnly: "PH-DEMO numbers are made-up demo numbers and are only accepted in a demo clinic.",
  needNumber: "Add a registration number before switching signing on.",
} as const;

/**
 * Checks and normalises signing details. An empty number is allowed (the member cannot sign until one is added);
 * "may sign" needs a number.
 */
export function checkSigning(input: SigningInput, opts: { demoClinic: boolean }): SigningCheck {
  if (!isRegistrationBody(input.registrationBody)) return { ok: false, fieldErrors: { registrationBody: SIGNING_COPY.body } };
  const raw = String(input.registrationNumber ?? "").normalize("NFKC").trim();
  let number: string | null = null;
  if (raw) {
    const demo = normaliseDemoHcpc(raw);
    if (demo) {
      if (!opts.demoClinic) return { ok: false, fieldErrors: { registrationNumber: SIGNING_COPY.demoOnly } };
      number = demo;
    } else {
      const plain = raw.replace(/[\s-]+/g, "").toUpperCase();
      if (!HCPC_PH.test(plain)) return { ok: false, fieldErrors: { registrationNumber: SIGNING_COPY.number } };
      number = plain;
    }
  }
  if (input.maySign === true && !number) return { ok: false, fieldErrors: { registrationNumber: SIGNING_COPY.needNumber } };
  return { ok: true, value: { registrationBody: input.registrationBody, registrationNumber: number, maySign: input.maySign === true } };
}

/** "Signed by Priya Shah, Physiotherapist · HCPC PH123456" – how signed notes show it. */
export function signedByLine(name: string, title: string | null, body: string | null, number: string | null): string {
  return `Signed by ${name}${title ? `, ${title}` : ""}${number ? ` · ${body ?? "HCPC"} ${number}` : ""}`;
}
