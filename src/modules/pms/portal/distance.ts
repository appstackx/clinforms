/**
 * Distance from the patient to a site (pure, browser-safe). Used ONLY in the patient's browser after they tap
 * "Use my location" or enter a postcode (Khuram, 28/10/2026): the site's map position comes with the page, the
 * patient's position never leaves the browser and nothing is stored.
 */
export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Great-circle distance in miles (haversine; the Earth's mean radius). */
export function milesBetween(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "0.8 miles", "12 miles" (at least 0.1). */
export function formatMiles(miles: number): string {
  const m = Math.max(0.1, miles);
  return m < 10 ? `${m.toFixed(1)} miles` : `${Math.round(m)} miles`;
}
