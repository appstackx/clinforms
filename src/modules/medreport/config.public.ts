/**
 * ClinForms – public configuration.
 *
 * Safe to import anywhere (browser, server, tests). NEVER read `process.env`
 * here: anything secret or environment-dependent belongs in `config.server.ts`.
 *
 * The product's display name is set exactly once, here.
 */

import { WORDING } from "./core/wording";

export const PRODUCT = {
  name: "ClinForms",
  shortName: "ClinForms",
  version: "0.1.0",
  vendor: "AppStackX",
  tagline: "Complete every referrer's own report form from your clinic notes",
} as const;

/** The only tenant in the demo build. Every type and token carries a tenantId from day one. */
export const DEMO_TENANT_ID = "demo" as const;

/** Fictional clinic used for letterheads, demo data and UI copy. */
export const DEMO_CLINIC = {
  name: "Riverside Physiotherapy (fictional)",
  town: "Milton Keynes",
  addressLines: ["Unit 4, Riverside Court (fictional)", "Milton Keynes", "MK9 0ZZ"],
  phone: "01632 960 418", // Ofcom drama range: never a real number
  email: "reports@riverside-physio.example",
} as const;

/** Studio primary colour (Tailwind teal-600). */
export const BRAND_COLOR = "#0D9488" as const;

/** Every browser storage key used by the module starts with this prefix. */
export const STORAGE_PREFIX = "medreport." as const;

/**
 * Largest tagged Word template accepted by POST /templates/validate and /render (decoded bytes).
 * 3 MB decodes from ~4 MB of base64, which keeps the JSON body under Vercel's 4.5 MB request limit.
 */
export const MAX_TEMPLATE_DOCX_BYTES = 3 * 1024 * 1024;

/** A /drafts call drafts one group of 1–2 sections (keeps each call inside the function time limit). */
export const MAX_SECTIONS_PER_DRAFT = 2;

/**
 * Referrer forms (Revision 2): a /drafts call for a form report drafts up to this many answerable
 * fields at once (form answers are shorter than report sections).
 */
export const MAX_FORM_FIELDS_PER_DRAFT = 4;

/**
 * Fix round 2 (B1-4): the numbered rows of one table on a clinic's own form ("Activity 1", "Activity 1 – frequency"…
 * "Activity 2 – comments") are drafted in one call of up to this many short cells, so each row takes a different item.
 */
export const MAX_FORM_ROW_FIELDS_PER_DRAFT = 8;

/**
 * Largest referrer form file (.docx or .pdf, decoded bytes) accepted by /forms/analyse,
 * /forms/fill-preview and /render. 2.5 MB of file is ~3.5 MB of base64, which leaves ~0.9 MB for the
 * report (with its bundle snapshot) and the form map under Vercel's 4.5 MB request limit. The client
 * also refuses any body over MAX_FORM_REQUEST_BYTES with a clear message (ui/api-client.ts).
 */
export const MAX_FORM_FILE_BYTES = 2.5 * 1024 * 1024;

/**
 * Largest RTF template accepted (10/2026, raw bytes): RTF stores pictures (logos) and embedded objects as hex text, so
 * a template a clinic system prints can be many MB although its converted Word file is small. An RTF file may be up
 * to 12 MB as long as everything EXCEPT its picture / object / binary data (core/rtf/prescan.ts) stays within
 * MAX_FORM_FILE_BYTES. The converted .docx stays within MAX_FORM_FILE_BYTES too. In the Studio the RTF is converted
 * in the browser, so the request limit below never sees it; through the partner API (which sends the RTF itself)
 * MAX_FORM_REQUEST_BYTES still applies.
 */
export const MAX_RTF_FILE_BYTES = 12 * 1024 * 1024;

/** Largest JSON body for the form endpoints (base64 file + report), just under Vercel's 4.5 MB limit. */
export const MAX_FORM_REQUEST_BYTES = 4_400_000;

/** Batch drafting runs at most this many /drafts calls at once. */
export const BATCH_CONCURRENCY = 2;

/** UI notices that must appear wherever the demo stores or shows data. */
export const NOTICES = {
  browserStorage: "Reports are stored in this browser only (demo-grade).",
  fictionalData: "Fictional data only. Do not enter real patient information.",
  otherBrowser: "This report is stored in another browser.",
  dataMinimisation:
    "Data minimisation, not anonymisation: the name, date of birth, address and contact details are removed before drafting, but free text in notes can still identify a patient.",
  prewrittenDraft: WORDING.labels.prewrittenDraft,
  /**
   * Word → PDF needs LibreOffice, which no hosted deployment has yet (no converter service exists): say so
   * truthfully (fix wave 2) – the Word file is the completed form.
   */
  pdfConversionUnavailable: "A PDF copy of a Word form is not available yet. Download the completed Word form instead.",
  /** Under the approved banner's Word download, where no PDF copy can be made (no greyed-out PDF button). */
  wordFormPdfHint: "Need a PDF? Open the completed Word file and save it as a PDF.",
  /** Shown wherever a referrer's form is completed. */
  originalLayout: "Completed in the referrer's own form, in its original layout.",
} as const;
