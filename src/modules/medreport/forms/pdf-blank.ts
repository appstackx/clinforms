import "server-only";

/**
 * Data minimisation for form ANALYSIS (ai/form-redact.ts): referrers sometimes send their form with the
 * claimant's details already typed into the fillable fields. The analysis needs the layout, never those
 * values, so the copy of the PDF attached for Claude has every text field emptied first.
 *
 * Owner: forms-engine agent.
 */
import { PDFDropdown, PDFTextField } from "pdf-lib";
import { loadPdfDocument } from "./pdf-outline";

export interface BlankedPdf {
  /** A copy with every text field emptied (and editable dropdown values cleared). */
  bytes: Uint8Array;
  /** Names of the fields that held a value. */
  prefilled: string[];
}

/** Names of fillable text fields (and editable dropdowns) that already hold a value. */
export async function prefilledPdfFields(buf: Uint8Array): Promise<string[]> {
  return (await blankPdfFormValues(buf)).prefilled;
}

export async function blankPdfFormValues(buf: Uint8Array): Promise<BlankedPdf> {
  const doc = await loadPdfDocument(buf);
  const form = doc.getForm();
  const prefilled: string[] = [];
  for (const field of form.getFields()) {
    if (field instanceof PDFTextField) {
      const value = field.getText();
      if (value && value.trim()) {
        prefilled.push(field.getName());
        field.setText("");
      }
    } else if (field instanceof PDFDropdown && field.isEditable()) {
      const selected = field.getSelected().filter((v) => v.trim());
      const options = field.getOptions();
      if (selected.some((v) => !options.includes(v))) {
        prefilled.push(field.getName());
        field.clear();
      }
    }
  }
  if (prefilled.length === 0) return { bytes: buf, prefilled };
  form.updateFieldAppearances();
  return { bytes: await doc.save({ useObjectStreams: false }), prefilled };
}
