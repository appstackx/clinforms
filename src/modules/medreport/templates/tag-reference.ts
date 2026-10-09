/**
 * The tags a tagged Word template can use (docxtemplater syntax: {tag}, {#loop}…{/loop},
 * {#condition}…{/condition}, {^condition}…{/condition}). Pure data: the Studio shows it as the tag list
 * for clinics, and docgen uses it to report unused/unknown tags when a template is uploaded.
 *
 * Keep in step with docgen/view-model.ts (ReportViewModel). Owner: forms-engine agent (formerly docgen).
 */

export type TemplateTagKind = "field" | "loop" | "condition";

export interface TemplateTagInfo {
  /** Tag name without braces, e.g. "patient.fullName" or "sections". */
  tag: string;
  kind: TemplateTagKind;
  /** Heading the tag is listed under. */
  group: string;
  description: string;
  /** Example value (fields) or a usage snippet (loops and conditions). */
  example: string;
  /** For tags used inside a loop: the loop's tag, e.g. "sections". */
  insideLoop?: string;
}

/**
 * Tags every uploaded template must contain. Without {#isDraft} an unsigned copy could look final;
 * without {#signed} a signed copy would carry no signature or fingerprint.
 */
export const REQUIRED_TEMPLATE_TAGS: readonly { tag: string; why: string; fix: string }[] = [
  {
    tag: "sections",
    why: "the report's sections would not appear in the document",
    fix: "Add a {#sections}…{/sections} loop with {heading} and a {#paragraphs}{text}{/paragraphs} loop inside it.",
  },
  {
    tag: "isDraft",
    why: "an unsigned draft would not be marked as a draft",
    fix: "Add {#isDraft}DRAFT – NOT SIGNED{/isDraft}, usually in the page header.",
  },
  {
    tag: "signed",
    why: "a signed copy would show no signature, HCPC number or fingerprint",
    fix: "Add a {#signed}…{/signed} block containing at least {signature.name}, {signature.hcpc} and {signature.hashShort}.",
  },
];

const T = (
  tag: string,
  kind: TemplateTagKind,
  group: string,
  description: string,
  example: string,
  insideLoop?: string,
): TemplateTagInfo => ({ tag, kind, group, description, example, ...(insideLoop ? { insideLoop } : {}) });

export const TEMPLATE_TAG_REFERENCE: readonly TemplateTagInfo[] = [
  // Status
  T("isDraft", "condition", "Status", "True until the report is signed. Wrap the draft marking in it.", "{#isDraft}DRAFT – NOT SIGNED{/isDraft}"),
  T("signed", "condition", "Status", "True on a signed copy only. Wrap the signature block in it.", "{#signed}Signed by {signature.name}{/signed}"),
  T("draftLabel", "field", "Status", '"DRAFT – NOT SIGNED" on drafts, empty when signed.', "DRAFT – NOT SIGNED"),
  T("reviewCopy", "condition", "Status", "True on an internal review copy (source dates after each paragraph).", "{#reviewCopy}Internal review copy{/reviewCopy}"),

  // Report
  T("report.title", "field", "Report", "Document title from the report template.", "Treating Physiotherapist Report"),
  T("report.date", "field", "Report", "Report date (the signing date once signed), DD/MM/YYYY.", "06/10/2026"),
  T("report.dateIso", "field", "Report", "Report date as YYYY-MM-DD.", "2026-10-06"),
  T("report.templateName", "field", "Report", "Name of the report template.", "Treating physiotherapist report (RTA personal injury)"),
  T("report.id", "field", "Report", "Internal report ID.", "rpt_9x2k…"),

  // Clinic
  T("clinic.name", "field", "Clinic", "Clinic name.", "Riverside Physiotherapy (fictional)"),
  T("clinic.addressText", "field", "Clinic", "Clinic address on one line.", "Unit 4, Riverside Court (fictional), Milton Keynes, MK9 0ZZ"),
  T("clinic.phone", "field", "Clinic", "Clinic telephone.", "01632 960 418"),
  T("clinic.email", "field", "Clinic", "Clinic email.", "reports@riverside-physio.example"),

  // Patient
  T("patient.fullName", "field", "Patient", "Full name.", "Megan Hart"),
  T("patient.firstName", "field", "Patient", "First name.", "Megan"),
  T("patient.lastName", "field", "Patient", "Last name.", "Hart"),
  T("patient.dob", "field", "Patient", "Date of birth, DD/MM/YYYY.", "22/11/1991"),
  T("patient.age", "field", "Patient", "Age in years when the report was created.", "34"),
  T("patient.sex", "field", "Patient", "Sex as recorded.", "Female"),
  T("patient.occupation", "field", "Patient", 'Occupation, or "Not recorded".', "Office administrator"),
  T("patient.employer", "field", "Patient", 'Employer, or "Not recorded".', "Ashby Freight Ltd (fictional)"),

  // Instructing party
  T("instructingParty.name", "field", "Instructing party", "Who instructed the report.", "Harrow & Pike Solicitors (fictional)"),
  T("instructingParty.typeLabel", "field", "Instructing party", "Solicitor, Employer, Insurer or Case manager.", "Solicitor"),
  T("instructingParty.reference", "field", "Instructing party", "Their reference.", "HP/RTA/2291"),
  T("instructingParty.contactName", "field", "Instructing party", "Contact name (may be empty).", "J. Pike"),
  T("instructingParty.address", "field", "Instructing party", "Postal address (may be empty).", "1 High Street (fictional), Bedford"),
  T("instructingParty.hasReference", "condition", "Instructing party", "True when a reference is recorded.", "{#instructingParty.hasReference}Your ref: {instructingParty.reference}{/instructingParty.hasReference}"),

  // Incident and episode
  T("incident.present", "condition", "Incident and episode", "True when an incident is recorded.", "{#incident.present}{incident.date}{/incident.present}"),
  T("incident.date", "field", "Incident and episode", "Incident date, DD/MM/YYYY.", "12/03/2026"),
  T("incident.mechanism", "field", "Incident and episode", "Mechanism as recorded.", "Rear-end collision while stationary"),
  T("incident.typeLabel", "field", "Incident and episode", "Type of incident.", "Road traffic accident"),
  T("episode.firstAppointment", "field", "Incident and episode", "First attended appointment, DD/MM/YYYY.", "18/03/2026"),
  T("episode.lastAppointment", "field", "Incident and episode", "Last attended appointment, DD/MM/YYYY.", "07/07/2026"),
  T("episode.statusLabel", "field", "Incident and episode", "Discharged or ongoing.", "discharged"),
  T("episode.noteCount", "field", "Incident and episode", "Number of clinical notes.", "10"),
  T("episode.clinicianNames", "field", "Incident and episode", "Treating clinicians with HCPC numbers.", "Sarah Reid (HCPC PH-DEMO-01), Tom Ellis (HCPC PH-DEMO-02)"),
  T("provenance", "field", "Incident and episode", "Where the records came from and when.", "Simulated TM3 sandbox – demo data, not affiliated with TM3 · fetched 06/10/2026 10:00"),

  // Sections
  T("sections", "loop", "Report sections", "Every report section in order (declaration excluded).", "{#sections}{heading}{#paragraphs}{text}{/paragraphs}{/sections}"),
  T("heading", "field", "Report sections", 'Numbered heading, e.g. "4. History of the incident (as reported)".', "4. History of the incident (as reported)", "sections"),
  T("number", "field", "Report sections", "Section number.", "4", "sections"),
  T("title", "field", "Report sections", "Section title without the number.", "History of the incident (as reported)", "sections"),
  T("paragraphs", "loop", "Report sections", "The section's paragraphs. Put {text} in its own paragraph between the loop tags.", "{#paragraphs}{text}{/paragraphs}", "sections"),
  T("text", "field", "Report sections", "Paragraph text (source IDs are never printed).", "On 18/03/2026 the claimant reported…", "paragraphs"),
  T("isPlaceholder", "condition", "Report sections", "True while a section is still empty (drafts only).", "{#isPlaceholder}(to be completed){/isPlaceholder}", "sections"),
  T("showAttendance", "condition", "Report sections", "True in the section that shows the attendance table.", "{#showAttendance}…attendance table…{/showAttendance}", "sections"),
  T("showOutcomes", "condition", "Report sections", "True in the section that shows the outcome-measures table.", "{#showOutcomes}…outcomes table…{/showOutcomes}", "sections"),
  T("showRecordsReviewed", "condition", "Report sections", "True in the section that summarises the records reviewed.", "{#showRecordsReviewed}See Appendix A.{/showRecordsReviewed}", "sections"),

  // Attendance
  T("attendance", "loop", "Attendance table", "One row per appointment. Put {#attendance} in the first cell and {/attendance} in the last.", "{#attendance}{date} | {statusLabel} | {reason}{/attendance}"),
  T("attendanceSummary", "field", "Attendance table", "One-line summary of attendance.", "10 of 11 appointments attended; 1 did not attend (15/04/2026, no reason recorded)."),
  T("hasAttendance", "condition", "Attendance table", "True when there are appointments.", "{#hasAttendance}…{/hasAttendance}"),
  T("date", "field", "Attendance table", "Appointment date, DD/MM/YYYY.", "15/04/2026", "attendance"),
  T("time", "field", "Attendance table", "Appointment time.", "09:30", "attendance"),
  T("statusLabel", "field", "Attendance table", "Attended, Did not attend, Late cancellation…", "Did not attend", "attendance"),
  T("reason", "field", "Attendance table", "Reason recorded for a missed or cancelled appointment.", "No reason recorded", "attendance"),
  T("clinician", "field", "Attendance table", "Clinician booked.", "Tom Ellis", "attendance"),

  // Outcomes
  T("outcomes", "loop", "Outcome measures table", "One row per outcome measure.", "{#outcomes}{label} | {first} → {latest} | {change}{/outcomes}"),
  T("hasOutcomes", "condition", "Outcome measures table", "True when outcome measures were recorded.", "{#hasOutcomes}…{/hasOutcomes}"),
  T("label", "field", "Outcome measures table", "Measure name.", "Neck Disability Index (NDI)", "outcomes"),
  T("instrument", "field", "Outcome measures table", "Short name.", "NDI", "outcomes"),
  T("first", "field", "Outcome measures table", "First score.", "42%", "outcomes"),
  T("firstDate", "field", "Outcome measures table", "Date of the first score.", "18/03/2026", "outcomes"),
  T("latest", "field", "Outcome measures table", "Latest score.", "12%", "outcomes"),
  T("latestDate", "field", "Outcome measures table", "Date of the latest score.", "07/07/2026", "outcomes"),
  T("change", "field", "Outcome measures table", "Change from first to latest.", "−30 points", "outcomes"),
  T("seriesText", "field", "Outcome measures table", "All scores in order.", "42% → 24% → 12%", "outcomes"),
  T("scaleNote", "field", "Outcome measures table", "How to read the scale.", "Lower scores are better.", "outcomes"),

  // Records reviewed
  T("recordsReviewed", "loop", "Records reviewed", "Every record reviewed (all notes with authors, appointments, outcome measures, registration).", "{#recordsReviewed}{date} | {description} | {author} | {citedMark}{/recordsReviewed}"),
  T("description", "field", "Records reviewed", "What the record is.", "Clinical note – Initial assessment", "recordsReviewed"),
  T("author", "field", "Records reviewed", "Author with HCPC number.", "Sarah Reid (HCPC PH-DEMO-01)", "recordsReviewed"),
  T("citedMark", "field", "Records reviewed", '"✓" when the report relies on the record.', "✓", "recordsReviewed"),
  T("cited", "condition", "Records reviewed", "True when the report relies on the record.", "{#cited}✓{/cited}", "recordsReviewed"),

  // Declaration and signature
  T("hasDeclaration", "condition", "Declaration and signature", "True when the report includes a declaration.", "{#hasDeclaration}…{/hasDeclaration}"),
  T("declarationHeading", "field", "Declaration and signature", "Numbered declaration heading.", "12. Declaration and statement of truth"),
  T("declarationParagraphs", "loop", "Declaration and signature", "Declaration paragraphs.", "{#declarationParagraphs}{text}{/declarationParagraphs}"),
  T("signature.name", "field", "Declaration and signature", "Signer's name (signed copies only).", "Sarah Reid"),
  T("signature.role", "field", "Declaration and signature", "Signer's role.", "Senior Physiotherapist, MCSP"),
  T("signature.hcpc", "field", "Declaration and signature", "Signer's HCPC registration number.", "PH-DEMO-01"),
  T("signature.signedAt", "field", "Declaration and signature", "Date and time signed (UK time).", "06/10/2026 14:05"),
  T("signature.statement", "field", "Declaration and signature", "The statement the signer accepted.", "I confirm the declaration above…"),
  T("signature.hashShort", "field", "Declaration and signature", "Short document fingerprint.", "3F9C 2A7B 1D4E"),
  T("signature.hash", "field", "Declaration and signature", "Full SHA-256 fingerprint.", "3f9c2a7b1d4e…"),
  T("signature.attestations", "loop", "Declaration and signature", "Statements the signer confirmed.", "{#signature.attestations}✓ {text}{/signature.attestations}"),

  // Footer
  T("footer.left", "field", "Header and footer", "Clinic, report type and patient.", "Riverside Physiotherapy (fictional) · Treating Physiotherapist Report · Megan Hart"),
  T("footer.right", "field", "Header and footer", "DRAFT marking, or the signer and fingerprint.", "Signed by Sarah Reid on 06/10/2026 · Fingerprint 3F9C 2A7B 1D4E"),
];
