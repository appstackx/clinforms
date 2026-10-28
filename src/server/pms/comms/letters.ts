/**
 * Starting a letter from a template: the recipient (the patient, their GP, the case's payer or referrer, or
 * someone typed in), the author (the chosen practitioner, else the case's) and the merged text. A value the
 * record does not hold shows as "[not recorded: …]" in the draft, and the standard templates' "[[…]]" gaps are
 * for the author to write – the letter cannot be finalised until both are gone (../../repos/pms/comms/letters.ts).
 */
import { renderTemplate } from "../../../modules/pms/comms/merge-fields";
import { formatLatestOutcomes } from "../../../modules/pms/comms/outcomes-field";
import { formatAppointmentDay, formatAppointmentTime, formatLongDate } from "../../../modules/pms/comms/schedule";
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
import { listOutcomesForPatient } from "../../repos/pms/records/outcomes";
import { clinicContact, clinicValues } from "./render";
import { pmsNow } from "../../../modules/pms/core/clock";

/** The register a profession's registration number belongs to (printed before the number under a signature). */
export const PROFESSION_REGISTERS: Readonly<Partial<Record<Profession, string>>> = {
  physiotherapist: "HCPC",
  podiatrist: "HCPC",
  osteopath: "GOsC",
  chiropractor: "GCC",
};

/** "Priya Shah, Physiotherapist · HCPC PH-DEMO-01" (design round 3, letter editor) – or just the name. */
export function signatureLine(name: string, practitioner: { profession: Profession; registrationNumber: string | null } | null): string {
  if (!practitioner) return name;
  const reg = practitioner.registrationNumber ? ` · ${[PROFESSION_REGISTERS[practitioner.profession], practitioner.registrationNumber].filter(Boolean).join(" ")}` : "";
  return `${name}, ${PROFESSION_LABELS[practitioner.profession]}${reg}`;
}

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
  /** Applied to the merged body before the letter is saved (the discharge letter writes the note's summary into its gaps). */
  bodyFill?: (body: string) => string;
}

const lines = (...parts: (string[] | string | null | undefined)[]) =>
  parts
    .flatMap((p) => (Array.isArray(p) ? p : p ? [p] : []))
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n") || null;

/**
 * What letters say about visits, from the diary's appointments of the patient (of the case, when the letter has
 * one): the completed visits' dates, the first and latest, and the next booked appointments ("Wed 28/10/2026 11:30
 * with Sarah Reid").
 */
async function appointmentFacts(ctx: RepoContext, tenantId: string, patientId: string, caseId: string | null) {
  let q = ctx.db
    .selectFrom("pms_appointments")
    .select(["starts_at", "starts_on", "status", "practitioner_id"])
    .where("tenant_id", "=", tenantId)
    .where("patient_id", "=", patientId)
    .where("kind", "=", "appointment")
    .where("status", "in", ["attended", "booked"]);
  if (caseId) q = q.where((eb) => eb.or([eb("case_id", "=", caseId), eb("status", "=", "booked")]));
  const rows = await q.orderBy("starts_at").limit(400).execute();
  const nowMs = (ctx.now ? ctx.now() : pmsNow()).getTime();
  const attended = rows.filter((r) => r.status === "attended").map((r) => formatUkDate(r.starts_on));
  const upcomingRows = rows.filter((r) => r.status === "booked" && Date.parse(r.starts_at) > nowMs).slice(0, 8);
  const names = new Map<string, string>();
  for (const id of Array.from(new Set(upcomingRows.map((r) => r.practitioner_id).filter((x): x is string => Boolean(x))))) {
    const p = await getPractitioner(ctx, tenantId, id);
    if (p) names.set(id, p.displayName);
  }
  const upcoming = upcomingRows.map((r) => `${formatAppointmentDay(r.starts_at)}/${r.starts_on.slice(0, 4)}  ${formatAppointmentTime(r.starts_at)}${r.practitioner_id && names.get(r.practitioner_id) ? `  with ${names.get(r.practitioner_id)}` : ""}`);
  return { attended, firstVisit: attended[0] ?? null, lastVisit: attended[attended.length - 1] ?? null, upcoming };
}

/**
 * `{{latest_outcomes}}`: first → latest score per measure of the case (when the case has any), else of the patient.
 * Clinical: only ever read for a letter (letters need messages.letters – never reception).
 */
export async function latestOutcomesText(ctx: RepoContext, tenantId: string, patientId: string, caseId: string | null): Promise<string> {
  const all = await listOutcomesForPatient(ctx, tenantId, patientId);
  const ofCase = caseId ? all.filter((o) => o.caseId === caseId) : [];
  return formatLatestOutcomes(ofCase.length ? ofCase : all);
}

interface LetterFacts {
  patient: NonNullable<Awaited<ReturnType<typeof getPatient>>>;
  theCase: Awaited<ReturnType<typeof getCase>> | null;
  practitioner: Awaited<ReturnType<typeof getPractitioner>> | null;
  site: Awaited<ReturnType<typeof getSite>> | null;
  payer: Awaited<ReturnType<typeof getReferrer>> | null;
  recipient: { name: string | null; address: string[] | null; postcode: string | null; salutation?: string | null };
  letterOn: string;
}

/** Every letter merge value for a patient, case, author and recipient. */
async function letterValues(ctx: RepoContext, tenantId: string, f: LetterFacts, fallbackClinicName?: string): Promise<Record<string, string | null>> {
  const { patient, theCase, practitioner, site, payer, recipient, letterOn } = f;
  const settings = await getCommsSettings(ctx, tenantId);
  const clinic = await clinicContact(ctx, tenantId, settings, fallbackClinicName);
  const visits = await appointmentFacts(ctx, tenantId, patient.id, theCase?.id ?? null);
  const outcomes = await latestOutcomesText(ctx, tenantId, patient.id, theCase?.id ?? null);
  const fullName = [patient.title, patient.firstName, patient.lastName].filter(Boolean).join(" ");
  return {
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
    "case.first_visit": visits.firstVisit,
    "case.last_visit": visits.lastVisit,
    "case.sessions": visits.attended.length ? String(visits.attended.length) : null,
    "case.discharge_date": theCase?.closedOn ? formatUkDate(theCase.closedOn) : null,
    latest_outcomes: outcomes || null,
    "appointments.attended": visits.attended.length ? visits.attended.join(", ") : null,
    "appointments.upcoming": visits.upcoming.length ? visits.upcoming.join("\n") : null,
    "author.name": practitioner?.displayName ?? null,
    "author.profession": practitioner ? PROFESSION_LABELS[practitioner.profession] : null,
    "author.registration": practitioner?.registrationNumber ?? null,
    "site.name": site?.name ?? null,
    "recipient.name": recipient.name,
    "recipient.salutation": recipient.salutation ?? recipient.name,
    "recipient.address": lines(recipient.address, recipient.postcode),
  };
}

/**
 * Fills merge fields typed into a draft after it started (the editor's "Merge fields"): the letter's own patient,
 * case, author and recipient; a value not recorded becomes "[not recorded: …]" (still to fill before signing).
 */
export async function fillLetterFields(ctx: RepoContext, tenantId: string, letter: Letter, text: { subject: string; body: string }): Promise<{ subject: string; body: string }> {
  if (!/\{\{/.test(text.subject) && !/\{\{/.test(text.body)) return text;
  const patient = await getPatient(ctx, tenantId, letter.patientId);
  if (!patient) return text;
  const theCase = letter.caseId ? await getCase(ctx, tenantId, letter.caseId) : null;
  const practitioner = letter.practitionerId ? await getPractitioner(ctx, tenantId, letter.practitionerId) : null;
  const site = theCase?.siteId ? await getSite(ctx, tenantId, theCase.siteId) : null;
  const payer = theCase?.payerReferrerId ? await getReferrer(ctx, tenantId, theCase.payerReferrerId) : null;
  const values = await letterValues(ctx, tenantId, { patient, theCase, practitioner, site, payer, recipient: { name: letter.recipientName, address: letter.recipientAddress, postcode: letter.recipientPostcode }, letterOn: letter.letterOn });
  return {
    subject: renderTemplate(text.subject, values, { missing: "marker" }).text.replace(/\s+/g, " ").trim().slice(0, 200),
    body: renderTemplate(text.body, values, { missing: "marker" }).text,
  };
}

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
  let recipient: { name: string | null; address: string[] | null; postcode: string | null; email: string | null; salutation?: string | null };
  const fullName = [patient.title, patient.firstName, patient.lastName].filter(Boolean).join(" ");
  if (kind === "patient") {
    recipient = { name: fullName, address: patient.address, postcode: patient.postcode, email: patient.email, salutation: fullName };
  } else if (kind === "gp") {
    recipient = { name: patient.gpName ?? (patient.gpPractice ? "The GP" : null), address: [patient.gpPractice ?? "", ...(patient.gpAddress ?? [])].filter(Boolean).slice(0, 6), postcode: patient.gpPostcode, email: null, salutation: patient.gpName ?? (patient.gpPractice ? "Doctor" : null) };
  } else if (kind === "referrer") {
    recipientReferrerId = input.recipientReferrerId ?? theCase?.payerReferrerId ?? theCase?.referrerId ?? null;
    const r = recipientReferrerId ? await getReferrer(ctx, tenantId, recipientReferrerId) : null;
    if (recipientReferrerId && !r) throw new RepoInputError("The recipient is not in the clinic's directory.");
    recipient = r
      ? { name: r.contactName ? `${r.contactName}, ${r.name}` : r.name, address: r.address, postcode: r.postcode, email: r.email, salutation: r.contactName ?? "Sir or Madam" }
      : { name: null, address: null, postcode: null, email: null };
  } else {
    recipient = { name: input.recipientName ?? null, address: input.recipientAddress ?? null, postcode: input.recipientPostcode ?? null, email: null };
  }

  const letterOn = input.letterOn ?? ukToday(ctx.now ? ctx.now() : pmsNow());
  const values = await letterValues(ctx, tenantId, { patient, theCase, practitioner, site, payer, recipient, letterOn }, fallbackClinicName);
  const subject = renderTemplate(template.subject, values, { missing: "marker" }).text.replace(/\s+/g, " ").trim();
  const merged = renderTemplate(template.body, values, { missing: "marker" }).text;
  const body = input.bodyFill ? input.bodyFill(merged) : merged;
  return createLetter(
    ctx,
    tenantId,
    {
      patientId: patient.id,
      templateId: template.id,
      templateName: template.name,
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
