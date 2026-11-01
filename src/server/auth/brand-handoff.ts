/**
 * Brand host hand-off (01/11/2026, Khuram's R1/R2/R3): a clinic is used on ITS brand's host. A ClinDesk clinic (the
 * clinic package on, or created for the clinic brand – brand-links.ts clinicBrandFor) opened on ClinForms' host, or a
 * ClinForms clinic opened on the clinic brand's host, is sent to the sign-in page of its own host. Sessions are
 * host-only (docs/auth.md §1a), so the person signs in there once; the sign-in page says why (?moved=1).
 *
 * Pure (no request, no database): the /app layouts and /app/start call it through src/server/brand-home.ts.
 *
 *   - the same brand, or a deployment that does not serve the clinic's brand host (previews, one-host set-ups): stay;
 *   - Plan and billing (and its done / cancelled pages) never hand off: a ClinForms clinic that has just bought ClinDesk
 *     sees its confirmation first, with a link to ClinDesk's sign-in (the done page);
 *   - the destination is the brand's landing page (/app/start for the clinic brand, /app for ClinForms), never a path
 *     from the request.
 */
import type { BrandId } from "../../lib/brand";
import { linkTarget, type BaseUrlSetting } from "./config";

/** Paths (and everything below them) that never hand off. */
export const HANDOFF_EXEMPT_PATHS = ["/app/settings/billing"] as const;

/** Where a clinic of `brand` lands after signing in on its own host. */
export function brandLandingPath(brand: BrandId): string {
  return brand === "clinic" ? "/app/start" : "/app";
}

/** The sign-in page on `brand`'s own host (null when this deployment does not serve that brand's host). */
export function brandSignInUrl(setting: BaseUrlSetting, brand: BrandId, opts: { moved?: boolean } = {}): string | null {
  const target = linkTarget(setting, brand);
  if (target.brand !== brand) return null;
  return `${target.origin}/login?next=${encodeURIComponent(brandLandingPath(brand))}${opts.moved ? "&moved=1" : ""}`;
}

function exempt(path: string | null | undefined): boolean {
  if (!path) return false;
  const bare = path.split(/[?#]/)[0];
  return HANDOFF_EXEMPT_PATHS.some((p) => bare === p || bare.startsWith(`${p}/`));
}

/** The URL to send the request to, or null to stay on this host. */
export function brandHandoffUrl(input: { hostBrand: BrandId; clinicBrand: BrandId; setting: BaseUrlSetting; path?: string | null }): string | null {
  if (input.hostBrand === input.clinicBrand) return null;
  if (exempt(input.path)) return null;
  return brandSignInUrl(input.setting, input.clinicBrand, { moved: true });
}
