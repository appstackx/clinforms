/**
 * The fictional demonstration patient as a clinic would export her: the simulated clinic system's record (the
 * sandbox fixtures, scripts/medreport/dev-bundles.ts) written in ClinForms' documented JSON import format
 * (src/modules/medreport/connectors/file-import/format.ts, "appstackx-reports.import" v1) – the file a clinic uploads
 * with "Upload the notes". Used by scripts/admin/seed-demo-clinic.ts, which also writes it out for the owner.
 *
 * Fictional data only (Rebecca Lane, sim-pat-006 – see the fixture's header).
 */
import type { SimEpisodeData } from "../../src/modules/medreport/connectors/tm3-sim/mapper";
import { IMPORT_FORMAT_ID, IMPORT_FORMAT_VERSION, type ImportDocument } from "../../src/modules/medreport/connectors/file-import/format";
import { getDemoEpisodeData } from "../medreport/dev-bundles";

/** The documented import file's name, as the clinic's Studio and the owner see it. */
export const DEMO_NOTES_FILE_NAME = "rebecca-lane-notes.json";

/** A record from the simulated clinic system's wire format → the documented import document (nothing invented). */
export function importDocumentFromSim(data: SimEpisodeData): ImportDocument {
  const { patient, episode, notes, appointments, outcomeMeasures } = data;
  const r = episode.referral;
  return {
    format: IMPORT_FORMAT_ID,
    version: IMPORT_FORMAT_VERSION,
    patient: {
      id: patient.id,
      title: patient.title,
      first_name: patient.first_name,
      last_name: patient.last_name,
      date_of_birth: patient.date_of_birth,
      sex: patient.sex,
      address: { line1: patient.address.line1, line2: patient.address.line2, town: patient.address.town, postcode: patient.address.postcode },
      phone: patient.phone,
      email: patient.email,
      occupation: patient.occupation,
      employer_name: patient.employer_name,
    },
    episode: {
      id: episode.id,
      title: episode.title,
      status: episode.status,
      start_date: episode.start_date,
      end_date: episode.end_date,
      referral: {
        source_type: r.source_type,
        organisation_name: r.organisation_name,
        reference: r.reference,
        contact_name: r.contact_name,
        address: r.address,
        referral_date: r.referral_date,
        reason: r.reason,
        insurer_name: r.insurer_name ?? null,
        membership_number: r.membership_number ?? null,
        authorisation_number: r.authorisation_number ?? null,
      },
      incident: episode.incident ? { date: episode.incident.date, mechanism: episode.incident.mechanism, incident_type: episode.incident.incident_type } : null,
      consent: { disclosure_consent_recorded: episode.consent.disclosure_consent_recorded, recorded_on: episode.consent.recorded_on },
      primary_clinician: { name: episode.primary_clinician.name, hcpc: episode.primary_clinician.hcpc, role: episode.primary_clinician.role },
    },
    notes: notes.map((n) => ({
      id: n.id,
      note_date: n.note_date,
      note_time: n.note_time,
      note_type: n.note_type,
      author: { name: n.author.name, hcpc: n.author.hcpc, role: n.author.role },
      subjective: n.subjective,
      objective: n.objective,
      assessment: n.assessment,
      plan: n.plan,
      free_text: n.free_text,
      past_medical_history: n.past_medical_history,
      social_history: n.social_history,
      appointment_id: n.appointment_id,
    })),
    appointments: appointments.map((a) => ({
      id: a.id,
      date: a.date,
      start_time: a.start_time,
      duration_minutes: a.duration_minutes,
      status: a.status,
      status_reason: a.status_reason,
      clinician: { name: a.clinician.name, hcpc: a.clinician.hcpc, role: a.clinician.role },
      note_id: a.note_id,
      ...(a.charge ? { charge: { amount: a.charge.amount, currency: a.charge.currency, paid: a.charge.paid } } : {}),
    })),
    outcome_measures: outcomeMeasures.map((m) => ({
      id: m.id,
      instrument: m.instrument,
      unit: m.unit,
      higher_is_worse: m.higher_is_worse,
      scores: m.scores.map((s) => ({ date: s.date, value: s.value, note_id: s.note_id })),
    })),
  };
}

/** The demonstration patient's import file (JSON text, 2-space indented, trailing newline). */
export function demoPatientNotesJson(): string {
  return `${JSON.stringify(importDocumentFromSim(getDemoEpisodeData("rebecca-lane")), null, 2)}\n`;
}
