/**
 * Record id prefixes of the shared record and the directory. An id is "<prefix>_<ULID>" (time-ordered, made by
 * the repositories). Modules add their own prefixes in their own files (contract §4) – never reuse one below.
 */
export const FOUNDATION_ID_PREFIXES = {
  patient: "pat",
  case: "case",
  authorisation: "auth",
  referrer: "ref",
  site: "site",
  room: "room",
  practitioner: "prac",
  service: "svc",
  priceList: "pl",
  priceListItem: "pli",
} as const;

export const PMS_ID_PATTERN = /^[a-z]{2,8}_[0-9A-HJKMNP-TV-Z]{26}$/;

/** True when an id has the given prefix and a ULID body. */
export function hasPrefix(id: string, prefix: string): boolean {
  return PMS_ID_PATTERN.test(id) && id.startsWith(`${prefix}_`);
}
