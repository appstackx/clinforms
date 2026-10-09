/**
 * HCPC registration numbers: a 2–3 letter profession prefix and 4–6 digits (physiotherapists: "PH" + digits,
 * e.g. PH123456). Format check only – it does not look the number up on the HCPC register.
 */
export const HCPC_PATTERN = /^[A-Z]{2,3}\d{4,6}$/;

export function normaliseHcpc(value: string): string {
  return value.replace(/[\s-]+/g, "").toUpperCase();
}

export function isValidHcpc(value: string): boolean {
  return HCPC_PATTERN.test(normaliseHcpc(value));
}
