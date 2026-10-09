/**
 * Which clinic a report names (referrer forms' clinic.* answers, the built-in templates' letterhead,
 * footer and introduction, the appointments table's "clinic" column).
 *
 * - A clinic's own bundle (wave 2) carries `bundle.clinic`, put there by the server from the signed-in
 *   member's clinic profile (api/handlers/file-import-bundle.ts).
 * - The public demo's bundles (tenant "demo") carry none and keep the fictional DEMO_CLINIC.
 * - A clinic's bundle WITHOUT a profile names no clinic (the clinic fields are left blank): the fictional
 *   demo clinic is never written onto a real clinic's form.
 *
 * Pure and browser-safe.
 */
import { DEMO_CLINIC, DEMO_TENANT_ID } from "../config.public";
import type { ClinicDetails, EpisodeBundle } from "./types";

/** DEMO_CLINIC as ClinicDetails. */
export const DEMO_CLINIC_DETAILS: ClinicDetails = {
  name: DEMO_CLINIC.name,
  addressLines: Array.from(DEMO_CLINIC.addressLines),
  phone: DEMO_CLINIC.phone,
  email: DEMO_CLINIC.email,
};

/** The clinic this bundle's documents name, or null (a clinic with no profile yet). */
export function bundleClinic(bundle: Pick<EpisodeBundle, "tenantId" | "clinic">): ClinicDetails | null {
  if (bundle.clinic) return bundle.clinic;
  return bundle.tenantId === DEMO_TENANT_ID ? DEMO_CLINIC_DETAILS : null;
}

/** A clinic profile (api/deps.ts ClinicProfile, structurally) → the details written into documents. */
export function clinicDetailsFromProfile(profile: {
  displayName: string;
  addressLines: string[];
  postcode?: string;
  phone?: string;
  email?: string;
}): ClinicDetails {
  const lines = profile.addressLines.map((l) => l.trim()).filter(Boolean);
  const postcode = profile.postcode?.trim();
  if (postcode && !lines.some((l) => l.toUpperCase() === postcode.toUpperCase())) lines.push(postcode);
  return {
    name: profile.displayName.trim().slice(0, 200) || "Clinic",
    addressLines: lines.slice(0, 12).map((l) => l.slice(0, 200)),
    ...(profile.phone?.trim() ? { phone: profile.phone.trim().slice(0, 40) } : {}),
    ...(profile.email?.trim() ? { email: profile.email.trim().slice(0, 254) } : {}),
  };
}
