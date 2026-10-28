/**
 * Demonstration messages and letters for the demo clinic (contract §9), after the diary, records and billing seeds:
 * message settings (text sender "Riverside", the clinic's reply number and email, quiet hours 20:00–08:00), two
 * reminders (a text 24 hours before, an email two days before at 10:00), the planned messages of the next week's
 * booked appointments, a little history (yesterday's and this morning's reminders – sent, the first of yesterday's texts failed), three replies (one asks to cancel, one a question – both waiting for an answer – and a YES), and two
 * letters for Megan Hart (a signed letter to her GP, a draft progress report).
 *
 * Everything goes through the comms repositories and server (audited, encrypted). The history is written with a
 * stand-in TEST provider defined here (it contacts nobody; one text "fails" so Retry can be shown). Refuses a clinic
 * not flagged as a demonstration clinic. Idempotent: a clinic that already has reminder rules is left as it is.
 *
 * Wiring (orchestrator, scripts/pms/seed-demo.ts – after seedBilling):
 *   await seedComms({ db, cipher: getDataCipher() }, slug, { log: (line) => console.log(`  ${line}`) });
 */
import { ukToday } from "../../src/modules/pms/core/text";
import { addDays, londonToUtcIso } from "../../src/modules/pms/comms/schedule";
import type { EmailProvider, SmsProvider } from "../../src/server/pms/comms/providers";
import { RepoInputError, type RepoContext } from "../../src/server/repos/context";
import { findPractitionerByUser, listPractitioners } from "../../src/server/repos/pms/directory";
import { getPmsSettings } from "../../src/server/repos/pms/settings";
import { createReminderRule, listReminderRules } from "../../src/server/repos/pms/comms/rules";
import { syncAppointmentMessages } from "../../src/server/repos/pms/comms/schedule";
import { getCommsSettings, updateCommsSettings } from "../../src/server/repos/pms/comms/settings";
import { finaliseLetter, listLetterTemplates, updateLetter } from "../../src/server/repos/pms/comms/letters";
import { runDueMessages, type DispatchDeps } from "../../src/server/pms/comms/dispatch";
import { signatureLine, startLetter } from "../../src/server/pms/comms/letters";
import { recordInboundSms } from "../../src/server/pms/comms/replies";
import { SEED_ACTOR } from "./seed-lib";
import { pmsNow, pmsNowMs } from "../../src/modules/pms/core/clock";

export interface SeedCommsOptions {
  now?: Date;
  log?: (line: string) => void;
}

export interface SeedCommsSummary {
  planned: number;
  history: number;
  replies: number;
  letters: number;
  existed: boolean;
}

let counter = 0;
const id = () => `seed_${pmsNowMs().toString(36)}_${(counter++).toString(36)}`;

/** The seed's own stand-in test service: accepts everything except the first text when `failFirst` (Retry demo). */
function seedProviders(failFirst: boolean): DispatchDeps["providers"] {
  let failed = !failFirst;
  const sms: SmsProvider = {
    id: "test",
    mode: "test",
    async send() {
      if (!failed) {
        failed = true;
        return { status: "failed", errorCode: "test_undeliverable" };
      }
      return { status: "sent", providerMessageId: `test_${id()}` };
    },
  };
  const email: EmailProvider = { id: "test", mode: "test", send: async () => ({ status: "sent", providerMessageId: `test_${id()}` }) };
  return { sms, email };
}

export async function seedComms(base: Pick<RepoContext, "db" | "cipher">, tenantId: string, options: SeedCommsOptions = {}): Promise<SeedCommsSummary> {
  const realNow = options.now ?? pmsNow();
  let clock = realNow.getTime();
  const ctx: RepoContext = { ...base, now: () => new Date(clock) };
  const log = options.log ?? (() => undefined);
  if (!(await getPmsSettings(ctx, tenantId)).isDemo) throw new RepoInputError("Messages demo data is only for a clinic flagged as a demonstration clinic.");
  if ((await listReminderRules(ctx, tenantId)).length > 0) {
    log("Messages: demonstration reminders are there already – nothing added.");
    return { planned: 0, history: 0, replies: 0, letters: 0, existed: true };
  }
  const today = ukToday(realNow);

  // Settings and reminders.
  const s = await getCommsSettings(ctx, tenantId);
  await updateCommsSettings(ctx, tenantId, s.rev, { smsSender: "Riverside", replyPhone: "01632 960100", replyEmail: "hello@riverside-demo.example.com", quietStart: "20:00", quietEnd: "08:00" }, SEED_ACTOR);
  await createReminderRule(ctx, tenantId, { name: "Text the day before", channel: "sms", timing: "hours_before", hoursBefore: 24 }, SEED_ACTOR);
  await createReminderRule(ctx, tenantId, { name: "Email two days before", channel: "email", timing: "days_before", daysBefore: 2, sendAt: "10:00" }, SEED_ACTOR);

  const patient = async (ref: string) => (await ctx.db.selectFrom("pms_patients").select(["id", "phone_mobile"]).where("tenant_id", "=", tenantId).where("import_ref", "=", ref).executeTakeFirst()) ?? null;
  // `asOfThen`: the history's appointments as they were when the reminders went (booked) – whatever the diary seed
  // has marked them since (attended, DNA…), so the history, and its failed text for Retry, is there at any hour.
  const booked = (from: string, until: string, asOfThen = false) =>
    ctx.db
      .selectFrom("pms_appointments")
      .select(["id", "patient_id", "starts_at", "ends_at", "site_id", "practitioner_id", "service_id"])
      .where("tenant_id", "=", tenantId)
      .where("kind", "=", "appointment")
      .where("status", "in", asOfThen ? ["booked", "arrived", "attended", "dna"] : ["booked"])
      .where("patient_id", "is not", null)
      .where("starts_at", ">=", from)
      .where("starts_at", "<", until)
      .orderBy("starts_at")
      .limit(400)
      .execute();
  const plan = async (rows: Awaited<ReturnType<typeof booked>>) => {
    let n = 0;
    for (const a of rows) {
      const r = await syncAppointmentMessages(
        ctx,
        tenantId,
        { id: a.id, patientId: a.patient_id as string, startsAt: new Date(a.starts_at).toISOString(), endsAt: a.ends_at ? new Date(a.ends_at).toISOString() : null, siteId: a.site_id, practitionerId: a.practitioner_id, serviceId: a.service_id, active: true },
        SEED_ACTOR,
      );
      n += r.planned;
    }
    return n;
  };

  // History: the reminders that went yesterday at 10:00 and this morning at 10:00 (for tomorrow's and the next day's
  // appointments – planned "as of" then and sent with the stand-in test service; one text fails).
  const asBooked = async (_c: RepoContext, _t: string, ids: readonly string[]) => new Map(ids.map((i) => [i, "booked"]));
  const deps = (failFirst: boolean): DispatchDeps => ({ providers: seedProviders(failFirst), linkSecret: null, linkOrigin: "http://clinic.localhost:3180", appointmentStatus: asBooked });
  let history = 0;
  for (const day of [-1, 0]) {
    // Planned "as of" 07:00 that day for the next day's first appointments, then sent by the run at 18:00 (today:
    // now) – the first of yesterday's texts "fails" so Retry can be shown.
    const planAt = Date.parse(londonToUtcIso(addDays(today, day), "07:00"));
    if (planAt > realNow.getTime()) continue;
    clock = planAt;
    const rows = await booked(londonToUtcIso(addDays(today, day + 1), "00:00"), londonToUtcIso(addDays(today, day + 2), "00:00"), true);
    await plan(rows.slice(0, 12));
    clock = Math.min(Date.parse(londonToUtcIso(addDays(today, day), "18:00")), realNow.getTime());
    const r = await runDueMessages(ctx, tenantId, deps(day === -1), { actor: SEED_ACTOR });
    history += r.sent + r.failed + r.outbox;
  }
  clock = realNow.getTime();

  // Everything still to come in the next week: planned (the reminder run sends them when due).
  const planned = await plan(await booked(new Date(clock).toISOString(), londonToUtcIso(addDays(today, 8), "00:00")));

  // Replies: three patients answered this morning's (or yesterday's) texts.
  let replies = 0;
  const sentTexts = await ctx.db
    .selectFrom("pms_messages")
    .select(["id", "to_address", "patient_id"])
    .where("tenant_id", "=", tenantId)
    .where("direction", "=", "outbound")
    .where("channel", "=", "sms")
    .where("status", "=", "sent")
    .where("kind", "=", "reminder")
    .orderBy("created_at", "desc")
    .limit(3)
    .execute();
  const answers = ["C", "Can I move to later in the day?", "YES"];
  for (let i = 0; i < sentTexts.length; i++) {
    const t = sentTexts[i];
    if (!t.to_address) continue;
    clock = realNow.getTime() - (sentTexts.length - i) * 7 * 60_000;
    await recordInboundSms(ctx, tenantId, { from: t.to_address, text: answers[i], providerMessageId: `test_reply_${id()}`, inReplyToId: t.id }, "test", SEED_ACTOR);
    replies++;
  }
  clock = realNow.getTime();

  // Letters for Megan Hart: a signed discharge letter to her GP, a draft progress report to the payer.
  let letters = 0;
  const megan = await patient("sim-pat-001");
  const prac = (await listPractitioners(ctx, tenantId))[0] ?? null;
  const templates = await listLetterTemplates(ctx, tenantId);
  const tpl = (key: string) => templates.find((t) => t.id === `standard:${key}`) ?? null;
  if (megan && prac) {
    const caseRow = await ctx.db.selectFrom("pms_cases").select("id").where("tenant_id", "=", tenantId).where("patient_id", "=", megan.id).orderBy("opened_on", "desc").limit(1).executeTakeFirst();
    const gp = tpl("gp-discharge");
    if (gp) {
      const l = await startLetter(ctx, tenantId, { patientId: megan.id, templateId: gp.id, caseId: caseRow?.id ?? null, practitionerId: prac.id, recipientKind: "gp" }, SEED_ACTOR, "Riverside Physiotherapy (fictional)");
      const body = l.body
        .replace(/\[\[Summarise progress and the outcome measures\]\]/, "Pain improved from 7/10 to 2/10 (NPRS) over six sessions; back to full work and walking 5 km.")
        .replace(/\[\[Home exercise programme and self-management advice\]\]/, "A home exercise programme to continue three times a week; advice on pacing and posture at work.")
        .replace(/\[not recorded: [^\]]*\]/g, "the presenting problem");
      const saved = await updateLetter(ctx, tenantId, l.id, l.rev, { body, recipientEmail: "reception@bletchley-surgery.example.com" }, SEED_ACTOR);
      const me = (await findPractitionerByUser(ctx, tenantId, SEED_ACTOR.userId)) ?? prac;
      if (saved.ok) await finaliseLetter(ctx, tenantId, l.id, saved.rev, SEED_ACTOR, signatureLine(me.displayName, { profession: me.profession, registrationNumber: me.registrationNumber }));
      letters++;
    }
    const progress = tpl("payer-progress");
    if (progress) {
      await startLetter(ctx, tenantId, { patientId: megan.id, templateId: progress.id, caseId: caseRow?.id ?? null, practitionerId: prac.id }, SEED_ACTOR, "Riverside Physiotherapy (fictional)");
      letters++;
    }
  }

  log(`Messages: settings and 2 reminders; ${planned} planned messages for the next week; ${history} sent in the last day (test service); ${replies} replies; ${letters} letters.`);
  return { planned, history, replies, letters, existed: false };
}
