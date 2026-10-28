/**
 * The appointment dialog's data: one diary item with its notes decrypted, the patient identified (name, number,
 * date of birth, mobile – what reception checks on the phone – only for roles that may see patients), the case
 * and authorisation, the series. diary.view; an item at a site outside the member's scope is "not found".
 * Server only.
 */
import "server-only";
import { PMS_ID_PATTERN } from "../../../modules/pms/core/ids";
import { formatUkDate } from "../../../modules/pms/core/text";
import { canMove, isLateCancellation, nextStatuses } from "../../../modules/pms/diary/rules";
import { formatLondonTime, minutesBetween } from "../../../modules/pms/diary/time";
import { DIARY_COPY } from "../../../modules/pms/diary/copy";
import type { DiaryRead } from "../../../modules/pms/diary/types";
import type { AppointmentDetailsView } from "../../../modules/pms/diary/view";
import { nowIso } from "../../repos/context";
import { getCase, listAuthorisations, listCasesForPatient } from "../../repos/pms/cases";
import { priceFor } from "../../repos/pms/price-lists";
import { getAppointment } from "../../repos/pms/diary/appointments";
import { occupyingNear } from "../../repos/pms/diary/shared";
import { getPatientSummaries } from "../../repos/pms/patients";
import { getPractitioner, getRoom, getService, getSite } from "../../repos/pms/directory";
import { getPatient } from "../../repos/pms/patients";
import { inScope, type DiaryCaller } from "./caller";
import { payerLabel, referrerNames } from "./payers";
import { doubleBookingsOf, isInitialCategory, patientDisplayName } from "./view";

/** Who booked an appointment, in words: a member's name, the patient (online) or the data import. */
async function bookedByOf(caller: DiaryCaller, source: string, createdBy: string | null): Promise<string | null> {
  if (source === "online") return "the patient online";
  if (source === "import") return "data import";
  if (!createdBy) return null;
  const user = await caller.ctx.db.selectFrom("user").select("name").where("id", "=", createdBy).executeTakeFirst();
  return user?.name ?? null;
}

export async function loadAppointmentDetails(caller: DiaryCaller, id: string): Promise<DiaryRead<AppointmentDetailsView>> {
  if (!caller.can("diary.view")) return { ok: false, status: 403, error: DIARY_COPY.notAllowed };
  const notFound = { ok: false as const, status: 404 as const, error: DIARY_COPY.notFound };
  if (!PMS_ID_PATTERN.test(id)) return notFound;
  const { ctx, tenantId } = caller;
  const options = { withPatient: caller.can("patients.view") };
  const a = await getAppointment(ctx, tenantId, id);
  if (!a || !inScope(caller, a.siteId)) return notFound;
  const [site, practitioner, room, service, patient, cases, auths, later] = await Promise.all([
    getSite(ctx, tenantId, a.siteId),
    a.practitionerId ? getPractitioner(ctx, tenantId, a.practitionerId) : null,
    a.roomId ? getRoom(ctx, tenantId, a.roomId) : null,
    a.serviceId ? getService(ctx, tenantId, a.serviceId) : null,
    a.patientId && options.withPatient ? getPatient(ctx, tenantId, a.patientId) : null,
    a.patientId && options.withPatient ? listCasesForPatient(ctx, tenantId, a.patientId) : [],
    a.patientId && options.withPatient ? listAuthorisations(ctx, tenantId, { patientId: a.patientId }) : [],
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
  const fullCase = kase ? await getCase(ctx, tenantId, kase.id) : null;
  const [names, price, bookedBy] = await Promise.all([
    kase?.payerReferrerId ? referrerNames(ctx, tenantId, [kase.payerReferrerId]) : Promise.resolve(new Map<string, string>()),
    a.serviceId ? priceFor(ctx, tenantId, a.serviceId, fullCase?.priceListId ?? null) : Promise.resolve(null),
    bookedByOf(caller, a.source, a.createdBy),
  ]);
  const auth = a.authorisationId ? (auths.find((x) => x.id === a.authorisationId) ?? null) : null;
  // A logged double-booking: the practitioner's other appointments at the same time (names for roles that may
  // see patients).
  const near = a.kind === "appointment" && a.practitionerId ? await occupyingNear(ctx, tenantId, { spans: [a], practitionerId: a.practitionerId, excludeId: a.id }) : [];
  const nearPatients = options.withPatient ? await getPatientSummaries(ctx, tenantId, near.map((n) => n.patientId).filter((x): x is string => Boolean(x))) : new Map<string, never>();
  const doubleBookedWith = doubleBookingsOf(a, near, (pid) => {
    const p = nearPatients.get(pid);
    return p ? patientDisplayName(p) : null;
  });
  const view: AppointmentDetailsView = {
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
    treatmentStarted: a.treatmentStartedAt !== null,
    doubleBookedWith,
    lateIfCancelledNow: isLateCancellation(a.startsAt, nowIso(ctx)),
    initial: isInitialCategory(service?.category),
    pricePence: price?.pricePence ?? service?.defaultPricePence ?? null,
    payerLabel: kase ? payerLabel(kase, names, fullCase?.excessPence ?? null) : null,
    alertText: patient?.alerts ?? null,
    bookedBy,
    bookedAt: a.createdAt,
    confirmationRequested: a.confirmationRequested,
  };
  return { ok: true, data: view };
}
