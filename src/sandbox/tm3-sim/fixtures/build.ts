/**
 * Small builders that turn a list of visits into linked wire appointments and notes, so the fixture
 * files read like a clinic diary. Wire IDs:
 *   appointment  sim-appt-<episodeKey>-<nn>
 *   note         sim-note-<episodeKey>-<nn>   (nn = the appointment's position in the diary)
 *
 * Owner: sandbox/fixtures agent.
 */
import type { SimAppointment, SimAppointmentStatus, SimCharge, SimClinician, SimNote, SimNoteType } from "../wire-types";

export interface NoteSpec {
  type: SimNoteType;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  freeText?: string;
  pastMedicalHistory?: string;
  socialHistory?: string;
}

export interface VisitSpec {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time: string;
  durationMinutes: number;
  clinician: SimClinician;
  status: SimAppointmentStatus;
  /** Reason recorded for DNA/LCN/CNC (omit when none was recorded). */
  reason?: string;
  /** Only attended visits have a note. */
  note?: NoteSpec;
  /** The clinic's charge, in pounds (omit when none was raised – e.g. cancelled or booked visits). */
  charge?: { amount: number; paid: boolean };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function buildVisits(
  episodeId: string,
  episodeKey: string,
  visits: VisitSpec[],
): { appointments: SimAppointment[]; notes: SimNote[] } {
  const appointments: SimAppointment[] = [];
  const notes: SimNote[] = [];
  visits.forEach((v, i) => {
    const nn = pad2(i + 1);
    const appointmentId = `sim-appt-${episodeKey}-${nn}`;
    const noteId = v.note ? `sim-note-${episodeKey}-${nn}` : null;
    const charge: SimCharge | undefined = v.charge ? { amount: v.charge.amount, currency: "GBP", paid: v.charge.paid } : undefined;
    appointments.push({
      id: appointmentId,
      episode_id: episodeId,
      date: v.date,
      start_time: v.time,
      duration_minutes: v.durationMinutes,
      status: v.status,
      status_reason: v.reason ?? null,
      clinician: v.clinician,
      note_id: noteId,
      // Only visits with a charge carry the key, so earlier cases' wire data is unchanged.
      ...(charge ? { charge } : {}),
      _simulated: true,
    });
    if (v.note && noteId) {
      notes.push({
        id: noteId,
        episode_id: episodeId,
        note_date: v.date,
        note_time: v.time,
        note_type: v.note.type,
        author: v.clinician,
        subjective: v.note.subjective,
        objective: v.note.objective,
        assessment: v.note.assessment,
        plan: v.note.plan,
        free_text: v.note.freeText ?? null,
        past_medical_history: v.note.pastMedicalHistory ?? null,
        social_history: v.note.socialHistory ?? null,
        appointment_id: appointmentId,
        _simulated: true,
      });
    }
  });
  return { appointments, notes };
}

/** Wire note ID of the visit at 1-based diary position `n` (for outcome-score links). */
export function noteRef(episodeKey: string, n: number): string {
  return `sim-note-${episodeKey}-${pad2(n)}`;
}
