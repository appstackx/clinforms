/**
 * Staff side of the portal module: Set-up → Online booking (settings.setup), the online bookings list (diary.view),
 * intake forms (builder: settings.setup) and a patient's forms on the record (patients.view – health answers only
 * with clinical.view; reception never sees them). Permission first, then the actor's sites (actor.siteIds), ids read
 * back from the database, zod-checked input, plain errors.
 */
import "server-only";
import type { PmsPermission } from "../../../modules/pms/core/permissions";
import type { OutcomeMeasureId } from "../../../modules/pms/records/outcomes";
import { MEASURES, OUTCOME_MEASURES } from "../../../modules/pms/records/outcomes";
import { recordUpdates, visibleAnswers, type RecordField, type VisibleAnswer } from "../../../modules/pms/portal/forms";
import { OUTCOME_FORM_TITLES, outcomeFormProblem, outcomeQuestionnaire } from "../../../modules/pms/portal/outcome-forms";
import { PORTAL_TIMINGS } from "../../../modules/pms/portal/policy";
import { clinicPublicPaths } from "../../../modules/pms/portal/paths";
import type { BookingSettingsInput, BookingSiteInput, IntakeTemplateInput, IntakeTemplatePatch } from "../../../modules/pms/portal/schemas";
import { starterForm } from "../../../modules/pms/portal/starters";
import type { BookingSettings, BookingSite, IntakeResponse, IntakeResponseSummary, IntakeTemplate, OnlineBooking } from "../../../modules/pms/portal/types";
import type { Practitioner, Service, Site } from "../../../modules/pms/core/types";
import { RepoInputError } from "../../repos/context";
import { listPractitioners, listServices, listSites, updatePractitioner, updateService } from "../../repos/pms/directory";
import { getPatient } from "../../repos/pms/patients";
import { listBookingSites, saveBookingSite } from "../../repos/pms/portal/sites";
import { getBookingSettings, updateBookingSettings } from "../../repos/pms/portal/settings";
import { listRecentOnlineBookings, markOnlineBookingReviewed, onlineBookingsForAppointments } from "../../repos/pms/portal/bookings";
import {
  countResponsesByTemplate,
  createIntakeTemplate,
  getIntakeResponse,
  getIntakeTemplate,
  listIntakeTemplates,
  listResponsesForPatient,
  markResponseReviewed,
  outcomeRequestQueries,
  requestIntakeForm,
  responseSealIntact,
  updateIntakeTemplate,
} from "../../repos/pms/portal/intake";
import { ensurePortalAccount, getPortalAccountForPatient, setPortalAccountStatus } from "../../repos/pms/portal/accounts";
import { getOutcome, listOutcomesForPatient } from "../../repos/pms/records/outcomes";
import { writeWithAudit } from "../../repos/pms/context";
import { listByIds } from "../../repos/pms/diary/appointments";
import type { ClinicActor } from "../actor";
import { commsLinkOrigin } from "../comms/links";
import { applyToRecord } from "./intake-service";
import { sendSignInLink } from "./portal-auth";
import { pmsNow } from "../../../modules/pms/core/clock";

export type StaffResult<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const FORBIDDEN = "You do not have permission to do that.";
const GONE = "This record no longer exists in this clinic.";
const CONFLICT = "Someone else changed this while you were editing. Reload the page and try again.";

function can(actor: ClinicActor, permission: PmsPermission): boolean {
  return actor.can(permission);
}

function plain(err: unknown): StaffResult<never> {
  if (err instanceof RepoInputError) return { ok: false, error: err.message };
  throw err;
}

/* ------------------------------------------------------------------------------------------------
 * Set-up → Online booking
 * ----------------------------------------------------------------------------------------------*/

export interface OnlineBookingSetup {
  settings: BookingSettings;
  sites: { site: Site; booking: BookingSite | null }[];
  services: Service[];
  practitioners: Practitioner[];
  bookingPath: string;
  portalPath: string;
}

export async function onlineBookingSetupFor(actor: ClinicActor): Promise<StaffResult<OnlineBookingSetup>> {
  if (!can(actor, "settings.setup")) return { ok: false, error: FORBIDDEN };
  const ctx = actor.repo();
  const [settings, sites, bookingSites, services, practitioners] = await Promise.all([
    getBookingSettings(ctx, actor.tenantId),
    listSites(ctx, actor.tenantId),
    listBookingSites(ctx, actor.tenantId),
    listServices(ctx, actor.tenantId),
    listPractitioners(ctx, actor.tenantId),
  ]);
  const paths = clinicPublicPaths(actor.tenantId);
  return {
    ok: true,
    value: {
      settings,
      sites: sites.map((site) => ({ site, booking: bookingSites.get(site.id) ?? null })),
      services: services.filter((s) => s.category !== "admin"),
      practitioners: practitioners.filter((p) => p.bookable),
      bookingPath: paths.book,
      portalPath: paths.portal,
    },
  };
}

export async function saveBookingSettingsFor(actor: ClinicActor, expectedRev: number, input: BookingSettingsInput): Promise<StaffResult<{ rev: number }>> {
  if (!can(actor, "settings.setup")) return { ok: false, error: FORBIDDEN };
  try {
    const r = await updateBookingSettings(actor.repo(), actor.tenantId, expectedRev, input, actor.actor);
    if (!r.ok) return { ok: false, error: r.reason === "conflict" ? CONFLICT : GONE };
    return { ok: true, value: { rev: r.rev }, message: "Online booking settings saved." };
  } catch (err) {
    return plain(err);
  }
}

export async function saveBookingSiteFor(actor: ClinicActor, expectedRev: number, input: BookingSiteInput): Promise<StaffResult<{ rev: number }>> {
  if (!can(actor, "settings.setup")) return { ok: false, error: FORBIDDEN };
  if (typeof input.siteId === "string" && actor.siteIds !== null && !actor.siteIds.has(input.siteId)) return { ok: false, error: GONE };
  try {
    const r = await saveBookingSite(actor.repo(), actor.tenantId, expectedRev, input, actor.actor);
    if (!r.ok) return { ok: false, error: r.reason === "conflict" ? CONFLICT : GONE };
    return { ok: true, value: { rev: r.rev }, message: "Site saved." };
  } catch (err) {
    return plain(err);
  }
}

/** Offers (or stops offering) an appointment type or a practitioner online – the directory's own switch. */
export async function setOnlineBookableFor(actor: ClinicActor, kind: "service" | "practitioner", id: string, on: boolean): Promise<StaffResult> {
  if (!can(actor, "settings.setup")) return { ok: false, error: FORBIDDEN };
  try {
    const ctx = actor.repo();
    const done = kind === "service" ? await updateService(ctx, actor.tenantId, id, { onlineBookable: on }, actor.actor) : await updatePractitioner(ctx, actor.tenantId, id, { onlineBookable: on }, actor.actor);
    if (!done) return { ok: false, error: GONE };
    return { ok: true, value: undefined, message: on ? "Offered online." : "No longer offered online." };
  } catch (err) {
    return plain(err);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Online bookings (reception)
 * ----------------------------------------------------------------------------------------------*/

export interface OnlineBookingRow {
  booking: OnlineBooking;
  startsAt: string;
  siteId: string;
  practitionerId: string | null;
  serviceId: string | null;
  status: string;
  patientId: string;
  patientName: string;
}

export async function recentOnlineBookingsFor(actor: ClinicActor, options: { unreviewedOnly?: boolean } = {}): Promise<StaffResult<OnlineBookingRow[]>> {
  if (!can(actor, "diary.view")) return { ok: false, error: FORBIDDEN };
  const ctx = actor.repo();
  const bookings = await listRecentOnlineBookings(ctx, actor.tenantId, { limit: 100, unreviewedOnly: options.unreviewedOnly });
  const items = new Map((await listByIds(ctx, actor.tenantId, bookings.map((b) => b.appointmentId))).map((i) => [i.id, i]));
  const rows: OnlineBookingRow[] = [];
  for (const b of bookings) {
    const item = items.get(b.appointmentId);
    if (!item) continue;
    if (actor.siteIds !== null && !actor.siteIds.has(item.siteId)) continue;
    const p = await getPatient(ctx, actor.tenantId, b.patientId);
    rows.push({ booking: b, startsAt: item.startsAt, siteId: item.siteId, practitionerId: item.practitionerId, serviceId: item.serviceId, status: item.status, patientId: b.patientId, patientName: p ? `${p.firstName} ${p.lastName}` : "Patient" });
  }
  return { ok: true, value: rows };
}

export async function reviewOnlineBookingFor(actor: ClinicActor, appointmentId: string): Promise<StaffResult> {
  if (!can(actor, "diary.book")) return { ok: false, error: FORBIDDEN };
  const ctx = actor.repo();
  const b = (await onlineBookingsForAppointments(ctx, actor.tenantId, [appointmentId])).get(appointmentId);
  const item = b ? (await listByIds(ctx, actor.tenantId, [appointmentId]))[0] : null;
  if (!b || !item || (actor.siteIds !== null && !actor.siteIds.has(item.siteId))) return { ok: false, error: GONE };
  const done = await markOnlineBookingReviewed(ctx, actor.tenantId, b.id, b.rev, actor.actor);
  return done ? { ok: true, value: undefined, message: "Marked as checked." } : { ok: false, error: CONFLICT };
}

/* ------------------------------------------------------------------------------------------------
 * Intake forms (builder)
 * ----------------------------------------------------------------------------------------------*/

export interface IntakeFormsView {
  templates: (IntakeTemplate & { requested: number; submitted: number })[];
}

export async function intakeFormsFor(actor: ClinicActor): Promise<StaffResult<IntakeFormsView>> {
  if (!can(actor, "settings.setup")) return { ok: false, error: FORBIDDEN };
  const ctx = actor.repo();
  const [templates, counts] = await Promise.all([listIntakeTemplates(ctx, actor.tenantId), countResponsesByTemplate(ctx, actor.tenantId)]);
  return { ok: true, value: { templates: templates.map((t) => ({ ...t, ...(counts.get(t.id) ?? { requested: 0, submitted: 0 }) })) } };
}

export async function intakeFormFor(actor: ClinicActor, id: string): Promise<StaffResult<IntakeTemplate>> {
  if (!can(actor, "settings.setup")) return { ok: false, error: FORBIDDEN };
  const t = await getIntakeTemplate(actor.repo(), actor.tenantId, id);
  return t ? { ok: true, value: t } : { ok: false, error: GONE };
}

export async function createIntakeFormFor(actor: ClinicActor, input: IntakeTemplateInput & { status?: "draft" | "active" }): Promise<StaffResult<{ id: string }>> {
  if (!can(actor, "settings.setup")) return { ok: false, error: FORBIDDEN };
  try {
    const t = await createIntakeTemplate(actor.repo(), actor.tenantId, input, actor.actor);
    return { ok: true, value: { id: t.id }, message: "Form created." };
  } catch (err) {
    return plain(err);
  }
}

/** A copy of one of the product's starter forms (written for the product – no third-party wording). */
export async function addStarterFormFor(actor: ClinicActor, key: string): Promise<StaffResult<{ id: string }>> {
  const starter = starterForm(key);
  if (!starter) return { ok: false, error: "Choose a starter form." };
  const { key: _key, ...template } = starter;
  void _key;
  return createIntakeFormFor(actor, { ...template, status: "draft" });
}

export async function saveIntakeFormFor(actor: ClinicActor, id: string, expectedRev: number, patch: IntakeTemplatePatch): Promise<StaffResult<{ rev: number }>> {
  if (!can(actor, "settings.setup")) return { ok: false, error: FORBIDDEN };
  try {
    const r = await updateIntakeTemplate(actor.repo(), actor.tenantId, id, expectedRev, patch, actor.actor);
    if (!r.ok) return { ok: false, error: r.reason === "conflict" ? CONFLICT : GONE };
    return { ok: true, value: { rev: r.rev }, message: patch.status === "active" ? "Form published." : "Form saved." };
  } catch (err) {
    return plain(err);
  }
}

/* ------------------------------------------------------------------------------------------------
 * A patient's forms (record → Forms tab)
 * ----------------------------------------------------------------------------------------------*/

export interface PatientFormsView {
  responses: IntakeResponseSummary[];
  templates: IntakeTemplate[];
  portal: { enabled: boolean; accountStatus: "active" | "disabled" | "none"; lastSignInAt: string | null };
  hasEmail: boolean;
  canSend: boolean;
  canSendOutcome: boolean;
  measures: { id: OutcomeMeasureId; label: string; problem: string | null }[];
}

/** The patient is checked by the caller (patientOr404 – clinic, sites). */
export async function patientFormsFor(actor: ClinicActor, patientId: string): Promise<StaffResult<PatientFormsView>> {
  if (!can(actor, "patients.view")) return { ok: false, error: FORBIDDEN };
  const ctx = actor.repo();
  const [responses, templates, account, settings, patient] = await Promise.all([
    listResponsesForPatient(ctx, actor.tenantId, patientId),
    listIntakeTemplates(ctx, actor.tenantId, { status: "active" }),
    getPortalAccountForPatient(ctx, actor.tenantId, patientId),
    getBookingSettings(ctx, actor.tenantId),
    getPatient(ctx, actor.tenantId, patientId),
  ]);
  const canSendOutcome = can(actor, "clinical.write");
  const psfs = canSendOutcome ? await psfsActivities(actor, patientId) : [];
  return {
    ok: true,
    value: {
      // Outcome questionnaires are clinical: reception sees that one was sent, never its answers or score.
      responses,
      templates,
      portal: { enabled: settings.portal, accountStatus: account ? account.status : "none", lastSignInAt: account?.lastSignInAt ?? null },
      hasEmail: Boolean(patient?.email),
      canSend: can(actor, "patients.edit"),
      canSendOutcome,
      measures: OUTCOME_MEASURES.map((m) => ({ id: m, label: `${MEASURES[m].short} – ${OUTCOME_FORM_TITLES[m]}`, problem: outcomeFormProblem(m, { psfsActivities: psfs }) })),
    },
  };
}

export interface ResponseView {
  response: IntakeResponse;
  /** Answers the viewer may see ("hidden" = health information without clinical.view). */
  answers: VisibleAnswer[];
  hiddenCount: number;
  canSeeHealth: boolean;
  sealIntact: boolean;
  /** Details that could be copied to the record (staff choose). */
  updates: { field: RecordField; label: string; value: string }[];
  canApply: boolean;
}

export async function patientResponseFor(actor: ClinicActor, patientId: string, responseId: string): Promise<StaffResult<ResponseView>> {
  if (!can(actor, "patients.view")) return { ok: false, error: FORBIDDEN };
  const r = await getIntakeResponse(actor.repo(), actor.tenantId, responseId);
  if (!r || r.patientId !== patientId) return { ok: false, error: GONE };
  const canSeeHealth = can(actor, "clinical.view");
  // An outcome questionnaire is clinical as a whole.
  if (r.kind === "outcome" && !canSeeHealth) return { ok: false, error: GONE };
  const answers = r.answers ? visibleAnswers(r.form, r.answers, canSeeHealth) : [];
  const updates = r.answers
    ? recordUpdates(r.form, r.answers)
        .filter((u) => canSeeHealth || !r.form.fields.find((f) => f.id === u.fieldId)?.sensitive)
        .map((u) => ({ field: u.field, label: u.label, value: Array.isArray(u.value) ? u.value.join(", ") : typeof u.value === "boolean" ? (u.value ? "Yes" : "No") : u.value }))
    : [];
  // Reception reads the signature and consent ticks, never the health answers (the decrypted text is dropped).
  const safe: IntakeResponse = canSeeHealth ? r : { ...r, answers: null };
  return {
    ok: true,
    value: {
      response: safe,
      answers,
      hiddenCount: answers.filter((a) => a.value === "hidden").length,
      canSeeHealth,
      sealIntact: responseSealIntact(r),
      updates,
      canApply: can(actor, "patients.edit") && r.status === "submitted" && !r.appliedAt,
    },
  };
}

/** The activities of the patient's latest PSFS (needed to send a PSFS to the portal). */
async function psfsActivities(actor: ClinicActor, patientId: string): Promise<{ key: string; name: string }[]> {
  if (!can(actor, "clinical.view")) return [];
  const ctx = actor.repo();
  const latest = (await listOutcomesForPatient(ctx, actor.tenantId, patientId)).filter((o) => o.measure === "psfs").pop();
  if (!latest) return [];
  const full = await getOutcome(ctx, actor.tenantId, latest.id);
  const acts = full?.answers?.activities ?? {};
  return Object.entries(acts)
    .filter(([, name]) => name.trim() !== "")
    .map(([key, name]) => ({ key, name }));
}

async function emailPortalLink(actor: ClinicActor, patientId: string, next: string): Promise<StaffResult> {
  const ctx = actor.repo();
  const settings = await getBookingSettings(ctx, actor.tenantId);
  if (!settings.portal) return { ok: false, error: "The patient portal is switched off. Switch it on in Set-up → Online booking first." };
  const patient = await getPatient(ctx, actor.tenantId, patientId);
  if (!patient) return { ok: false, error: GONE };
  if (!patient.email) return { ok: false, error: "The patient has no email address. Add one to their details first." };
  const account = await ensurePortalAccount(ctx, actor.tenantId, patientId, actor.actor);
  if (account.status !== "active") return { ok: false, error: "The patient's portal access is switched off." };
  const sent = await sendSignInLink(ctx, actor.tenantId, account.id, patientId, pmsNow(), PORTAL_TIMINGS.staffLinkHours * 3_600_000, commsLinkOrigin(), actor.actor, next);
  return sent ? { ok: true, value: undefined } : { ok: false, error: "The email could not be written. Check Messages → Outbox." };
}

/** Sends a form to the patient: an unanswered copy (reused if one is open) and an email with a portal link. */
export async function sendFormFor(actor: ClinicActor, patientId: string, templateId: string): Promise<StaffResult> {
  if (!can(actor, "patients.edit")) return { ok: false, error: FORBIDDEN };
  try {
    const { response } = await requestIntakeForm(actor.repo(), actor.tenantId, { templateId, patientId }, actor.actor);
    const mailed = await emailPortalLink(actor, patientId, clinicPublicPaths(actor.tenantId).portalForm(response.id));
    if (!mailed.ok) return { ok: false, error: `The form is ready in the portal, but: ${mailed.error}` };
    return { ok: true, value: undefined, message: "Form sent. The patient gets an email with a link to the portal." };
  } catch (err) {
    return plain(err);
  }
}

/** Sends an outcome questionnaire to the patient's portal (clinical.write). */
export async function sendOutcomeFor(actor: ClinicActor, patientId: string, measure: OutcomeMeasureId, caseId: string | null): Promise<StaffResult> {
  if (!can(actor, "clinical.write")) return { ok: false, error: FORBIDDEN };
  if (!(OUTCOME_MEASURES as readonly string[]).includes(measure)) return { ok: false, error: "Choose a measure." };
  const psfs = measure === "psfs" ? await psfsActivities(actor, patientId) : [];
  const problem = outcomeFormProblem(measure, { psfsActivities: psfs });
  if (problem) return { ok: false, error: problem };
  try {
    const ctx = actor.repo();
    const form = outcomeQuestionnaire(measure, { psfsActivities: psfs });
    const { id, queries } = outcomeRequestQueries(ctx, actor.tenantId, { patientId, caseId, measure, name: OUTCOME_FORM_TITLES[measure], form }, actor.actor);
    await writeWithAudit(ctx, queries, { foreignKey: "That patient or case does not exist in this clinic." });
    const mailed = await emailPortalLink(actor, patientId, clinicPublicPaths(actor.tenantId).portalForm(id));
    if (!mailed.ok) return { ok: false, error: `The questionnaire is ready in the portal, but: ${mailed.error}` };
    return { ok: true, value: undefined, message: `${MEASURES[measure].short} sent to the patient's portal.` };
  } catch (err) {
    return plain(err);
  }
}

export async function reviewResponseFor(actor: ClinicActor, patientId: string, responseId: string): Promise<StaffResult> {
  if (!can(actor, "patients.view")) return { ok: false, error: FORBIDDEN };
  const r = await getIntakeResponse(actor.repo(), actor.tenantId, responseId);
  if (!r || r.patientId !== patientId) return { ok: false, error: GONE };
  if (r.kind === "outcome" && !can(actor, "clinical.view")) return { ok: false, error: GONE };
  const done = await markResponseReviewed(actor.repo(), actor.tenantId, responseId, actor.actor);
  return done ? { ok: true, value: undefined, message: "Marked as checked." } : { ok: false, error: CONFLICT };
}

export async function applyResponseFor(actor: ClinicActor, patientId: string, responseId: string, fields: RecordField[]): Promise<StaffResult> {
  if (!can(actor, "patients.edit")) return { ok: false, error: FORBIDDEN };
  const view = await patientResponseFor(actor, patientId, responseId);
  if (!view.ok) return view;
  const allowed = new Set(view.value.updates.map((u) => u.field));
  const r = await applyToRecord(actor.repo(), actor.tenantId, responseId, fields.filter((f) => allowed.has(f)), actor.actor);
  return r.ok ? { ok: true, value: undefined, message: "Copied to the patient's record." } : { ok: false, error: r.error };
}

export async function setPortalAccessFor(actor: ClinicActor, patientId: string, on: boolean): Promise<StaffResult> {
  if (!can(actor, "patients.edit")) return { ok: false, error: FORBIDDEN };
  const ctx = actor.repo();
  const account = on ? await ensurePortalAccount(ctx, actor.tenantId, patientId, actor.actor) : await getPortalAccountForPatient(ctx, actor.tenantId, patientId);
  if (!account) return { ok: true, value: undefined };
  await setPortalAccountStatus(ctx, actor.tenantId, account.id, on ? "active" : "disabled", actor.actor);
  return { ok: true, value: undefined, message: on ? "Portal access switched on." : "Portal access switched off – the patient is signed out." };
}

/** The record Overview's Forms card: the latest five forms (outcome questionnaires only for clinical.view). */
export async function formsCardFor(actor: ClinicActor, patientId: string): Promise<{ id: string; name: string; status: "requested" | "submitted" | "cancelled"; detail: string; open: boolean }[]> {
  if (!can(actor, "patients.view")) return [];
  const clinical = can(actor, "clinical.view");
  const rows = (await listResponsesForPatient(actor.repo(), actor.tenantId, patientId)).filter((r) => r.status !== "cancelled" && (clinical || r.kind !== "outcome"));
  return rows.slice(0, 5).map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    detail: r.status === "submitted" ? (r.signedAt ? "Signed" : "Completed") : "Waiting",
    open: r.status === "submitted",
  }));
}
