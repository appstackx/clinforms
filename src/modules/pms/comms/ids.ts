/**
 * Record id prefixes of the comms module (contract §4: "<prefix>_<ULID>", never reusing another module's prefix).
 * Foundation: pat case auth ref site room prac svc pl pli. Diary: appt avl blk rec. Records: note ntpl natt om.
 * Billing: inv invl crn pay acct stmt. Portal: bkr ptl ifm ifr. Reporting: rpt. Integration: imp impr.
 */
export const COMMS_ID_PREFIXES = {
  message: "msg",
  messageTemplate: "mtpl",
  reminderRule: "rrule",
  schedule: "msch",
  consentEvent: "cev",
  letter: "ltr",
  letterTemplate: "ltpl",
} as const;
