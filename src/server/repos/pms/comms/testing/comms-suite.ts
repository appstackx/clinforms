/**
 * TESTS ONLY: the comms module's repository suite – message settings, templates, reminder rules, planned
 * appointment messages, the send run (outbox and test providers), manual messages, replies, consent, letters –
 * run unchanged on node:sqlite and PGlite (../comms-repos.test.ts) and on D1 through the gateway
 * (workers/data-gateway/test/pms-comms-stack.test.ts). When the factory gives a query log, the suite ends with
 * the tenant-scope guard (every clinic-system statement names tenant_id).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../../../db/schema";
import { testCipher } from "../../../../db/testing/databases";
import { listAudit } from "../../../audit";
import { RepoInputError, type RepoContext } from "../../../context";
import { createCase } from "../../cases";
import { createPractitioner, createService, createSite } from "../../directory";
import { setEntitlement } from "../../entitlements";
import { createPatient, getPatient } from "../../patients";
import { createReferrer } from "../../referrers";
import { unscopedStatements, type QueryLog } from "../../testing/guarded-db";
import { changeConsent, listConsentEvents } from "../consent";
import { getMessagingContacts } from "../contacts";
import { createLetterTemplate, finaliseLetter, getLetter, listLetters, markLetterSent, updateLetter, voidLetter } from "../letters";
import { appointmentReplyStates, getMessage, listMessages, markReplyDone, messageCounts, recordDeliveryReceipt } from "../messages";
import { createReminderRule, listReminderRules, updateReminderRule } from "../rules";
import { claimDueMessages, countDueMessages, listSchedule, listScheduleForAppointment, listUpcomingMessages, scheduleCounts, syncAppointmentMessages } from "../schedule";
import { getCommsSettings, updateCommsSettings } from "../settings";
import { copyStandardTemplate, createMessageTemplate, getMessageTemplate, listMessageTemplates, resolveTemplate, updateMessageTemplate } from "../templates";
import { retryMessage, runDueMessages, sendDocumentMessage, sendPatientMessage, type DispatchDeps } from "../../../../pms/comms/dispatch";
import { startLetter } from "../../../../pms/comms/letters";
import { verifyStopToken } from "../../../../pms/comms/links";
import { outboxEmail, outboxSms } from "../../../../pms/comms/providers/outbox";
import { clearTestOutbox, testEmail, testOutbox, testSms } from "../../../../pms/comms/providers/test";
import { recordInboundSms } from "../../../../pms/comms/replies";

export interface CommsSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-a";
const B = "harbour-b";
const STAFF = { userId: "user_reception_01", sessionId: "sess_01" };
const STAFF_B = { userId: "user_other_clinic", sessionId: "sess_b" };
const LINK_SECRET = "comms-suite-link-secret-".padEnd(43, "x");

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(promise, (err: unknown) => err instanceof RepoInputError && pattern.test(err.message));
}

export function defineCommsRepoSuite(label: string, factory: () => Promise<CommsSuiteDb>): void {
  describe(`comms repositories on ${label}`, () => {
    let suite: CommsSuiteDb;
    let ctx: RepoContext;
    // Saturday 24 October 2026, 09:00 UTC (10:00 BST) – the clocks go back tomorrow.
    let clock = Date.parse("2026-10-24T09:00:00.000Z");
    const at = (iso: string) => {
      clock = Date.parse(iso);
    };
    const ids: Record<string, string> = {};
    const outbox: DispatchDeps = { providers: { sms: outboxSms, email: outboxEmail }, linkSecret: LINK_SECRET, linkOrigin: "https://clinic.example.com" };
    const test: DispatchDeps = { providers: { sms: testSms, email: testEmail }, linkSecret: LINK_SECRET, linkOrigin: "https://clinic.example.com" };

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => new Date(clock) };
      for (const [t, who] of [
        [A, STAFF],
        [B, STAFF_B],
      ] as const) {
        await setEntitlement(ctx, t, "clinic", { status: "trial" }, who);
      }
      const site = await createSite(ctx, A, { name: "Bletchley (fictional)", phone: "01632 960101", address: ["2 Station Parade (fictional)", "Bletchley"], postcode: "MK2 9ZZ" }, STAFF);
      const prac = await createPractitioner(ctx, A, { displayName: "Sarah Reid", registrationNumber: "PH-DEMO-01", defaultSiteId: site.id }, STAFF);
      const fu = await createService(ctx, A, { name: "Follow-up", durationMinutes: 30 }, STAFF);
      const pil = await createService(ctx, A, { name: "Clinical Pilates class", category: "class", durationMinutes: 60 }, STAFF);
      Object.assign(ids, { site: site.id, prac: prac.id, fu: fu.id, pil: pil.id });
      const megan = await createPatient(
        ctx,
        A,
        {
          title: "Ms",
          firstName: "Megan",
          lastName: "Hart",
          preferredName: "Meg",
          dateOfBirth: "1991-11-22",
          phoneMobile: "07700 900123",
          email: "megan.hart@example.com",
          gpName: "Dr Ellen Ward (fictional)",
          gpPractice: "Bletchley Medical Centre (fictional)",
          importRef: "sim-pat-001",
        },
        STAFF,
      );
      const daniel = await createPatient(ctx, A, { firstName: "Daniel", lastName: "Brooks", phoneMobile: "07700 900456", reminderSms: false, email: "daniel.brooks@example.com" }, STAFF);
      const landline = await createPatient(ctx, A, { firstName: "Leo", lastName: "Landline (fictional)", phoneHome: "01632 960444" }, STAFF);
      const failing = await createPatient(ctx, A, { firstName: "Fay", lastName: "Failing (fictional)", phoneMobile: "07700 900999" }, STAFF);
      const other = await createPatient(ctx, B, { firstName: "Olive", lastName: "Other (fictional)", phoneMobile: "07700 900777" }, STAFF_B);
      Object.assign(ids, { megan: megan.id, daniel: daniel.id, landline: landline.id, failing: failing.id, other: other.id });
      const sol = await createReferrer(ctx, A, { kind: "solicitor", name: "Harrow & Pike Solicitors (fictional)", contactName: "Amelia Grant", address: ["3 Silbury Arcade (fictional)"], postcode: "MK9 0ZZ" }, STAFF);
      ids.sol = sol.id;
      const c = await createCase(ctx, A, { patientId: megan.id, title: "Neck pain after a road traffic accident", openedOn: "2026-03-18", practitionerId: prac.id, siteId: site.id, payerType: "solicitor", payerReferrerId: sol.id, claimReference: "HP/2291" }, STAFF);
      ids.case = c.id;
      const dc = await createCase(ctx, A, { patientId: daniel.id, title: "Lower back", openedOn: "2026-10-01" }, STAFF);
      ids.danielCase = dc.id;
    });
    after(async () => {
      await suite?.close();
    });

    it("settings: defaults until saved, then revision-checked", async () => {
      const s0 = await getCommsSettings(ctx, A);
      assert.deepEqual([s0.rev, s0.confirmationsSms, s0.quietStart, s0.quietEnd, s0.repliesEnabled], [0, true, "20:00", "08:00", true]);
      const r1 = await updateCommsSettings(ctx, A, 0, { smsSender: "RIVERSIDE", replyPhone: "01632 960100", replyEmail: "Hello@Riverside-Demo.example.com" }, STAFF);
      assert.deepEqual(r1.ok ? r1.rev : r1, 1);
      assert.deepEqual(await updateCommsSettings(ctx, A, 0, { smsSender: "STALE" }, STAFF), { ok: false, reason: "conflict", currentRev: 1 });
      const s1 = await getCommsSettings(ctx, A);
      assert.deepEqual([s1.smsSender, s1.replyEmail], ["RIVERSIDE", "hello@riverside-demo.example.com"]);
      assert.equal((await getCommsSettings(ctx, B)).rev, 0, "another clinic keeps its defaults");
      await rejects(updateCommsSettings(ctx, A, 1, { smsSender: "12" }, STAFF), /letters/);
    });

    it("templates: standard ones until the clinic saves its own default; fields checked; one default per kind and channel", async () => {
      const std = await resolveTemplate(ctx, A, "reminder", "sms");
      assert.equal(std?.standard, true);
      const ours = await copyStandardTemplate(ctx, A, "sms-reminder", STAFF, "Reminder – Riverside");
      assert.equal(ours.isDefault, true);
      assert.equal((await resolveTemplate(ctx, A, "reminder", "sms"))?.id, ours.id);
      assert.equal((await resolveTemplate(ctx, B, "reminder", "sms"))?.standard, true, "another clinic still uses the standard one");
      const second = await createMessageTemplate(ctx, A, { kind: "reminder", channel: "sms", name: "Short reminder", body: "Hi {{patient.first_name}}, see you {{appointment.date}} {{appointment.time}}. {{reply.instructions}}", isDefault: true }, STAFF);
      assert.equal((await getMessageTemplate(ctx, A, ours.id))?.isDefault, false, "the flag moved");
      assert.equal((await resolveTemplate(ctx, A, "reminder", "sms"))?.id, second.id);
      const back = await updateMessageTemplate(ctx, A, ours.id, 1, { isDefault: true }, STAFF);
      assert.ok(back.ok);
      assert.equal((await getMessageTemplate(ctx, A, second.id))?.isDefault, false);
      assert.deepEqual(await updateMessageTemplate(ctx, A, ours.id, 1, { name: "Stale" }, STAFF), { ok: false, reason: "conflict", currentRev: 2 });
      await rejects(createMessageTemplate(ctx, A, { kind: "reminder", channel: "sms", name: "Clinical", body: "About your {{case.title}}" }, STAFF), /cannot be used in an appointment message/);
      await rejects(createMessageTemplate(ctx, A, { kind: "general", channel: "email", name: "No subject", body: "Hi" }, STAFF), /subject/);
      await rejects(updateMessageTemplate(ctx, A, ours.id, 2, { body: "{{unsubscribe.link}}" }, STAFF), /only be used in emails/);
      await rejects(updateMessageTemplate(ctx, A, "standard:sms-reminder", 1, { name: "x" }, STAFF), /Standard templates/);
      assert.equal(await getMessageTemplate(ctx, B, ours.id), null, "another clinic cannot read it");
      assert.deepEqual(await updateMessageTemplate(ctx, B, ours.id, 2, { name: "x" }, STAFF_B), { ok: false, reason: "not_found" });
      const general = await createMessageTemplate(ctx, A, { kind: "general", channel: "sms", name: "Running late", body: "Hi {{patient.first_name}}, {{clinic.name}} is running about 15 minutes late today. Sorry!" }, STAFF);
      ids.generalSms = general.id;
      ids.reminderTemplate = ours.id;
      const list = await listMessageTemplates(ctx, A);
      assert.ok(list.some((t) => t.id === "standard:sms-reminder" && !t.isDefault), "the standard reminder is listed, no longer the default");
      assert.ok(list.some((t) => t.id === "standard:email-reminder" && t.isDefault));
      // Switching the default off: the standard template is used again.
      const off = await updateMessageTemplate(ctx, A, ours.id, 2, { active: false }, STAFF);
      assert.ok(off.ok);
      assert.equal((await resolveTemplate(ctx, A, "reminder", "sms"))?.standard, true);
      const on = await updateMessageTemplate(ctx, A, ours.id, 3, { active: true, isDefault: true }, STAFF);
      assert.ok(on.ok);
    });

    it("reminder rules: timing, quiet hours, the clinic's own templates and appointment types only", async () => {
      const sms = await createReminderRule(ctx, A, { name: "Text the day before", channel: "sms", timing: "days_before", daysBefore: 1, sendAt: "10:00", templateId: ids.reminderTemplate }, STAFF);
      ids.smsRule = sms.id;
      await rejects(createReminderRule(ctx, A, { name: "Night", channel: "sms", timing: "days_before", daysBefore: 1, sendAt: "22:30" }, STAFF), /quiet hours/);
      await rejects(createReminderRule(ctx, A, { name: "Wrong template", channel: "email", timing: "hours_before", hoursBefore: 24, templateId: ids.reminderTemplate }, STAFF), /reminder templates for emails/);
      await rejects(createReminderRule(ctx, B, { name: "Cross", channel: "sms", timing: "hours_before", hoursBefore: 2, serviceIds: [ids.fu] }, STAFF_B), /appointment type does not exist/);
      await rejects(createReminderRule(ctx, A, { name: "Text the day before", channel: "sms", timing: "hours_before", hoursBefore: 3 }, STAFF), /already exists/);
      const email = await createReminderRule(ctx, A, { name: "Email two days before", channel: "email", timing: "hours_before", hoursBefore: 48, serviceIds: [ids.fu] }, STAFF);
      ids.emailRule = email.id;
      const r = await updateReminderRule(ctx, A, email.id, 1, { hoursBefore: 50 }, STAFF);
      assert.ok(r.ok);
      await rejects(updateReminderRule(ctx, A, email.id, 2, { timing: "days_before" }, STAFF), /days before/);
      assert.deepEqual((await listReminderRules(ctx, A)).map((x) => x.name), ["Email two days before", "Text the day before"]);
      assert.equal((await listReminderRules(ctx, B)).length, 0);
    });

    it("planning: a booking plans the confirmation and each rule's reminder; idempotent; a move re-plans; a cancel cancels", async () => {
      const appt = { id: "appt_megan_1", patientId: ids.megan, startsAt: "2026-10-28T14:30:00.000Z", endsAt: "2026-10-28T15:00:00.000Z", siteId: ids.site, practitionerId: ids.prac, serviceId: ids.fu, active: true };
      const first = await syncAppointmentMessages(ctx, A, appt, STAFF, { notify: "confirmation" });
      assert.deepEqual(first, { planned: 4, cancelled: 0, kept: 0 });
      const rows = await listScheduleForAppointment(ctx, A, appt.id);
      assert.deepEqual(
        rows.map((r) => [r.kind, r.channel, r.dueAt]),
        [
          ["confirmation", "sms", "2026-10-24T09:00:00.000Z"],
          ["confirmation", "email", "2026-10-24T09:00:00.000Z"],
          ["reminder", "email", "2026-10-26T12:30:00.000Z"],
          ["reminder", "sms", "2026-10-27T10:00:00.000Z"],
        ],
      );
      assert.deepEqual(await syncAppointmentMessages(ctx, A, appt, STAFF, { notify: "confirmation" }), { planned: 0, cancelled: 0, kept: 4 }, "idempotent");
      const moved = await syncAppointmentMessages(ctx, A, { ...appt, startsAt: "2026-10-29T09:00:00.000Z", endsAt: "2026-10-29T09:30:00.000Z" }, STAFF, { notify: "moved" });
      assert.deepEqual(moved, { planned: 4, cancelled: 4, kept: 0 }, "the old confirmation and reminders go, the moved notices and new reminders come");
      const back = await syncAppointmentMessages(ctx, A, appt, STAFF, { notify: "none" });
      assert.equal(back.planned, 2, "moved back: the earlier reminders are planned again");
      const cancelled = await syncAppointmentMessages(ctx, A, { ...appt, active: false }, STAFF, { notify: "cancelled" });
      assert.equal(cancelled.planned, 2, "a cancellation notice by text and email");
      const after = await listScheduleForAppointment(ctx, A, appt.id);
      assert.deepEqual(after.filter((r) => r.status === "pending").map((r) => r.kind).sort(), ["cancelled", "cancelled"]);
      assert.ok(after.filter((r) => r.kind === "reminder").every((r) => r.status === "cancelled"));
      assert.ok(after.filter((r) => r.kind === "reminder" && r.startsAt === appt.startsAt).every((r) => r.skipReason === "appointment_cancelled"));
      // The class appointment gets only the text reminder (the email rule is for follow-ups).
      await syncAppointmentMessages(ctx, A, { ...appt, id: "appt_megan_2", serviceId: ids.pil, startsAt: "2026-10-30T18:00:00.000Z", endsAt: null }, STAFF, { notify: "none" });
      assert.deepEqual((await listScheduleForAppointment(ctx, A, "appt_megan_2")).map((r) => [r.kind, r.channel]), [["reminder", "sms"]]);
      await rejects(syncAppointmentMessages(ctx, B, { ...appt, id: "appt_cross" }, STAFF_B, { notify: "confirmation" }), /does not exist in this clinic/);
      assert.equal((await listScheduleForAppointment(ctx, B, appt.id)).length, 0, "another clinic sees none of it");
      await rejects(syncAppointmentMessages(ctx, A, { ...appt, startsAt: "28/10/2026 14:30" }, STAFF), /time zone/);
    });

    it("the send run (outbox): writes due messages, encrypted, never sends; respects consent; skips what is too late", async () => {
      // A new booking for Megan tomorrow afternoon, Daniel (texts off) and a landline-only patient.
      await syncAppointmentMessages(ctx, A, { id: "appt_megan_3", patientId: ids.megan, startsAt: "2026-10-25T15:00:00.000Z", endsAt: "2026-10-25T15:30:00.000Z", siteId: ids.site, practitionerId: ids.prac, serviceId: ids.fu, active: true }, STAFF, { notify: "confirmation" });
      await syncAppointmentMessages(ctx, A, { id: "appt_daniel_1", patientId: ids.daniel, startsAt: "2026-10-27T11:00:00.000Z", siteId: ids.site, practitionerId: ids.prac, serviceId: ids.fu, active: true }, STAFF, { notify: "confirmation" });
      await syncAppointmentMessages(ctx, A, { id: "appt_leo_1", patientId: ids.landline, startsAt: "2026-10-27T12:00:00.000Z", siteId: ids.site, serviceId: ids.fu, active: true }, STAFF, { notify: "confirmation" });
      assert.ok((await countDueMessages(ctx, A, new Date(clock).toISOString())) >= 6);
      const run = await runDueMessages(ctx, A, outbox);
      assert.equal(run.sent, 0, "the outbox sends nothing");
      assert.ok(run.outbox >= 4, `outbox ${run.outbox}`);
      assert.equal(run.reasons.opted_out, 1, "Daniel's text: he said no to texts");
      assert.equal(run.reasons.no_mobile, 1, "Leo has no mobile");
      assert.equal(run.reasons.no_email, 1, "Leo has no email either");
      const log = await listMessages(ctx, A, { patientId: ids.megan });
      const sms = log.find((m) => m.appointmentId === "appt_megan_3" && m.channel === "sms");
      assert.ok(sms && sms.status === "outbox" && sms.provider === "outbox" && sms.kind === "confirmation");
      assert.equal(sms?.toAddress, "07700 900123");
      const full = await getMessage(ctx, A, sms!.id);
      assert.match(full?.body ?? "", /^RIVERSIDE: you're booked for Sun 25\/10 at 15:00 with Sarah Reid, Bletchley \(fictional\)\. To change it call 01632 960101\. STOP to opt out$/);
      const raw = await ctx.db.selectFrom("pms_messages").select(["body_enc", "subject_enc"]).where("tenant_id", "=", A).where("id", "=", sms!.id).executeTakeFirstOrThrow();
      assert.ok(!String(raw.body_enc).includes("Bletchley") && String(raw.body_enc).startsWith("v1."), "encrypted at rest");
      const email = log.find((m) => m.appointmentId === "appt_megan_3" && m.channel === "email");
      const fullEmail = await getMessage(ctx, A, email!.id);
      assert.equal(fullEmail?.subject, "Booked: Sun 25/10 at 15:00");
      const stop = /Stop reminder emails \(booking confirmations will still be sent\): (\S+)/.exec(fullEmail?.body ?? "")?.[1];
      const token = stop ? new URL(stop).searchParams.get("t") : null;
      assert.deepEqual(verifyStopToken(token, LINK_SECRET, clock), { tenantId: A, patientId: ids.megan, channel: "email", purpose: "service", exp: verifyStopToken(token, LINK_SECRET, clock)?.exp });
      // A ciphertext moved to another message does not decrypt.
      const emailRaw = await ctx.db.selectFrom("pms_messages").select("body_enc").where("tenant_id", "=", A).where("id", "=", email!.id).executeTakeFirstOrThrow();
      await ctx.db.updateTable("pms_messages").set({ body_enc: raw.body_enc }).where("tenant_id", "=", A).where("id", "=", email!.id).execute();
      await assert.rejects(getMessage(ctx, A, email!.id), /Decryption failed/);
      await ctx.db.updateTable("pms_messages").set({ body_enc: emailRaw.body_enc }).where("tenant_id", "=", A).where("id", "=", email!.id).execute();
      assert.equal(await getMessage(ctx, B, sms!.id), null, "another clinic cannot read it");
      assert.equal((await listMessages(ctx, B)).length, 0);
      const schedule = await listScheduleForAppointment(ctx, A, "appt_megan_3");
      assert.equal(schedule.find((r) => r.kind === "confirmation" && r.channel === "sms")?.messageId, sms!.id);
      // Nothing due any more; Daniel's reminders are still to come. Then: run them too late.
      assert.equal((await runDueMessages(ctx, A, outbox)).claimed, 0);
      assert.deepEqual(
        (await listUpcomingMessages(ctx, A, { until: "2026-10-31T00:00:00.000Z" })).filter((r) => r.appointmentId === "appt_daniel_1").map((r) => [r.channel, r.dueAt]),
        [
          ["email", "2026-10-25T09:00:00.000Z"],
          ["sms", "2026-10-26T10:00:00.000Z"],
        ],
      );
      at("2026-10-27T10:45:00.000Z");
      const late = await runDueMessages(ctx, A, outbox);
      assert.equal(late.reasons.too_late, 2, "reminders 15 minutes before the start are too late");
      assert.equal(late.outbox, 0);
      at("2026-10-24T09:05:00.000Z");
    });

    it("claims: two runs never take the same row; a stale claim is released", async () => {
      await syncAppointmentMessages(ctx, A, { id: "appt_megan_4", patientId: ids.megan, startsAt: "2026-11-02T10:00:00.000Z", siteId: ids.site, active: true }, STAFF, { notify: "confirmation" });
      const one = await claimDueMessages(ctx, A, "tok_one", 90);
      const two = await claimDueMessages(ctx, A, "tok_two", 90);
      assert.ok(one.length >= 2);
      assert.equal(two.length, 0, "already claimed");
      at("2026-10-24T09:20:00.000Z");
      const three = await claimDueMessages(ctx, A, "tok_three", 90);
      assert.deepEqual(three.map((r) => r.id).sort(), one.map((r) => r.id).sort(), "released after 10 minutes and claimed again");
      assert.ok(three.every((r) => r.attempts === 2));
      // Leave them for the next run.
      at("2026-10-24T09:35:00.000Z");
      await runDueMessages(ctx, A, outbox);
    });

    it("the test provider: accepted messages get provider ids; numbers ending 999 fail; receipts update the log", async () => {
      clearTestOutbox();
      await syncAppointmentMessages(ctx, A, { id: "appt_fay_1", patientId: ids.failing, startsAt: "2026-11-03T10:00:00.000Z", siteId: ids.site, active: true }, STAFF, { notify: "confirmation" });
      await syncAppointmentMessages(ctx, A, { id: "appt_megan_5", patientId: ids.megan, startsAt: "2026-11-04T10:00:00.000Z", siteId: ids.site, practitionerId: ids.prac, active: true }, STAFF, { notify: "confirmation" });
      const run = await runDueMessages(ctx, A, test);
      assert.equal(run.failed, 1, "Fay's number fails");
      assert.equal(run.sent, 2, "Megan's text and email");
      assert.equal(testOutbox.sms.length, 1);
      assert.equal(testOutbox.sms[0].to, "+447700900123");
      assert.equal(testOutbox.sms[0].from, "RIVERSIDE");
      assert.equal(testOutbox.email[0].headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
      assert.match(testOutbox.email[0].html, /<a href="https:\/\/clinic\.example\.com\/api\/clinic-messages\/unsubscribe\?t=/);
      const sent = (await listMessages(ctx, A, { appointmentId: "appt_megan_5" })).find((m) => m.channel === "sms");
      assert.equal(sent?.status, "sent");
      const fail = (await listMessages(ctx, A, { patientId: ids.failing }))[0];
      assert.deepEqual([fail.status, fail.errorCode], ["failed", "test_undeliverable"]);
      const providerId = (await getMessage(ctx, A, sent!.id))?.providerMessageId as string;
      assert.match(providerId, /^test_/);
      assert.equal(await recordDeliveryReceipt(ctx, A, "test", { providerMessageId: providerId, status: "delivered" }, { userId: null, sessionId: null }), true);
      assert.equal((await getMessage(ctx, A, sent!.id))?.status, "delivered");
      assert.equal(await recordDeliveryReceipt(ctx, B, "test", { providerMessageId: providerId, status: "failed" }, { userId: null, sessionId: null }), false, "another clinic cannot touch it");
      ids.reminderSms = sent!.id;
    });

    it("messages staff write: general by default, marketing only with an opt-in and a stop route", async () => {
      clearTestOutbox();
      const general = await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", templateId: ids.generalSms, body: "Hi {{patient.first_name}}, {{clinic.name}} is running about 15 minutes late today." }, STAFF, outbox);
      assert.ok(general.ok && general.status === "outbox");
      assert.equal((await getMessage(ctx, A, general.ok ? general.messageId : ""))?.body, "Hi Meg, riverside-a is running about 15 minutes late today.");
      const refused = await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", purpose: "marketing", body: "Spring offer" }, STAFF, outbox);
      assert.deepEqual(refused, { ok: false, reason: "no_marketing_consent", message: "no_marketing_consent" });
      assert.deepEqual(await sendPatientMessage(ctx, A, { patientId: ids.daniel, channel: "sms", body: "Hello" }, STAFF, outbox), { ok: false, reason: "opted_out", message: "opted_out" });
      assert.equal((await sendPatientMessage(ctx, B, { patientId: ids.megan, channel: "sms", body: "x" }, STAFF_B, outbox)).ok, false, "another clinic's patient does not exist here");
      await rejects(changeConsent(ctx, A, { patientId: ids.megan, channel: "sms", purpose: "marketing", value: true, source: "staff" }, STAFF), /how the patient agreed/);
      assert.deepEqual(await changeConsent(ctx, A, { patientId: ids.megan, channel: "sms", purpose: "marketing", value: true, source: "staff", marketingConsentSource: "written" }, STAFF), { changed: true, cancelled: 0 });
      assert.deepEqual(await changeConsent(ctx, A, { patientId: ids.megan, channel: "sms", purpose: "marketing", value: true, source: "staff", marketingConsentSource: "written" }, STAFF), { changed: false, cancelled: 0 });
      const marketing = await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", purpose: "marketing", body: "Spring offer: 10% off sports massage at {{clinic.name}}." }, STAFF, test);
      assert.ok(marketing.ok && marketing.status === "sent");
      assert.match(testOutbox.sms[0].body, /STOP to opt out$/, "the stop route is added");
      await rejects(sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", body: "See you {{appointment.date}}" }, STAFF, outbox), /cannot be used in a general message/);
      assert.equal((await sendPatientMessage(ctx, A, { patientId: ids.megan, channel: "sms", templateId: "standard:sms-reminder", body: "x" }, STAFF, outbox)).ok, false, "only general templates");
      const patient = await getPatient(ctx, A, ids.megan);
      assert.equal(patient?.marketingConsentSource, "written");
    });

    it("replies: YES confirms, NO and the unclear go to a person, STOP switches texts off; stored once", async () => {
      at("2026-10-24T10:00:00.000Z");
      // The latest text to Megan: the confirmation of a new booking.
      await syncAppointmentMessages(ctx, A, { id: "appt_megan_7", patientId: ids.megan, startsAt: "2026-11-12T10:00:00.000Z", siteId: ids.site, active: true }, STAFF, { notify: "confirmation" });
      await runDueMessages(ctx, A, outbox);
      at("2026-10-24T10:05:00.000Z");
      const yes = await recordInboundSms(ctx, A, { from: "+447700900123", text: "Yes please", providerMessageId: "in_1" }, "test");
      assert.deepEqual([yes.intent, yes.patientId, yes.appointmentId, yes.needsAction, yes.duplicate], ["confirm", ids.megan, "appt_megan_7", false, false]);
      const again = await recordInboundSms(ctx, A, { from: "+447700900123", text: "Yes please", providerMessageId: "in_1" }, "test");
      assert.deepEqual([again.duplicate, again.messageId], [true, yes.messageId], "a webhook delivered twice is stored once");
      const states = await appointmentReplyStates(ctx, A, ["appt_megan_7", "appt_megan_1"]);
      assert.equal(states.get("appt_megan_7")?.intent, "confirm");
      assert.equal(states.has("appt_megan_1"), false);
      assert.equal((await appointmentReplyStates(ctx, B, ["appt_megan_7"])).size, 0);
      // "Can I…" is unclear: a person reads it.
      const unclear = await recordInboundSms(ctx, A, { from: "07700 900123", text: "Can I come at 3 instead?" }, "test");
      assert.deepEqual([unclear.intent, unclear.needsAction], ["unknown", true]);
      const stranger = await recordInboundSms(ctx, A, { from: "07700 900321", text: "Who is this?" }, "test");
      assert.deepEqual([stranger.patientId, stranger.needsAction], [null, true], "an unknown number is kept for a person");
      const no = await recordInboundSms(ctx, A, { from: "07700 900123", text: "NO", inReplyToId: ids.reminderSms }, "simulated");
      assert.deepEqual([no.intent, no.needsAction, no.appointmentId], ["cancel", true, "appt_megan_5"]);
      await rejects(recordInboundSms(ctx, A, { from: "07700 900888", text: "NO", inReplyToId: ids.reminderSms }, "simulated"), /does not match/);
      await rejects(recordInboundSms(ctx, B, { from: "07700 900123", text: "NO", inReplyToId: ids.reminderSms }, "simulated"), /not a text the clinic sent/);
      assert.equal((await messageCounts(ctx, A)).toAction, 3);
      assert.equal(await markReplyDone(ctx, A, no.messageId, STAFF), true);
      assert.equal(await markReplyDone(ctx, A, no.messageId, STAFF), false, "only once");
      assert.equal(await markReplyDone(ctx, B, unclear.messageId, STAFF_B), false);
      const reply = await getMessage(ctx, A, no.messageId);
      assert.deepEqual([reply?.body, reply?.actionStatus, reply?.actionedBy, reply?.inReplyToId], ["NO", "done", STAFF.userId, ids.reminderSms]);
      // STOP: texts off (appointment and marketing), planned texts cancelled, the evidence kept.
      await syncAppointmentMessages(ctx, A, { id: "appt_megan_6", patientId: ids.megan, startsAt: "2026-11-10T10:00:00.000Z", siteId: ids.site, active: true }, STAFF, { notify: "none" });
      const stop = await recordInboundSms(ctx, A, { from: "07700 900123", text: "STOP" }, "test");
      assert.deepEqual([stop.intent, stop.needsAction], ["stop", false]);
      const contact = (await getMessagingContacts(ctx, A, [ids.megan])).get(ids.megan);
      assert.deepEqual([contact?.reminderSms, contact?.marketingSms, contact?.reminderEmail], [false, false, true]);
      assert.ok((await listScheduleForAppointment(ctx, A, "appt_megan_6")).every((r) => r.channel !== "sms" || (r.status === "cancelled" && r.skipReason === "opted_out")));
      const events = await listConsentEvents(ctx, A, ids.megan);
      assert.deepEqual(events.slice(0, 2).map((e) => [e.channel, e.purpose, e.action, e.source, e.messageId]), [
        ["sms", "marketing", "opt_out", "sms_reply", stop.messageId],
        ["sms", "service", "opt_out", "sms_reply", stop.messageId],
      ]);
      assert.equal((await listConsentEvents(ctx, B, ids.megan)).length, 0);
      // Staff switch texts back on when the patient asks.
      assert.equal((await changeConsent(ctx, A, { patientId: ids.megan, channel: "sms", purpose: "service", value: true, source: "staff" }, STAFF)).changed, true);
    });

    it("letters: merged from a template with visible gaps; finalised only when complete; locked after; withdrawn, never deleted", async () => {
      const lt = await createLetterTemplate(ctx, A, { name: "Update to the solicitor", recipientKind: "referrer", subject: "{{patient.full_name}} – {{case.claim_reference}}", body: "Dear {{recipient.name}},\n\n[[Progress]]\n\n{{author.name}}\n{{author.registration}}" }, STAFF);
      await rejects(createLetterTemplate(ctx, A, { name: "Bad", recipientKind: "gp", subject: "x", body: "{{appointment.date}}" }, STAFF), /cannot be used in a letter/);
      const gp = await startLetter(ctx, A, { patientId: ids.megan, templateId: "standard:gp-assessment", caseId: ids.case }, STAFF, "Riverside Physiotherapy (fictional)");
      assert.equal(gp.recipientKind, "gp");
      assert.equal(gp.recipientName, "Dr Ellen Ward (fictional)");
      assert.equal(gp.templateId, null, "standard templates are not rows");
      assert.match(gp.body, /^Dear Dr Ellen Ward \(fictional\),/);
      assert.match(gp.body, /for Neck pain after a road traffic accident\./);
      assert.match(gp.body, /Yours sincerely,$/, "the signature is added when the letter is signed");
      assert.equal(gp.subject, "Ms Megan Hart, date of birth 22/11/1991");
      assert.deepEqual(await finaliseLetter(ctx, A, gp.id, gp.rev, STAFF), { ok: false, reason: "unfilled" });
      const filled = gp.body.replace(/\[\[[^\]]*\]\]/g, "Completed by the physiotherapist (fictional).");
      const saved = await updateLetter(ctx, A, gp.id, 1, { body: filled }, STAFF);
      assert.ok(saved.ok);
      assert.deepEqual(await updateLetter(ctx, A, gp.id, 1, { body: "stale" }, STAFF), { ok: false, reason: "conflict", currentRev: 2 });
      assert.deepEqual(await finaliseLetter(ctx, A, gp.id, 2, STAFF), { ok: true });
      assert.deepEqual(await updateLetter(ctx, A, gp.id, 3, { body: "changed after" }, STAFF), { ok: false, reason: "locked" });
      assert.deepEqual(await markLetterSent(ctx, A, gp.id, "post", STAFF), { ok: true });
      assert.deepEqual(await markLetterSent(ctx, A, gp.id, "email", STAFF), { ok: false, reason: "locked" }, "once");
      const raw = await ctx.db.selectFrom("pms_letters").select(["body_enc", "subject_enc"]).where("tenant_id", "=", A).where("id", "=", gp.id).executeTakeFirstOrThrow();
      assert.ok(!String(raw.body_enc).includes("Ward") && !String(raw.subject_enc).includes("Megan"));
      assert.equal(await getLetter(ctx, B, gp.id), null);
      const sol = await startLetter(ctx, A, { patientId: ids.megan, templateId: lt.id, caseId: ids.case, practitionerId: ids.prac }, STAFF);
      assert.equal(sol.recipientName, "Amelia Grant, Harrow & Pike Solicitors (fictional)");
      assert.equal(sol.subject, "Ms Megan Hart – HP/2291");
      assert.equal(sol.templateId, lt.id);
      const noGp = await startLetter(ctx, A, { patientId: ids.daniel, templateId: "standard:gp-discharge", caseId: ids.danielCase }, STAFF);
      assert.match(noGp.body, /^Dear \[not recorded: Recipient for "Dear …"[^\]]*\],/, "a gap the author sees");
      await rejects(startLetter(ctx, A, { patientId: ids.daniel, templateId: "standard:gp-discharge", caseId: ids.case }, STAFF), /not one of this patient's cases/);
      await rejects(startLetter(ctx, B, { patientId: ids.megan, templateId: "standard:gp-discharge" }, STAFF_B), /does not exist in this clinic/);
      assert.deepEqual(await voidLetter(ctx, A, noGp.id, STAFF), { ok: true });
      assert.deepEqual(await voidLetter(ctx, A, noGp.id, STAFF), { ok: false, reason: "locked" });
      assert.equal((await getLetter(ctx, A, noGp.id))?.status, "void", "kept, marked withdrawn");
      assert.deepEqual((await listLetters(ctx, A, { patientId: ids.megan })).map((l) => l.status), ["draft", "final"]);
      assert.equal((await listLetters(ctx, A, { status: "void" })).length, 1);
      assert.equal((await listLetters(ctx, B)).length, 0);
      // The database refuses a letter whose case belongs to another patient.
      await assert.rejects(
        ctx.db
          .insertInto("pms_letters")
          .values({ tenant_id: A, id: "ltr_mismatch", rev: 1, patient_id: ids.daniel, case_id: ids.case, recipient_kind: "gp", letter_on: "2026-10-24", subject_enc: "x", body_enc: "x", status: "draft", created_at: new Date(clock).toISOString(), updated_at: new Date(clock).toISOString() })
          .execute(),
      );
    });

    it("M6: retry of a failed message, documents to a third party, the STOP confirmation, held texts, site scope", async () => {
      // Retry: Fay's number fails every time with the test service; each retry counts an attempt, at most 5.
      clearTestOutbox();
      const failed = (await listMessages(ctx, A, { patientId: ids.failing, status: "failed" }))[0];
      assert.ok(failed, "Fay's failed text from the test-provider run");
      const again = await retryMessage(ctx, A, failed.id, STAFF, test);
      assert.ok(again.ok && again.status === "failed");
      assert.equal((await getMessage(ctx, A, failed.id))?.attempts, 2);
      assert.equal((await retryMessage(ctx, A, failed.id, STAFF, outbox)).ok, true, "requeued again (outbox keeps the answer of the test run)");
      const sentOk = (await listMessages(ctx, A, { patientId: ids.megan, status: "sent" }))[0];
      assert.equal((await retryMessage(ctx, A, sentOk.id, STAFF, test)).ok, false, "only failed messages are retried");
      // A letter's email to the GP (someone else's address, no stop link), linked to the letter.
      const doc = await sendDocumentMessage(
        ctx,
        A,
        { kind: "letter", channel: "email", patientId: ids.megan, to: { kind: "other", address: "gp.ward@example.com" }, values: { "document.title": "Discharge", "document.body": "Dear Dr Ward,\nAll well.", "recipient.name": "Dr Ward" }, documentType: "letter", documentId: "ltr_test" },
        STAFF,
        test,
      );
      assert.ok(doc.ok && doc.status === "sent");
      const mail = testOutbox.email.at(-1);
      assert.equal(mail?.to, "gp.ward@example.com");
      assert.equal(mail?.headers["List-Unsubscribe"], undefined, "no stop link on a letter");
      assert.match(mail?.text ?? "", /Dear Dr Ward,\nAll well\./);
      assert.equal((await listMessages(ctx, A, { documentType: "letter", documentId: "ltr_test" })).length, 1);
      assert.equal((await sendDocumentMessage(ctx, A, { kind: "invoice", channel: "email", patientId: ids.megan, to: { kind: "other", address: "not an address" }, values: {}, documentType: "invoice", documentId: null }, STAFF, test)).ok, false);
      // An invoice email to a patient who stopped reminder emails still goes (it is their own account).
      await changeConsent(ctx, A, { patientId: ids.daniel, channel: "email", purpose: "service", value: false, source: "email_link" }, STAFF);
      const inv = await sendDocumentMessage(ctx, A, { kind: "invoice", channel: "email", patientId: ids.daniel, to: { kind: "patient" }, values: { "billing.number": "INV00001", "billing.amount": "£55.00" }, documentType: "invoice", documentId: "inv_test" }, STAFF, test);
      assert.ok(inv.ok, "transactional email after the stop link");
      assert.equal((await sendPatientMessage(ctx, A, { patientId: ids.daniel, channel: "email", subject: "Hello", body: "A note" }, STAFF, test)).ok, false, "general emails stop");
      // STOP: texts off, one last text says so.
      clearTestOutbox();
      const stop = await recordInboundSms(ctx, A, { from: "+447700900123", text: "STOP", providerMessageId: "test_stop_m6" }, "test", STAFF, test);
      assert.equal(stop.intent, "stop");
      assert.match(testOutbox.sms.at(-1)?.body ?? "", /^RIVERSIDE: you won't get more texts from us\. We'll email reminders instead\.$/);
      // Held: a text booked in the quiet hours is held (flag) until 08:00.
      at("2026-10-26T21:30:00.000Z");
      await syncAppointmentMessages(ctx, A, { id: "appt_daniel_m6", patientId: ids.daniel, startsAt: "2026-10-29T10:00:00.000Z", siteId: ids.site, active: true }, STAFF, { notify: "confirmation" });
      await changeConsent(ctx, A, { patientId: ids.landline, channel: "sms", purpose: "service", value: true, source: "staff" }, STAFF);
      const held = (await listScheduleForAppointment(ctx, A, "appt_daniel_m6")).filter((r) => r.channel === "sms");
      assert.deepEqual(held.map((r) => [r.kind, r.held, r.dueAt]), [
        ["confirmation", true, "2026-10-27T08:00:00.000Z"],
        ["reminder", false, "2026-10-28T10:00:00.000Z"],
      ]);
      const counts = await scheduleCounts(ctx, A, { from: "2026-10-27T00:00:00.000Z", until: "2026-10-28T00:00:00.000Z" });
      assert.ok(counts.held >= 1 && counts.planned >= counts.held);
      // Site scope: a member limited to another site sees none of these messages (no case or appointment there).
      assert.equal((await listMessages(ctx, A, { siteIds: new Set(["site_elsewhere"]) })).filter((m) => m.patientId === ids.megan).length, 0);
      assert.ok((await listMessages(ctx, A, { siteIds: new Set([ids.site]) })).some((m) => m.patientId === ids.megan));
      assert.ok((await listSchedule(ctx, A, { siteIds: new Set([ids.site]), statuses: ["pending"] })).length >= 0);
      // Moved before the confirmation went: the confirmation is re-planned for the new time, no "moved" notice.
      await syncAppointmentMessages(ctx, A, { id: "appt_megan_m6", patientId: ids.megan, startsAt: "2026-10-30T10:00:00.000Z", siteId: ids.site, active: true }, STAFF, { notify: "confirmation" });
      await syncAppointmentMessages(ctx, A, { id: "appt_megan_m6", patientId: ids.megan, startsAt: "2026-10-30T11:00:00.000Z", siteId: ids.site, active: true }, STAFF, { notify: "moved" });
      const moved = (await listScheduleForAppointment(ctx, A, "appt_megan_m6")).filter((r) => r.status === "pending");
      assert.ok(moved.length > 0 && moved.every((r) => r.kind !== "moved" && r.startsAt === "2026-10-30T11:00:00.000Z"), JSON.stringify(moved.map((r) => [r.kind, r.startsAt])));
      assert.ok(moved.some((r) => r.kind === "confirmation"));
      // Daniel used the stop-emails link (above): his booking confirmation email is still planned (transactional).
      const kinds = (await listScheduleForAppointment(ctx, A, "appt_daniel_m6")).filter((r) => r.channel === "email").map((r) => [r.kind, r.status]);
      assert.deepEqual(kinds.filter((k) => k[0] === "confirmation"), [["confirmation", "pending"]]);
      at("2026-10-24T09:05:00.000Z");
    });

    it("M6: letters are signed with the signer's line; changes and their audit rows are one batch", async () => {
      const t = await createLetterTemplate(ctx, A, { name: "Short note to the GP", recipientKind: "gp", subject: "{{patient.full_name}}", body: "Dear {{recipient.name}},\n\nSeen {{case.sessions}} times.\n\n{{author.name}}" }, STAFF);
      const l = await startLetter(ctx, A, { patientId: ids.megan, templateId: t.id, caseId: ids.case, practitionerId: ids.prac }, STAFF);
      const saved = await updateLetter(ctx, A, l.id, l.rev, { body: "Dear Dr Ward,\n\nAll well.\n\nSarah Reid" }, STAFF);
      assert.ok(saved.ok);
      const before = (await listAudit(ctx, A, { limit: 500 })).filter((e) => e.targetId === l.id).length;
      assert.deepEqual(await finaliseLetter(ctx, A, l.id, saved.ok ? saved.rev : 0, STAFF, "Sarah Reid, Physiotherapist · HCPC PH-DEMO-01"), { ok: true });
      const signed = await getLetter(ctx, A, l.id);
      assert.equal(signed?.signatureText, "Sarah Reid, Physiotherapist · HCPC PH-DEMO-01");
      assert.equal(signed?.status, "final");
      // A stale finalise changes nothing and writes no audit row.
      assert.deepEqual(await finaliseLetter(ctx, A, l.id, 1, STAFF, "x"), { ok: false, reason: "locked" });
      const after = (await listAudit(ctx, A, { limit: 500 })).filter((e) => e.targetId === l.id);
      assert.equal(after.length, before + 1);
      assert.deepEqual(await updateCommsSettings(ctx, A, 0, { quietStart: "21:00" }, STAFF), { ok: false, reason: "conflict", currentRev: (await getCommsSettings(ctx, A)).rev });
    });

    it("every write was audited under its own clinic, with ids and counts only", async () => {
      const a = await listAudit(ctx, A, { limit: 500 });
      const codes = new Set(a.map((e) => e.action));
      for (const code of [
        "pms.comms_settings.update",
        "pms.message_template.create",
        "pms.message_template.update",
        "pms.reminder_rule.create",
        "pms.reminder_rule.update",
        "pms.message_schedule.sync",
        "pms.message.bulk_send",
        "pms.message.status",
        "pms.message.send",
        "pms.message.receive",
        "pms.message.reply_done",
        "pms.consent.change",
        "pms.letter_template.create",
        "pms.letter.create",
        "pms.letter.update",
        "pms.letter.finalise",
        "pms.letter.sent",
        "pms.letter.void",
        "pms.message.retry",
        "pms.message_schedule.opt_out",
      ]) {
        assert.ok(codes.has(code), code);
      }
      const text = JSON.stringify(a);
      for (const secret of ["Megan", "Hart", "Meg,", "07700", "example.com", "running", "Spring", "Ward", "Neck pain", "STOP", "Yes please"]) assert.ok(!text.includes(secret), secret);
      const b = await listAudit(ctx, B, { limit: 500 });
      assert.ok(b.every((e) => e.userId === STAFF_B.userId || e.userId === null), "the other clinic's trail holds only its own writes");
    });

    it("tenant-scope guard: every clinic-system statement named tenant_id", () => {
      if (!suite.log) return;
      assert.ok(suite.log.statements.length > 150, `recorded ${suite.log.statements.length} statements`);
      assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
