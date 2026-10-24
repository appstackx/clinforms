/**
 * Record id prefixes of the portal module (online booking, patient portal, intake forms). An id is
 * "<prefix>_<ULID>" (src/server/repos/pms/context.ts pmsId). Never reuse a prefix of another module
 * (docs/clinic-system/contract.md §4).
 */
export const PORTAL_ID_PREFIXES = {
  /** An appointment booked online (booking page or patient portal). */
  booking: "bkr",
  /** Weekly online booking hours of a practitioner at a site. */
  bookingHours: "bkh",
  /** A patient's portal account (separate from staff accounts). */
  account: "ptl",
  /** A one-time sign-in link of a portal account. */
  signInLink: "ptk",
  /** A signed-in portal session. */
  session: "psn",
  /** A message in the portal's outbox (never sent in test mode). */
  message: "pmsg",
  /** An intake or consent form (template). */
  form: "ifm",
  /** One patient's copy of a form: requested, then completed and signed. */
  response: "ifr",
  /** A document the clinic explicitly shared with the patient in the portal. */
  share: "psh",
} as const;

export type PortalIdKind = keyof typeof PORTAL_ID_PREFIXES;
