/**
 * Sign-time confirmations (plan WB design 13 – the safe defaults until the referrer answers). Pure, so the approve
 * dialog ticks exactly what /sign requires (api/handlers/sign/checks/voice.ts signerConfirmationsCheck):
 * - a sign-off field filled from the approval and labelled as the assessing or treating physiotherapist, when the
 *   approver wrote none of the assessment (or treatment) notes: "I assessed this patient" / "I treated this patient";
 * - an HCPC, CSP or registration-number field the form prints that is not filled from the approver's own profile:
 *   "This number is mine" (with the number as it will be printed).
 *
 * Fix round 1 (R1T-WB-01 / R1T-WB-02): a sign-off name field labelled by the clinician's ROLE on the form – "therapist",
 * "physiotherapist", "physio", "practitioner", "clinician" (not a plain "Name" / "Print name") – names the patient's
 * own physiotherapist on the issued form, whatever the label's other words, so it asks too:
 * - "I assessed this patient" on an initial assessment form (its title says so; a title that says neither initial nor
 *   final, discharge or progress: the form prints the assessment date in the sign-off block, beside the name) when the
 *   approver wrote no initial-assessment note;
 * - "I treated this patient" on any other form when the approver wrote none of the notes. Where the form also has a
 *   box for the self-management advice given (some discharge forms print a fixed first-person statement that the
 *   signer gave that advice), the confirmation says so: the approver confirms that advice was theirs too.
 * Structural, from the confirmed map (the field kind and its place, the form's title) – no map edit and no referrer
 * wording. It adds one tick in the approve dialog (never a blocking item in the review); the label's own assessor or
 * treating wording (ASSESSOR / TREATING) is read first, so those forms keep exactly what they asked before.
 *
 * Browser and server. Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Clinician, FormDefinition, FormField, Note, Report, SignerConfirmation } from "../types";
import { sameClinician } from "../voice";

const ASSESSOR =
  /\b(?:assess(?:ing|or|ors|ed by|ment by)|examin(?:ing|er|ed by)|(?:who|that) (?:assessed|examined|saw|has seen)\b|(?:who|that) (?:carried out|conducted|performed|undertook|completed|did) the (?:[a-z-]+ )?(?:assessment|examination)|(?:conducting|carrying out|performing|undertaking|completing) the (?:[a-z-]+ )?(?:assessment|examination)|(?:assessment|examination) (?:was )?(?:carried out|conducted|performed|undertaken|completed|done) by|seen by)\b/i;
const TREATING =
  /\b(?:treat(?:ing|ed by|ment (?:given|provided|delivered) by)|(?:who|that) (?:treated|has treated|is treating)\b|(?:who|that) (?:provided|gave|delivered|is providing) (?:the |his |her |their )?(?:[a-z-]+ )?(?:treatment|care|physiotherapy|rehabilitation)|(?:providing|delivering|giving|responsible for)(?: the| his| her| their)? (?:[a-z-]+ )?(?:treatment|care|physiotherapy|rehabilitation))\b/i;
const REGISTRATION =
  /\b(?:hcpc|csp|registration|regist(?:ered|ry)|professional body|reg)\b\.?[^.;]{0,30}?\b(?:no\.?|number|num|reg|id|pin)\b|\bregistration number\b|\bhcpc\b|\bcsp (?:no|number|membership)\b|\breg\.? ?no\b/i;

/**
 * A sign-off name field labelled by the clinician's role on the form (R1T-WB-01): the label alone – every map's guidance
 * says "the approving physiotherapist's name", so guidance never decides it.
 */
const ROLE_NAME = /\b(?:therapist|physiotherapist|physio|practitioner|clinician)s?(?:['’]s)?\b/i;
/** An initial assessment form by its title: "Initial Assessment …" always; a bare "(Physiotherapy) Assessment Report" unless the title says final, discharge or progress. */
const INITIAL_TITLE = /\b(?:initial|first)\s+assessment\b/i;
const ASSESSMENT_TITLE = /^\s*(?:physiotherapy\s+)?assessment(?:\s+report)?\s*$/i;
const NOT_INITIAL_TITLE = /\b(?:final|discharge|end of treatment|progress|interim|review|closing|summary)\b/i;
/** A date field that prints the assessment date: it reads the episode's first-seen date, or its label says so. */
const ASSESSMENT_DATE_LABEL = /\b(?:date (?:of )?(?:the )?(?:initial |first )?assessment|(?:initial |first )?assessment date|date (?:first )?seen|date assessed)\b/i;
/** How far either side of the sign-off name field its block reads (the name, the number, a date beside them). */
const SIGNOFF_BLOCK = 2;
/** A box for the self-management advice given (R1T-WB-02): the form states the advice was the signer's. */
const SELF_MANAGEMENT_ADVICE = /\badvice\b[^.;]{0,60}\bself[- ]?(?:management|care)\b|\bself[- ]?(?:management|care)\b[^.;]{0,60}\badvi(?:c|s)e\b/i;

/** Whether the field prints the assessment date. */
function printsAssessmentDate(field: FormField): boolean {
  if (field.answerType !== "date") return false;
  const src = field.fillSource as { kind: string; path?: string };
  return (src.kind === "registration" && src.path === "episode.firstSeen") || ASSESSMENT_DATE_LABEL.test(field.label);
}

/**
 * The form is an initial assessment: its title says so (a final, discharge, progress or interim title says it is not),
 * or – a title that says neither – the assessment date is printed in the sign-off block beside the name.
 */
function initialAssessmentSignoff(form: Pick<FormDefinition, "fields"> & Partial<Pick<FormDefinition, "title">>, index: number): boolean {
  const title = form.title ?? "";
  if (INITIAL_TITLE.test(title)) return true;
  if (NOT_INITIAL_TITLE.test(title)) return false;
  if (ASSESSMENT_TITLE.test(title)) return true;
  for (let i = Math.max(0, index - SIGNOFF_BLOCK); i <= Math.min(form.fields.length - 1, index + SIGNOFF_BLOCK); i++) {
    if (i !== index && printsAssessmentDate(form.fields[i])) return true;
  }
  return false;
}

/** The form has a box for the self-management advice given (its fixed wording may state, in the signer's name, that they gave it). */
function hasSelfManagementAdvice(form: Pick<FormDefinition, "fields">): boolean {
  return form.fields.some((f) => f.fillSource.kind !== "signoff" && SELF_MANAGEMENT_ADVICE.test(f.label));
}

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
  form: (Pick<FormDefinition, "fields"> & Partial<Pick<FormDefinition, "title">>) | null,
  signer: Pick<Clinician, "name" | "hcpc">,
): SignerConfirmation[] {
  if (!form) return [];
  const out: SignerConfirmation[] = [];
  const notes = report.bundleSnapshot.notes;
  form.fields.forEach((field, index) => {
    const label = `${field.label} ${field.guidance ?? ""}`;
    if (field.fillSource.kind === "signoff") {
      if (field.fillSource.part !== "name") return;
      const role = signoffRole(form, field, index, label);
      if (role === "assessed" && !wroteAny(notes, signer, ["initial_assessment"])) out.push({ kind: "assessed_patient", fieldId: field.id });
      else if (role === "treated" && !wroteAny(notes, signer, null)) out.push({ kind: "treated_patient", fieldId: field.id });
      return;
    }
    if (field.answerType === "hcpc_number" || REGISTRATION.test(field.label)) {
      const value = printedValue(report, field);
      if (!value) return;
      if (signer.hcpc && normaliseRegistration(value) === normaliseRegistration(signer.hcpc) && field.fillSource.kind !== "registration") return;
      out.push({ kind: "own_registration_number", fieldId: field.id, value: value.slice(0, 40) });
    }
  });
  return out;
}

/**
 * Whom a sign-off name field prints the approver as: the assessing physiotherapist, the treating one, or neither (a plain
 * "Name" / "Print name"). The label's own assessor or treating wording first (as before this round), then its role
 * name (R1T-WB-01 / 02): on an initial assessment form the assessor, else the treating physiotherapist.
 */
function signoffRole(form: Pick<FormDefinition, "fields"> & Partial<Pick<FormDefinition, "title">>, field: FormField, index: number, labelAndGuidance: string): "assessed" | "treated" | null {
  if (ASSESSOR.test(labelAndGuidance)) return "assessed";
  if (TREATING.test(labelAndGuidance)) return "treated";
  if (!ROLE_NAME.test(field.label)) return null;
  return initialAssessmentSignoff(form, index) ? "assessed" : "treated";
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
  if (c.kind === "treated_patient") {
    // R1T-WB-02: the form also states, in the signer's name, that they gave the self-management advice.
    const advice = hasSelfManagementAdvice(form) ? " and gave the self-management advice the form states I gave" : "";
    return `I treated this patient${advice} (“${label}” is completed with my name; the treatment notes were written by someone else).`;
  }
  return `${c.value ?? "This number"} is my own registration number (“${label}”).`;
}
