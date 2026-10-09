/**
 * Who fills in which part of a referrer's form. Insurer forms often carry several people's sections on
 * one form – "Part A – to be completed by the policyholder", "Part D – for completion by the patient's
 * doctor or another medical practitioner", "Therapist's declaration" – and
 * the clinic must complete only its own: never the policyholder's answers, and never its clinician's
 * approval in someone else's signature box.
 *
 * Plain text rules over the form's own wording, shared by the PDF section reader (forms/pdf-sections.ts),
 * the label classifier (ai/form-classify.ts) and the confirmation checks (core/forms.ts). Pure and
 * browser-safe.
 *
 * - completerParty(text): "to be completed by X", "for completion by X", "X to complete", "X must
 *   complete" (not "… must complete Section 4", which names another part of the form).
 * - signerParty(text): "X's signature", "signature of X", "signed by X", "X's declaration",
 *   "declaration by X", "I am this patient's X", "X must sign". X may be a list of parties
 *   ("Patient or parent/guardian declaration", "Policyholder/patient declaration").
 * - headingParty(title): either of the above, plus a heading about the clinic's own details
 *   ("Therapist details"), a consent form (the patient's) and office use (the insurer's).
 *
 * X maps to a party by its words: GP / doctor / (other) medical practitioner / specialist / consultant /
 * dentist / optician / hospital → doctor; therapist / physiotherapist / practitioner / clinician / clinic /
 * provider → clinic; policyholder / member / insured → policyholder; patient / claimant / parent or
 * guardian → patient; insurer / claims team / office use → insurer. When the clinic is among several
 * named completers ("your GP or therapist") the clinic may complete it. Plain "you" is not mapped: on a
 * form addressed to the clinic it means the clinician.
 */
import type { Party } from "./types";

/** Parties other than the clinic: their parts of a form are left blank and never take the sign-off. */
export const NON_CLINIC_PARTIES: readonly Party[] = ["patient", "policyholder", "doctor", "insurer"];

export function isNonClinicParty(party: Party | null | undefined): boolean {
  return party !== null && party !== undefined && NON_CLINIC_PARTIES.indexOf(party) >= 0;
}

/** Plain-English name for messages to staff ("…is for the policyholder to complete"). */
export function partyLabel(party: Party): string {
  switch (party) {
    case "clinic":
      return "the clinic";
    case "patient":
      return "the patient";
    case "policyholder":
      return "the policyholder";
    case "doctor":
      return "the patient's doctor";
    case "insurer":
      return "the insurer";
    default:
      return "someone other than the clinic";
  }
}

export function normPartyText(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

const PARTY_WORDS: Array<[RegExp, Party]> = [
  [/\b(?:gp|g\.p\.|general practitioner|doctor|physician|specialist|consultant|surgeon|dentist|optician|medical attendant|hospital)s?\b/, "doctor"],
  [/\b(?:physio(?:therapist)?|therapist|practitioner|clinician|chiropractor|osteopath|podiatrist|clinic|(?:healthcare |treatment |service )?provider|health ?care professional)s?\b/, "clinic"],
  [/\b(?:policy ?holder|main member|plan holder|scheme member|member|insured(?: person)?)s?\b/, "policyholder"],
  [/\b(?:patient|claimant|applicant|employee|injured party|parent|guardian)s?\b/, "patient"],
  [/\b(?:insurer|insurance company|claims? (?:team|department|handler|assessor)|underwriter|administrator)s?\b/, "insurer"],
];

/** The party named in a "who" phrase ("the GP, consultant or another medical practitioner"). */
export function partyOfWho(who: string): Party | null {
  const w = normPartyText(who)
    .replace(/\b(?:registered |other |a |any )?medical (?:practitioner|professional)s?\b/g, " doctor ")
    // "the patient's GP", "your patient's therapist": the person after the possessive.
    .replace(/\b(?:patient|claimant|client|member|policy ?holder|insured|employee)(?:'s|s') /g, " ");
  const found: Array<{ party: Party; at: number }> = [];
  for (const [re, party] of PARTY_WORDS) {
    const m = re.exec(w);
    if (m) found.push({ party, at: m.index });
  }
  if (found.length === 0) return null;
  if (found.some((f) => f.party === "clinic")) return "clinic";
  found.sort((a, b) => a.at - b.at);
  return found[0].party;
}

const WHO = "([^.;:!?\\n]{2,100})";
/**
 * Characters of a "who" phrase written before its verb or noun – words, possessives and lists of
 * parties ("Patient or parent/guardian", "Policyholder/patient", "Claimant's / patient's").
 */
const WHO_LIST = "[a-z' ,/&]";
const COMPLETER_RES: RegExp[] = [
  new RegExp(`\\b(?:completed|filled in|filled out|answered)\\s+by\\s+${WHO}`),
  new RegExp(`\\bfor completion by\\s+${WHO}`),
  new RegExp(`\\b(${WHO_LIST}{2,60}?)\\s+(?:to|must|should|will need to|needs? to)\\s+(?:complete|fill in)\\b(?!\\s+(?:section|part|question|box|page)s?\\b)`),
];

/** "to be completed by the policyholder" → policyholder; null when the text names no completer. */
export function completerParty(text: string): Party | null {
  const t = normPartyText(text);
  for (const re of COMPLETER_RES) {
    const m = re.exec(t);
    if (!m) continue;
    const party = partyOfWho(m[1]);
    if (party) return party;
  }
  return null;
}

const SIGNER_RES: RegExp[] = [
  /\bsignature of (?:the |your |a )?([^.;:!?\n]{2,60})/,
  /\bsigned by (?:the |your |a )?([^.;:!?\n]{2,60})/,
  /\bdeclaration (?:by|of|from) (?:the |your |a )?([^.;:!?\n]{2,60})/,
  /\bi am (?:the|this|your|a|an) ([^.;:!?\n]{2,60})/,
  new RegExp(`(?:^|[.;:!?(]\\s*|^\\s*)(${WHO_LIST}{2,40}?)(?:'s|s')?\\s+(?:signature|declaration)\\b`),
  new RegExp(`\\b(${WHO_LIST}{2,60}?)\\s+(?:must|should|to|will need to|needs? to)\\s+sign\\b(?!\\s+(?:section|part|page)s?\\b)`),
];

/** "Policyholder's signature" → policyholder, "Signature of medical practitioner" → doctor, "Signature" → null. */
export function signerParty(text: string): Party | null {
  const t = normPartyText(text);
  for (const re of SIGNER_RES) {
    const m = re.exec(t);
    if (!m) continue;
    const party = partyOfWho(m[1]);
    if (party) return party;
  }
  return null;
}

/** A heading about the clinic's own details ("Therapist details", "Practitioner information"). */
const CLINIC_DETAILS_HEADING = /\b(?:treating )?(?:physio(?:therapist)?|therapist|practitioner|clinician|provider|clinic)(?:'s|s')? (?:details|information|contact details)\b/;
const MEDICAL_PRACTITIONER = /\bmedical (?:practitioner|professional)/;
const CONSENT_FORM = /\b(?:consent form|patient consent|authority to release|authorisation to release)\b/;
const OFFICE_USE = /\b(?:for )?(?:office|official|internal|administrative) use\b|\bfor (?:[\w&'()-]+ ){0,4}use only\b/;

/** Who completes the part of the form under this heading (or a party-marker line), if it says. */
export function headingParty(title: string): Party | null {
  const t = normPartyText(title);
  const named = completerParty(t) ?? signerParty(t);
  if (named) return named;
  if (CLINIC_DETAILS_HEADING.test(t) && !MEDICAL_PRACTITIONER.test(t)) return "clinic";
  if (CONSENT_FORM.test(t)) return "patient";
  if (OFFICE_USE.test(t)) return "insurer";
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * Boxes left blank: whose they are (shown to staff instead of a single "referrer's use")
 * ----------------------------------------------------------------------------------------------*/

/** Who a box the clinic leaves blank belongs to; "not_needed" = the clinic's own box, not needed here. */
export type BlankFor = "patient" | "policyholder" | "doctor" | "insurer" | "not_needed";

/**
 * Whose part a box left blank is: the party the form names for it (patient, policyholder, the patient's
 * doctor, the insurer's office), else "office use" wording, else the clinic's own box that is not needed
 * for this patient (an "Other – please specify" box, the sender's checklist, a fax number).
 */
export function blankFor(field: { completedBy?: Party; label?: string; section?: string }): BlankFor {
  const party = field.completedBy;
  if (party === "patient" || party === "policyholder" || party === "doctor" || party === "insurer") return party;
  if (OFFICE_USE.test(normPartyText(`${field.section ?? ""} ${field.label ?? ""}`))) return "insurer";
  return "not_needed";
}

/** Status chip and card sentence for a box left blank ("For the patient to complete"). */
export function blankForWording(kind: BlankFor, referrerName?: string | null): { chip: string; sentence: string } {
  const office = referrerName ? `${referrerName}'s office` : "the referrer's office";
  switch (kind) {
    case "patient":
      return { chip: "For the patient to complete", sentence: "Left blank on the form – this part is for the patient to complete." };
    case "policyholder":
      return { chip: "For the policyholder to complete", sentence: "Left blank on the form – this part is for the policyholder to complete." };
    case "doctor":
      return { chip: "For the patient's GP or doctor", sentence: "Left blank on the form – this part is for the patient's GP or doctor to complete." };
    case "insurer":
      return { chip: `For ${office}`, sentence: `Left blank on the form – this box is for ${office}.` };
    default:
      return { chip: "Left blank – not needed", sentence: "Left blank on the form – the clinic does not need to fill it in for this patient." };
  }
}

/** How many boxes are left blank for each party. */
export function blankForCounts(fields: ReadonlyArray<{ completedBy?: Party; label?: string; section?: string; fillSource: { kind: string } }>): Record<BlankFor, number> {
  const out: Record<BlankFor, number> = { patient: 0, policyholder: 0, doctor: 0, insurer: 0, not_needed: 0 };
  for (const f of fields) if (f.fillSource.kind === "leave_blank") out[blankFor(f)] += 1;
  return out;
}

/** "50 for the patient or their GP · 2 for Aviva's office · 3 not needed" (empty parts left out). */
export function blankForSummary(counts: Record<BlankFor, number>, referrerName?: string | null): string[] {
  const people: string[] = [];
  if (counts.patient) people.push("the patient");
  if (counts.policyholder) people.push("the policyholder");
  if (counts.doctor) people.push("their GP");
  const peopleN = counts.patient + counts.policyholder + counts.doctor;
  const parts: string[] = [];
  if (peopleN) parts.push(`${peopleN} for ${people.length > 1 ? `${people.slice(0, -1).join(", ")} or ${people[people.length - 1]}` : people[0]}`);
  if (counts.insurer) parts.push(`${counts.insurer} for ${referrerName ? `${referrerName}'s` : "the referrer's"} office`);
  if (counts.not_needed) parts.push(`${counts.not_needed} not needed`);
  return parts;
}

/* ------------------------------------------------------------------------------------------------
 * Forms the clinic only prefills (a patient's claim form, a GP's report): someone else signs them
 * ----------------------------------------------------------------------------------------------*/

const SIGNER_ORDER: Party[] = ["patient", "policyholder", "doctor"];

/**
 * Who signs a form the clinic only PREFILLS: the form has no sign-off box of the clinic's own, and
 * another party's signature box is left blank (Freedom's claim form: the policyholder and the patient;
 * Aviva CM016: the patient and their GP). Null when the clinic signs the form, or for portal questions.
 * Such a form is checked by a clinician but not signed by the clinic: files are named "_PREFILLED",
 * never "_SIGNED", and the approval wording says "checked for the patient to complete and sign".
 */
export function prefillSigners(form: {
  kind?: string;
  fields: ReadonlyArray<{ answerType?: string; label?: string; completedBy?: Party; fillSource: { kind: string } }>;
}): Party[] | null {
  if (form.kind === "questions") return null;
  if (form.fields.some((f) => f.fillSource.kind === "signoff")) return null;
  const found = new Set<Party>();
  for (const f of form.fields) {
    if (f.fillSource.kind !== "leave_blank" || !f.completedBy) continue;
    const signature = f.answerType === "signature" || /\bsignature\b/i.test(f.label ?? "");
    if (signature && SIGNER_ORDER.indexOf(f.completedBy) >= 0) found.add(f.completedBy);
  }
  const out = SIGNER_ORDER.filter((p) => found.has(p));
  return out.length ? out : null;
}

/** "the patient", "the policyholder and the patient", "the patient and their GP". */
export function prefillSignersText(parties: readonly Party[]): string {
  const names = parties.map((p) => (p === "doctor" ? "their GP or doctor" : `the ${p}`));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "the patient";
}
