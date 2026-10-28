/**
 * Record id prefixes of the diary module ("<prefix>_<ULID>", contract §4). Never reuse a prefix of another module.
 *   appt – an appointment (pms_appointments, kind "appointment")
 *   blk  – blocked time: leave, meetings, a room out of use (pms_appointments, kind "block")
 *   avl  – a rota entry: when a practitioner works at a site (pms_availability)
 *   rec  – a series of recurring appointments (pms_appointment_series)
 *   wait – a waiting-list entry (pms_waiting_list)
 *   woff – a slot offered to a waiting patient (pms_waiting_list_offers)
 */
export const DIARY_ID_PREFIXES = {
  appointment: "appt",
  block: "blk",
  availability: "avl",
  series: "rec",
  waitingList: "wait",
  offer: "woff",
} as const;
