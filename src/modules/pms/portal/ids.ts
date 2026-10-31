/**
 * Record id prefixes of the portal module (online booking, patient portal, intake forms). An id is
 * "<prefix>_<ULID>" (src/server/repos/pms/context.ts pmsId). Never reuse a prefix of another module
 * (docs/clinic-system/contract.md §4).
 */
export const PORTAL_ID_PREFIXES = {
  /** The online-booking record of a diary appointment booked online (booking page or patient portal). */
  booking: "bkr",
  /** A patient's portal account (separate from staff accounts). */
  account: "ptl",
  /** A one-time sign-in link of a portal account. */
  signInLink: "ptk",
  /** A signed-in portal session. */
  session: "psn",
  /** An intake or consent form (template). */
  form: "ifm",
  /** One patient's copy of a form: requested, then completed and signed. */
  response: "ifr",
  /** A document the clinic explicitly shared with the patient in the portal. */
  share: "psh",
  /** A form handed to the patient on a clinic device (completed in the clinic, verified by staff). */
  handoff: "ihd",
} as const;

export type PortalIdKind = keyof typeof PORTAL_ID_PREFIXES;
