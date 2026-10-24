/**
 * TESTS ONLY: the portal module's suite – repositories AND the booking, sign-in and form flows that run on them –
 * on node:sqlite and PGlite (src/server/repos/pms/portal/portal-repos.test.ts) and on D1 through the gateway
 * (workers/data-gateway/test/pms-portal-stack.test.ts). Two clinics; nothing of clinic B is ever readable or
 * changeable from A; no double booking; encrypted free text; sealed signed forms; every write audited; the
 * tenant-scope guard over every statement at the end.
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
import { getBookingSettings, updateBookingSettings } from "../settings";
import { createBookingHours, listBookingHours, removeBookingHours } from "../hours";
import { bookingInsert, cancelOnlineBooking, createOnlineBooking, findBookingByManageToken, getOnlineBooking, listBookingsForPatient, listOnlineBookings, markBookingReviewed, rebookOnlineBooking } from "../bookings";
import { ensurePortalAccount, getPortalAccountForPatient, setPortalAccountStatus } from "../accounts";
import { getPortalMessage, listPortalMessages } from "../messages";
import { getPortalShare, listSharesForPatient, markShareViewed, sharePortalDocument, withdrawShare } from "../shares";
import {
  cancelIntakeResponse,
  countResponsesByTemplate,
  createIntakeTemplate,
  getIntakeResponse,
  getIntakeTemplate,
  listIntakeTemplates,
  listResponsesForBooking,
  listResponsesForPatient,
  listResponsesToReview,
  markResponseReviewed,
  requestIntakeForm,
  responseSealIntact,
  updateIntakeTemplate,
} from "../intake";
import { STARTER_FORMS } from "../../../../../modules/pms/portal/starters";
import { bookingCatalogue, findSlots } from "../../../../pms/portal/availability";
import { bookFromPortal, bookFromPublicPage, cancelByClinic, cancelByPatient, rebookByPatient, type FlowDeps } from "../../../../pms/portal/booking";
import { loadPublicClinic, type PublicClinic } from "../../../../pms/portal/public-clinic";
import { completeSignIn, readPortalSession, requestSignInLink, signOutPortal } from "../../../../pms/portal/portal-auth";
import { applyToRecord, submitForm } from "../../../../pms/portal/intake-service";
import { hashSecret } from "../../../../pms/portal/tokens";
import type { PortalMailer } from "../../../../pms/portal/mailer";
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
const OUTBOX: PortalMailer = { provider: "outbox", status: "outbox", testMode: true };
const ORIGIN = "https://clinic.example";
const SECRET = "portal-suite-limit-secret-0123456789";

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(promise, (err: unknown) => err instanceof RepoInputError && pattern.test(err.message));
}

/** The "manage" secret out of a manage link. */
const tokenOf = (url: string) => decodeURIComponent(url.split("/").pop() ?? "");

export function definePortalSuite(label: string, factory: () => Promise<PortalSuiteDb>): void {
  describe(`clinic-system portal module on ${label}`, () => {
    let suite: PortalSuiteDb;
    let ctx: RepoContext;
    // Monday 2 November 2026, 08:00 UK (GMT).
    let clock = Date.parse("2026-11-02T08:00:00.000Z");
    const now = () => new Date(clock);
    const tick = (ms = 1000) => {
      clock += ms;
    };
    const ids: Record<string, string> = {};
    let clinicA: PublicClinic;
    const deps = (over: Partial<FlowDeps> = {}): FlowDeps => ({ ctx, now: now(), origin: ORIGIN, clientIp: "203.0.113.7", mailer: OUTBOX, limitSecret: SECRET, ...over });
    /** The secret of the newest sign-in link in a patient's outbox. */
    const latestLinkToken = async (patientId: string): Promise<string> => {
      const message = (await listPortalMessages(ctx, A, { patientId, limit: 500 })).find((m) => m.kind === "sign_in_link");
      const body = message ? (await getPortalMessage(ctx, A, message.id))?.body : null;
      const token = body ? /\/portal\/link\/([A-Za-z0-9_-]{43})/.exec(body)?.[1] : null;
      assert.ok(token, "a sign-in link in the outbox");
      return token as string;
    };

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
      const site = await createSite(ctx, A, { name: "Bletchley (fictional)", code: "BLE", phone: "01632 960101" }, STAFF);
      const site2 = await createSite(ctx, A, { name: "Wolverton (fictional)", code: "WOL" }, STAFF);
      ids.site = site.id;
      ids.site2 = site2.id;
      ids.james = (await createPractitioner(ctx, A, { displayName: "James Okafor", registrationNumber: "PH-DEMO-04", onlineBookable: true, sortOrder: 1 }, STAFF)).id;
      ids.priya = (await createPractitioner(ctx, A, { displayName: "Priya Shah", registrationNumber: "PH-DEMO-03", onlineBookable: true, sortOrder: 2 }, STAFF)).id;
      ids.offline = (await createPractitioner(ctx, A, { displayName: "Tom Ellis", registrationNumber: "PH-DEMO-02", sortOrder: 3 }, STAFF)).id;
      ids.ia = (await createService(ctx, A, { name: "Initial assessment", durationMinutes: 45, bufferMinutes: 15, onlineBookable: true }, STAFF)).id;
      ids.fu = (await createService(ctx, A, { name: "Follow-up", durationMinutes: 30, onlineBookable: true }, STAFF)).id;
      ids.mla = (await createService(ctx, A, { name: "Medico-legal assessment", durationMinutes: 60 }, STAFF)).id;
      ids.megan = (await createPatient(ctx, A, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-22", email: "megan.hart@example.com", phoneMobile: "07700 900123", importRef: "sim-pat-001" }, STAFF)).id;
      const siteB = await createSite(ctx, B, { name: "Harbour (fictional)" }, STAFF_B);
      ids.siteB = siteB.id;
      ids.pracB = (await createPractitioner(ctx, B, { displayName: "Hal Bright", onlineBookable: true }, STAFF_B)).id;
      ids.svcB = (await createService(ctx, B, { name: "Follow-up", durationMinutes: 30, onlineBookable: true }, STAFF_B)).id;
      ids.patientB = (await createPatient(ctx, B, { firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-22", email: "megan.hart@example.com" }, STAFF_B)).id;
    });
    after(async () => {
      await suite?.close();
    });

    it("public clinic: nothing without the package and an open page; settings are revision-checked", async () => {
      assert.equal(await loadPublicClinic(ctx, "no-such-clinic"), null);
      assert.equal(await loadPublicClinic(ctx, "Bad Slug!"), null);
      assert.equal(await loadPublicClinic(ctx, A), null, "no clinic package yet");
      await setEntitlement(ctx, A, "clinic", { status: "active" }, STAFF);
      await setEntitlement(ctx, B, "clinic", { status: "active" }, STAFF_B);
      assert.equal(await loadPublicClinic(ctx, A), null, "package on, but online booking and the portal are off by default");
      const defaults = await getBookingSettings(ctx, A);
      assert.deepEqual([defaults.rev, defaults.onlineBooking, defaults.portal, defaults.minNoticeHours], [0, false, false, 24]);
      const saved = await updateBookingSettings(ctx, A, 0, { onlineBooking: true, portal: true, minNoticeHours: 2, cancelNoticeHours: 24, contactPhone: "01632 960101", cancellationPolicy: "Please give 24 hours' notice." }, STAFF);
      assert.deepEqual(saved.ok ? saved.rev : saved, 1);
      assert.deepEqual(await updateBookingSettings(ctx, A, 0, { portal: false }, STAFF), { ok: false, reason: "conflict", currentRev: 1 }, "a second first save is a conflict");
      assert.deepEqual(await updateBookingSettings(ctx, A, 5, { portal: false }, STAFF), { ok: false, reason: "conflict", currentRev: 1 });
      await rejects(updateBookingSettings(ctx, A, 1, { slotStepMinutes: 7 }, STAFF), /slotStepMinutes/);
      assert.equal((await getBookingSettings(ctx, B)).onlineBooking, false, "clinic B unaffected");
      const loaded = await loadPublicClinic(ctx, A);
      assert.ok(loaded);
      clinicA = loaded;
      assert.equal(clinicA.name, "Riverside Physiotherapy (fictional)");
      await updateBookingSettings(ctx, B, 0, { onlineBooking: true, portal: true, minNoticeHours: 0 }, STAFF_B);
    });

    it("online hours: per practitioner and site, no clash, never pointing at another clinic", async () => {
      // Mondays and Tuesdays 09:00–12:00 at Bletchley for James; Mondays 09:00–11:00 for Priya.
      ids.hMon = (await createBookingHours(ctx, A, { practitionerId: ids.james, siteId: ids.site, weekday: 1, startMinute: 540, endMinute: 720 }, STAFF)).id;
      await createBookingHours(ctx, A, { practitionerId: ids.james, siteId: ids.site, weekday: 2, startMinute: 540, endMinute: 720 }, STAFF);
      await createBookingHours(ctx, A, { practitionerId: ids.priya, siteId: ids.site, weekday: 1, startMinute: 540, endMinute: 660 }, STAFF);
      await rejects(createBookingHours(ctx, A, { practitionerId: ids.james, siteId: ids.site2, weekday: 1, startMinute: 660, endMinute: 780 }, STAFF), /overlap Monday 09:00–12:00/);
      await rejects(createBookingHours(ctx, B, { practitionerId: ids.james, siteId: ids.siteB, weekday: 1, startMinute: 540, endMinute: 600 }, STAFF_B), /does not exist in this clinic/);
      const extra = await createBookingHours(ctx, A, { practitionerId: ids.james, siteId: ids.site2, weekday: 3, startMinute: 540, endMinute: 600 }, STAFF);
      assert.equal(await removeBookingHours(ctx, B, extra.id, STAFF_B), false, "another clinic cannot remove it");
      assert.equal(await removeBookingHours(ctx, A, extra.id, STAFF), true);
      assert.equal((await listBookingHours(ctx, A)).length, 3);
      assert.equal((await listBookingHours(ctx, B)).length, 0);
      await createBookingHours(ctx, B, { practitionerId: ids.pracB, siteId: ids.siteB, weekday: 1, startMinute: 540, endMinute: 600 }, STAFF_B);
    });

    it("slots: online types and practitioners only, the clinic's notice period, the service's buffer", async () => {
      const cat = await bookingCatalogue(ctx, A);
      assert.deepEqual(cat.services.map((s) => s.name).sort(), ["Follow-up", "Initial assessment"], "the medico-legal type is not bookable online");
      assert.deepEqual(cat.sites.map((s) => s.id), [ids.site], "only sites with online hours");
      assert.deepEqual(cat.practitioners.map((p) => p.displayName), ["James Okafor", "Priya Shah"]);
      const ia = await findSlots(ctx, A, clinicA.settings, cat, { siteId: ids.site, serviceId: ids.ia, practitionerId: ids.james, fromDate: "2026-11-02", days: 1, now: now() });
      // now = 08:00, notice 2 h → from 10:00; 45 min appointments in 15-minute steps up to 11:15.
      assert.deepEqual(ia.slots.map((s) => s.startsAt.slice(11, 16)), ["10:00", "10:15", "10:30", "10:45", "11:00", "11:15"]);
      assert.equal(ia.slots[0].blocksUntil, "2026-11-02T11:00:00.000Z", "45 minutes + 15 minutes' buffer");
      const none = await findSlots(ctx, A, clinicA.settings, cat, { siteId: ids.site, serviceId: ids.mla, practitionerId: "any", fromDate: "2026-11-02", days: 1, now: now() });
      assert.equal(none.slots.length, 0);
      const offline = await findSlots(ctx, A, clinicA.settings, cat, { siteId: ids.site, serviceId: ids.fu, practitionerId: ids.offline, fromDate: "2026-11-02", days: 1, now: now() });
      assert.equal(offline.slots.length, 0, "a practitioner not bookable online");
    });

    it("forms the clinic sends with a booking: starters as templates, versions, one open copy per form", async () => {
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

    it("public booking, new patient: registered, booked, forms sent, confirmation in the outbox – nothing secret stored", async () => {
      const out = await bookFromPublicPage(
        clinicA,
        { siteId: ids.site, serviceId: ids.ia, practitionerId: "any", startsAt: "2026-11-03T09:00:00.000Z", firstName: "Ellie", lastName: "Sample", dateOfBirth: "1990-05-04", email: "Ellie.Sample@example.com", phoneMobile: "07700 900205", agree: true, reminders: true },
        deps(),
      );
      assert.ok(out.ok, JSON.stringify(out));
      if (!out.ok) return;
      assert.equal(out.practitionerName, "James Okafor", "any practitioner: the first free one in the clinic's order");
      assert.equal(out.forms, 3, "the three starter forms sent to new patients");
      assert.match(out.reference, /^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
      ids.ellieToken = tokenOf(out.manageUrl);
      const booking = await findBookingByManageToken(ctx, A, hashSecret(ids.ellieToken), now().toISOString());
      assert.ok(booking);
      ids.ellieBooking = booking!.id;
      ids.ellie = booking!.patientId;
      assert.equal(booking!.patientMatch, "new");
      assert.equal(booking!.channel, "booking_page");
      const raw = await ctx.db.selectFrom("pms_online_bookings").selectAll().where("tenant_id", "=", A).where("id", "=", booking!.id).executeTakeFirstOrThrow();
      assert.ok(!JSON.stringify(raw).includes(ids.ellieToken), "only the hash of the manage link is stored");
      const ellie = await getPatient(ctx, A, ids.ellie);
      assert.deepEqual([ellie?.firstName, ellie?.email, ellie?.phoneMobile, ellie?.dateOfBirth], ["Ellie", "ellie.sample@example.com", "07700 900205", "1990-05-04"]);
      assert.equal((await listResponsesForBooking(ctx, A, booking!.id)).length, 3);
      const messages = await listPortalMessages(ctx, A, { patientId: ids.ellie });
      assert.deepEqual(messages.map((m) => [m.kind, m.status]), [["booking_confirmed", "outbox"]]);
      const rawMsg = await ctx.db.selectFrom("pms_portal_messages").selectAll().where("tenant_id", "=", A).where("id", "=", messages[0].id).executeTakeFirstOrThrow();
      assert.ok(!String(rawMsg.body_enc).includes("Ellie") && !String(rawMsg.recipient_enc).includes("example.com"), "recipient and body encrypted");
      const msg = await getPortalMessage(ctx, A, messages[0].id);
      assert.equal(msg?.recipient, "ellie.sample@example.com");
      assert.ok(msg?.body?.includes(out.manageUrl), "the link is in the message");
      assert.ok(msg?.body?.includes("Tuesday 3 November 2026 at 09:00"));
      assert.equal(await getPortalMessage(ctx, B, messages[0].id), null);
    });

    it("public booking, existing patient: matched on email, date of birth and last name – the answer looks the same", async () => {
      tick();
      const before = (await ctx.db.selectFrom("pms_patients").select((eb) => eb.fn.countAll<number>().as("n")).where("tenant_id", "=", A).executeTakeFirstOrThrow()).n;
      const out = await bookFromPublicPage(
        clinicA,
        { siteId: ids.site, serviceId: ids.fu, practitionerId: ids.priya, startsAt: "2026-11-02T10:15:00.000Z", firstName: "Meg", lastName: "HART", dateOfBirth: "1991-11-22", email: "megan.hart@example.com", phoneMobile: "07700 900999", agree: true },
        deps(),
      );
      assert.ok(out.ok, JSON.stringify(out));
      if (!out.ok) return;
      assert.deepEqual(Object.keys(out).sort(), ["forms", "manageUrl", "ok", "practitionerName", "reference", "serviceName", "siteName", "startsAt"], "same shape as for a new patient");
      const after = (await ctx.db.selectFrom("pms_patients").select((eb) => eb.fn.countAll<number>().as("n")).where("tenant_id", "=", A).executeTakeFirstOrThrow()).n;
      assert.equal(Number(after), Number(before), "no new record");
      const b = await findBookingByManageToken(ctx, A, hashSecret(tokenOf(out.manageUrl)), now().toISOString());
      assert.equal(b?.patientId, ids.megan);
      assert.equal(b?.patientMatch, "existing");
      ids.meganBooking = b!.id;
      assert.equal(out.forms, 0, "new-patient forms are not sent to an existing patient");
      assert.equal((await getPatient(ctx, A, ids.megan))?.phoneMobile, "07700 900123", "the record is never changed by a booking");
      // A different date of birth is a new person (a new record), never a match.
      const other = await bookFromPublicPage(
        clinicA,
        { siteId: ids.site, serviceId: ids.fu, practitionerId: ids.james, startsAt: "2026-11-02T10:30:00.000Z", firstName: "Megan", lastName: "Hart", dateOfBirth: "1991-11-23", email: "megan.hart@example.com", phoneMobile: "07700 900124", agree: true },
        deps({ clientIp: "203.0.113.8" }),
      );
      assert.ok(other.ok);
      if (other.ok) assert.notEqual((await findBookingByManageToken(ctx, A, hashSecret(tokenOf(other.manageUrl)), now().toISOString()))?.patientId, ids.megan);
    });

    it("no double booking: the slot is recomputed, and the database refuses an overlap even past the check", async () => {
      const taken = await bookFromPublicPage(
        clinicA,
        { siteId: ids.site, serviceId: ids.fu, practitionerId: ids.james, startsAt: "2026-11-03T09:30:00.000Z", firstName: "Late", lastName: "Comer", dateOfBirth: "1985-01-01", email: "late.comer@example.com", phoneMobile: "07700 900206", agree: true },
        deps({ clientIp: "203.0.113.9" }),
      );
      assert.deepEqual(taken.ok ? "booked" : [taken.slotGone, /just been taken/.test(taken.error)], [true, true], "09:30 is inside Ellie's 09:00 + 45 + 15");
      const audits = (await listAudit(ctx, A, { action: "pms.online_booking.create", limit: 500 })).length;
      const msgs = (await listPortalMessages(ctx, A, { limit: 500 })).length;
      const direct = await createOnlineBooking(
        ctx,
        A,
        { patientId: ids.megan, siteId: ids.site, practitionerId: ids.james, serviceId: ids.fu, startsAt: "2026-11-03T09:50:00.000Z", endsAt: "2026-11-03T10:20:00.000Z", blocksUntil: "2026-11-03T10:20:00.000Z", channel: "clinic", patientMatch: "existing", manageTokenHash: null, manageExpiresAt: null },
        STAFF,
        () => [],
      );
      assert.deepEqual(direct, { ok: false, reason: "slot_taken" });
      assert.equal((await listAudit(ctx, A, { action: "pms.online_booking.create", limit: 500 })).length, audits, "a refused booking leaves no audit row");
      assert.equal((await listPortalMessages(ctx, A, { limit: 500 })).length, msgs);
      const back = await createOnlineBooking(
        ctx,
        A,
        { patientId: ids.megan, siteId: ids.site, practitionerId: ids.james, serviceId: ids.fu, startsAt: "2026-11-03T10:00:00.000Z", endsAt: "2026-11-03T10:30:00.000Z", blocksUntil: "2026-11-03T10:30:00.000Z", channel: "clinic", patientMatch: "existing", manageTokenHash: null, manageExpiresAt: null },
        STAFF,
      );
      assert.ok(back.ok, "back to back after the buffer is fine");
      ids.backToBack = back.ok ? back.booking.id : "";
      // A raw insert past the repository is refused by the database too.
      const raw = bookingInsert(ctx, A, { patientId: ids.megan, siteId: ids.site, practitionerId: ids.james, serviceId: ids.fu, startsAt: "2026-11-03T10:10:00.000Z", endsAt: "2026-11-03T10:40:00.000Z", blocksUntil: "2026-11-03T10:40:00.000Z", channel: "clinic", patientMatch: "existing", manageTokenHash: null, manageExpiresAt: null });
      await assert.rejects(runBatch(ctx.db, [raw.query]), /pms_online_bookings_overlap/);
      // Another clinic's practitioner cannot be booked from clinic A.
      await rejects(
        createOnlineBooking(ctx, A, { patientId: ids.megan, siteId: ids.site, practitionerId: ids.pracB, serviceId: ids.fu, startsAt: "2026-11-03T09:00:00.000Z", endsAt: "2026-11-03T09:30:00.000Z", blocksUntil: "2026-11-03T09:30:00.000Z", channel: "clinic", patientMatch: "existing", manageTokenHash: null, manageExpiresAt: null }, STAFF),
        /does not exist in this clinic/,
      );
      assert.equal(await getOnlineBooking(ctx, B, ids.ellieBooking), null, "another clinic cannot read it");
    });

    it("moving and cancelling within the notice period; the manage link and the forms follow the booking", async () => {
      const ellie = (await getOnlineBooking(ctx, A, ids.ellieBooking))!;
      const moved = await rebookByPatient(clinicA, ellie, ellie.rev, { practitionerId: ids.james, startsAt: "2026-11-03T11:00:00.000Z" }, deps());
      assert.ok(moved.ok, JSON.stringify(moved));
      if (!moved.ok) return;
      const old = await getOnlineBooking(ctx, A, ids.ellieBooking);
      assert.deepEqual([old?.status, old?.cancelReason, old?.cancelledBy], ["cancelled", "rebooked", "patient"]);
      assert.equal(moved.booking.rebookedFromId, ids.ellieBooking);
      assert.equal(moved.booking.startsAt, "2026-11-03T11:00:00.000Z");
      assert.equal((await findBookingByManageToken(ctx, A, hashSecret(ids.ellieToken), now().toISOString()))?.id, moved.booking.id, "the same link opens the new booking");
      assert.equal((await listResponsesForBooking(ctx, A, moved.booking.id)).length, 3, "the forms moved with it");
      ids.ellieBooking = moved.booking.id;
      // The old booking cannot be moved again (the database keeps one successor and wants it cancelled first).
      const again = await rebookOnlineBooking(ctx, A, ellie.id, ellie.rev, { siteId: ids.site, practitionerId: ids.james, serviceId: ids.ia, startsAt: "2026-11-04T10:00:00.000Z", endsAt: "2026-11-04T10:45:00.000Z", blocksUntil: "2026-11-04T11:00:00.000Z" }, STAFF);
      assert.deepEqual(again, { ok: false, reason: "conflict" });
      const forged = bookingInsert(ctx, A, { patientId: ids.ellie, siteId: ids.site, practitionerId: ids.james, serviceId: ids.fu, startsAt: "2026-11-10T09:00:00.000Z", endsAt: "2026-11-10T09:30:00.000Z", blocksUntil: "2026-11-10T09:30:00.000Z", channel: "clinic", patientMatch: "existing", manageTokenHash: null, manageExpiresAt: null }, { rebookedFromId: ids.backToBack });
      await assert.rejects(runBatch(ctx.db, [forged.query]), /pms_online_bookings_rebook/, "a move from a booking that was not cancelled as moved");
      // Too late to cancel online: Megan's 10:15 today is about two hours away (notice 24 h).
      const megan = (await getOnlineBooking(ctx, A, ids.meganBooking))!;
      const late = await cancelByPatient(clinicA, megan, megan.rev, deps());
      assert.ok(!late.ok && /too close to the appointment/.test(late.error) && /01632 960101/.test(late.error));
      // Ellie cancels her moved booking (tomorrow 11:00 = 27 h away).
      const current = (await getOnlineBooking(ctx, A, ids.ellieBooking))!;
      assert.deepEqual(await cancelByPatient(clinicA, current, current.rev - 1, deps()).then((r) => r.ok), false, "stale revision");
      const cancelled = await cancelByPatient(clinicA, current, current.rev, deps());
      assert.ok(cancelled.ok);
      assert.equal(await findBookingByManageToken(ctx, A, hashSecret(ids.ellieToken), now().toISOString()), null, "a cancelled booking's link stops working");
      const kinds = (await listPortalMessages(ctx, A, { patientId: ids.ellie })).map((m) => m.kind);
      assert.deepEqual(kinds, ["booking_cancelled", "booking_changed", "booking_confirmed"]);
      // The clinic cancels inside the notice period: recorded as late.
      const byClinic = await cancelByClinic(ctx, { tenantId: A, name: clinicA.name, contactPhone: "01632 960101", cancelNoticeHours: 24 }, megan.id, megan.rev, STAFF, { now: now(), mailer: OUTBOX, origin: ORIGIN });
      assert.ok(byClinic.ok);
      if (byClinic.ok) assert.deepEqual([byClinic.booking.cancelledBy, byClinic.booking.lateCancellation], ["clinic", true]);
      assert.deepEqual(await cancelOnlineBooking(ctx, B, megan.id, 1, { by: "clinic", reason: "clinic", late: false }, STAFF_B), { ok: false, reason: "not_found" });
      assert.equal(await markBookingReviewed(ctx, A, ids.backToBack, STAFF), true);
      assert.equal(await markBookingReviewed(ctx, A, ids.backToBack, STAFF), false, "once");
      assert.equal((await listOnlineBookings(ctx, A, { from: "2026-11-02T00:00:00.000Z", unreviewed: true })).some((b) => b.id === ids.backToBack), false);
      assert.equal((await listOnlineBookings(ctx, B)).length, 0);
    });

    it("limits: three online bookings a day per email address, whoever's address it is", async () => {
      const book = (startsAt: string, ip: string) =>
        bookFromPublicPage(clinicA, { siteId: ids.site, serviceId: ids.fu, practitionerId: "any", startsAt, firstName: "Rate", lastName: "Limit", dateOfBirth: "1970-02-02", email: "rate.limit@example.com", phoneMobile: "07700 900207", agree: true }, deps({ clientIp: ip }));
      assert.ok((await book("2026-11-09T09:00:00.000Z", "198.51.100.1")).ok);
      assert.ok((await book("2026-11-09T09:30:00.000Z", "198.51.100.2")).ok);
      assert.ok((await book("2026-11-09T10:00:00.000Z", "198.51.100.3")).ok);
      const fourth = await book("2026-11-09T10:30:00.000Z", "198.51.100.4");
      assert.ok(!fourth.ok && /Too many attempts/.test(fourth.error));
      const bot = await bookFromPublicPage(clinicA, { website: "http://spam.example", siteId: ids.site }, deps());
      assert.ok(!bot.ok && !bot.fieldErrors, "the hidden field: refused quietly");
      const invalid = await bookFromPublicPage(clinicA, { siteId: ids.site, serviceId: ids.fu, practitionerId: "any", startsAt: "soon", agree: false }, deps());
      assert.ok(!invalid.ok && invalid.fieldErrors?.email && invalid.fieldErrors?.agree);
    });

    it("portal sign-in: same answer for everyone; a one-time link to the address on the record; sessions expire", async () => {
      tick();
      const unknown = await requestSignInLink(clinicA, { email: "nobody@example.com", dateOfBirth: "1990-01-01" }, deps());
      const wrongDob = await requestSignInLink(clinicA, { email: "megan.hart@example.com", dateOfBirth: "1990-01-01" }, deps());
      const right = await requestSignInLink(clinicA, { email: "Megan.Hart@example.com", dateOfBirth: "1991-11-22" }, deps());
      assert.deepEqual([unknown, wrongDob, right], [{ ok: true }, { ok: true }, { ok: true }], "the answer never says who is a patient");
      const account = await getPortalAccountForPatient(ctx, A, ids.megan);
      assert.ok(account);
      ids.account = account!.id;
      assert.equal(await getPortalAccountForPatient(ctx, B, ids.patientB), null, "clinic B's Megan is another person");
      const linkMsg = (await listPortalMessages(ctx, A, { patientId: ids.megan })).find((m) => m.kind === "sign_in_link");
      assert.ok(linkMsg);
      const body = (await getPortalMessage(ctx, A, linkMsg!.id))!.body!;
      const token = /\/portal\/link\/([A-Za-z0-9_-]{43})/.exec(body)?.[1] as string;
      assert.ok(token);
      const rawLink = await ctx.db.selectFrom("pms_portal_links").selectAll().where("tenant_id", "=", A).executeTakeFirstOrThrow();
      assert.equal(rawLink.token_hash, hashSecret(token), "only the hash is stored");
      assert.deepEqual(await completeSignIn({ ...clinicA, tenantId: B }, token, deps()), { ok: false, error: "This sign-in link has expired or has already been used. Ask for a new one below." }, "another clinic's address does nothing");
      const signed = await completeSignIn(clinicA, token, deps());
      assert.ok(signed.ok);
      if (!signed.ok) return;
      ids.cookie = signed.cookieValue;
      assert.equal((await completeSignIn(clinicA, token, deps())).ok, false, "used once");
      const viewer = await readPortalSession(ctx, A, signed.cookieValue, now());
      assert.equal(viewer?.patientId, ids.megan);
      assert.equal(await readPortalSession(ctx, B, signed.cookieValue, now()), null, "the cookie is worthless for another clinic");
      assert.equal(await readPortalSession(ctx, A, signed.cookieValue.slice(0, -2) + "xx", now()), null, "a forged secret");
      assert.equal(await readPortalSession(ctx, A, signed.cookieValue, new Date(clock + 31 * 60_000)), null, "idle for more than 30 minutes");
      // The signed-in patient books without giving details again, then signs out.
      const portalBooking = await bookFromPortal(clinicA, ids.megan, viewer!.sessionId, { siteId: ids.site, serviceId: ids.fu, practitionerId: ids.priya, startsAt: "2026-11-09T09:00:00.000Z" }, deps());
      assert.ok(portalBooking.ok, JSON.stringify(portalBooking));
      if (portalBooking.ok) assert.deepEqual([portalBooking.booking.channel, portalBooking.booking.patientMatch, portalBooking.booking.patientId], ["portal", "portal", ids.megan]);
      await signOutPortal(ctx, A, signed.cookieValue);
      assert.equal(await readPortalSession(ctx, A, signed.cookieValue, now()), null, "signed out");
      // An expired link does nothing.
      await requestSignInLink(clinicA, { email: "megan.hart@example.com", dateOfBirth: "1991-11-22" }, deps({ clientIp: "203.0.113.10" }));
      const token2 = await latestLinkToken(ids.megan);
      const later = { ...deps(), ctx: { ...ctx, now: () => new Date(clock + 21 * 60_000) }, now: new Date(clock + 21 * 60_000) };
      assert.equal((await completeSignIn(clinicA, token2, later)).ok, false, "after 20 minutes");
      // Switching the account off signs the patient out and stops new links.
      await requestSignInLink(clinicA, { email: "megan.hart@example.com", dateOfBirth: "1991-11-22" }, deps({ clientIp: "203.0.113.12" }));
      const third = await completeSignIn(clinicA, await latestLinkToken(ids.megan), deps());
      assert.ok(third.ok);
      if (!third.ok) return;
      assert.ok(await readPortalSession(ctx, A, third.cookieValue, now()));
      assert.equal(await setPortalAccountStatus(ctx, A, ids.account, "disabled", STAFF), true);
      assert.equal(await readPortalSession(ctx, A, third.cookieValue, now()), null);
      const before = (await listPortalMessages(ctx, A, { patientId: ids.megan, limit: 500 })).length;
      assert.deepEqual(await requestSignInLink(clinicA, { email: "megan.hart@example.com", dateOfBirth: "1991-11-22" }, deps({ clientIp: "203.0.113.11" })), { ok: true });
      assert.equal((await listPortalMessages(ctx, A, { patientId: ids.megan, limit: 500 })).length, before, "no link for a switched-off account");
      assert.equal(await setPortalAccountStatus(ctx, A, ids.account, "active", STAFF), true);
      assert.equal(await readPortalSession(ctx, A, third.cookieValue, now()), null, "switching back on does not revive old sessions");
      assert.equal((await ensurePortalAccount(ctx, A, ids.megan, STAFF)).id, ids.account, "one account per patient");
      // Upcoming online bookings of the patient (the portal home).
      assert.ok((await listBookingsForPatient(ctx, A, ids.megan, { from: now().toISOString(), status: "booked" })).length >= 1);
    });

    it("forms: answers checked, typed signature, sealed; verified consent recorded; other details wait for staff", async () => {
      const copies = await listResponsesForPatient(ctx, A, ids.ellie, { status: "requested" });
      assert.equal(copies.length, 3);
      const consentCopy = copies.find((c) => c.kind === "consent")!;
      const detailsCopy = copies.find((c) => c.kind === "intake")!;
      const healthCopy = copies.find((c) => c.kind === "questionnaire")!;
      // Through the booking link (unverified): consent is NOT recorded on the record by itself.
      const bad = await submitForm(ctx, A, consentCopy.id, 1, { answers: { consent_treatment: "on" }, signatureName: "E", trust: "unverified" }, { userId: null, sessionId: null });
      assert.ok(!bad.ok && bad.reason === "invalid");
      if (!bad.ok && bad.reason === "invalid") assert.deepEqual(Object.keys(bad.errors).sort(), ["cancellations", "consent_records", "share_gp", "signature"]);
      const signed = await submitForm(ctx, A, consentCopy.id, 1, { answers: { consent_treatment: "on", consent_records: "on", share_gp: "yes", cancellations: "on" }, signatureName: "  Ellie   Sample ", trust: "unverified" }, { userId: null, sessionId: null });
      assert.ok(signed.ok);
      if (!signed.ok) return;
      assert.equal(signed.response.signatureName, "Ellie Sample");
      assert.equal(signed.response.signedAt, now().toISOString());
      assert.equal(responseSealIntact(signed.response), true);
      assert.equal(signed.consentRecorded, undefined);
      assert.equal((await getPatient(ctx, A, ids.ellie))?.consentTreatment, false, "unverified: staff check first");
      assert.deepEqual(await submitForm(ctx, A, consentCopy.id, 2, { answers: {}, trust: "unverified" }, { userId: null, sessionId: null }), { ok: false, reason: "closed" });
      const raw = await ctx.db.selectFrom("pms_intake_responses").selectAll().where("tenant_id", "=", A).where("id", "=", consentCopy.id).executeTakeFirstOrThrow();
      assert.ok(!String(raw.answers_enc).includes("yes") && !String(raw.signature_name_enc).includes("Ellie"), "answers and signature encrypted");
      // A signed form is sealed in the database.
      await assert.rejects(ctx.db.updateTable("pms_intake_responses").set({ answers_enc: raw.signature_name_enc }).where("tenant_id", "=", A).where("id", "=", consentCopy.id).execute(), /pms_intake_responses_sealed/);
      await assert.rejects(ctx.db.updateTable("pms_intake_responses").set({ status: "cancelled" }).where("tenant_id", "=", A).where("id", "=", consentCopy.id).execute(), /pms_intake_responses_sealed/);
      assert.equal(await cancelIntakeResponse(ctx, A, consentCopy.id, STAFF), false, "a completed form cannot be withdrawn");
      // Staff apply it: consent to treatment from a complete signed consent form, and the GP answer.
      const applied = await applyToRecord(ctx, A, consentCopy.id, ["consentTreatment", "consentShareGp"], STAFF);
      assert.deepEqual(applied, { ok: true, fields: ["consentTreatment", "consentShareGp"] });
      const ellie = await getPatient(ctx, A, ids.ellie);
      assert.deepEqual([ellie?.consentTreatment, ellie?.consentShareGp], [true, true]);
      // Details: checked, then copied by staff (only the chosen fields).
      const details = await submitForm(
        ctx,
        A,
        detailsCopy.id,
        1,
        { answers: { mobile: "07700 900210", address: "1 Sample Street (fictional)\nBletchley", postcode: "mk3 9zz", gp_practice: "Bletchley Medical Centre (fictional)", emergency_name: "Sam Sample" }, trust: "unverified" },
        { userId: null, sessionId: null },
      );
      assert.ok(details.ok, JSON.stringify(details));
      const copied = await applyToRecord(ctx, A, detailsCopy.id, ["address", "postcode", "gpPractice"], STAFF);
      assert.deepEqual(copied, { ok: true, fields: ["address", "postcode", "gpPractice"] });
      const after = await getPatient(ctx, A, ids.ellie);
      assert.deepEqual([after?.address, after?.postcode, after?.gpPractice, after?.phoneMobile], [["1 Sample Street (fictional)", "Bletchley"], "MK3 9ZZ", "Bletchley Medical Centre (fictional)", "07700 900205"]);
      // Verified (portal) consent goes straight onto the record.
      const megansConsent = await requestIntakeForm(ctx, A, { templateId: ids.form_consent, patientId: ids.megan }, STAFF);
      assert.equal(megansConsent.created, true);
      assert.equal((await requestIntakeForm(ctx, A, { templateId: ids.form_consent, patientId: ids.megan }, STAFF)).created, false, "one open copy per form");
      const verified = await submitForm(ctx, A, megansConsent.response.id, 1, { answers: { consent_treatment: "on", consent_records: "on", share_gp: "no", cancellations: "on" }, signatureName: "Megan Hart", trust: "verified" }, { userId: null, sessionId: "psn_test" });
      assert.ok(verified.ok);
      if (verified.ok) assert.equal(verified.consentRecorded, true);
      const meg = await getPatient(ctx, A, ids.megan);
      assert.deepEqual([meg?.consentTreatment, meg?.consentShareGp], [true, false]);
      // Health answers are stored like the rest (shown to clinicians only – the page decides).
      const health = await submitForm(ctx, A, healthCopy.id, 1, { answers: { problem: "Sore knee after running", started: "2 to 6 weeks ago" }, trust: "unverified" }, { userId: null, sessionId: null });
      assert.ok(health.ok);
      // Applied by staff = checked; the patient's own consent and the questionnaire still wait for a member of staff.
      assert.deepEqual((await listResponsesToReview(ctx, A)).map((r) => r.id).sort(), [healthCopy.id, megansConsent.response.id].sort());
      assert.equal(await markResponseReviewed(ctx, A, healthCopy.id, STAFF), true);
      assert.equal((await listResponsesToReview(ctx, A)).length, 1);
      assert.equal(await getIntakeResponse(ctx, B, healthCopy.id), null, "another clinic cannot read it");
      await rejects(requestIntakeForm(ctx, B, { templateId: ids.form_consent, patientId: ids.patientB }, STAFF_B), /does not exist in this clinic/);
      const running = await requestIntakeForm(ctx, A, { templateId: ids.form_running, patientId: ids.megan }, STAFF);
      assert.equal(await cancelIntakeResponse(ctx, A, running.response.id, STAFF), true);
      const counts = await countResponsesByTemplate(ctx, A);
      assert.deepEqual(counts.get(ids.form_consent), { requested: 2, submitted: 2 }, "two other new patients have not answered theirs yet");
      // A ciphertext moved to another copy no longer decrypts (AAD = clinic, table.column, row id).
      const open = await requestIntakeForm(ctx, A, { templateId: ids.form_running, patientId: ids.ellie }, STAFF);
      await ctx.db.updateTable("pms_intake_responses").set({ answers_enc: raw.answers_enc }).where("tenant_id", "=", A).where("id", "=", open.response.id).execute();
      await assert.rejects(getIntakeResponse(ctx, A, open.response.id), /Decryption failed/);
      await ctx.db.updateTable("pms_intake_responses").set({ answers_enc: null }).where("tenant_id", "=", A).where("id", "=", open.response.id).execute();
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
      assert.equal((await listSharesForPatient(ctx, A, ids.megan)).length, 0);
      assert.equal((await listSharesForPatient(ctx, A, ids.megan, { includeWithdrawn: true })).length, 1);
    });

    it("every write was audited under its own clinic – ids and counts only", async () => {
      const a = await listAudit(ctx, A, { limit: 500 });
      const codes = new Set(a.map((e) => e.action));
      for (const code of [
        "pms.booking_settings.update",
        "pms.booking_hours.create",
        "pms.booking_hours.remove",
        "pms.online_booking.create",
        "pms.online_booking.rebook",
        "pms.online_booking.cancel",
        "pms.online_booking.review",
        "pms.portal_account.create",
        "pms.portal_account.status",
        "pms.portal_link.create",
        "pms.portal_session.create",
        "pms.portal_session.end",
        "pms.portal_message.queue",
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
      ]) {
        assert.ok(codes.has(code), code);
      }
      const text = JSON.stringify(a);
      for (const secret of ["Ellie", "Sample", "megan.hart", "Sore knee", "Chin tucks", "07700", ids.ellieToken]) assert.ok(!text.includes(secret), secret);
      assert.ok((await listAudit(ctx, B, { limit: 500 })).every((e) => e.userId === STAFF_B.userId || e.userId === null));
    });

    it("offboarding: every portal row exported decrypted, then deleted in foreign-key order", async () => {
      const exported = await exportPmsData(ctx.db, ctx.cipher, A);
      assert.ok(exported.pms_online_bookings.length >= 6);
      assert.ok(exported.pms_intake_responses.some((r) => typeof r.answers === "string" && String(r.answers).includes("Sore knee")), "answers decrypted in the export");
      assert.ok(exported.pms_portal_messages.every((r) => !("body_enc" in r)));
      await runBatch(ctx.db, deletePmsQueries(ctx.db, B));
      assert.deepEqual(await countPmsRows(ctx.db, B), {});
      assert.ok((await countPmsRows(ctx.db, A)).pms_online_bookings >= 6, "clinic A untouched");
    });

    it("tenant-scope guard: every clinic-system statement named tenant_id", () => {
      if (!suite.log) return;
      assert.ok(suite.log.statements.length > 200, `recorded ${suite.log.statements.length} statements`);
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
