/**
 * Audit actions of the diary module and their plain-English labels (owned by the diary builder – contract §7).
 * Codes: "pms.<entity>.<verb>", lower case. Every code a repository writes must be listed here. Details hold ids,
 * counts, statuses and field names only – never a patient's name or a note.
 */
export const DIARY_AUDIT_LABELS: Readonly<Record<string, string>> = {
  "pms.appointment.book": "Appointment booked",
  "pms.appointment.move": "Appointment moved",
  "pms.appointment.update": "Appointment details changed",
  "pms.appointment.arrive": "Patient marked as arrived",
  "pms.appointment.attend": "Appointment marked as attended",
  "pms.appointment.dna": "Appointment marked as did not attend",
  "pms.appointment.cancel": "Appointment cancelled",
  "pms.appointment.late_cancel": "Appointment cancelled late",
  "pms.appointment.reinstate": "Cancelled appointment reinstated",
  "pms.appointment.status_undo": "Appointment status corrected",
  "pms.appointment.cancel_series": "Rest of a recurring booking cancelled",
  "pms.appointment.bulk_create": "Appointments added in bulk",
  "pms.block.create": "Diary time blocked",
  "pms.block.move": "Blocked time moved",
  "pms.block.remove": "Blocked time removed",
  "pms.block.restore": "Blocked time restored",
  "pms.availability.create": "Rota entry added",
  "pms.availability.update": "Rota entry changed",
  "pms.availability.end": "Rota entry ended",
  "pms.availability.bulk_create": "Rota entries added in bulk",
  "pms.waiting_list.add": "Patient added to the waiting list",
  "pms.waiting_list.update": "Waiting-list entry changed",
  "pms.waiting_list.status": "Waiting-list entry removed or put back",
  "pms.waiting_list.offer": "Slot offered from the waiting list",
  "pms.waiting_list.offer_decline": "Offered slot declined",
  "pms.waiting_list.offer_withdraw": "Offered slot withdrawn",
};

/** Names of the record types its audit rows point at (target_type → label). */
export const DIARY_AUDIT_TARGETS: Readonly<Record<string, string>> = {
  pms_appointment: "Appointment",
  pms_appointment_series: "Recurring booking",
  pms_availability: "Rota entry",
  pms_waiting_list: "Waiting-list entry",
};
