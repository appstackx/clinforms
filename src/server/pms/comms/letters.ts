/**
 * Starting a letter from a template: the recipient (the patient, their GP, the case's payer or referrer, or
 * someone typed in), the author (the chosen practitioner, else the case's) and the merged text. A value the
 * record does not hold shows as "[not recorded: …]" in the draft, and the standard templates' "[[…]]" gaps are
 * for the author to write – the letter cannot be finalised until both are gone (../../repos/pms/comms/letters.ts).
 */
import { renderTemplate } from "../../../modules/pms/comms/merge-fields";
import { formatLongDate } from "../../../modules/pms/comms/schedule";
import type { Letter, LetterRecipientKind } from "../../../modules/pms/comms/types";
import { formatUkDate, ukToday } from "../../../modules/pms/core/text";
import type { PmsActor, Profession } from "../../../modules/pms/core/types";
import { RepoInputError, type RepoContext } from "../../repos/pms/context";
import { getCase } from "../../repos/pms/cases";
import { createLetter, getLetterTemplate } from "../../repos/pms/comms/letters";
import { getCommsSettings } from "../../repos/pms/comms/settings";
import { getPractitioner, getSite } from "../../repos/pms/directory";
import { getPatient } from "../../repos/pms/patients";
import { getReferrer } from "../../repos/pms/referrers";
import { clinicContact, clinicValues } from "./render";

export const PROFESSION_LABELS: Readonly<Record<Profession, string>> = {
  physiotherapist: "Physiotherapist",
  sports_therapist: "Sports therapist",
  osteopath: "Osteopath",
  chiropractor: "Chiropractor",
  podiatrist: "Podiatrist",
  massage_therapist: "Massage therapist",
  other: "Practitioner",
};

export interface StartLetterInput {
  patientId: string;
  templateId: string;
  caseId?: string | null;
  practitionerId?: string | null;
  /** Default: the template's recipient. */
  recipientKind?: LetterRecipientKind;
  /** For a referrer or payer: which one (default: the case's payer, else its referrer). */
  recipientReferrerId?: string | null;
  /** For "other": typed in. */
  recipientName?: string | null;
  recipientAddress?: string[] | null;
  recipientPostcode?: string | null;
  letterOn?: string;
}

const lines = (...parts: (string[] | string | null | undefined)[]) =>
  parts
    .flatMap((p) => (Array.isArray(p) ? p : p ? [p] : []))
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n") || null;

export async function startLetter(ctx: RepoContext, tenantId: string, input: StartLetterInput, actor: PmsActor, fallbackClinicName?: string): Promise<Letter> {
  const template = await getLetterTemplate(ctx, tenantId, input.templateId);
  if (!template || !template.active) throw new RepoInputError("Choose a letter template.");
  const patient = await getPatient(ctx, tenantId, input.patientId);
  if (!patient) throw new RepoInputError("The patient does not exist in this clinic.");
  const theCase = input.caseId ? await getCase(ctx, tenantId, input.caseId) : null;
  if (input.caseId && (!theCase || theCase.patientId !== patient.id)) throw new RepoInputError("The case is not one of this patient's cases.");
  const practitionerId = input.practitionerId ?? theCase?.practitionerId ?? null;
  const practitioner = practitionerId ? await getPractitioner(ctx, tenantId, practitionerId) : null;
  if (practitionerId && !practitioner) throw new RepoInputError("The author is not one of the clinic's practitioners.");
  const site = theCase?.siteId ? await getSite(ctx, tenantId, theCase.siteId) : null;
  const payer = theCase?.payerReferrerId ? await getReferrer(ctx, tenantId, theCase.payerReferrerId) : null;

  const kind = input.recipientKind ?? template.recipientKind;
  let recipientReferrerId: string | null = null;
  let recipient: { name: string | null; address: string[] | null; postcode: string | null; email: string | null };
  const fullName = [patient.title, patient.firstName, patient.lastName].filter(Boolean).join(" ");
  if (kind === "patient") {
    recipient = { name: fullName, address: patient.address, postcode: patient.postcode, email: patient.email };
  } else if (kind === "gp") {
    recipient = { name: patient.gpName ?? (patient.gpPractice ? `The GP, ${patient.gpPractice}` : null), address: [patient.gpPractice ?? "", ...(patient.gpAddress ?? [])].filter(Boolean).slice(0, 6), postcode: patient.gpPostcode, email: null };
  } else if (kind === "referrer") {
    recipientReferrerId = input.recipientReferrerId ?? theCase?.payerReferrerId ?? theCase?.referrerId ?? null;
    const r = recipientReferrerId ? await getReferrer(ctx, tenantId, recipientReferrerId) : null;
    if (recipientReferrerId && !r) throw new RepoInputError("The recipient is not in the clinic's directory.");
    recipient = r ? { name: r.contactName ? `${r.contactName}, ${r.name}` : r.name, address: r.address, postcode: r.postcode, email: r.email } : { name: null, address: null, postcode: null, email: null };
  } else {
    recipient = { name: input.recipientName ?? null, address: input.recipientAddress ?? null, postcode: input.recipientPostcode ?? null, email: null };
  }

  const settings = await getCommsSettings(ctx, tenantId);
  const clinic = await clinicContact(ctx, tenantId, settings, fallbackClinicName);
  const letterOn = input.letterOn ?? ukToday(ctx.now ? ctx.now() : new Date());
  const values: Record<string, string | null> = {
    ...clinicValues(clinic),
    today: formatLongDate(letterOn),
    "patient.first_name": patient.preferredName || patient.firstName,
    "patient.last_name": patient.lastName,
    "patient.title": patient.title,
    "patient.full_name": fullName,
    "patient.date_of_birth": patient.dateOfBirth ? formatUkDate(patient.dateOfBirth) : null,
    "patient.number": String(patient.patientNumber),
    "patient.address": lines(patient.address, patient.postcode),
    "gp.name": patient.gpName,
    "gp.surgery": patient.gpPractice,
    "gp.address": lines(patient.gpAddress, patient.gpPostcode),
    "case.title": theCase?.title ?? null,
    "case.opened_on": theCase ? formatUkDate(theCase.openedOn) : null,
    "case.injury_on": theCase?.injuryOn ? formatUkDate(theCase.injuryOn) : null,
    "case.claim_reference": theCase?.claimReference ?? null,
    "case.membership_number": theCase?.membershipNumber ?? null,
    "case.payer": payer?.name ?? (theCase?.payerType === "self_pay" ? "Self-pay" : null),
    "author.name": practitioner?.displayName ?? null,
    "author.profession": practitioner ? PROFESSION_LABELS[practitioner.profession] : null,
    "author.registration": practitioner?.registrationNumber ?? null,
    "site.name": site?.name ?? null,
    "recipient.name": recipient.name,
    "recipient.address": lines(recipient.address, recipient.postcode),
  };
  const subject = renderTemplate(template.subject, values, { missing: "marker" }).text.replace(/\s+/g, " ").trim();
  const body = renderTemplate(template.body, values, { missing: "marker" }).text;
  return createLetter(
    ctx,
    tenantId,
    {
      patientId: patient.id,
      templateId: template.id,
      caseId: theCase?.id ?? null,
      practitionerId: practitioner?.id ?? null,
      recipientKind: kind,
      recipientReferrerId,
      recipientName: recipient.name,
      recipientAddress: recipient.address,
      recipientPostcode: recipient.postcode,
      recipientEmail: recipient.email,
      letterOn,
      subject: subject.slice(0, 200),
      body,
    },
    actor,
  );
}
