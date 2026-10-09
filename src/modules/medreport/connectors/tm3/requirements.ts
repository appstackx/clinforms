/**
 * What a TM3 partner API must expose for the real TM3 connector (./connector.ts) to work.
 *
 * BROWSER-SAFE on purpose (plain data, no "server-only"): the Studio's connector tile imports it to
 * show the list. Keep it free of imports.
 *
 * Owner: integration agent.
 */
export interface ConnectorRequirement {
  /** Short heading for the tile, e.g. "Clinical notes with authors". */
  title: string;
  /** What exactly is needed and why. */
  detail: string;
  /** Required for a report (true) or an optional extra such as write-back (false). */
  required: boolean;
}

/** What a TM3 partner API must expose for this connector to work. */
export const TM3_REQUIREMENTS: readonly ConnectorRequirement[] = [
  {
    title: "Partner access",
    detail: "Partner credentials (for example OAuth client credentials per clinic) and a sandbox tenant to test against.",
    required: true,
  },
  {
    title: "Patients",
    detail: "Patient search and registration details: name, date of birth, sex, occupation and employer.",
    required: true,
  },
  {
    title: "Episodes and referrals",
    detail: "Episodes of care with start and discharge dates, the referrer or instructing party with its reference, the incident date and mechanism, and recorded disclosure consent.",
    required: true,
  },
  {
    title: "Clinical notes with authors",
    detail: "Read access to the full SOAP clinical notes, each with its date and time, note type and the author's name and HCPC registration number.",
    required: true,
  },
  {
    title: "Appointments with attendance",
    detail: "Appointments with date, time, clinician and attendance status (attended, did not attend, late cancellation, cancelled) and any recorded reason.",
    required: true,
  },
  {
    title: "Outcome measures",
    detail: "Outcome measure scores (for example NDI, ODI, NPRS, QuickDASH, PSFS) with the date each was recorded.",
    required: true,
  },
  {
    title: "Document upload",
    detail: "An endpoint to file the signed report (PDF or Word) against the patient's record, returning a document ID.",
    required: false,
  },
];
