/**
 * Possible duplicate patients (pure): before a new patient is registered (or a patient's identity is changed),
 * the records module looks for patients of the same clinic who may be the same person, so reception can open the
 * existing record instead of creating a second one. Nothing is merged automatically (merging duplicates is a later
 * requirement, K2-PAT-012); the person decides.
 *
 * A match needs one strong reason: the same last name and date of birth, the same email, or the same phone number
 * (10+ digits). The same first and last name alone is shown only together with one of those.
 */
import { phoneDigits, searchKey } from "../core/text";

export const DUPLICATE_REASONS = ["name_and_birth_date", "email", "phone"] as const;
export type DuplicateReason = (typeof DUPLICATE_REASONS)[number];

export const DUPLICATE_REASON_LABELS: Readonly<Record<DuplicateReason, string>> = {
  name_and_birth_date: "Same last name and date of birth",
  email: "Same email address",
  phone: "Same phone number",
};

export interface DuplicateProbe {
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  email?: string | null;
  phones?: readonly (string | null | undefined)[];
}

/** The normalised keys a probe is searched by (empty ones left out). */
export function duplicateKeys(probe: DuplicateProbe): { lastName: string | null; dateOfBirth: string | null; email: string | null; phones: string[] } {
  const last = searchKey(probe.lastName ?? "");
  const dob = typeof probe.dateOfBirth === "string" && /^\d{4}-\d{2}-\d{2}$/.test(probe.dateOfBirth) ? probe.dateOfBirth : null;
  const email = typeof probe.email === "string" && probe.email.includes("@") ? probe.email.trim().toLowerCase() : null;
  const phones = Array.from(new Set((probe.phones ?? []).map((p) => phoneDigits(p ?? "")).filter((d) => d.length >= 10)));
  return { lastName: last || null, dateOfBirth: dob, email, phones };
}

export interface DuplicateCandidate {
  searchName: string;
  dateOfBirth: string | null;
  email: string | null;
  searchPhone: string;
}

/** Why a stored patient may be the probe's person (empty = not a match). */
export function duplicateReasons(probe: DuplicateProbe, candidate: DuplicateCandidate): DuplicateReason[] {
  const keys = duplicateKeys(probe);
  const out: DuplicateReason[] = [];
  const words = new Set(candidate.searchName.split(" ").filter(Boolean));
  const lastWords = (keys.lastName ?? "").split(" ").filter(Boolean);
  if (keys.dateOfBirth && candidate.dateOfBirth === keys.dateOfBirth && lastWords.length > 0 && lastWords.every((w) => words.has(w))) out.push("name_and_birth_date");
  if (keys.email && candidate.email && candidate.email.toLowerCase() === keys.email) out.push("email");
  const stored = candidate.searchPhone.split(" ").filter(Boolean);
  if (keys.phones.some((p) => stored.includes(p))) out.push("phone");
  return out;
}
