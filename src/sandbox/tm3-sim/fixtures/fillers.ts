/**
 * Three registration-only patients (no episodes) so the simulated patient list looks like a real clinic.
 * All fictional; phone numbers use the Ofcom drama range, emails use example.com.
 *
 * Owner: sandbox/fixtures agent.
 */
import type { SimPatient } from "../wire-types";

export const FILLER_PATIENTS: SimPatient[] = [
  {
    id: "sim-pat-003",
    title: "Ms",
    first_name: "Aisha",
    last_name: "Rahman",
    date_of_birth: "1988-07-02",
    sex: "female",
    address: { line1: "8 Linford Close (fictional)", line2: "Newport Pagnell", town: "Milton Keynes", postcode: "MK16 9ZZ" },
    phone: "07700 900311",
    email: "aisha.rahman@example.com",
    occupation: "Teaching assistant",
    employer_name: null,
    registered_at: "2026-09-28T09:05:00.000Z",
    episode_count: 0,
    _simulated: true,
  },
  {
    id: "sim-pat-004",
    title: "Mr",
    first_name: "George",
    last_name: "Whitfield",
    date_of_birth: "1957-02-11",
    sex: "male",
    address: { line1: "41 Orchard Rise (fictional)", line2: "Stony Stratford", town: "Milton Keynes", postcode: "MK11 8ZZ" },
    phone: "07700 900742",
    email: null,
    occupation: "Retired",
    employer_name: null,
    registered_at: "2026-09-30T13:40:00.000Z",
    episode_count: 0,
    _simulated: true,
  },
  {
    id: "sim-pat-005",
    title: "Miss",
    first_name: "Chloe",
    last_name: "Bennett",
    date_of_birth: "2001-09-30",
    sex: "female",
    address: { line1: "Flat 6, Harbour House (fictional)", line2: "Campbell Park", town: "Milton Keynes", postcode: "MK9 4ZZ" },
    phone: "07700 900588",
    email: "chloe.bennett@example.com",
    occupation: "Retail assistant",
    employer_name: null,
    registered_at: "2026-10-05T16:20:00.000Z",
    episode_count: 0,
    _simulated: true,
  },
];
