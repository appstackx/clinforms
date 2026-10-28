/**
 * The clinic system's record of one case → the ClinForms episode bundle (what a referrer form is completed from):
 * registration (the patient), referral (the case's payer or referrer, references, authorisation), incident, the
 * clinicians, signed notes, appointments and outcome scores (through the records and diary ports), the patient's
 * consent to share (the latest "Complete referrer form" request) and the clinic's own details.
 *
 * buildNativeBundle() is pure (tested on its own); loadNativeBundle() reads everything for one case.
 * Nothing here writes. ClinForms keeps no copy of the notes beyond the report it makes from them.
 */
import "server-only";
import { clinicDetailsFromProfile } from "../../../modules/medreport/core/clinic";
import type {
  Appointment,
  Clinician,
  EpisodeBundle,
  InstructingPartyType,
  Note,
  OutcomeMeasureSeries,
} from "../../../modules/medreport/core/types";
import { CLINIC_SYSTEM_NAME } from "../../../lib/brand";
import type {
  Authorisation,
  Case,
  Patient,
  Practitioner,
  Referrer,
  ReferrerKind,
} from "../../../modules/pms/core/types";
import { loadClinicProfile } from "../../auth/medreport-actor";
import type { RepoContext } from "../../repos/context";
import { getCase, listAuthorisations } from "../../repos/pms/cases";
import { getPractitioner, listPractitioners } from "../../repos/pms/directory";
import {
  latestFormRequest,
  type FormRequest,
} from "../../repos/pms/integration/form-requests";
import { getPatient } from "../../repos/pms/patients";
import { getReferrer } from "../../repos/pms/referrers";
import type {
  IntegrationPorts,
  NativeAppointment,
  NativeNote,
  NativeOutcomeSeries,
} from "./ports";

export const NATIVE_CONNECTOR_ID = "native" as const;

/** A registration number for documents: practitioners without one say so instead of inventing one. */
const NO_REGISTRATION = "not recorded";

export interface NativeBundleInput {
  tenantId: string;
  fetchedAt: string;
  patient: Patient;
  case: Case;
  payer: Referrer | null;
  referrer: Referrer | null;
  authorisations: readonly Authorisation[];
  practitioners: readonly Practitioner[];
  notes: readonly NativeNote[];
  appointments: readonly NativeAppointment[];
  outcomes: readonly NativeOutcomeSeries[];
  request: FormRequest | null;
  /** The member may see the case's referral reason (patients.referral); otherwise it is left out. */
  referralReason?: boolean;
  clinic: {
    displayName: string;
    addressLines: string[];
    postcode?: string;
    phone?: string;
    email?: string;
  } | null;
}

export class NativeBundleError extends Error {
  readonly code: "NOT_FOUND" | "DATE_OF_BIRTH_MISSING";
  constructor(code: "NOT_FOUND" | "DATE_OF_BIRTH_MISSING", message: string) {
    super(message);
    this.name = "NativeBundleError";
    this.code = code;
  }
}

const PARTY_TYPE: Partial<Record<ReferrerKind, InstructingPartyType>> = {
  insurer: "insurer",
  mlc: "mlc",
  solicitor: "solicitor",
  employer: "employer",
  case_manager: "case_manager",
};

const UNITS: Record<
  NativeOutcomeSeries["instrument"],
  { unit: string; higherIsWorse: boolean }
> = {
  NDI: { unit: "%", higherIsWorse: true },
  ODI: { unit: "%", higherIsWorse: true },
  NPRS: { unit: "/10", higherIsWorse: true },
  PSFS: { unit: "/10", higherIsWorse: false },
  QuickDASH: { unit: "/100", higherIsWorse: true },
};

const STATUS: Record<NativeAppointment["status"], Appointment["status"]> = {
  attended: "ATT",
  did_not_attend: "DNA",
  late_cancellation: "LCN",
  cancelled: "CNC",
  booked: "BOOKED",
};

function oneLine(
  lines: readonly string[] | null,
  postcode: string | null,
): string {
  return [...(lines ?? []), postcode ?? ""]
    .map((l) => l.trim())
    .filter(Boolean)
    .join(", ");
}

function clinicianOf(p: Practitioner): Clinician {
  return {
    name: p.displayName,
    hcpc: p.registrationNumber ?? NO_REGISTRATION,
    role:
      p.profession === "physiotherapist"
        ? "Physiotherapist"
        : p.profession.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
  };
}

/** The incident of a road traffic or workplace case (only when the case records the date of injury). */
function incidentOf(
  c: Case,
  payer: Referrer | null,
): EpisodeBundle["incident"] {
  if (!c.injuryOn) return undefined;
  const title = c.title.toLowerCase();
  const type = /road traffic|\brta\b|whiplash|car accident|collision/.test(
    title,
  )
    ? "road_traffic_accident"
    : /\bwork|workplace|lifting|warehouse/.test(title) ||
        payer?.kind === "employer"
      ? "workplace"
      : /\bslip|trip|\bfall\b|fell/.test(title)
        ? "slip_trip_fall"
        : /sport|running|football|rugby|gym/.test(title)
          ? "sport"
          : "other";
  return { date: c.injuryOn, mechanism: "", type };
}

export function buildNativeBundle(input: NativeBundleInput): EpisodeBundle {
  const { patient: p, case: c, payer, referrer } = input;
  if (!p.dateOfBirth)
    throw new NativeBundleError(
      "DATE_OF_BIRTH_MISSING",
      "The patient's date of birth is not recorded. Add it to the patient's record first.",
    );
  const byId = new Map(input.practitioners.map((x) => [x.id, x]));
  const casePractitioner = c.practitionerId
    ? byId.get(c.practitionerId)
    : undefined;
  const authorOf = (practitionerId: string | null): Clinician => {
    const pr = (practitionerId && byId.get(practitionerId)) || casePractitioner;
    return pr
      ? clinicianOf(pr)
      : { name: "Treating clinician", hcpc: NO_REGISTRATION };
  };

  // Notes: N-001… in date and time order (the ids ClinForms cites).
  const notes = input.notes
    .slice()
    .sort(
      (a, b) =>
        (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")) ||
        a.id.localeCompare(b.id),
    );
  const noteIds = new Map<string, string>();
  const bundleNotes: Note[] = notes.map((n, i) => {
    const id = `N-${String(i + 1).padStart(3, "0")}`;
    noteIds.set(n.id, id);
    return {
      id,
      externalId: n.id,
      date: n.date,
      ...(n.time ? { time: n.time } : {}),
      type: n.type,
      author: authorOf(n.practitionerId),
      subjective: n.subjective,
      objective: n.objective,
      assessment: n.assessment,
      plan: n.plan,
      ...(n.freeText ? { freeText: n.freeText } : {}),
      ...(n.pastMedicalHistory
        ? { pastMedicalHistory: n.pastMedicalHistory }
        : {}),
      ...(n.socialHistory ? { socialHistory: n.socialHistory } : {}),
    };
  });

  const appointments: Appointment[] = input.appointments
    .slice()
    .sort(
      (a, b) =>
        (a.date + a.time).localeCompare(b.date + b.time) ||
        a.id.localeCompare(b.id),
    )
    .map((a) => ({
      id: a.id,
      externalId: a.id,
      date: a.date,
      time: a.time,
      status: STATUS[a.status],
      ...(a.reason ? { reason: a.reason } : {}),
      ...(a.noteId && noteIds.has(a.noteId)
        ? { noteId: noteIds.get(a.noteId) }
        : {}),
      ...(a.practitionerId || casePractitioner
        ? { clinician: authorOf(a.practitionerId) }
        : {}),
      ...(typeof a.chargePence === "number"
        ? {
            charge: {
              amount: a.chargePence / 100,
              currency: "GBP" as const,
              ...(typeof a.paid === "boolean" ? { paid: a.paid } : {}),
            },
          }
        : {}),
    }));

  const outcomeMeasures: OutcomeMeasureSeries[] = input.outcomes.map((o) => ({
    id: o.id,
    instrument: o.instrument,
    ...UNITS[o.instrument],
    points: o.points
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((pt) => ({
        date: pt.date,
        value: pt.value,
        ...(pt.noteId && noteIds.has(pt.noteId)
          ? { noteId: noteIds.get(pt.noteId) }
          : {}),
      })),
  }));

  // Clinicians: the case's practitioner first, then everyone who wrote a note or saw the patient.
  const clinicianIds = [
    c.practitionerId,
    ...notes.map((n) => n.practitionerId),
    ...input.appointments.map((a) => a.practitionerId),
  ].filter((x): x is string => Boolean(x) && byId.has(x as string));
  const clinicians = Array.from(new Set(clinicianIds)).map((id) =>
    clinicianOf(byId.get(id) as Practitioner),
  );

  const party =
    payer ?? (referrer && PARTY_TYPE[referrer.kind] ? referrer : null);
  const auth = input.authorisations
    .filter((a) => a.status === "active")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const referredBy =
    referrer &&
    (referrer.kind === "gp" ||
      referrer.kind === "consultant" ||
      referrer.kind === "other")
      ? referrer.name
      : undefined;

  return {
    tenantId: input.tenantId,
    source: {
      connectorId: NATIVE_CONNECTOR_ID,
      simulated: false,
      fetchedAt: input.fetchedAt,
      externalPatientId: p.id,
      externalEpisodeId: c.id,
      label: CLINIC_SYSTEM_NAME,
    },
    episodeTitle: c.title,
    registration: {
      id: "REG",
      externalPatientId: p.id,
      ...(p.title ? { title: p.title } : {}),
      firstName: p.firstName,
      lastName: p.lastName,
      fullName: `${p.firstName} ${p.lastName}`,
      dob: p.dateOfBirth,
      sex:
        p.sex === "female" || p.sex === "male" || p.sex === "other"
          ? p.sex
          : "not_recorded",
      addressSummary: oneLine(p.address, p.postcode),
      ...(p.occupation ? { occupation: p.occupation } : {}),
      ...(p.employer ? { employer: p.employer } : {}),
      ...(p.phoneMobile || p.phoneHome || p.email
        ? {
            contact: {
              ...(p.phoneMobile || p.phoneHome
                ? { phone: (p.phoneMobile ?? p.phoneHome) as string }
                : {}),
              ...(p.email ? { email: p.email } : {}),
            },
          }
        : {}),
      ...(p.gpPractice || p.gpName
        ? { gpPractice: [p.gpName, p.gpPractice].filter(Boolean).join(", ") }
        : {}),
    },
    referral: {
      type: party ? (PARTY_TYPE[party.kind] ?? "other") : "other",
      name: party?.name ?? (referrer?.name || "Self-referral"),
      reference: c.claimReference ?? "",
      contactName: party?.contactName ?? "",
      address: party ? oneLine(party.address, party.postcode) : "",
      referralDate: c.referralReceivedOn ?? c.openedOn,
      ...(c.referralReason && input.referralReason !== false
        ? { reason: c.referralReason }
        : {}),
      ...(payer?.kind === "insurer" ? { insurerName: payer.name } : {}),
      ...(c.membershipNumber ? { membershipNumber: c.membershipNumber } : {}),
      ...(auth ? { authorisationNumber: auth.code } : {}),
      ...(referredBy ? { referredBy } : {}),
    },
    ...(incidentOf(c, payer) ? { incident: incidentOf(c, payer) } : {}),
    clinicians,
    notes: bundleNotes,
    appointments,
    outcomeMeasures,
    consent: input.request?.consentRecorded
      ? {
          disclosureConsentRecorded: true,
          ...(input.request.consentOn ? { date: input.request.consentOn } : {}),
        }
      : { disclosureConsentRecorded: false },
    episodeStatus: c.status === "open" ? "open" : "discharged",
    ...(input.clinic ? { clinic: clinicDetailsFromProfile(input.clinic) } : {}),
  };
}

export interface LoadBundleOptions {
  ports: IntegrationPorts;
  /**
   * The member may see clinical notes (clinical.view): only then are signed notes and outcome scores read. Without it
   * the bundle carries the shared record only (registration, referral, payer, authorisation, appointments) and no
   * clinical free text – reception never gets a clinical prefill.
   */
  clinical: boolean;
  /** The member may see the referral reason (patients.referral). */
  referral: boolean;
  now?: Date;
  /** The clinic's details for documents (default: its clinic profile). */
  clinic?: (tenantId: string) => Promise<NativeBundleInput["clinic"]>;
}

/** Reads one case of one patient (both of this clinic) and builds its bundle. Throws NativeBundleError. */
export async function loadNativeBundle(
  ctx: RepoContext,
  tenantId: string,
  patientId: string,
  caseId: string,
  options: LoadBundleOptions,
): Promise<EpisodeBundle> {
  const [patient, kase] = await Promise.all([
    getPatient(ctx, tenantId, patientId),
    getCase(ctx, tenantId, caseId),
  ]);
  if (!patient || !kase || kase.patientId !== patient.id)
    throw new NativeBundleError(
      "NOT_FOUND",
      "There is no such case for this patient in the clinic system.",
    );
  const { records, diary } = options.ports;
  const [
    payer,
    referrer,
    authorisations,
    practitioners,
    notes,
    appointments,
    outcomes,
    request,
    clinic,
  ] = await Promise.all([
    kase.payerReferrerId
      ? getReferrer(ctx, tenantId, kase.payerReferrerId)
      : Promise.resolve(null),
    kase.referrerId
      ? getReferrer(ctx, tenantId, kase.referrerId)
      : Promise.resolve(null),
    listAuthorisations(ctx, tenantId, { caseId }),
    listPractitioners(ctx, tenantId, { includeInactive: true }),
    records && options.clinical
      ? records.caseNotes(ctx, tenantId, patient.id, caseId)
      : Promise.resolve([]),
    diary
      ? diary.caseAppointments(ctx, tenantId, patient.id, caseId)
      : Promise.resolve([]),
    records && options.clinical
      ? records.caseOutcomes(ctx, tenantId, patient.id, caseId)
      : Promise.resolve([]),
    latestFormRequest(ctx, tenantId, caseId),
    options.clinic
      ? options.clinic(tenantId)
      : loadClinicProfile(ctx.db, tenantId),
  ]);
  return buildNativeBundle({
    tenantId,
    fetchedAt: (options.now ?? new Date()).toISOString(),
    patient,
    case: kase,
    payer,
    referrer,
    authorisations,
    practitioners,
    notes,
    appointments,
    outcomes,
    request,
    referralReason: options.referral,
    clinic,
  });
}

/** One practitioner as a ClinForms clinician (the launch's treating clinician), when they have a registration number. */
export async function practitionerClinician(
  ctx: RepoContext,
  tenantId: string,
  practitionerId: string | null,
): Promise<Clinician | null> {
  if (!practitionerId) return null;
  const p = await getPractitioner(ctx, tenantId, practitionerId);
  return p && p.registrationNumber ? clinicianOf(p) : null;
}
