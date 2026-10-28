/**
 * What the patient portal and the "manage this booking" pages show – only the signed-in patient's own appointments,
 * forms and shared documents (or, through a manage link, that one booking and its forms). Ids from the address are
 * always checked against the patient; anything else is "not found".
 */
import "server-only";
import { formatPence } from "../../../modules/pms/core/text";
import { clinicPublicPaths } from "../../../modules/pms/portal/paths";
import { patientChangeRights, type PatientChangeRights } from "../../../modules/pms/portal/policy";
import { formatWhen } from "../../../modules/pms/portal/time";
import type { IntakeResponse, IntakeResponseSummary, OnlineBooking, PortalShareSummary } from "../../../modules/pms/portal/types";
import type { RepoContext } from "../../repos/context";
import { findByManageToken, onlineBookingsForAppointments } from "../../repos/pms/portal/bookings";
import { getIntakeResponse, listResponsesForAppointment, listResponsesForPatient } from "../../repos/pms/portal/intake";
import { getPortalShare, listSharesForPatient, shareFilesForPatient } from "../../repos/pms/portal/shares";
import { listAttachmentsForPatient } from "../../repos/pms/records/attachments";
import { ATTACHMENT_TYPES, formatBytes } from "../../../modules/pms/records/attachments";
import { portalDiary, type PortalAppointment } from "./diary-port";
import { directoryView, type DirectoryView } from "./directory-view";
import type { PublicClinic } from "./public-clinic";
import { hashSecret, isLinkToken } from "./tokens";
import { pmsNow } from "../../../modules/pms/core/clock";

const STATUS_WORDS: Record<string, string> = {
  booked: "Booked",
  arrived: "Arrived",
  in_treatment: "In treatment",
  attended: "Completed",
  dna: "Missed",
  late_cancelled: "Cancelled – late cancellation",
  cancelled: "Cancelled",
};

export interface AppointmentCard {
  id: string;
  rev: number;
  startsAt: string;
  when: string;
  dow: string;
  day: string;
  time: string;
  service: string;
  practitioner: string;
  site: string;
  siteAddress: string;
  status: string;
  statusWords: string;
  reference: string | null;
  rights: PatientChangeRights;
  /** The fee a late cancellation may cost (the appointment type's price), when known. */
  lateFee: string | null;
  serviceId: string | null;
  siteId: string;
}

function card(clinic: PublicClinic, a: PortalAppointment, dir: DirectoryView, booking: OnlineBooking | undefined, now: Date): AppointmentCard {
  const when = formatWhen(a.startsAt);
  const site = dir.sites.get(a.siteId);
  const service = a.serviceId ? dir.services.get(a.serviceId) : undefined;
  return {
    id: a.id,
    rev: a.rev,
    startsAt: a.startsAt,
    when,
    dow: when.slice(0, 3),
    day: when.slice(4, 6),
    time: when.slice(-5),
    service: service?.name ?? "Appointment",
    practitioner: a.practitionerId ? dir.practitionerName(a.practitionerId) : "",
    site: site?.name ?? "",
    siteAddress: [...(site?.address ?? []), site?.postcode].filter(Boolean).join(", "),
    status: a.status,
    statusWords: STATUS_WORDS[a.status] ?? a.status,
    reference: booking?.reference ?? null,
    rights: patientChangeRights(clinic.settings, a, now.getTime()),
    lateFee: service?.defaultPricePence ? formatPence(service.defaultPricePence) : null,
    serviceId: a.serviceId,
    siteId: a.siteId,
  };
}

export interface FormCard {
  id: string;
  name: string;
  kind: IntakeResponseSummary["kind"];
  status: IntakeResponseSummary["status"];
  /** "before Wed 28/10 at 16:00" when sent for an appointment. */
  before: string | null;
  submittedAt: string | null;
  href: string;
}

export interface PortalHome {
  upcoming: AppointmentCard[];
  past: AppointmentCard[];
  formsToDo: FormCard[];
  documents: { id: string; title: string; detail: string; href: string }[];
}

export async function portalHome(ctx: RepoContext, clinic: PublicClinic, patientId: string, now: Date = pmsNow()): Promise<PortalHome> {
  const paths = clinicPublicPaths(clinic.tenantId);
  const [appointments, responses, shares, dir, shareFiles, files] = await Promise.all([
    portalDiary().patientAppointments(ctx, clinic.tenantId, patientId, { limit: 100 }),
    listResponsesForPatient(ctx, clinic.tenantId, patientId),
    listSharesForPatient(ctx, clinic.tenantId, patientId),
    directoryView(ctx, clinic.tenantId),
    shareFilesForPatient(ctx, clinic.tenantId, patientId),
    listAttachmentsForPatient(ctx, clinic.tenantId, patientId),
  ]);
  // A shared FILE is listed only while it is still on the record (a file withdrawn from the record is never handed out).
  const activeFiles = new Map(files.map((f) => [f.id, f]));
  const bookings = await onlineBookingsForAppointments(ctx, clinic.tenantId, appointments.map((a) => a.id));
  const cards = appointments.map((a) => card(clinic, a, dir, bookings.get(a.id), now));
  const nowIso = now.toISOString();
  const byId = new Map(appointments.map((a) => [a.id, a]));
  const formCard = (r: IntakeResponseSummary): FormCard => {
    const appt = r.appointmentId ? byId.get(r.appointmentId) : undefined;
    return { id: r.id, name: r.name, kind: r.kind, status: r.status, before: appt ? formatWhen(appt.startsAt) : null, submittedAt: r.submittedAt, href: paths.portalForm(r.id) };
  };
  return {
    upcoming: cards.filter((c) => c.startsAt >= nowIso || c.status === "arrived").filter((c) => c.status !== "cancelled" || c.startsAt >= nowIso),
    past: cards.filter((c) => c.startsAt < nowIso && c.status !== "arrived").reverse().slice(0, 10),
    formsToDo: responses.filter((r) => r.status === "requested").map(formCard),
    documents: [
      ...shares
        .filter((s: PortalShareSummary) => !shareFiles.has(s.id) || activeFiles.has(shareFiles.get(s.id) as string))
        .map((s: PortalShareSummary) => {
          const file = shareFiles.has(s.id) ? activeFiles.get(shareFiles.get(s.id) as string) : undefined;
          const kind = file ? `${ATTACHMENT_TYPES[file.type]?.label ?? "File"}, ${formatBytes(file.sizeBytes)} · ` : "";
          return { id: s.id, title: s.title, detail: `${kind}Shared ${formatWhen(s.sharedAt).slice(0, 14)}`, href: paths.portalDocument(s.id) };
        }),
      ...responses.filter((r) => r.status === "submitted" && r.kind !== "outcome").map((r) => ({ id: r.id, title: `${r.name} (signed copy)`, detail: r.submittedAt ? `Sent ${formatWhen(r.submittedAt).slice(0, 14)}` : "", href: paths.portalForm(r.id) })),
    ],
  };
}

/** One of the patient's own appointments as a card, or null. */
export async function appointmentCard(ctx: RepoContext, clinic: PublicClinic, patientId: string, appointmentId: string, now: Date = pmsNow()): Promise<AppointmentCard | null> {
  if (typeof appointmentId !== "string" || !/^appt_[0-9A-HJKMNP-TV-Z]{26}$/.test(appointmentId)) return null;
  const a = await portalDiary().appointment(ctx, clinic.tenantId, appointmentId);
  if (!a || a.patientId !== patientId) return null;
  const [dir, bookings] = await Promise.all([directoryView(ctx, clinic.tenantId), onlineBookingsForAppointments(ctx, clinic.tenantId, [a.id])]);
  return card(clinic, a, dir, bookings.get(a.id), now);
}

export interface ManageContext {
  booking: OnlineBooking;
  appointment: AppointmentCard;
  forms: FormCard[];
  token: string;
}

/** The booking a "manage this booking" link opens (valid, unexpired), with its appointment and forms – or null. */
export async function manageContext(ctx: RepoContext, clinic: PublicClinic, token: string, now: Date = pmsNow()): Promise<ManageContext | null> {
  if (!isLinkToken(token)) return null;
  const booking = await findByManageToken(ctx, clinic.tenantId, hashSecret(token));
  if (!booking) return null;
  const appointment = await appointmentCard(ctx, clinic, booking.patientId, booking.appointmentId, now);
  if (!appointment) return null;
  const paths = clinicPublicPaths(clinic.tenantId);
  const forms = (await listResponsesForAppointment(ctx, clinic.tenantId, booking.appointmentId))
    .filter((r) => r.patientId === booking.patientId)
    .map((r) => ({ id: r.id, name: r.name, kind: r.kind, status: r.status, before: appointment.when, submittedAt: r.submittedAt, href: paths.manageForm(token, r.id) }));
  return { booking, appointment, forms, token };
}

/** A form copy of this patient (portal) – or, through a manage link, of that booking's appointment. */
export async function patientForm(ctx: RepoContext, clinic: PublicClinic, who: { patientId: string; appointmentId?: string }, responseId: string): Promise<IntakeResponse | null> {
  if (typeof responseId !== "string" || !/^ifr_[0-9A-HJKMNP-TV-Z]{26}$/.test(responseId)) return null;
  const r = await getIntakeResponse(ctx, clinic.tenantId, responseId);
  if (!r || r.patientId !== who.patientId || r.status === "cancelled") return null;
  if (who.appointmentId !== undefined && r.appointmentId !== who.appointmentId) return null;
  return r;
}

/** A shared document of the signed-in patient, with the file it hands out (if any and still on the record) – or null. */
export async function patientShare(ctx: RepoContext, tenantId: string, patientId: string, shareId: string) {
  if (typeof shareId !== "string" || !/^psh_[0-9A-HJKMNP-TV-Z]{26}$/.test(shareId)) return null;
  const share = await getPortalShare(ctx, tenantId, shareId);
  if (!share || share.patientId !== patientId || share.withdrawnAt) return null;
  if (!share.attachmentId) return { share, file: null };
  const file = (await listAttachmentsForPatient(ctx, tenantId, patientId)).find((f) => f.id === share.attachmentId);
  if (!file) return null;
  return { share, file: { id: file.id, label: ATTACHMENT_TYPES[file.type]?.label ?? "File", size: formatBytes(file.sizeBytes) } };
}
