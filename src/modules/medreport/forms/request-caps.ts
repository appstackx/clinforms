/**
 * Size caps for a form map that arrives in a REQUEST (WA2 design 4, R-security-2/3): at most 400 fields and 20 fields
 * per block, duplicates keyed on (blockId, target, placeholderText) – a referrer's map may hold legitimate pairs on one
 * line. Applied to request inputs only (/forms/analyse, /forms/fill-preview, /forms/confirm), never to
 * FormDefinitionSchema, so a stored map always stays readable. A refusal is 422 FORM_TOO_COMPLEX with these issues.
 *
 * bh2 W0 follow-up (seam "form-request-caps", bh2-base2): /forms/confirm (api/handlers/forms-confirm.ts, WE's file)
 * already asks it; WA2 calls it from its own handlers (forms-analyse.ts, forms-fill-preview.ts) and fills it in.
 * Stub: no problem found.
 *
 * Pure (no server-only code).
 * Owner: WA2 (forms engine) – docs/bh2-ownership.json.
 */
import type { ProblemIssue } from "../api/contract";
import type { FormDefinition } from "../core/types";

export const formRequestCapIssues: (form: Pick<FormDefinition, "fields">) => ProblemIssue[] = () => [];
