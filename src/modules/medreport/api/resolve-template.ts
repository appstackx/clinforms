import "server-only";

/**
 * One rule for every handler that needs a report's template (/drafts, /validate, /sign, /render,
 * /forms/fill-preview): a built-in template comes from the registry; a form report's template is
 * formToTemplate(form) built from the form map sent in the request (forms live in the browser).
 *
 * Shared contract (orchestrator-owned).
 */
import { formConfirmationProblem, formMapSha256, verifyFormConfirmation } from "../auth/attestations";
import { formIdFromTemplateId, formToTemplate } from "../core/forms";
import type { FormDefinition, ReportFormRef, ReportTemplate } from "../core/types";
import { getTemplate } from "../templates/registry";
import { problem } from "./http";

export type TemplateResolution =
  | { ok: true; template: ReportTemplate; form: FormDefinition | null }
  | { ok: false; response: Response };

export interface ResolveTemplateInput {
  templateId: string;
  /** The form map from the request body, if any. */
  form?: FormDefinition;
  /** `report.form` when resolving for a whole report (must match `form`). */
  reportForm?: ReportFormRef;
  /** Body path used in 422 issues, e.g. "templateId" or "report.templateId". */
  path?: string;
}

/**
 * - "form:<id>" (or a report with report.form): `form` is required (422), its ID must match (422) and
 *   its file must be the one the report was started from (409 FORM_MISMATCH).
 * - any other ID: the built-in registry (422 if unknown). A `form` sent with a built-in ID is ignored.
 */
export function resolveTemplate(input: ResolveTemplateInput): TemplateResolution {
  const path = input.path ?? "templateId";
  const formId = formIdFromTemplateId(input.templateId) ?? input.reportForm?.formId ?? null;
  if (formId !== null) {
    const form = input.form;
    if (!form) {
      return {
        ok: false,
        response: problem(422, "The form map is missing", {
          code: "VALIDATION_FAILED",
          issues: [{ path: "form", message: "This report completes a referrer's form: send its form map as `form`." }],
        }),
      };
    }
    if (form.id !== formId || (input.reportForm && input.reportForm.formId !== form.id)) {
      return {
        ok: false,
        response: problem(422, "Wrong form map", {
          code: "VALIDATION_FAILED",
          issues: [{ path: "form.id", message: `This report completes form "${formId}", not "${form.id}".` }],
        }),
      };
    }
    if (input.reportForm && input.reportForm.fileSha256 !== form.file.sha256) {
      return {
        ok: false,
        response: problem(409, "This is not the form the report was started from", {
          code: "FORM_MISMATCH",
          detail: "The form map belongs to a different version of the referrer's file. Start a new report with the current form.",
        }),
      };
    }
    // The report records the hash of the confirmed map it was started from (part of the signed
    // content): every later request must send exactly that map.
    if (input.reportForm?.mapSha256 && input.reportForm.mapSha256 !== formMapSha256(form)) {
      return {
        ok: false,
        response: problem(409, "The form's mapping has changed since this report was started", {
          code: "FORM_MISMATCH",
          detail: "This report was started with a different mapping of the referrer's form. Start a new report with the current mapping, or restore the mapping it was started with.",
        }),
      };
    }
    return { ok: true, template: formToTemplate(form), form };
  }
  const template = getTemplate(input.templateId);
  if (!template) {
    return {
      ok: false,
      response: problem(422, "Unknown template", {
        code: "VALIDATION_FAILED",
        issues: [{ path, message: `No template "${input.templateId}".` }],
      }),
    };
  }
  return { ok: true, template, form: null };
}

/**
 * 409 FORM_NOT_CONFIRMED unless the map carries a valid server-attested confirmation of exactly these
 * fields (auth/attestations.ts). Null when it does.
 */
export function requireAttestedForm(form: FormDefinition): Response | null {
  const check = verifyFormConfirmation(form);
  if (check.ok) return null;
  return problem(409, check.reason === "NOT_CONFIRMED" ? "The form mapping has not been confirmed" : "The form mapping needs confirming again", {
    code: "FORM_NOT_CONFIRMED",
    detail: formConfirmationProblem(check.reason),
  });
}
