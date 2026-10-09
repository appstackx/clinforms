/**
 * EXTENSION POINT for additional report templates and Word files (owned by the forms-engine agent (formerly docgen)).
 *
 * Pure data, bundled into the browser via templates/registry.ts: no server-only imports here.
 *
 * - `EXTENSION_TEMPLATES`: further `ReportTemplate`s (report types with their own sections). Empty in
 *   the demo: a report type needs demo drafts and validator rules, so the clinic-style file below is a
 *   Word HOUSE STYLE that works with either built-in report type rather than a third report type.
 * - `SAMPLE_TEMPLATE_UPLOADS`: downloadable sample Word files for the "Upload your own template" demo
 *   (GET /templates/{id}/docx serves them by `id`). One is deliberately broken so the validator's
 *   plain-English error can be shown, then the working file is uploaded and the report renders into it.
 */
import type { ReportTemplate } from "../core/types";

export const EXTENSION_TEMPLATES: readonly ReportTemplate[] = [];

export interface SampleTemplateUpload {
  /** ID for GET /templates/{id}/docx. */
  id: string;
  /** Suggested download file name. */
  fileName: string;
  label: string;
  description: string;
  /** True for the deliberately broken file (one unclosed tag). */
  broken: boolean;
  /** The problem a validation run reports, in plain English (broken files only). */
  expectedProblem?: string;
  /** Docgen key of the tagged .docx (templates/generated/<docxTemplateId>.docx.b64.ts). */
  docxTemplateId: string;
}

export const CLINIC_STYLE_SAMPLE_ID = "clinic-style-sample" as const;
export const CLINIC_STYLE_BROKEN_SAMPLE_ID = "clinic-style-sample-broken" as const;

export const SAMPLE_TEMPLATE_UPLOADS: readonly SampleTemplateUpload[] = [
  {
    id: CLINIC_STYLE_SAMPLE_ID,
    fileName: "Riverside-Medico-legal-house-style.docx",
    label: "Clinic house style (working)",
    description:
      "A clinic's own Word template: Riverside Physiotherapy – Medico-legal Department (fictional) letterhead, serif fonts, navy and burgundy, letter-style reference block. Works with both report types.",
    broken: false,
    docxTemplateId: "clinic-style-v1",
  },
  {
    id: CLINIC_STYLE_BROKEN_SAMPLE_ID,
    fileName: "Riverside-Medico-legal-house-style_BROKEN.docx",
    label: "Clinic house style (one broken tag)",
    description:
      "The same file with one tag left unclosed, as happens when a tag is typed by hand. Upload it to see the validator explain the problem in plain English.",
    broken: true,
    expectedProblem: 'The tag "{instructingParty.reference" is never closed: add "}" at the end of it.',
    docxTemplateId: "clinic-style-v1-broken",
  },
];

export function getSampleTemplateUpload(id: string): SampleTemplateUpload | undefined {
  return SAMPLE_TEMPLATE_UPLOADS.find((s) => s.id === id);
}
