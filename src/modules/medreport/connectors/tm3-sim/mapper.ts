import "server-only";

/**
 * Maps simulated TM3 wire data to an EpisodeBundle. Pure: no I/O, no clock, no randomness, so the same
 * wire data always yields the same bundle (stable citable IDs).
 *
 * - Notes get citable IDs "N-001"… in date/time order (ties broken by wire ID).
 * - Appointments get "A-001"… in date/time order; their note links are rewritten to N-IDs (via
 *   `note_id`, or a note whose `appointment_id` points back at the appointment).
 * - Outcome series get "OM-<instrument>" ("OM-NDI-2" if an instrument repeats); points are sorted by date
 *   and linked to N-IDs (via `note_id`, or the single note on the same date).
 * - Clinicians are de-duplicated by HCPC number: primary clinician first, then note authors, then
 *   appointment clinicians.
 * - Appointment charges and the referral's insurer, membership and authorisation numbers are copied when
 *   the wire has them (private medical insurance episodes), and left out otherwise.
 * - Only items whose `episode_id` matches the episode are used. ISO dates are kept as they are.
 * - Wire `null`s become absent optional fields; InstructingParty strings become "" when null.
 *
 * Owner: sandbox/fixtures agent.
 */
import { compareIsoDateTime } from "../../core/dates";
import { formatNoteId } from "../../core/ids";
import { REGISTRATION_SOURCE_ID } from "../../core/schemas";
import type {
  Appointment,
  Clinician,
  EpisodeBundle,
  InstructingParty,
  Note,
  OutcomeMeasureSeries,
  PatientRegistration,
  TenantId,
} from "../../core/types";
import { ConnectorError } from "../types";
import type {
  SimAddress,
  SimAppointment,
  SimClinician,
  SimEpisode,
  SimNote,
  SimOutcomeMeasure,
  SimPatient,
  SimReferral,
} from "./wire";

export interface SimEpisodeData {
  patient: SimPatient;
  episode: SimEpisode;
  notes: SimNote[];
  appointments: SimAppointment[];
  outcomeMeasures: SimOutcomeMeasure[];
}

/** Provenance label written to `bundle.source.label`. */
export const TM3_SIM_SOURCE_LABEL = "Simulated TM3 sandbox";

/** "A-001" for the first appointment in date/time order. */
export function formatAppointmentId(n: number): string {
  return `A-${String(n).padStart(3, "0")}`;
}

export function mapSimEpisodeToBundle(
  data: SimEpisodeData,
  opts: { tenantId: TenantId; fetchedAt: string },
): EpisodeBundle {
  const { patient, episode } = data;
  if (episode.patient_id !== patient.id) {
    throw new ConnectorError(
      "INVALID_DATA",
      `Episode ${episode.id} belongs to patient ${episode.patient_id}, not ${patient.id}.`,
    );
  }

  const wireNotes = data.notes.filter((n) => n.episode_id === episode.id);
  const wireAppointments = data.appointments.filter((a) => a.episode_id === episode.id);
  const wireOutcomes = data.outcomeMeasures.filter((m) => m.episode_id === episode.id);

  // Notes: N-001… in date/time order.
  const sortedNotes = wireNotes
    .slice()
    .sort((a, b) => compareIsoDateTime(noteKey(a), noteKey(b)) || compareStrings(a.id, b.id));
  const noteIdByWireId = new Map<string, string>();
  sortedNotes.forEach((n, i) => noteIdByWireId.set(n.id, formatNoteId(i + 1)));
  const notes: Note[] = sortedNotes.map((n) => mapNote(n, noteIdByWireId.get(n.id) as string));

  // Appointments: A-001… in date/time order, linked to N-IDs.
  const noteIdByAppointmentId = new Map<string, string>();
  sortedNotes.forEach((n) => {
    if (n.appointment_id) noteIdByAppointmentId.set(n.appointment_id, noteIdByWireId.get(n.id) as string);
  });
  const appointments: Appointment[] = wireAppointments
    .slice()
    .sort(
      (a, b) =>
        compareIsoDateTime({ date: a.date, time: a.start_time }, { date: b.date, time: b.start_time }) ||
        compareStrings(a.id, b.id),
    )
    .map((a, i) => {
      const noteId = (a.note_id ? noteIdByWireId.get(a.note_id) : undefined) ?? noteIdByAppointmentId.get(a.id);
      const out: Appointment = {
        id: formatAppointmentId(i + 1),
        externalId: a.id,
        date: a.date,
        time: a.start_time,
        status: a.status,
        clinician: mapClinician(a.clinician),
      };
      const reason = trimToUndefined(a.status_reason);
      if (reason) out.reason = reason;
      if (noteId) out.noteId = noteId;
      if (a.charge) out.charge = { amount: a.charge.amount, currency: a.charge.currency, paid: a.charge.paid };
      return out;
    });

  // Outcome measures.
  const notesByDate = new Map<string, string[]>();
  sortedNotes.forEach((n) => {
    const list = notesByDate.get(n.note_date) ?? [];
    list.push(noteIdByWireId.get(n.id) as string);
    notesByDate.set(n.note_date, list);
  });
  const instrumentCount = new Map<string, number>();
  const outcomeMeasures: OutcomeMeasureSeries[] = wireOutcomes.map((m) => {
    const count = (instrumentCount.get(m.instrument) ?? 0) + 1;
    instrumentCount.set(m.instrument, count);
    return {
      id: count === 1 ? `OM-${m.instrument}` : `OM-${m.instrument}-${count}`,
      instrument: m.instrument,
      unit: m.unit,
      higherIsWorse: m.higher_is_worse,
      points: m.scores
        .slice()
        .sort((a, b) => compareStrings(a.date, b.date))
        .map((s) => {
          const sameDay = notesByDate.get(s.date);
          const noteId =
            (s.note_id ? noteIdByWireId.get(s.note_id) : undefined) ??
            (sameDay && sameDay.length === 1 ? sameDay[0] : undefined);
          return noteId ? { date: s.date, value: s.value, noteId } : { date: s.date, value: s.value };
        }),
    };
  });

  // Clinicians, de-duplicated by HCPC number.
  const clinicians: Clinician[] = [];
  const seen = new Set<string>();
  const addClinician = (c: SimClinician) => {
    // Clinicians without a registration number (uploaded notes: "Not recorded") are told apart by name.
    const hcpc = c.hcpc.trim().toUpperCase();
    const key = hcpc && hcpc !== "NOT RECORDED" ? hcpc : `name:${c.name.trim().toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    clinicians.push(mapClinician(c));
  };
  addClinician(episode.primary_clinician);
  sortedNotes.forEach((n) => addClinician(n.author));
  wireAppointments.forEach((a) => addClinician(a.clinician));

  const bundle: EpisodeBundle = {
    tenantId: opts.tenantId,
    source: {
      connectorId: "tm3-sim",
      simulated: true,
      fetchedAt: opts.fetchedAt,
      externalPatientId: patient.id,
      externalEpisodeId: episode.id,
      label: TM3_SIM_SOURCE_LABEL,
    },
    episodeTitle: episode.title,
    registration: mapRegistration(patient),
    referral: mapReferral(episode.referral),
    clinicians,
    notes,
    appointments,
    outcomeMeasures,
    consent: episode.consent.recorded_on
      ? {
          disclosureConsentRecorded: episode.consent.disclosure_consent_recorded,
          date: episode.consent.recorded_on,
        }
      : { disclosureConsentRecorded: episode.consent.disclosure_consent_recorded },
    episodeStatus: episode.status,
  };
  if (episode.incident) {
    bundle.incident = {
      mechanism: episode.incident.mechanism,
      type: episode.incident.incident_type,
    };
    if (episode.incident.date) bundle.incident.date = episode.incident.date;
  }
  return bundle;
}

/* ------------------------------------------------------------------------------------------------ */

function noteKey(n: SimNote): { date: string; time?: string } {
  return n.note_time ? { date: n.note_date, time: n.note_time } : { date: n.note_date };
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function trimToUndefined(s: string | null | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

function mapClinician(c: SimClinician): Clinician {
  const role = trimToUndefined(c.role);
  return role ? { name: c.name, hcpc: c.hcpc, role } : { name: c.name, hcpc: c.hcpc };
}

function formatAddress(a: SimAddress): string {
  return [a.line1, a.line2, a.town, a.postcode]
    .map((part) => trimToUndefined(part))
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

function mapRegistration(p: SimPatient): PatientRegistration {
  const reg: PatientRegistration = {
    id: REGISTRATION_SOURCE_ID,
    externalPatientId: p.id,
    firstName: p.first_name,
    lastName: p.last_name,
    fullName: `${p.first_name} ${p.last_name}`,
    dob: p.date_of_birth,
    sex: p.sex,
    addressSummary: formatAddress(p.address),
  };
  const title = trimToUndefined(p.title);
  if (title) reg.title = title;
  const occupation = trimToUndefined(p.occupation);
  if (occupation) reg.occupation = occupation;
  const employer = trimToUndefined(p.employer_name);
  if (employer) reg.employer = employer;
  const phone = trimToUndefined(p.phone);
  const email = trimToUndefined(p.email);
  if (phone || email) {
    reg.contact = {};
    if (phone) reg.contact.phone = phone;
    if (email) reg.contact.email = email;
  }
  return reg;
}

function mapReferral(r: SimReferral): EpisodeBundle["referral"] {
  if (r.source_type === "self" || r.source_type === "gp") {
    throw new ConnectorError(
      "UNSUPPORTED",
      `This episode is a ${r.source_type === "gp" ? "GP" : "self"}-referral; a medico-legal report needs an instructing solicitor, employer, insurer or case manager.`,
    );
  }
  const party: InstructingParty = {
    type: r.source_type,
    name: r.organisation_name,
    reference: r.reference ?? "",
    contactName: r.contact_name ?? "",
    address: r.address ?? "",
  };
  const referral: EpisodeBundle["referral"] = { ...party };
  if (r.referral_date) referral.referralDate = r.referral_date;
  const reason = trimToUndefined(r.reason);
  if (reason) referral.reason = reason;
  // Private medical insurance identifiers (optional on the wire; absent for other referrals).
  const insurer = trimToUndefined(r.insurer_name);
  if (insurer) referral.insurerName = insurer;
  const membership = trimToUndefined(r.membership_number);
  if (membership) referral.membershipNumber = membership;
  const authorisation = trimToUndefined(r.authorisation_number);
  if (authorisation) referral.authorisationNumber = authorisation;
  return referral;
}

function mapNote(n: SimNote, id: string): Note {
  const note: Note = {
    id,
    externalId: n.id,
    date: n.note_date,
    type: n.note_type,
    author: mapClinician(n.author),
    subjective: n.subjective,
    objective: n.objective,
    assessment: n.assessment,
    plan: n.plan,
  };
  if (n.note_time) note.time = n.note_time;
  const freeText = trimToUndefined(n.free_text);
  if (freeText) note.freeText = freeText;
  const pmh = trimToUndefined(n.past_medical_history);
  if (pmh) note.pastMedicalHistory = pmh;
  const social = trimToUndefined(n.social_history);
  if (social) note.socialHistory = social;
  return note;
}
