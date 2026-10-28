/**
 * Record id prefixes of the reporting and set-up module (contract §4: never reuse another module's prefix).
 *   hrs – one opening session of a site on a weekday (pms_site_hours)
 *   clo – a closure of one site or every site (pms_site_closures)
 *   rpt – reserved for saved reports (not stored yet)
 */
export const REPORTING_ID_PREFIXES = {
  openingSession: "hrs",
  closure: "clo",
  report: "rpt",
} as const;
