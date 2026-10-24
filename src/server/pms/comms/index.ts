/**
 * The comms module's server API for the other modules (owned by the comms builder).
 *
 * For the DIARY (contract: comms plans the messages, the diary owns the appointments) – call after every write
 * that books, moves, changes or cancels an appointment, in the same request, after the diary's own write:
 *
 *   import { syncAppointmentMessages } from "@/server/pms/comms";
 *   await syncAppointmentMessages(actor.repo(), actor.tenantId, {
 *     id: appt.id, patientId: appt.patientId, startsAt: appt.startsAt, endsAt: appt.endsAt,
 *     siteId: appt.siteId, practitionerId: appt.practitionerId, serviceId: appt.serviceId,
 *     active: appt.status === "booked",            // false for cancelled / late cancellation / did not attend
 *   }, actor.actor, { notify: "confirmation" });    // "moved" when the time changed, "cancelled" on cancel, else "none"
 *
 * It is idempotent (safe to call again with the same appointment) and audited ("pms.message_schedule.sync").
 * appointmentReplyStates(ctx, tenantId, appointmentIds) gives the latest text reply per appointment (confirmed /
 * asked to cancel) for the diary's day view.
 */
export { syncAppointmentMessages, listScheduleForAppointment, type SyncResult } from "../../repos/pms/comms/schedule";
export { appointmentReplyStates } from "../../repos/pms/comms/messages";
export type { AppointmentForMessages } from "../../../modules/pms/comms/schemas";
