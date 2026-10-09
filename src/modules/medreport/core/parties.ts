/**
 * Who fills in which part of a referrer's form. Insurer forms often carry several people's sections on
 * one form – "Section 1 – to be completed by the policyholder", "Section 4 – Medical details (to be
 * completed by the GP, dentist, optician or other medical practitioner)", "Therapist's declaration" – and
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
 *   "declaration by X", "I am this patient's X", "X must sign".
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

/** The party named in a "who" phrase ("the GP, dentist, optician or other medical practitioner"). */
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
const COMPLETER_RES: RegExp[] = [
  new RegExp(`\\b(?:completed|filled in|filled out|answered)\\s+by\\s+${WHO}`),
  new RegExp(`\\bfor completion by\\s+${WHO}`),
  /\b([a-z' ,]{2,60}?)\s+(?:to|must|should|will need to|needs? to)\s+(?:complete|fill in)\b(?!\s+(?:section|part|question|box|page)s?\b)/,
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
  /(?:^|[.;:!?(]\s*|^\s*)([a-z' ]{2,40}?)(?:'s|s')?\s+(?:signature|declaration)\b/,
  /\b([a-z' ,]{2,60}?)\s+(?:must|should|to|will need to|needs? to)\s+sign\b(?!\s+(?:section|part|page)s?\b)/,
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
