/**
 * TESTS ONLY: the portal module's suite – repositories AND the booking, sign-in and form flows that run on them, with
 * the DIARY as the one appointment store (the diary's adapter for the portal's port) and COMMS as the one outbox –
 * on node:sqlite and PGlite (src/server/repos/pms/portal/portal-repos.test.ts) and on D1 through the gateway
 * (workers/data-gateway/test/pms-portal-stack.test.ts). Two clinics; nothing of clinic B is ever readable or
 * changeable from A; one clash rule for online and reception bookings; encrypted free text; sealed signed forms;
 * every write audited in its batch; the tenant-scope guard over every statement at the end.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../../db/schema";
import { testCipher } from "../../../../db/testing/databases";
import { listAudit } from "../../../audit";
import { RepoInputError, type RepoContext } from "../../../context";
import { createPractitioner, createService, createSite } from "../../directory";
import { setEntitlement } from "../../entitlements";
import { createPatient, getPatient } from "../../patients";
import { exportPmsData, deletePmsQueries, countPmsRows } from "../../../../pms/offboard";
import { runBatch } from "../../../../db/batch";
import { createAvailability } from "../../diary/availability";
import { bookAppointment, getDiaryItem } from "../../diary/appointments";
import { findFreeSlots } from "../../diary/slots";
import { getMessage, listMessages } from "../../comms/messages";
import { listOutcomesForPatient, recordOutcome } from "../../records/outcomes";
import { writeWithAudit } from "../../context";
import { getBookingSettings, updateBookingSettings } from "../settings";
import { listBookingSites, saveBookingSite } from "../sites";
import { findByManageToken, getOnlineBookingForAppointment, listRecentOnlineBookings, markOnlineBookingReviewed } from "../bookings";
import { ensurePortalAccount, revokePortalSession, setPortalAccountStatus } from "../accounts";
import { getPortalShare, listSharesForPatient, markShareViewed, recordShareDownload, shareAttachment, shareFilesForPatient, sharePortalDocument, withdrawShare } from "../shares";
import { endHandoff, findHandoffByToken, getHandoff, handoffForResponse, startHandoff, verifyHandoff } from "../handoffs";
import { putAttachment, withdrawAttachment } from "../../records/attachments";
import { deviceState, submitOnDevice } from "../../../../pms/portal/device-flow";
import { manageFormView, patientShare, portalHome } from "../../../../pms/portal/portal-views";
import { publicLimit } from "../../../../pms/portal/rate-limit";
import { recordVerifiedConsent } from "../../../../pms/portal/intake-service";
import { newSecret } from "../../../../pms/portal/tokens";
import { HIDDEN_LINK, hasSecretLink } from "../../../../../modules/pms/comms/secret-links";
import { clearTestOutbox, testOutbox } from "../../../../pms/comms/providers/test";
import {
  cancelIntakeResponse,
  countResponsesByTemplate,
  createIntakeTemplate,
  getIntakeResponse,
  getIntakeTemplate,
  listIntakeTemplates,
  listResponsesForAppointment,
  listResponsesForPatient,
  listResponsesToReview,
  markResponseReviewed,
  outcomeRequestQueries,
  requestIntakeForm,
  responseSealIntact,
  updateIntakeTemplate,
} from "../intake";
import { STARTER_FORMS } from "../../../../../modules/pms/portal/starters";
import { visibleAnswers } from "../../../../../modules/pms/portal/forms";
import { outcomeQuestionnaire } from "../../../../../modules/pms/portal/outcome-forms";
import { bookingCatalogue, findSlots } from "../../../../pms/portal/availability";
import { bookFromPortal, bookFromPublicPage, cancelByPatient, moveByPatient, patientAppointment, type FlowDeps } from "../../../../pms/portal/booking";
import { loadPublicClinic, type PublicClinic } from "../../../../pms/portal/public-clinic";
import { completeSignIn, readPortalSession, requestSignInLink, signOutPortal } from "../../../../pms/portal/portal-auth";
import { applyToRecord, submitForm } from "../../../../pms/portal/intake-service";
import { hashSecret } from "../../../../pms/portal/tokens";
import { unscopedStatements, type QueryLog } from "../../testing/guarded-db";

export interface PortalSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-a";
const B = "harbour-b";
const STAFF = { userId: "user_owner_a", sessionId: "sess_a" };
const STAFF_B = { userId: "user_owner_b", sessionId: "sess_b" };
const ORIGIN = "https://clinic.example";
const SECRET = "portal-suite-limit-secret-0123456789";
const PATIENT = { userId: null, sessionId: null };

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(promise, (err: unknown) => err instanceof RepoInputError && pattern.test(err.message));
}

/** The "manage" secret out of a manage path. */
const tokenOf = (path: string) => decodeURIComponent(path.split("/").pop() ?? "");
const hhmm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

export function definePortalSuite(label: string, factory: () => Promise<PortalSuiteDb>): void {
  describe(`clinic-system portal module on ${label}`, () => {
    let suite: PortalSuiteDb;
    let ctx: RepoContext;
    // Monday 2 November 2026, about 08:00 UK (GMT). The clock moves on a millisecond at every reading (as a real
    // one does between two requests – the conditional audit rows key on the write's time); it starts two minutes
    // early so the whole suite stays before 08:00.
    let clock = Date.parse("2026-11-02T07:58:00.000Z");
    const now = () => new Date(clock++);
    const ids: Record<string, string> = {};
    let clinicA: PublicClinic;
    const deps = (over: Partial<FlowDeps> = {}): FlowDeps => ({ ctx, now: now(), origin: ORIGIN, clientIp: "203.0.113.7", limitSecret: SECRET, ...over });
    /**
     * The secret of the newest portal sign-in email for a patient: from what the (test) email provider was handed –
     * the message log keeps the email with the link hidden (M10 C1), so nobody at the clinic can sign in with it.
     */
    const latestLinkToken = async (patientId: string, address: string): Promise<string> => {
      const message = (await listMessages(ctx, A, { patientId, kind: "portal_link", limit: 50 }))[0];
      const stored = message ? await getMessage(ctx, A, message.id) : null;
      assert.ok(stored, "a sign-in email in the message log");
      assert.ok(stored.body.includes(HIDDEN_LINK) && !hasSecretLink(stored.body) && !/[A-Za-z0-9_-]{43}/.test(stored.body), "the stored copy has no sign-in secret");
      const sent = testOutbox.email.filter((e) => e.to.toLowerCase() === address.toLowerCase() && e.messageId === stored.id).pop();
      const token = sent ? /\/portal\/link\/([A-Za-z0-9_-]{43})/.exec(sent.text)?.[1] : null;
      assert.ok(token, "the provider got the email with the link");
      assert.ok(sent && sent.html.includes(token as string), "and in the HTML");
      return token as string;
    };
    const ellie = { firstName: "Ellie", lastName: "Sample", dateOfBirth: "1990-04-02", email: "ellie.sample@example.com", phoneMobile: "07700 900205", reminders: true, paying: "self" };

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now };
      const at = new Date(clock).toISOString();
      for (const [slug, name] of [
        [A, "Riverside Physiotherapy (fictional)"],
        [B, "Harbour Clinic (fictional)"],
      ]) {
        await ctx.db.insertInto("organization").values({ id: `org_${slug}`, name, slug, logo: null, createdAt: at, metadata: null }).execute();
      }
      ids.site = (await createSite(ctx, A, { name: "Bletchley (fictional)", code: "BLE", phone: "01632 960101" }, STAFF)).id;
      ids.site2 = (await createSite(ctx, A, { name: "Wolverton (fictional)", code: "WOL" }, STAFF)).id;
      ids.james = (await createPractitioner(ctx, A, { displayName: "James Okafor", registrationNumber: "PH-DEMO-04", onlineBookable: true, sortOrder: 1 }, STAFF)).id;
      ids.priya = (await createPractitioner(ctx, A, { displayName: "Priya Shah", registrationNumber: "PH-DEMO-03", onlineBookable: true, sortOrder: 2 }, STAFF)).id;
      ids.offline = (await createPractitioner(ctx, A, { displayName: "Tom Ellis", registrationNumber: "PH-DEMO-02", sortOrder: 3 }, STAFF)).id;
      ids.ia = (await createService(ctx, A, { name: "Initial assessment", durationMinutes: 45, onlineBookable: true }, STAFF)).id;
      ids.fu = (await createService(ctx, A, { name: "Follow-up", durationMinutes: 30, onlineBookable: true }, STAFF)).id;
      ids.mla = (await createService(ctx, A, { name: "Medico-legal assessment", durationMinutes: 60 }, STAFF)).id;
      ids.megan = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-22", email: "megan.hart@example.com", phoneMobile: "07700 900123", importRef: "sim-pat-001" }, STAFF)).id;
      // Rota: Mondays 09:00–12:00 for James and Priya at Bletchley (online); Tom too but he is not offered online;
      // James also Mondays 13:00–17:00 NOT marked for online booking, and Tuesdays 09:00–12:00 online.
      const rota = { validFrom: "2026-10-01", siteId: ids.site, weekday: 1 };
      await createAvailability(ctx, A, { ...rota, practitionerId: ids.james, startTime: "09:00", endTime: "12:00", onlineBookable: true }, STAFF);
      await createAvailability(ctx, A, { ...rota, practitionerId: ids.james, startTime: "13:00", endTime: "17:00", onlineBookable: false }, STAFF);
      await createAvailability(ctx, A, { ...rota, practitionerId: ids.priya, startTime: "09:00", endTime: "12:00", onlineBookable: true }, STAFF);
      await createAvailability(ctx, A, { ...rota, practitionerId: ids.offline, startTime: "09:00", endTime: "12:00", onlineBookable: true }, STAFF);
      await createAvailability(ctx, A, { ...rota, weekday: 2, practitionerId: ids.james, startTime: "09:00", endTime: "12:00", onlineBookable: true }, STAFF);
      ids.siteB = (await createSite(ctx, B, { name: "Harbour (fictional)" }, STAFF_B)).id;
      ids.pracB = (await createPractitioner(ctx, B, { displayName: "Hal Bright", onlineBookable: true }, STAFF_B)).id;
      ids.svcB = (await createService(ctx, B, { name: "Follow-up", durationMinutes: 30, onlineBookable: true }, STAFF_B)).id;
      ids.patientB = (await createPatient(ctx, B, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-22", email: "megan.hart@example.com" }, STAFF_B)).id;
    });
    after(async () => {
      await suite?.close();
    });

    it("public clinic: nothing without the package and an open page; settings revision-checked and audited", async () => {
      assert.equal(await loadPublicClinic(ctx, "no-such-clinic"), null);
      assert.equal(await loadPublicClinic(ctx, "Bad Slug!"), null);
      assert.equal(await loadPublicClinic(ctx, A), null, "no clinic package yet (a reports-only clinic has no public page)");
      await setEntitlement(ctx, A, "clinic", { status: "active" }, STAFF);
      await setEntitlement(ctx, B, "clinic", { status: "active" }, STAFF_B);
      assert.equal(await loadPublicClinic(ctx, A), null, "package on, but online booking and the portal are off by default");
      const defaults = await getBookingSettings(ctx, A);
      assert.deepEqual([defaults.rev, defaults.onlineBooking, defaults.portal, defaults.minNoticeHours], [0, false, false, 24]);
      const saved = await updateBookingSettings(ctx, A, 0, { onlineBooking: true, portal: true, minNoticeHours: 2, maxDaysAhead: 14, cancelNoticeHours: 24, contactPhone: "01632 960101", cancellationPolicy: "Please give 24 hours' notice." }, STAFF);
      assert.deepEqual(saved.ok ? saved.rev : saved, 1);
      assert.deepEqual(await updateBookingSettings(ctx, A, 0, { portal: false }, STAFF), { ok: false, reason: "conflict", currentRev: 1 }, "a second first save is a conflict");
      assert.deepEqual(await updateBookingSettings(ctx, A, 5, { portal: false }, STAFF), { ok: false, reason: "conflict", currentRev: 1 });
      await rejects(updateBookingSettings(ctx, A, 1, { slotStepMinutes: 7 }, STAFF), /slotStepMinutes/);
      assert.equal((await getBookingSettings(ctx, B)).onlineBooking, false, "clinic B unaffected");
      const audits = (await listAudit(ctx, A, { limit: 50 })).filter((e) => e.action === "pms.booking_settings.update");
      assert.equal(audits.length, 1, "the refused saves wrote no audit row");
      const loaded = await loadPublicClinic(ctx, A);
      assert.ok(loaded);
      clinicA = loaded;
      assert.equal(clinicA.name, "Riverside Physiotherapy (fictional)");
      await updateBookingSettings(ctx, B, 0, { onlineBooking: true, portal: true, minNoticeHours: 0 }, STAFF_B);
    });

    it("sites: switched on or off per site, with a map position; revision-checked; never another clinic's site", async () => {
      assert.ok((await saveBookingSite(ctx, A, 0, { siteId: ids.site, online: true, latitude: 51.99712, longitude: -0.7422 }, STAFF)).ok);
      assert.ok((await saveBookingSite(ctx, A, 0, { siteId: ids.site2, online: false }, STAFF)).ok);
      assert.deepEqual(await saveBookingSite(ctx, A, 0, { siteId: ids.site, online: false }, STAFF), { ok: false, reason: "conflict", currentRev: 1 });
      assert.deepEqual(await saveBookingSite(ctx, A, 7, { siteId: ids.site, online: false }, STAFF), { ok: false, reason: "conflict", currentRev: 1 });
      await rejects(saveBookingSite(ctx, A, 1, { siteId: ids.site, online: true, latitude: 51.9 }, STAFF), /both latitude and longitude/);
      await rejects(saveBookingSite(ctx, B, 0, { siteId: ids.site, online: true }, STAFF_B), /does not exist in this clinic/);
      const sites = await listBookingSites(ctx, A);
      assert.deepEqual(sites.get(ids.site)?.latitude, 51.99712);
      assert.equal(sites.get(ids.site2)?.online, false);
      assert.equal((await listBookingSites(ctx, B)).size, 0);
    });

    it("slots come from the diary: rota hours marked online, online types and practitioners, notice and horizon", async () => {
      const cat = await bookingCatalogue(ctx, A, now());
      assert.deepEqual(cat.services.map((s) => s.name).sort(), ["Follow-up", "Initial assessment"], "the medico-legal type is not bookable online");
      assert.deepEqual(cat.sites.map((s) => s.id), [ids.site], "Wolverton is switched off");
      assert.deepEqual(cat.practitioners.map((p) => p.displayName), ["James Okafor", "Priya Shah"], "Tom is not offered online");
      assert.deepEqual(cat.positions.get(ids.site), { latitude: 51.99712, longitude: -0.7422 });
      const ia = await findSlots(ctx, A, clinicA.settings, cat, { siteId: ids.site, serviceId: ids.ia, practitionerId: ids.james, fromDate: "2026-11-02", days: 1, now: now() });
      // now = 08:00, notice 2 h → from 10:00; 45 minutes inside 09:00–12:00; never the afternoon (not online).
      assert.deepEqual(ia.slots.map((s) => hhmm(s.startsAt)), ["10:00", "10:15", "10:30", "10:45", "11:00", "11:15"]);
      // The SAME slots as the diary's own search (a time shown online is bookable by reception at that moment).
      const diary = await findFreeSlots(ctx, A, { fromDate: "2026-11-02", days: 1, siteId: ids.site, practitionerIds: [ids.james], serviceId: ids.ia, onlineOnly: true, notBefore: "2026-11-02T10:00:00.000Z", limit: 50 });
      assert.deepEqual(ia.slots.map((s) => s.startsAt), diary.map((s) => s.startsAt));
      const any = await findSlots(ctx, A, clinicA.settings, cat, { siteId: ids.site, serviceId: ids.fu, practitionerId: "any", fromDate: "2026-11-02", days: 1, now: now() });
      assert.equal(new Set(any.slots.map((s) => s.startsAt)).size, any.slots.length, "anyone available: one per time");
      assert.ok(any.slots.every((s) => s.practitionerId === ids.james), "the clinic's order decides who");
      const none = await findSlots(ctx, A, clinicA.settings, cat, { siteId: ids.site, serviceId: ids.mla, practitionerId: "any", fromDate: "2026-11-02", days: 1, now: now() });
      assert.equal(none.slots.length, 0);
      const offline = await findSlots(ctx, A, clinicA.settings, cat, { siteId: ids.site, serviceId: ids.fu, practitionerId: ids.offline, fromDate: "2026-11-02", days: 1, now: now() });
      assert.equal(offline.slots.length, 0, "a practitioner not bookable online");
      const tooFar = await findSlots(ctx, A, clinicA.settings, cat, { siteId: ids.site, serviceId: ids.fu, practitionerId: "any", fromDate: "2026-11-23", days: 1, now: now() });
      assert.equal(tooFar.slots.length, 0, "beyond the 14-day horizon");
    });

    it("forms the clinic sends with a booking: starter forms as templates, versions, one open copy per form", async () => {
      for (const s of STARTER_FORMS) {
        const t = await createIntakeTemplate(ctx, A, { name: s.name, kind: s.kind, description: s.description, sendWhen: s.sendWhen, requiresSignature: s.requiresSignature, signatureStatement: s.signatureStatement, setsTreatmentConsent: s.setsTreatmentConsent, definition: s.definition }, STAFF);
        ids[`form_${s.key}`] = t.id;
      }
      await rejects(createIntakeTemplate(ctx, A, { name: "New patient details", kind: "intake", definition: STARTER_FORMS[0].definition }, STAFF), /already has a form with this name/);
      await rejects(createIntakeTemplate(ctx, A, { name: "Bad", kind: "intake", definition: { fields: [{ id: "x", type: "choice", label: "Pick", options: ["One"] }] } }, STAFF), /2–20 choices/);
      const consent = (await getIntakeTemplate(ctx, A, ids.form_consent))!;
      const r = await updateIntakeTemplate(ctx, A, consent.id, consent.rev, { description: "Signed by typing a name." }, STAFF);
      assert.ok(r.ok);
      assert.equal((await getIntakeTemplate(ctx, A, consent.id))?.version, 1, "a description change keeps the version");
      const draft = await createIntakeTemplate(ctx, A, { name: "Running questionnaire", kind: "questionnaire", definition: { fields: [{ id: "km", type: "text", label: "Kilometres a week" }] }, status: "draft" }, STAFF);
      const v = await updateIntakeTemplate(ctx, A, draft.id, 1, { definition: { fields: [{ id: "km", type: "text", label: "Kilometres a week (roughly)" }] }, status: "active", sendWhen: "manual" }, STAFF);
      assert.ok(v.ok);
      assert.equal((await getIntakeTemplate(ctx, A, draft.id))?.version, 2, "new wording = new version");
      ids.form_running = draft.id;
      assert.deepEqual(await updateIntakeTemplate(ctx, A, draft.id, 1, { name: "Stale" }, STAFF), { ok: false, reason: "conflict", currentRev: 2 });
      assert.deepEqual(await updateIntakeTemplate(ctx, B, draft.id, 2, { name: "Other clinic" }, STAFF_B), { ok: false, reason: "not_found" });
      assert.equal((await listIntakeTemplates(ctx, A, { status: "active" })).length, 4);
      assert.equal((await listIntakeTemplates(ctx, B)).length, 0);
    });

    it("public booking, new patient: a DIARY appointment (source online), the record, forms and confirmation – no secret stored", async () => {
      const cat = await bookingCatalogue(ctx, A, now());
      const slot = (await findSlots(ctx, A, clinicA.settings, cat, { siteId: ids.site, serviceId: ids.ia, practitionerId: ids.james, fromDate: "2026-11-02", days: 1, now: now() })).slots.find((s) => hhmm(s.startsAt) === "10:30")!;
      const r = await bookFromPublicPage(clinicA, { siteId: ids.site, serviceId: ids.ia, practitionerId: ids.james, startsAt: slot.startsAt, ...ellie }, deps());
      assert.ok(r.ok, JSON.stringify(r));
      if (!r.ok) return;
      ids.ellieAppt = r.visit.appointmentId;
      ids.ellieManage = tokenOf(r.managePath);
      const appt = await getDiaryItem(ctx, A, r.visit.appointmentId);
      assert.ok(appt);
      assert.deepEqual([appt.kind, appt.source, appt.status, appt.practitionerId, appt.serviceId, appt.startsAt], ["appointment", "online", "booked", ids.james, ids.ia, slot.startsAt]);
      ids.ellie = appt.patientId as string;
      const patient = await getPatient(ctx, A, ids.ellie);
      assert.deepEqual([patient?.firstName, patient?.email, patient?.reminderSms], ["Ellie", "ellie.sample@example.com", true]);
      const record = await getOnlineBookingForAppointment(ctx, A, r.visit.appointmentId);
      assert.deepEqual([record?.channel, record?.patientMatch, record?.reference], ["booking_page", "new", r.visit.reference]);
      const raw = await ctx.db.selectFrom("pms_online_bookings").selectAll().where("tenant_id", "=", A).where("appointment_id", "=", r.visit.appointmentId).executeTakeFirstOrThrow();
      assert.equal(raw.manage_token_hash, hashSecret(ids.ellieManage), "only the hash of the manage link");
      assert.ok(!JSON.stringify(raw).includes(ids.ellieManage));
      assert.equal(r.visit.formIds.length, 3, "the three new-patient forms, sent with the booking");
      assert.deepEqual((await listResponsesForAppointment(ctx, A, r.visit.appointmentId)).map((x) => x.status), ["requested", "requested", "requested"]);
      // The confirmation: planned by the diary hook, written to the outbox by the message run (comms).
      const messages = await listMessages(ctx, A, { patientId: ids.ellie, limit: 20 });
      assert.ok(
        messages.some((m) => m.kind === "confirmation" && m.appointmentId === r.visit.appointmentId && m.status === "outbox"),
        JSON.stringify(messages.map((m) => [m.kind, m.status])),
      );
      assert.equal((await findByManageToken(ctx, A, hashSecret(ids.ellieManage)))?.appointmentId, r.visit.appointmentId);
      assert.equal(await findByManageToken(ctx, B, hashSecret(ids.ellieManage)), null, "another clinic");
      assert.equal(await findByManageToken(ctx, A, hashSecret("x".repeat(43))), null);
    });

    it("one clash rule: reception cannot book over an online booking, and the patient cannot take reception's time", async () => {
      const taken = await getDiaryItem(ctx, A, ids.ellieAppt);
      const reception = await bookAppointment(ctx, A, { patientId: ids.megan, serviceId: ids.fu, practitionerId: ids.james, siteId: ids.site, date: "2026-11-02", startTime: hhmm(taken!.startsAt) }, STAFF);
      assert.equal(reception.ok, false, "reception refused for the same slot");
      // Reception books 11:15 with Priya; the online page no longer offers it, and a stale page is refused.
      const r2 = await bookAppointment(ctx, A, { patientId: ids.megan, serviceId: ids.fu, practitionerId: ids.priya, siteId: ids.site, date: "2026-11-02", startTime: "11:15" }, STAFF);
      assert.ok(r2.ok);
      const cat = await bookingCatalogue(ctx, A, now());
      const priya = await findSlots(ctx, A, clinicA.settings, cat, { siteId: ids.site, serviceId: ids.fu, practitionerId: ids.priya, fromDate: "2026-11-02", days: 1, now: now() });
      assert.ok(!priya.slots.some((s) => hhmm(s.startsAt) === "11:15"));
      const stale = await bookFromPublicPage(clinicA, { siteId: ids.site, serviceId: ids.fu, practitionerId: ids.priya, startsAt: "2026-11-02T11:15:00.000Z", ...ellie, email: "sam.sample@example.com", firstName: "Sam" }, deps());
      assert.deepEqual(stale.ok ? stale : { ok: stale.ok, slotGone: stale.slotGone }, { ok: false, slotGone: true });
      // Even past the slot check (two people at once), the diary's own rule refuses the second booking.
      const forced = await bookAppointment(ctx, A, { patientId: ids.megan, serviceId: ids.fu, practitionerId: ids.priya, siteId: ids.site, date: "2026-11-02", startTime: "11:15", source: "online" }, PATIENT);
      assert.equal(forced.ok, false);
    });

    it("public booking, existing patient: matched on email, date of birth and last name – the answer looks the same", async () => {
      const cat = await bookingCatalogue(ctx, A, now());
      const slots = (await findSlots(ctx, A, clinicA.settings, cat, { siteId: ids.site, serviceId: ids.fu, practitionerId: ids.priya, fromDate: "2026-11-02", days: 1, now: now() })).slots;
      const existing = await bookFromPublicPage(clinicA, { siteId: ids.site, serviceId: ids.fu, practitionerId: ids.priya, startsAt: slots[0].startsAt, firstName: "Meg", lastName: "HART", dateOfBirth: "1991-11-22", email: "Megan.Hart@example.com", phoneMobile: "07700 900999" }, deps());
      assert.ok(existing.ok, JSON.stringify(existing));
      const typo = await bookFromPublicPage(clinicA, { siteId: ids.site, serviceId: ids.fu, practitionerId: ids.priya, startsAt: slots[2].startsAt, firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-23", email: "megan.hart@example.com", phoneMobile: "07700 900123" }, deps());
      assert.ok(typo.ok, JSON.stringify(typo));
      if (!existing.ok || !typo.ok) return;
      assert.deepEqual(Object.keys(existing).sort(), Object.keys(typo).sort(), "the same shape whether or not a record matched");
      assert.deepEqual(Object.keys(existing.visit).sort(), Object.keys(typo.visit).sort());
      const a1 = await getDiaryItem(ctx, A, existing.visit.appointmentId);
      const a2 = await getDiaryItem(ctx, A, typo.visit.appointmentId);
      assert.equal(a1?.patientId, ids.megan, "matched to Megan's record");
      assert.notEqual(a2?.patientId, ids.megan, "a different date of birth makes a new record (staff merge it)");
      assert.equal((await getPatient(ctx, A, ids.megan))?.phoneMobile, "07700 900123", "a match never changes the record");
      // M10 M4: the same forms whether or not the details matched a record – the answer never tells who is a patient.
      assert.equal(existing.visit.formIds.length, typo.visit.formIds.length, "the same forms for a matched and a new record");
      assert.equal(existing.visit.formIds.length, 3);
      assert.equal((await getOnlineBookingForAppointment(ctx, A, existing.visit.appointmentId))?.patientMatch, "existing");
    });

    it("limits: three online bookings a day per email address, whoever's address it is; the honeypot", async () => {
      const cat = await bookingCatalogue(ctx, A, now());
      const slots = (await findSlots(ctx, A, clinicA.settings, cat, { siteId: ids.site, serviceId: ids.fu, practitionerId: "any", fromDate: "2026-11-03", days: 1, now: now() })).slots;
      // megan.hart@… has booked twice; a third is accepted (tomorrow), the fourth refused.
      const third = await bookFromPublicPage(clinicA, { siteId: ids.site, serviceId: ids.fu, practitionerId: "any", startsAt: slots[0].startsAt, firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-23", email: "megan.hart@example.com", phoneMobile: "07700 900123" }, deps());
      assert.ok(third.ok, JSON.stringify(third));
      if (third.ok) ids.typoAppt = third.visit.appointmentId;
      const fourth = await bookFromPublicPage(clinicA, { siteId: ids.site, serviceId: ids.fu, practitionerId: "any", startsAt: slots[4].startsAt, firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-22", email: "megan.hart@example.com", phoneMobile: "07700 900123" }, deps());
      assert.ok(!fourth.ok && /Too many attempts/.test(fourth.error));
      const honeypot = await bookFromPublicPage(clinicA, { siteId: ids.site, serviceId: ids.fu, practitionerId: "any", startsAt: slots[4].startsAt, ...ellie, website: "spam" }, deps());
      assert.ok(!honeypot.ok);
    });

    it("cancel and move: free outside the notice period, LATE (fee flagged) inside it; a move inside it is refused", async () => {
      // Ellie's 10:30 today is 2.5 hours away (notice 24 h): cancelling is late, moving is refused.
      const appt = (await patientAppointment(ctx, A, ids.ellie, ids.ellieAppt))!;
      assert.equal(await patientAppointment(ctx, A, ids.megan, ids.ellieAppt), null, "never another patient's appointment");
      const move = await moveByPatient(clinicA, ids.ellie, appt.id, appt.rev, { practitionerId: ids.james, startsAt: "2026-11-03T09:00:00.000Z" }, deps());
      assert.ok(!move.ok && /too close/.test(move.error), JSON.stringify(move));
      const late = await cancelByPatient(clinicA, ids.ellie, appt.id, appt.rev, deps());
      assert.ok(late.ok && late.late, JSON.stringify(late));
      const item = await getDiaryItem(ctx, A, appt.id);
      assert.deepEqual([item?.status, item?.feeDue, item?.cancelReason], ["late_cancelled", true, "patient"]);
      assert.ok((await listMessages(ctx, A, { patientId: ids.ellie, limit: 20 })).some((m) => m.kind === "late_cancelled"), "the late-cancellation notice went to the outbox");
      const again = await cancelByPatient(clinicA, ids.ellie, appt.id, appt.rev + 1, deps());
      assert.ok(!again.ok, "already cancelled");
      // The typo record's booking tomorrow: moved to another free time (outside the notice period), then cancelled.
      const cat = await bookingCatalogue(ctx, A, now());
      const typoAppt = (await getDiaryItem(ctx, A, ids.typoAppt))!;
      const free = (await findSlots(ctx, A, clinicA.settings, cat, { siteId: ids.site, serviceId: ids.fu, practitionerId: ids.james, fromDate: "2026-11-03", days: 1, now: now() })).slots;
      const target = free[free.length - 1];
      const moved = await moveByPatient(clinicA, typoAppt.patientId as string, typoAppt.id, typoAppt.rev, { practitionerId: ids.james, startsAt: target.startsAt }, deps());
      assert.ok(moved.ok, JSON.stringify(moved));
      const after = await getDiaryItem(ctx, A, typoAppt.id);
      assert.deepEqual([after?.startsAt, after?.practitionerId, after?.status], [target.startsAt, ids.james, "booked"], "the same appointment, moved");
      const stale = await moveByPatient(clinicA, typoAppt.patientId as string, typoAppt.id, typoAppt.rev, { practitionerId: ids.james, startsAt: free[0].startsAt }, deps());
      assert.ok(!stale.ok, "a stale page is refused");
      const early = await cancelByPatient(clinicA, typoAppt.patientId as string, typoAppt.id, after!.rev, deps());
      assert.ok(early.ok && !early.late);
      assert.equal((await getDiaryItem(ctx, A, typoAppt.id))?.status, "cancelled");
    });

    it("portal sign-in: same answer for everyone; a one-time link through comms to the address on the record; sessions expire", async () => {
      const provider = process.env.CLINIC_EMAIL_PROVIDER;
      process.env.CLINIC_EMAIL_PROVIDER = "test";
      clearTestOutbox();
      try {
        const unknown = await requestSignInLink(clinicA, { email: "nobody@example.com" }, deps());
      const known = await requestSignInLink(clinicA, { email: "MEGAN.HART@example.com" }, deps());
      assert.deepEqual(unknown, { ok: true });
      assert.deepEqual(known, unknown, "no patient-existence leak");
      const token = await latestLinkToken(ids.megan, "megan.hart@example.com");
      assert.equal((await listMessages(ctx, A, { kind: "portal_link", limit: 50 })).length, 2, "Megan's record and the typo record share the address – one link each, none for the unknown address");
      const raw = await ctx.db.selectFrom("pms_portal_links").select("token_hash").where("tenant_id", "=", A).execute();
      assert.ok(raw.every((l) => l.token_hash !== token) && raw.some((l) => l.token_hash === hashSecret(token)), "only the hash is stored");
      assert.deepEqual(await completeSignIn(clinicA, "x".repeat(43), deps()), { ok: false, error: "This sign-in link has expired or has already been used. Ask for a new one below." });
      const signedIn = await completeSignIn(clinicA, token, deps());
      assert.ok(signedIn.ok);
      if (!signedIn.ok) return;
      assert.equal((await completeSignIn(clinicA, token, deps())).ok, false, "a link works once");
      const viewer = await readPortalSession(ctx, A, signedIn.cookieValue, now());
      assert.equal(viewer?.patientId, ids.megan);
      assert.equal(await readPortalSession(ctx, B, signedIn.cookieValue, now()), null, "never in another clinic");
      assert.equal(await readPortalSession(ctx, A, signedIn.cookieValue.slice(0, -2) + "AA", now()), null, "a forged secret");
      assert.equal(await readPortalSession(ctx, A, signedIn.cookieValue, new Date(clock + 31 * 60_000)), null, "idle for 30 minutes");
      // Rate limit per email (5 an hour): the answer becomes "too many" for that address only.
      for (let i = 0; i < 4; i++) await requestSignInLink(clinicA, { email: "megan.hart@example.com" }, deps());
      const limited = await requestSignInLink(clinicA, { email: "megan.hart@example.com" }, deps());
      assert.ok(!limited.ok && /Too many attempts/.test(limited.error), JSON.stringify(limited));
      assert.ok((await requestSignInLink(clinicA, { email: "nobody@example.com" }, deps())).ok, "another address is not limited");
      // Signing out ends the session; switching the account off signs the patient out everywhere.
      await signOutPortal(ctx, A, signedIn.cookieValue);
      assert.equal(await readPortalSession(ctx, A, signedIn.cookieValue, now()), null, "signed out");
      await requestSignInLink(clinicA, { email: "nobody@example.com" }, deps({ clientIp: "203.0.113.8" }));
      const account = await ensurePortalAccount(ctx, A, ids.megan, STAFF);
      assert.equal(await setPortalAccountStatus(ctx, A, account.id, "disabled", STAFF), true);
      assert.equal(await setPortalAccountStatus(ctx, A, account.id, "disabled", STAFF), false);
      assert.equal(await setPortalAccountStatus(ctx, A, account.id, "active", STAFF), true);
      } finally {
        if (provider === undefined) delete process.env.CLINIC_EMAIL_PROVIDER;
        else process.env.CLINIC_EMAIL_PROVIDER = provider;
      }
    });

    it("portal booking: the signed-in patient's own record; staff check the online bookings", async () => {
      const cat = await bookingCatalogue(ctx, A, now());
      const slots = (await findSlots(ctx, A, clinicA.settings, cat, { siteId: ids.site, serviceId: ids.fu, practitionerId: "any", fromDate: "2026-11-09", days: 1, now: now() })).slots;
      const r = await bookFromPortal(clinicA, ids.megan, "psn_01JZZZZZZZZZZZZZZZZZZZZZZZ", { siteId: ids.site, serviceId: ids.fu, practitionerId: "any", startsAt: slots[0].startsAt }, deps());
      assert.ok(r.ok, JSON.stringify(r));
      if (!r.ok) return;
      const item = await getDiaryItem(ctx, A, r.visit.appointmentId);
      assert.deepEqual([item?.patientId, item?.source], [ids.megan, "online"]);
      assert.equal((await getOnlineBookingForAppointment(ctx, A, r.visit.appointmentId))?.channel, "portal");
      const list = await listRecentOnlineBookings(ctx, A, { unreviewedOnly: true });
      assert.ok(list.length >= 4);
      const rec = list.find((b) => b.appointmentId === r.visit.appointmentId)!;
      assert.equal(await markOnlineBookingReviewed(ctx, B, rec.id, rec.rev, STAFF_B), false, "another clinic");
      assert.equal(await markOnlineBookingReviewed(ctx, A, rec.id, rec.rev, STAFF), true);
      assert.equal(await markOnlineBookingReviewed(ctx, A, rec.id, rec.rev, STAFF), false);
    });

    it("forms: answers checked, typed signature, sealed; verified consent recorded; health answers hidden from reception", async () => {
      const copies = await listResponsesForPatient(ctx, A, ids.ellie, { status: "requested" });
      assert.equal(copies.length, 3);
      const consentCopy = copies.find((c) => c.kind === "consent")!;
      const detailsCopy = copies.find((c) => c.kind === "intake")!;
      const healthCopy = copies.find((c) => c.kind === "questionnaire")!;
      const bad = await submitForm(ctx, A, consentCopy.id, 1, { answers: { consent_treatment: "on" }, signatureName: "E", trust: "unverified" }, PATIENT);
      assert.ok(!bad.ok && bad.reason === "invalid");
      const signed = await submitForm(ctx, A, consentCopy.id, 1, { answers: { consent_treatment: "on", consent_records: "on", share_gp: "yes", cancellations: "on" }, signatureName: "  Ellie   Sample ", trust: "unverified" }, PATIENT);
      assert.ok(signed.ok, JSON.stringify(signed));
      if (!signed.ok) return;
      assert.equal(signed.response.signatureName, "Ellie Sample");
      assert.equal(responseSealIntact(signed.response), true);
      assert.equal((await getPatient(ctx, A, ids.ellie))?.consentTreatment, false, "unverified: staff check first");
      assert.deepEqual(await submitForm(ctx, A, consentCopy.id, 2, { answers: {}, trust: "unverified" }, PATIENT), { ok: false, reason: "closed" });
      const raw = await ctx.db.selectFrom("pms_intake_responses").selectAll().where("tenant_id", "=", A).where("id", "=", consentCopy.id).executeTakeFirstOrThrow();
      assert.ok(!String(raw.answers_enc).includes("yes") && !String(raw.signature_name_enc).includes("Ellie"), "answers and signature encrypted");
      await assert.rejects(ctx.db.updateTable("pms_intake_responses").set({ answers_enc: raw.signature_name_enc }).where("tenant_id", "=", A).where("id", "=", consentCopy.id).execute(), /pms_intake_responses_sealed/);
      assert.equal(await cancelIntakeResponse(ctx, A, consentCopy.id, STAFF), false, "a completed form cannot be withdrawn");
      assert.deepEqual(await applyToRecord(ctx, A, consentCopy.id, ["consentTreatment", "consentShareGp"], STAFF), { ok: true, fields: ["consentTreatment", "consentShareGp"] });
      const details = await submitForm(
        ctx,
        A,
        detailsCopy.id,
        1,
        { answers: { mobile: "07700 900210", address: "1 Sample Street (fictional)\nBletchley", postcode: "mk3 9zz", gp_practice: "Bletchley Medical Centre (fictional)", emergency_name: "Sam Sample" }, trust: "unverified" },
        PATIENT,
      );
      assert.ok(details.ok, JSON.stringify(details));
      assert.deepEqual(await applyToRecord(ctx, A, detailsCopy.id, ["address", "postcode", "gpPractice"], STAFF), { ok: true, fields: ["address", "postcode", "gpPractice"] });
      const verifiedCopy = await requestIntakeForm(ctx, A, { templateId: ids.form_consent, patientId: ids.megan }, STAFF);
      assert.equal((await requestIntakeForm(ctx, A, { templateId: ids.form_consent, patientId: ids.megan }, STAFF)).created, false, "one open copy per form");
      const verified = await submitForm(ctx, A, verifiedCopy.response.id, 1, { answers: { consent_treatment: "on", consent_records: "on", share_gp: "no", cancellations: "on" }, signatureName: "Megan Hart", trust: "verified" }, { userId: null, sessionId: "psn_test" });
      assert.ok(verified.ok && verified.consentRecorded === true);
      const health = await submitForm(ctx, A, healthCopy.id, 1, { answers: { problem: "Sore knee after running", started: "2 to 6 weeks ago" }, trust: "unverified" }, PATIENT);
      assert.ok(health.ok, JSON.stringify(health));
      if (!health.ok) return;
      // Reception (no clinical access) never sees health answers; clinicians do.
      const reception = visibleAnswers(health.response.form, health.response.answers!, false);
      assert.ok(reception.some((a) => a.value === "hidden") && !JSON.stringify(reception).includes("Sore knee"));
      assert.ok(JSON.stringify(visibleAnswers(health.response.form, health.response.answers!, true)).includes("Sore knee"));
      assert.equal(await markResponseReviewed(ctx, A, healthCopy.id, STAFF), true);
      assert.equal(await markResponseReviewed(ctx, A, healthCopy.id, STAFF), false);
      assert.ok((await listResponsesToReview(ctx, A)).every((r) => r.id !== healthCopy.id));
      assert.equal(await getIntakeResponse(ctx, B, healthCopy.id), null, "another clinic cannot read it");
      await rejects(requestIntakeForm(ctx, B, { templateId: ids.form_consent, patientId: ids.patientB }, STAFF_B), /does not exist in this clinic/);
      const running = await requestIntakeForm(ctx, A, { templateId: ids.form_running, patientId: ids.megan }, STAFF);
      assert.equal(await cancelIntakeResponse(ctx, A, running.response.id, STAFF), true);
      assert.ok((await countResponsesByTemplate(ctx, A)).get(ids.form_consent)!.submitted >= 2);
      // A ciphertext moved to another copy no longer decrypts (AAD = clinic, table.column, row id).
      const open = await requestIntakeForm(ctx, A, { templateId: ids.form_running, patientId: ids.ellie }, STAFF);
      await ctx.db.updateTable("pms_intake_responses").set({ answers_enc: raw.answers_enc }).where("tenant_id", "=", A).where("id", "=", open.response.id).execute();
      await assert.rejects(getIntakeResponse(ctx, A, open.response.id), /Decryption failed/);
      await ctx.db.updateTable("pms_intake_responses").set({ answers_enc: null }).where("tenant_id", "=", A).where("id", "=", open.response.id).execute();
    });

    it("outcome questionnaires: answered in the portal, scored by records, the score in the record's outcomes", async () => {
      const form = outcomeQuestionnaire("odi");
      const { id, queries } = outcomeRequestQueries(ctx, A, { patientId: ids.megan, caseId: null, measure: "odi", name: "Back pain questionnaire", form }, STAFF);
      await writeWithAudit(ctx, queries);
      const answers: Record<string, string> = {};
      form.fields.forEach((f, i) => {
        if (f.required) answers[f.id] = f.options![i % 3];
      });
      const r = await submitForm(ctx, A, id, 1, { answers, trust: "verified" }, { userId: null, sessionId: "psn_test" });
      assert.ok(r.ok && r.outcomeId, JSON.stringify(r));
      const odi = (await listOutcomesForPatient(ctx, A, ids.megan)).find((o) => o.id === (r.ok ? r.outcomeId : ""))!;
      // Nine sections answered 0,1,2,0,1,2,0,(sex life skipped),2,0 → 8 / 45 = 17.8 %.
      assert.deepEqual([odi.measure, odi.answered, odi.scoreTenths, odi.band], ["odi", 9, 178, "Minimal"]);
      assert.equal((await getIntakeResponse(ctx, A, id))?.outcomeId, odi.id);
      // PSFS: the patient's own activities from the first visit.
      await recordOutcome(ctx, A, { patientId: ids.megan, measure: "psfs", takenOn: "2026-10-20", answers: { items: { a1: 3, a2: 4, a3: 5 }, activities: { a1: "Sitting through a meeting", a2: "Lifting my daughter", a3: "Running 5 km" } } }, STAFF);
      const psfs = outcomeQuestionnaire("psfs", { psfsActivities: [{ key: "a1", name: "Sitting through a meeting" }, { key: "a2", name: "Lifting my daughter" }, { key: "a3", name: "Running 5 km" }] });
      const q = outcomeRequestQueries(ctx, A, { patientId: ids.megan, caseId: null, measure: "psfs", name: "Everyday activities", form: psfs }, STAFF);
      await writeWithAudit(ctx, q.queries);
      const p = await submitForm(ctx, A, q.id, 1, { answers: { a1: psfs.fields[0].options![6], a2: psfs.fields[1].options![7], a3: psfs.fields[2].options![5] }, trust: "verified" }, { userId: null, sessionId: "psn_test" });
      assert.ok(p.ok && p.outcomeId, JSON.stringify(p));
      assert.equal((await listOutcomesForPatient(ctx, A, ids.megan)).find((o) => o.id === (p.ok ? p.outcomeId : ""))?.scoreTenths, 60);
    });

    it("documents shared with the patient: only what staff share, encrypted, withdrawable", async () => {
      const share = await sharePortalDocument(ctx, A, { patientId: ids.megan, title: "Home exercises", body: "Chin tucks, 10 repetitions, three times a day." }, STAFF);
      const raw = await ctx.db.selectFrom("pms_portal_shares").select("body_enc").where("tenant_id", "=", A).where("id", "=", share.id).executeTakeFirstOrThrow();
      assert.ok(!raw.body_enc.includes("Chin"));
      assert.equal((await getPortalShare(ctx, A, share.id))?.body, "Chin tucks, 10 repetitions, three times a day.");
      assert.equal(await getPortalShare(ctx, B, share.id), null);
      await rejects(sharePortalDocument(ctx, B, { patientId: ids.megan, title: "Cross", body: "x" }, STAFF_B), /does not exist in this clinic/);
      assert.equal(await markShareViewed(ctx, A, share.id, { userId: null, sessionId: "psn_test" }), true);
      assert.equal(await markShareViewed(ctx, A, share.id, { userId: null, sessionId: "psn_test" }), false);
      assert.equal(await withdrawShare(ctx, A, share.id, STAFF), true);
      assert.equal(await withdrawShare(ctx, A, share.id, STAFF), false);
      assert.equal((await listSharesForPatient(ctx, A, ids.megan)).length, 0);
      assert.equal((await listSharesForPatient(ctx, A, ids.megan, { includeWithdrawn: true })).length, 1);
      ids.textShare = share.id;
    });

    it("write ids: two identical writes in the SAME millisecond audit once (shares, sessions, form copies)", async () => {
      // A frozen clock: both writes carry the same time – only the write id tells them apart.
      const frozen: RepoContext = { ...ctx, now: () => new Date(Date.parse("2026-11-02T07:59:30.000Z")) };
      ids.sam = (await createPatient(ctx, A, { firstName: "Sam", lastName: "Fixture", dateOfBirth: "1985-03-04", email: "sam.fixture@example.com" }, STAFF)).id;
      const share = await sharePortalDocument(ctx, A, { patientId: ids.sam, title: "Stretches", body: "Hamstring stretch, hold 30 seconds." }, STAFF);
      const viewer = { userId: null, sessionId: "psn_frozen" };
      assert.deepEqual([await markShareViewed(frozen, A, share.id, viewer), await markShareViewed(frozen, A, share.id, viewer)], [true, false]);
      assert.deepEqual([await withdrawShare(frozen, A, share.id, STAFF), await withdrawShare(frozen, A, share.id, STAFF)], [true, false]);
      const account = await ensurePortalAccount(ctx, A, ids.sam, STAFF);
      const at = frozen.now!().toISOString();
      const sessionId = "psn_01JBFROZENSESSION000000000";
      await ctx.db.insertInto("pms_portal_sessions").values({ tenant_id: A, id: sessionId, account_id: account.id, token_hash: hashSecret("frozen-session"), expires_at: "2026-11-02T12:00:00.000Z", last_seen_at: at, revoked_at: null, created_at: at }).execute();
      assert.deepEqual([await revokePortalSession(frozen, A, sessionId), await revokePortalSession(frozen, A, sessionId)], [true, false]);
      const copy = (await requestIntakeForm(ctx, A, { templateId: ids.form_running, patientId: ids.sam }, STAFF)).response;
      assert.deepEqual([await cancelIntakeResponse(frozen, A, copy.id, STAFF), await cancelIntakeResponse(frozen, A, copy.id, STAFF)], [true, false]);
      const done = (await requestIntakeForm(ctx, A, { templateId: ids.form_running, patientId: ids.sam }, STAFF)).response;
      const sent = await submitForm(frozen, A, done.id, 1, { answers: { km: "20" }, trust: "verified" }, viewer);
      assert.ok(sent.ok);
      assert.deepEqual(await submitForm(frozen, A, done.id, 1, { answers: { km: "20" }, trust: "verified" }, viewer), { ok: false, reason: "closed" });
      // The same two writes racing (both read "requested" before either wrote): the loser's UPDATE matches nothing.
      const raced = (await requestIntakeForm(ctx, A, { templateId: ids.form_running, patientId: ids.sam }, STAFF)).response;
      const both = await Promise.all([
        submitIntakeResponseTwice(frozen, raced.id, viewer),
        submitIntakeResponseTwice(frozen, raced.id, viewer),
      ]);
      assert.equal(both.filter((r) => r.ok).length, 1, "exactly one of two racing submits sealed the copy");
      assert.deepEqual([await markResponseReviewed(frozen, A, done.id, STAFF), await markResponseReviewed(frozen, A, done.id, STAFF)], [true, false]);
      const audit = await listAudit(ctx, A, { limit: 1000 });
      const count = (action: string, target: string) => audit.filter((e) => e.action === action && e.targetId === target).length;
      assert.equal(count("pms.portal_share.view", share.id), 1);
      assert.equal(count("pms.portal_share.withdraw", share.id), 1);
      assert.equal(count("pms.portal_session.end", account.id), 1);
      assert.equal(count("pms.intake_response.cancel", copy.id), 1);
      assert.equal(count("pms.intake_response.submit", done.id), 1);
      assert.equal(count("pms.intake_response.submit", raced.id), 1, "racing submits in the same millisecond: one audit row");
      assert.equal(count("pms.intake_response.review", done.id), 1);
    });

    /** submitIntakeResponse with the revision read up front (as two requests arriving together would). */
    async function submitIntakeResponseTwice(c: RepoContext, id: string, who: { userId: null; sessionId: string }) {
      return submitForm(c, A, id, 1, { answers: { km: "12" }, trust: "verified" }, who);
    }

    it("files shared with the patient (PORTAL-004): the record's file, who and when, withdraw, never another clinic's", async () => {
      const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("fictional exercise sheet ".repeat(40))]);
      const file = await putAttachment(ctx, A, { patientId: ids.sam, bytes: pdf, fileName: "Sam exercise sheet.pdf", description: "Home exercises (fictional)" }, STAFF);
      const fileB = await putAttachment(ctx, B, { patientId: ids.patientB, bytes: pdf, fileName: "b.pdf" }, STAFF_B);
      const share = await shareAttachment(ctx, A, { patientId: ids.sam, attachmentId: file.id, title: "Your exercise sheet", message: "Three times a day." }, STAFF);
      assert.equal(share.sharedBy, STAFF.userId);
      assert.ok(share.sharedAt);
      assert.equal((await shareFilesForPatient(ctx, A, ids.sam)).get(share.id), file.id);
      const full = await getPortalShare(ctx, A, share.id);
      assert.deepEqual([full?.attachmentId, full?.body], [file.id, "Three times a day."]);
      // Another clinic's file, or a file of another clinic's patient, is refused by the foreign keys.
      await rejects(shareAttachment(ctx, A, { patientId: ids.sam, attachmentId: fileB.id, title: "Cross", message: null }, STAFF), /does not exist in this clinic/);
      await rejects(shareAttachment(ctx, B, { patientId: ids.patientB, attachmentId: file.id, title: "Cross", message: null }, STAFF_B), /does not exist in this clinic/);
      assert.equal(await getPortalShare(ctx, B, share.id), null);
      // The patient's portal lists it with the file's kind and size, and hands the file out.
      const home = await portalHome(ctx, clinicA, ids.sam, now());
      assert.ok(home.documents.some((d) => d.id === share.id && /PDF document/.test(d.detail)), JSON.stringify(home.documents));
      const mine = await patientShare(ctx, A, ids.sam, share.id);
      assert.equal(mine?.file?.id, file.id);
      assert.equal(await patientShare(ctx, A, ids.megan, share.id), null, "never another patient's");
      await recordShareDownload(ctx, A, share.id, file.id, { userId: null, sessionId: "psn_test" });
      // A file withdrawn from the record is no longer handed out, whatever the share says.
      const second = await shareAttachment(ctx, A, { patientId: ids.sam, attachmentId: file.id, title: "Again", message: null }, STAFF);
      assert.equal(await withdrawShare(ctx, A, second.id, STAFF), true);
      assert.equal(await patientShare(ctx, A, ids.sam, second.id), null, "a withdrawn share");
      assert.equal(await withdrawAttachment(ctx, A, file.id, "Replaced by a newer sheet", STAFF), true);
      assert.equal(await patientShare(ctx, A, ids.sam, share.id), null, "the file was withdrawn from the record");
      assert.ok(!(await portalHome(ctx, clinicA, ids.sam, now())).documents.some((d) => d.id === share.id));
      const audit = await listAudit(ctx, A, { limit: 1000 });
      const created = audit.find((e) => e.action === "pms.portal_share.create" && e.targetId === share.id);
      assert.deepEqual(created?.detail, { patientId: ids.sam, attachmentId: file.id });
      assert.ok(audit.some((e) => e.action === "pms.portal_share.download" && e.targetId === share.id));
      assert.ok(!JSON.stringify(audit.filter((e) => e.targetId === share.id)).includes("exercise sheet"), "no titles or names in the audit");
    });

    it("forms completed in the clinic on a clinic device: only that form, sealed as usual, verified by staff", async () => {
      const copy = (await requestIntakeForm(ctx, A, { templateId: ids.form_consent, patientId: ids.sam }, STAFF)).response;
      const secret = newSecret();
      const later = new Date(Date.parse("2026-11-02T09:00:00.000Z")).toISOString();
      await rejects(startHandoff(ctx, A, { responseId: copy.id, patientId: ids.sam, tokenHash: hashSecret(secret), expiresAt: later }, { userId: null, sessionId: "psn_x" }), /member of staff/);
      await rejects(startHandoff(ctx, A, { responseId: copy.id, patientId: ids.megan, tokenHash: hashSecret(secret), expiresAt: later }, STAFF), /can no longer be completed/);
      const first = await startHandoff(ctx, A, { responseId: copy.id, patientId: ids.sam, tokenHash: hashSecret(newSecret()), expiresAt: later }, STAFF);
      const h = await startHandoff(ctx, A, { responseId: copy.id, patientId: ids.sam, tokenHash: hashSecret(secret), expiresAt: later }, STAFF);
      assert.equal((await getHandoff(ctx, A, first.id))?.status, "ended", "a new hand-off of the same form ends the earlier one");
      assert.equal(await findHandoffByToken(ctx, B, hashSecret(secret)), null, "never another clinic's");
      const raw = await ctx.db.selectFrom("pms_intake_handoffs").select("token_hash").where("tenant_id", "=", A).where("id", "=", h.id).executeTakeFirstOrThrow();
      assert.ok(raw.token_hash !== secret && raw.token_hash === hashSecret(secret), "only the hash of the device's secret is stored");
      const state = await deviceState(ctx, A, secret);
      assert.equal(state.state, "open");
      assert.equal((await deviceState(ctx, A, newSecret())).state, "none");
      const form = new FormData();
      for (const k of ["consent_treatment", "consent_records", "cancellations"]) form.set(`q_${k}`, "on");
      form.set("q_share_gp", "yes");
      const bad = new FormData();
      bad.set("signature", "Sam Fixture");
      const refused = await submitOnDevice(ctx, A, secret, 1, bad);
      assert.ok(!refused.ok && refused.fieldErrors && Object.keys(refused.fieldErrors).length > 0);
      form.set("signature", "Sam Fixture");
      assert.deepEqual(await submitOnDevice(ctx, A, secret, 1, form), { ok: true });
      const sealed = (await getIntakeResponse(ctx, A, copy.id))!;
      assert.equal(sealed.status, "submitted");
      assert.equal(sealed.trust, "unverified", "unverified until staff confirm it");
      assert.equal(responseSealIntact(sealed), true);
      assert.equal((await getPatient(ctx, A, ids.sam))?.consentTreatment, false, "no consent on the record before staff verify");
      const s2 = await deviceState(ctx, A, secret);
      assert.equal(s2.state, "completed", "the device is locked on 'hand back to staff'");
      assert.equal((await submitOnDevice(ctx, A, secret, 2, form)).ok, false, "cannot be sent twice from the device");
      assert.equal(await verifyHandoff(ctx, A, h.id, { userId: null, sessionId: "psn_x" }).catch(() => "refused"), "refused");
      assert.equal(await verifyHandoff(ctx, A, h.id, STAFF), true);
      assert.equal(await verifyHandoff(ctx, A, h.id, STAFF), false);
      assert.equal(await recordVerifiedConsent(ctx, A, sealed, STAFF), true);
      assert.equal((await getPatient(ctx, A, ids.sam))?.consentTreatment, true, "consent recorded under the verifying member");
      const done = (await handoffForResponse(ctx, A, copy.id))!;
      assert.deepEqual([done.status, done.verifiedBy, Boolean(done.completedAt && done.verifiedAt)], ["verified", STAFF.userId, true]);
      assert.equal((await deviceState(ctx, A, secret)).state, "finished");
      // An expired hand-off shows nothing and accepts nothing; ending one is audited once.
      const other = (await requestIntakeForm(ctx, A, { templateId: ids.form_running, patientId: ids.sam }, STAFF)).response;
      const oldSecret = newSecret();
      const expired = await startHandoff(ctx, A, { responseId: other.id, patientId: ids.sam, tokenHash: hashSecret(oldSecret), expiresAt: "2026-11-02T07:00:00.000Z" }, STAFF);
      assert.equal((await deviceState(ctx, A, oldSecret)).state, "finished");
      const kmForm = new FormData();
      kmForm.set("q_km", "5");
      assert.equal((await submitOnDevice(ctx, A, oldSecret, 1, kmForm)).ok, false);
      assert.equal((await getIntakeResponse(ctx, A, other.id))?.status, "requested");
      assert.deepEqual([await endHandoff(ctx, A, expired.id, STAFF), await endHandoff(ctx, A, expired.id, STAFF)], [true, false]);
      // A questionnaire (outcome) is never handed to a device.
      const outcome = outcomeRequestQueries(ctx, A, { patientId: ids.sam, caseId: null, measure: "nprs", name: "Pain score", form: outcomeQuestionnaire("nprs") }, STAFF);
      await writeWithAudit(ctx, outcome.queries);
      await rejects(startHandoff(ctx, A, { responseId: outcome.id, patientId: ids.sam, tokenHash: hashSecret(newSecret()), expiresAt: later }, STAFF), /can no longer be completed/);
      const audit = await listAudit(ctx, A, { limit: 1000 });
      const sign = audit.find((e) => e.action === "pms.intake_response.sign" && e.targetId === copy.id);
      assert.deepEqual(sign?.detail && { via: sign.detail.via, handoff: sign.detail.handoff, trust: sign.detail.trust }, { via: "clinic_device", handoff: h.id, trust: "unverified" });
      const verify = audit.filter((e) => e.action === "pms.intake_response.verify" && e.targetId === copy.id);
      assert.equal(verify.length, 1);
      assert.deepEqual([verify[0].userId, verify[0].detail], [STAFF.userId, { handoff: h.id, via: "clinic_device" }]);
      assert.equal(audit.filter((e) => e.action === "pms.intake_handoff.start" && e.targetId === copy.id).length, 2);
      assert.equal(audit.filter((e) => e.action === "pms.intake_handoff.end" && e.targetId === copy.id).length, 1, "the replaced hand-off");
      assert.equal(audit.filter((e) => e.action === "pms.intake_handoff.end" && e.targetId === other.id).length, 1);
      assert.ok(!JSON.stringify(audit.filter((e) => e.action.startsWith("pms.intake_")).map((e) => e.detail)).includes("Sam"));
    });

    it("M10 M5: a manage link shows a sent form as 'Sent' – never its answers", async () => {
      const sent = (await listResponsesForPatient(ctx, A, ids.ellie, { status: "submitted" })).find((c) => c.appointmentId === ids.ellieAppt);
      assert.ok(sent, "a form of the booking already sent");
      const v = await manageFormView(ctx, clinicA, ids.ellieManage, sent!.id, now());
      assert.equal(v?.state, "sent");
      const text = JSON.stringify(v && v.state === "sent" ? { name: v.name, state: v.state } : v);
      assert.ok(!/Ellie Sample|"answers"|share_gp|signatureName/.test(text), "no answers, no signature");
      assert.equal(v && "response" in v, false, "the copy itself is not handed to the page");
      const open = (await listResponsesForPatient(ctx, A, ids.ellie, { status: "requested" })).find((c) => c.appointmentId === ids.ellieAppt);
      if (open) assert.equal((await manageFormView(ctx, clinicA, ids.ellieManage, open.id, now()))?.state, "fill");
      assert.equal(await manageFormView(ctx, clinicA, "x".repeat(43), sent!.id, now()), null, "a wrong link opens nothing");
    });

    it("M10 M6: production refuses public booking without the bot check; at most 40 bookings an hour reach the patient step", async () => {
      const cat = await bookingCatalogue(ctx, A, now());
      const slots = (await findSlots(ctx, A, clinicA.settings, cat, { siteId: ids.site, serviceId: ids.ia, practitionerId: ids.james, fromDate: "2026-11-03", days: 14, now: now() })).slots;
      assert.ok(slots.length > 0, "a free slot");
      const input = { siteId: ids.site, serviceId: ids.ia, practitionerId: ids.james, startsAt: slots[slots.length - 1].startsAt, firstName: "Cap", lastName: "Test", dateOfBirth: "1985-05-05", email: "cap.test@example.com", phoneMobile: "07700 900777" };
      const prod = await bookFromPublicPage(clinicA, input, deps({ env: { VERCEL_ENV: "production" } }));
      assert.deepEqual(prod, { ok: false, error: "Online booking is closed at the moment. Please contact the clinic." });
      for (let i = 0; i < 40; i++) await publicLimit(ctx, A, "recordsPerClinic", null, SECRET);
      const before = await countPmsRows(ctx.db, A);
      const capped = await bookFromPublicPage(clinicA, input, deps({ clientIp: "203.0.113.77" }));
      assert.ok(!capped.ok && /Too many attempts/.test(capped.error), JSON.stringify(capped));
      assert.deepEqual(await countPmsRows(ctx.db, A), before, "no record made");
    });

    it("every write was audited under its own clinic – ids and counts only", async () => {
      const a = await listAudit(ctx, A, { limit: 1000 });
      const codes = new Set(a.map((e) => e.action));
      for (const code of [
        "pms.booking_settings.update",
        "pms.booking_site.update",
        "pms.appointment.book",
        "pms.online_booking.create",
        "pms.online_booking.review",
        "pms.portal_account.create",
        "pms.portal_account.status",
        "pms.portal_link.create",
        "pms.portal_session.create",
        "pms.portal_session.end",
        "pms.message.send",
        "pms.portal_share.create",
        "pms.portal_share.view",
        "pms.portal_share.withdraw",
        "pms.intake_form.create",
        "pms.intake_form.update",
        "pms.intake_response.request",
        "pms.intake_response.sign",
        "pms.intake_response.submit",
        "pms.intake_response.cancel",
        "pms.intake_response.review",
        "pms.intake_response.apply",
        "pms.intake_response.score",
        "pms.intake_response.verify",
        "pms.intake_handoff.start",
        "pms.intake_handoff.end",
        "pms.portal_share.download",
        "pms.outcome.record",
      ]) {
        assert.ok(codes.has(code), code);
      }
      assert.equal(a.filter((e) => e.action === "pms.portal_share.withdraw" && e.targetId === ids.textShare).length, 1, "a refused second withdrawal wrote no audit row");
      assert.equal(a.filter((e) => e.action === "pms.portal_account.status").length, 2, "a status that did not change wrote no audit row");
      const text = JSON.stringify(a.filter((e) => e.action.startsWith("pms.")));
      for (const secret of ["Ellie", "Sample", "megan.hart", "Sore knee", "Chin tucks", "07700", ids.ellieManage]) assert.ok(!text.includes(secret), secret);
      assert.ok((await listAudit(ctx, B, { limit: 500 })).every((e) => e.userId === STAFF_B.userId || e.userId === null));
    });

    it("offboarding: every portal row exported decrypted, then deleted in foreign-key order", async () => {
      const exported = await exportPmsData(ctx.db, ctx.cipher, A);
      assert.ok(exported.pms_online_bookings.length >= 5);
      assert.ok(exported.pms_intake_responses.some((r) => typeof r.answers === "string" && String(r.answers).includes("Sore knee")), "answers decrypted in the export");
      assert.equal(exported.pms_booking_sites.length, 2);
      await runBatch(ctx.db, deletePmsQueries(ctx.db, B));
      assert.deepEqual(await countPmsRows(ctx.db, B), {});
      assert.ok((await countPmsRows(ctx.db, A)).pms_online_bookings >= 5, "clinic A untouched");
    });

    it("tenant-scope guard: every clinic-system statement named tenant_id", () => {
      if (!suite.log) return;
      assert.ok(suite.log.statements.length > 200, `recorded ${suite.log.statements.length} statements`);
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
