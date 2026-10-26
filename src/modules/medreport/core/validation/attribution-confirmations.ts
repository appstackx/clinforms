/**
 * Sign-time confirmations (plan WB design 13 – the safe defaults until the referrer answers). Pure, so the approve
 * dialog ticks exactly what /sign requires (api/handlers/sign/checks/voice.ts signerConfirmationsCheck):
 * - a sign-off field filled from the approval and labelled as the assessing or treating physiotherapist, when the
 *   approver wrote none of the assessment (or treatment) notes: "I assessed this patient" / "I treated this patient";
 * - an HCPC, CSP or registration-number field the form prints that is not filled from the approver's own profile:
 *   "This number is mine" (with the number as it will be printed).
 *
 * Browser and server. Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Clinician, FormDefinition, FormField, Note, Report, SignerConfirmation } from "../types";
import { sameClinician } from "../voice";

const ASSESSOR = /\b(?:assess(?:ing|or|ors|ed by|ment by)|examin(?:ing|er|ed by)|clinician (?:who|that) assessed)\b/i;
const TREATING = /\b(?:treat(?:ing|ed by|ment (?:given|provided) by)|clinician (?:who|that) treated)\b/i;
const REGISTRATION = /\b(?:hcpc|csp|registration|regist(?:ered|ry))\b[^.;]{0,30}?\b(?:no\.?|number|num|reg|id)\b|\bregistration number\b|\bhcpc\b|\bcsp (?:no|number|membership)\b/i;

/** A registration number as compared: no spaces, upper case. */
export const normaliseRegistration = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toUpperCase();

/** The printed answer of a form field on this report (its text, or a short value). */
function printedValue(report: Pick<Report, "sections">, field: FormField): string {
  const section = report.sections.find((s) => s.key === field.id);
  if (!section) return "";
  const answer = section.answer as { kind?: string; value?: unknown } | undefined;
  if (answer && typeof answer.value === "string" && answer.value.trim()) return answer.value.trim();
  return section.paragraphs.map((p) => p.text).join(" ").trim();
}

/** Whether the signer wrote any of the notes (of these kinds). */
function wroteAny(notes: readonly Note[], signer: Pick<Clinician, "name" | "hcpc">, kinds: ReadonlyArray<Note["type"]> | null): boolean {
  return notes.some((n) => (!kinds || kinds.includes(n.type)) && sameClinician(n.author, signer));
}

/** The confirmations this approval needs (a form report; none otherwise). */
export function requiredConfirmations(
  report: Pick<Report, "sections" | "bundleSnapshot">,
  form: Pick<FormDefinition, "fields"> | null,
  signer: Pick<Clinician, "name" | "hcpc">,
): SignerConfirmation[] {
  if (!form) return [];
  const out: SignerConfirmation[] = [];
  const notes = report.bundleSnapshot.notes;
  for (const field of form.fields) {
    const label = `${field.label} ${field.guidance ?? ""}`;
    if (field.fillSource.kind === "signoff") {
      if (field.fillSource.part !== "name") continue;
      if (ASSESSOR.test(label) && !wroteAny(notes, signer, ["initial_assessment"])) out.push({ kind: "assessed_patient", fieldId: field.id });
      else if (TREATING.test(label) && !wroteAny(notes, signer, null)) out.push({ kind: "treated_patient", fieldId: field.id });
      continue;
    }
    if (field.answerType === "hcpc_number" || REGISTRATION.test(field.label)) {
      const value = printedValue(report, field);
      if (!value) continue;
      if (signer.hcpc && normaliseRegistration(value) === normaliseRegistration(signer.hcpc) && field.fillSource.kind !== "registration") continue;
      out.push({ kind: "own_registration_number", fieldId: field.id, value: value.slice(0, 40) });
    }
  }
  return out;
}

/** Whether `given` confirms `required` (the same kind and field, and for a number the same number). */
export function confirms(given: SignerConfirmation, required: SignerConfirmation): boolean {
  if (given.kind !== required.kind || given.fieldId !== required.fieldId) return false;
  return required.kind !== "own_registration_number" || normaliseRegistration(given.value ?? "") === normaliseRegistration(required.value ?? "");
}

/** What the approver confirms, in their words (the approve dialog's tick box; /sign's 409 detail). */
export function confirmationText(c: SignerConfirmation, form: Pick<FormDefinition, "fields">): string {
  const label = form.fields.find((f) => f.id === c.fieldId)?.label ?? c.fieldId ?? "";
  if (c.kind === "assessed_patient") return `I assessed this patient (“${label}” is completed with my name; the assessment notes were written by someone else).`;
  if (c.kind === "treated_patient") return `I treated this patient (“${label}” is completed with my name; the treatment notes were written by someone else).`;
  return `${c.value ?? "This number"} is my own registration number (“${label}”).`;
}
