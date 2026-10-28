/**
 * Starting points for a clinic's own forms (written for this product – no third-party template). A clinic copies
 * one, then edits the wording to its own policies; the clinic is responsible for what its forms ask and say.
 */
import type { FormDefinition } from "./forms";
import type { IntakeFormKind, SendWhen } from "./schemas";

export interface StarterForm {
  key: string;
  name: string;
  kind: IntakeFormKind;
  description: string;
  sendWhen: SendWhen;
  requiresSignature: boolean;
  signatureStatement: string | null;
  setsTreatmentConsent: boolean;
  definition: FormDefinition;
}

const URGENT_HELP =
  "This form is read by the clinic before your appointment, not straight away. If you think you need urgent medical help, call 999, or call 111 for advice.";

export const STARTER_FORMS: readonly StarterForm[] = [
  {
    key: "new-patient",
    name: "New patient details",
    kind: "intake",
    description: "Contact details, GP and emergency contact, so the clinic's record is complete before the first visit.",
    sendWhen: "new_patient",
    requiresSignature: false,
    signatureStatement: null,
    setsTreatmentConsent: false,
    definition: {
      fields: [
        { id: "about_you", type: "heading", label: "About you", help: "We use these details to contact you about your care." },
        { id: "mobile", type: "text", label: "Mobile phone", required: true, recordField: "phoneMobile" },
        { id: "address", type: "textarea", label: "Home address (without the postcode)", required: true, recordField: "address" },
        { id: "postcode", type: "text", label: "Postcode", required: true, recordField: "postcode" },
        { id: "occupation", type: "text", label: "Occupation", recordField: "occupation" },
        { id: "emergency", type: "heading", label: "Emergency contact" },
        { id: "emergency_name", type: "text", label: "Name", recordField: "emergencyName" },
        { id: "emergency_relationship", type: "text", label: "Relationship to you", recordField: "emergencyRelationship" },
        { id: "emergency_phone", type: "text", label: "Phone", recordField: "emergencyPhone" },
        { id: "gp", type: "heading", label: "Your GP" },
        { id: "gp_practice", type: "text", label: "GP practice", required: true, recordField: "gpPractice" },
        { id: "gp_name", type: "text", label: "GP's name (if you know it)", recordField: "gpName" },
        {
          id: "hear_about",
          type: "choice",
          label: "How did you hear about the clinic?",
          options: ["Recommended by someone", "My GP or a consultant", "My insurer or employer", "Searching online", "Other"],
        },
      ],
    },
  },
  {
    key: "health",
    name: "Health questionnaire",
    kind: "questionnaire",
    description: "The reason for the visit and the health questions the practitioner reviews before the assessment.",
    sendWhen: "new_patient",
    requiresSignature: false,
    signatureStatement: null,
    setsTreatmentConsent: false,
    definition: {
      fields: [
        { id: "urgent", type: "heading", label: "Before you start", help: URGENT_HELP },
        { id: "problem", type: "textarea", label: "What would you like help with?", required: true, sensitive: true },
        { id: "started", type: "choice", label: "When did it start?", required: true, sensitive: true, options: ["In the last 2 weeks", "2 to 6 weeks ago", "6 weeks to 3 months ago", "More than 3 months ago"] },
        { id: "cause", type: "choice", label: "How did it start?", sensitive: true, options: ["Gradually, for no clear reason", "After an injury at work", "After a road traffic accident", "After sport or exercise", "After an operation", "Another way"] },
        { id: "worse_better", type: "textarea", label: "What makes it worse, and what helps?", sensitive: true },
        { id: "history", type: "heading", label: "Your health" },
        {
          id: "conditions",
          type: "multi",
          label: "Do any of these apply to you?",
          help: "Tick all that apply. Your practitioner will talk them through with you.",
          sensitive: true,
          options: ["Heart or circulation problems", "Diabetes", "Epilepsy", "Cancer, now or in the past", "Osteoporosis", "A pacemaker or other implant", "Pregnant", "None of these"],
        },
        { id: "medicines", type: "textarea", label: "Medicines you take (including from a pharmacy)", sensitive: true },
        { id: "allergies", type: "text", label: "Allergies (for example latex or plasters)", sensitive: true },
        { id: "operations", type: "textarea", label: "Operations or hospital stays in the past few years", sensitive: true },
        { id: "goals", type: "textarea", label: "What would you like to be able to do again?", sensitive: true },
      ],
    },
  },
  {
    key: "consent",
    name: "Consent to assessment and treatment",
    kind: "consent",
    description: "The patient's consent, signed by typing their name. Recorded on the patient's record.",
    sendWhen: "new_patient",
    requiresSignature: true,
    signatureStatement: "By typing my name I confirm that I have read this form, that the answers are mine and that I agree to what I have ticked.",
    setsTreatmentConsent: true,
    definition: {
      fields: [
        {
          id: "explained",
          type: "heading",
          label: "Your assessment and treatment",
          help: "Your practitioner will explain what they find, the treatment they suggest, its benefits and risks, and the alternatives. You can ask questions, ask for a chaperone and stop at any time.",
        },
        { id: "consent_treatment", type: "consent", label: "I agree to be assessed and treated by the clinic's practitioners.", required: true, recordField: "consentTreatment" },
        { id: "consent_records", type: "consent", label: "I understand that the clinic keeps a confidential record of my care.", required: true },
        { id: "share_gp", type: "yes_no", label: "May the clinic write to your GP about your care?", required: true, recordField: "consentShareGp" },
        { id: "cancellations", type: "consent", label: "I have read the clinic's cancellation policy.", required: true },
      ],
    },
  },
];

export function starterForm(key: string): StarterForm | null {
  return STARTER_FORMS.find((s) => s.key === key) ?? null;
}
