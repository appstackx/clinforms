/**
 * The appointment dialog's data: one diary item with its notes decrypted, the patient identified (name, number,
 * date of birth, mobile – what reception checks on the phone), the case and authorisation, the series. Server only.
 */
import "server-only";
import { formatUkDate } from "../../../modules/pms/core/text";
import { canMove, isLateCancellation, nextStatuses } from "../../../modules/pms/diary/rules";
import { formatLondonTime, minutesBetween } from "../../../modules/pms/diary/time";
import type { AppointmentDetailsView } from "../../../modules/pms/diary/view";
import { nowIso, type RepoContext } from "../../repos/context";
import { listAuthorisations, listCasesForPatient } from "../../repos/pms/cases";
import { getAppointment } from "../../repos/pms/diary/appointments";
import { getPractitioner, getRoom, getService, getSite } from "../../repos/pms/directory";
import { getPatient } from "../../repos/pms/patients";

export async function loadAppointmentDetails(ctx: RepoContext, tenantId: string, id: string, options: { withPatient: boolean }): Promise<AppointmentDetailsView | null> {
  const a = await getAppointment(ctx, tenantId, id);
  if (!a) return null;
  const [site, practitioner, room, service, patient, cases, auths, later] = await Promise.all([
    getSite(ctx, tenantId, a.siteId),
    a.practitionerId ? getPractitioner(ctx, tenantId, a.practitionerId) : null,
    a.roomId ? getRoom(ctx, tenantId, a.roomId) : null,
    a.serviceId ? getService(ctx, tenantId, a.serviceId) : null,
    a.patientId && options.withPatient ? getPatient(ctx, tenantId, a.patientId) : null,
    a.patientId ? listCasesForPatient(ctx, tenantId, a.patientId) : [],
    a.patientId ? listAuthorisations(ctx, tenantId, { patientId: a.patientId }) : [],
    a.seriesId
      ? ctx.db
          .selectFrom("pms_appointments")
          .select((eb) => eb.fn.countAll<number>().as("n"))
          .where("tenant_id", "=", tenantId)
          .where("series_id", "=", a.seriesId)
          .where("status", "=", "booked")
          .where("starts_at", ">=", a.startsAt)
          .executeTakeFirst()
      : null,
  ]);
  const kase = a.caseId ? (cases.find((c) => c.id === a.caseId) ?? null) : null;
  const auth = a.authorisationId ? (auths.find((x) => x.id === a.authorisationId) ?? null) : null;
  return {
    id: a.id,
    rev: a.rev,
    kind: a.kind,
    status: a.status,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    startsOn: a.startsOn,
    startTime: formatLondonTime(a.startsAt),
    durationMinutes: minutesBetween(a.startsAt, a.endsAt),
    siteId: a.siteId,
    siteName: site?.name ?? null,
    practitionerId: a.practitionerId,
    practitionerName: practitioner?.displayName ?? null,
    roomId: a.roomId,
    roomName: room?.name ?? null,
    serviceId: a.serviceId,
    serviceName: service?.name ?? null,
    blockKind: a.blockKind,
    title: a.title,
    notes: a.notes,
    cancelNote: a.cancelNote,
    cancelReason: a.cancelReason,
    feeDue: a.feeDue,
    feePence: a.feePence,
    source: a.source,
    authSessionUsed: a.authSessionUsed,
    patient: patient
      ? {
          id: patient.id,
          name: `${patient.preferredName || patient.firstName} ${patient.lastName}`,
          number: patient.patientNumber,
          dateOfBirth: patient.dateOfBirth ? formatUkDate(patient.dateOfBirth) : null,
          phone: patient.phoneMobile,
          hasAlerts: patient.hasAlerts,
        }
      : null,
    caseId: a.caseId,
    caseTitle: kase?.title ?? null,
    authorisation: auth ? { id: auth.id, code: auth.code, sessionsAuthorised: auth.sessionsAuthorised, sessionsUsed: auth.sessionsUsed, expiresOn: auth.expiresOn } : null,
    cases: cases.filter((c) => c.status !== "closed").map((c) => ({ id: c.id, title: c.title })),
    authorisations: auths
      .filter((x) => x.status === "active")
      .map((x) => ({ id: x.id, caseId: x.caseId, code: x.code, sessionsLeft: x.sessionsAuthorised === null ? null : Math.max(0, x.sessionsAuthorised - x.sessionsUsed) })),
    seriesId: a.seriesId,
    seriesLater: Number(later?.n ?? 0),
    nextStatuses: Array.from(nextStatuses(a.kind, a.status)),
    canMove: canMove(a.status),
    lateIfCancelledNow: isLateCancellation(a.startsAt, nowIso(ctx)),
  };
}
