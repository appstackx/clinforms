/**
 * UK postcode-district centres for "how far is each site" on the online booking page (Khuram's decision 28/10/2026:
 * bundle the ONS list so a typed postcode in any district gives distances, no lookup service). The data is
 * ./data/postcode-districts.json – 2,863 Great Britain districts, the mean position of each district's live postcodes
 * in the ONS Postcode Directory (August 2026), 3 decimals; Northern Ireland (BT) is left out (its data needs a separate
 * licence for commercial use). Source and method: ./data/postcode-districts.SOURCE.md. Open Government Licence v3.0 –
 * the attribution lines below must be shown where it is used (the booking page shows them under the sites).
 * Browser-safe: loaded on first use as its own small chunk from this site; the patient's postcode never leaves the
 * browser.
 */
import type { LatLng } from "./distance";

export const ONS_ATTRIBUTION: readonly string[] = [
  "Contains OS data © Crown copyright and database right 2026.",
  "Contains Royal Mail data © Royal Mail copyright and database right 2026.",
  "Source: Office for National Statistics licensed under the Open Government Licence v.3.0.",
];

export type DistrictCentres = Readonly<Record<string, readonly [number, number]>>;

/** The outward code ("MK9") of a full or partial UK postcode, or null. */
export function postcodeDistrict(text: string): string | null {
  const compact = text.trim().toUpperCase().replace(/\s+/g, "");
  const full = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/.exec(compact);
  if (full) return full[1];
  return /^[A-Z]{1,2}\d[A-Z\d]?$/.test(compact) ? compact : null;
}

/** The district's centre, or null when it is not in the list (Northern Ireland, non-geographic, unknown). */
export function districtCentre(centres: DistrictCentres, district: string): LatLng | null {
  const at = centres[district];
  return at ? { latitude: at[0], longitude: at[1] } : null;
}

let loading: Promise<DistrictCentres | null> | null = null;

/** The list, loaded once (null if it could not be loaded – the page then falls back to "Use my location"). */
export function loadDistrictCentres(): Promise<DistrictCentres | null> {
  if (!loading) {
    loading = import("./data/postcode-districts.json")
      .then((m) => (m.default ?? m) as unknown as DistrictCentres)
      .catch(() => null);
  }
  return loading;
}
