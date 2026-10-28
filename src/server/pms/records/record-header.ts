/**
 * What the patient record's header and tabs need (design round 2, "Patient record – tabs by role"), read once per
 * request (React cache) for the layout and the tab page below it.
 *
 * Every part is read through the records services – so the role decides: clinical flags, note and file counts are
 * null (left out, not empty) for a member without clinical.view (reception); appointments are null without
 * diary.view. The diary part comes from the diary's merged server read (loadPatientAppointments), read only.
 */
import "server-only";
import { cache } from "react";
import { ukToday } from "../../../modules/pms/core/text";
import type { CaseSummary, Patient } from "../../../modules/pms/core/types";
import type { PatientAppointmentRow, PatientAppointmentsView } from "../../../modules/pms/diary/view";
import type { ClinicalFlag } from "../../../modules/pms/records/flags";
import type { NoteSummary } from "../../../modules/pms/records/types";
import { listAttachmentsForPatient } from "../../repos/pms/records/attachments";
import { getAnonymisation } from "../../repos/pms/records/anonymise";
import type { ClinicActor } from "../actor";
import { diaryCallerOf } from "../diary/caller";
import { loadPatientAppointments } from "../diary/reads";
import { listCasesFor } from "./cases-service";
import { clinicalFlagsFor, patientExtrasFor } from "./flags-service";
import { listNotesFor } from "./notes-service";
import { patientOr404 } from "./record";

export interface RecordHeaderData {
  patient: Patient;
  anonymised: boolean;
  pronouns: string | null;
  pronounsRev: number;
  /** null = the member may not see clinical flags (reception). */
  flags: ClinicalFlag[] | null;
  /** null = the member may not see the diary. */
  appointments: PatientAppointmentsView | null;
  /** The appointment shown in the header's "Next appointment" card (today's open one first, else the next). */
  next: PatientAppointmentRow | null;
  cases: CaseSummary[];
  /** null = the member may not see clinical notes. */
  notes: NoteSummary[] | null;
  /** null = the member may not see attached files. */
  attachmentCount: number | null;
  today: string;
}

/** The appointment for the header: today's booked/arrived one (even if its start has passed), else the next one. */
export function headerAppointment(view: PatientAppointmentsView | null, today: string): PatientAppointmentRow | null {
  if (!view) return null;
  const todayOpen = view.past.filter((r) => r.startsOn === today && (r.status === "booked" || r.status === "arrived")).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return todayOpen[0] ?? view.upcoming.find((r) => r.status === "booked" || r.status === "arrived") ?? null;
}

export const loadRecordHeader = cache(async (actor: ClinicActor, patientId: string): Promise<RecordHeaderData> => {
  const patient = await patientOr404(actor, patientId);
  const ctx = actor.repo();
  const today = ukToday(ctx.now ? ctx.now() : new Date());
  const clinical = actor.can("clinical.view");
  const [anon, extras, flags, appts, cases, notes, files] = await Promise.all([
    getAnonymisation(ctx, actor.tenantId, patient.id),
    patientExtrasFor(actor, patient.id),
    clinical ? clinicalFlagsFor(actor, patient.id) : Promise.resolve(null),
    actor.can("diary.view") ? diaryCallerOf(actor).then((caller) => loadPatientAppointments(caller, patient.id, { pageSize: 100 })) : Promise.resolve(null),
    listCasesFor(actor, patient.id),
    clinical ? listNotesFor(actor, patient.id) : Promise.resolve(null),
    clinical ? listAttachmentsForPatient(ctx, actor.tenantId, patient.id) : Promise.resolve(null),
  ]);
  const appointments = appts && appts.ok ? appts.data : null;
  return {
    patient,
    anonymised: anon?.status === "done",
    pronouns: extras.ok ? extras.value.pronouns : null,
    pronounsRev: extras.ok ? extras.value.rev : 0,
    flags: flags && flags.ok ? flags.value : clinical ? [] : null,
    appointments,
    next: headerAppointment(appointments, today),
    cases: cases.ok ? cases.value : [],
    notes: notes && notes.ok ? notes.value : clinical ? [] : null,
    attachmentCount: files ? files.length : null,
    today,
  };
});
