/**
 * Customer-facing copy that only a clinic's own Studio shows (tenant mode, /app/studio). The public demo
 * keeps its own wording in the screens, NOTICES and core/wording.ts WORDING.
 *
 * Production copy: no "demo", "fictional", simulated-system or placeholder-clinician wording, and – like
 * all customer-facing text – no technology or vendor names (checked against core/wording.ts
 * BANNED_TERM_PATTERNS in studio-copy.test.ts). It states only what a clinic's Studio does today.
 */
export const TENANT_COPY = {
  home: {
    eyebrow: "Your clinic's Studio",
    reportsIntro: "Your clinic's forms, waiting for review or approved –",
    securityLink: "how patient data is protected",
    emptyBody:
      "First add a referrer's blank form in Referrer forms and confirm its mapping once. Then complete a form: upload the patient's notes (printed to PDF from your clinic system, or an export) and choose that form.",
    draftingOff:
      "Drafting from the notes is switched off for your clinic: answers from the notes are left for the clinician to write. Your clinic's owner or an administrator can switch it on in Clinic details.",
    uploadStepTitle: "Upload the notes",
    uploadStepText: "The patient's notes printed to PDF from your clinic system, or an export.",
    approveStepText: "The referrer's own Word or PDF, completed and ready to send.",
    securityCardBlurb: "Clinician approval, two-step verification, encryption and data minimisation – what is in place today.",
    deleteNote: "This cannot be undone. The deletion is recorded in your clinic's activity.",
  },
  wizard: {
    description:
      "Fill the referrer's own form from the patient's registration details and physiotherapy notes. Identifiers and figures are filled by code; answers from the notes are drafted with citations; anything not recorded is left blank and flagged for the clinician.",
    draftingOffTitle: "The remaining questions are left for the clinician",
    draftingOffBody: "Drafting from the notes is not switched on for your clinic, so these questions were not drafted. Open the form and answer them in review.",
    draftingOffSuffix: " Drafting from the notes is not switched on for your clinic – answer them in review.",
    saveFailedTitle: "The report has not been saved yet",
    saveFailedBody:
      "The connection to the clinic's records was interrupted. Keep this page open: the report is saved as soon as the connection is back.",
    launchFailed: "Choose the patient's notes below instead.",
    formatGuideSummary: "What the notes need – the format guide",
    notesHelpTitle: "Notes not read?",
    notesHelp:
      "A printed PDF cannot be edited: paste the notes as text instead and add the missing line, or send ClinForms support a sample printout from your clinic system (with made-up details) so its layout can be checked before you use it with patients.",
    missingLineHint: "A PDF printout cannot be edited: paste the notes as text below and add the missing lines.",
  },
  progress: {
    leftBlank: "Left blank for the clinician to answer.",
  },
  review: {
    notFoundTitle: "This report was not found",
    notFoundBody: "It may have been deleted, or it belongs to another clinic. Reports are kept for your clinic's retention period.",
    reviewDraftingOff: "Drafting from the notes is not switched on for your clinic, so these questions were not drafted. Answer them below.",
    actorFallback: "Clinic staff",
    approveSignerHint: "Your name and HCPC number come from your clinic profile.",
    approveSavedFailed: "Approved, but the change could not be saved. Download the completed form now.",
    approvedToast: "Your approval is recorded with your name and HCPC number. The completed form is ready to download.",
    activityNote: "Every draft, edit, resolution and approval is recorded with the report, with who did it and when.",
    saved: "Saved",
    saveFailed: "Could not save – check your connection",
    staffCannotApprove: "Ready for a signing clinician: staff prepare forms, and a clinician with signing details approves them.",
    noSigningDetails:
      "You cannot approve yet: your clinic profile has no HCPC number or permission to sign. Ask an administrator (Settings → Members), or a signing clinician to approve.",
    otherVoicePrefix: "Drafted in another clinician's voice:",
    otherVoiceSuffix: "Edit those answers so they do not speak as them, or ask them to approve.",
  },
  files: {
    missing: "The referrer's original file is not in your clinic's storage. Upload the referrer's form again to preview, fill or download it.",
    missingForCompletion:
      "The referrer's original file is not in your clinic's storage, so the completed form cannot be produced. Add the form again in the forms library.",
    mapMissingForPreview: "The form map for this report is not in your clinic's forms library, so the form cannot be previewed.",
    fileMissingForPreview: "The referrer's original file is not in your clinic's storage. Add it again in the forms library to preview the completed form.",
    mapMissing: "The form map is not in your clinic's forms library.",
    fileMissing: "The referrer's original file is not in your clinic's storage.",
    pdfUnavailable: "A PDF copy of a Word form is not available yet. Download the completed Word form and save it as PDF from Word.",
  },
  forms: {
    notFoundTitle: "This form is not in your clinic's library",
    notFoundBody: "It may have been deleted. Upload the referrer's form again to map it.",
    libraryIntro: "Upload the form an MLC or insurer sent you (.docx or PDF).",
    referrerNeeded: "Enter the referrer's name in Details (the form's own sender – it could not be read off the form).",
    analysisLive: "Read from the form",
    analysisRecorded: "Stored reading of this form",
    analysisPrewritten: "Pre-written map",
    analysisRules: "Found from the layout – check every question",
  },
  /** Fix wave 2: where answers come from, in a clinic's Studio (its notes upload – never a practice-system link). */
  sources: {
    registrationLong: "From the patient record in the uploaded notes – filled by code",
    registrationShort: "From the patient record",
    registrationValue: "Record value",
    fillHelpRegistration: "Copied by code from the patient's details, referral or episode in the uploaded notes – never drafted.",
    mappingIdentifiers: "Identifiers are always copied by code from the patient record, never drafted.",
    lockedFromRecords: "Filled in by code from the uploaded notes. To change it, correct the notes and upload them again.",
  },
  batch: {
    title: "Batch",
    unavailableTitle: "Batch needs a connected clinic system",
    unavailableBody:
      "Batch completes several patients' forms at once from a connected clinic system. Your clinic adds patients by uploading their notes, so complete each form from “Complete a form”.",
  },
} as const;

/** Every string in TENANT_COPY (for the wording tests). */
export function tenantCopyStrings(): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(TENANT_COPY);
  return out;
}
