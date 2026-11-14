/**
 * TESTS: the self-serve 14-day free trial (docs/clinic-system/trial.md) on a real database – SQLite and PGlite
 * (../trial.test.ts, npm run test:db) and D1 through the gateway Worker (workers/data-gateway/test/trial-stack.test.ts,
 * npm run test:gateway). Fictional clinics and people only; email captured by a test provider; the payment service
 * mocked (FakeSubscriptions). Covers: what a trial gets (both brands, configuration), the abuse brakes, the first
 * sign-in, the 10-report cap, read-only after the end, conversion by the first payment (every record kept, the limits
 * lifted at once), the email schedule (each email once, on its UK day, skipped when paid or late, retried when the
 * provider failed), no deletion by the retention cron, and the separate sample clinic (isolation, once only).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../db/schema";
import { testCipher } from "../../db/testing/databases";
import { createClinic } from "../../auth/platform";
import { loadClinicProfile } from "../../auth/medreport-actor";
import { noteClinicVisit } from "../../admin/clinic-plan";
import { setEmailProviderForTests, type EmailMessage } from "../../email";
import { listAudit } from "../../repos/audit";
import { getClinicPackage } from "../../repos/clinic-package";
import { clinicAccessOf, getClinicPlan, setClinicTrial } from "../../repos/clinic-plan";
import { getSmsCreditAccount, listSmsCreditEntries, setCreditCustomer } from "../../repos/pms/comms/credits";
import { getEntitlement } from "../../repos/pms/entitlements";
import { countPatients, createPatient, searchPatients } from "../../repos/pms/patients";
import { getSelfTrial, listTrialEmails, setTrialTipsOff } from "../../repos/self-trial";
import { countBillableReports, isReportCounted, recordUsageEvent } from "../../repos/usage";
import { runRetention } from "../../repos/maintenance";
import { FakeSubscriptions, subscription } from "../../billing/testing/billing-suite";
import { syncSubscription, type BillingNoticeKind } from "../../billing/sync";
import { emailBillingNotifier } from "../../billing/notify";
import { pausedByEndedTrial, selfTrialEnded } from "../access";
import { runTrialEmailSweep, sendTrialEmailNow } from "../emails";
import { createSampleClinic, declineSampleClinic } from "../sample";
import { startSelfServeTrial, trialKeys, TRIAL_TEXTS_REASON } from "../start";
import { trialBannerState } from "../view";
import { listTrialsForPlatform } from "../platform";
import { updateBookingSettings } from "../../repos/pms/portal/settings";
import { loadPublicClinic } from "../../pms/portal/public-clinic";

const SECRET = "trial-suite-secret-".padEnd(48, "t");
const DAY = 86_400_000;
const ENV = { BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: "http://localhost:3000", CLINFORMS_AUTH_ORIGINS: "http://clinic.localhost:3000" };

export interface TrialSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
}

export function defineTrialSuite(label: string, factory: () => Promise<TrialSuiteDb>, options: { sample?: boolean; skip?: string | false } = {}): void {
  describe(`self-serve free trial – ${label}`, { skip: options.skip }, () => {
    let t: TrialSuiteDb;
    let clock = Date.parse("2026-11-16T09:30:00.000Z");
    const now = () => new Date(clock);
    const sent: EmailMessage[] = [];
    let failSends = false;
    let n = 0;
    const cipher = testCipher();

    /** A clinic as self sign-up makes it (createClinic for the brand) with its owner account and membership. */
    async function signedUpClinic(brand: "clinic" | "clinforms", emailIn?: string) {
      n++;
      const email = emailIn ?? `owner${n}@larkfield-physio${n}.example`;
      const name = `Larkfield Physio ${n} (fictional)`;
      const slug = `larkfield-${brand}-${n}`;
      const created = await createClinic(t.db, {
        name,
        slug,
        ownerEmail: email,
        appOrigin: brand === "clinic" ? "http://clinic.localhost:3000" : "http://localhost:3000",
        brand,
        linkSecret: SECRET,
        sendEmail: false,
        now: now(),
      });
      const at = now().toISOString();
      const userId = `u-trial-${n}`;
      await t.db.insertInto("user").values({ id: userId, name: `Dana Lark ${n}`, email, emailVerified: true, image: null, createdAt: at, updatedAt: at, twoFactorEnabled: true }).execute();
      await t.db.insertInto("member").values({ id: `m-trial-${n}`, organizationId: created.organizationId, userId, role: "owner", createdAt: at }).execute();
      return { tenantId: created.tenantId, organizationId: created.organizationId, userId, email, name };
    }
    const start = (c: { tenantId: string; userId: string; email: string }, brand: "clinic" | "clinforms", ip = `198.51.${n}.7`, env: Record<string, string> = {}) =>
      startSelfServeTrial(t.db, { tenantId: c.tenantId, brand, userId: c.userId, email: c.email, ip, secret: SECRET }, { env: { ...ENV, ...env }, now });
    const firstVisit = (c: { tenantId: string; userId: string }) => noteClinicVisit(t.db, { tenantId: c.tenantId, userId: c.userId, role: "owner" }, now());
    const sweep = () => runTrialEmailSweep(t.db, { env: ENV, now });
    const kindsSent = (tenantEmail: string) => sent.filter((m) => m.to.email === tenantEmail).map((m) => m.subject);

    const savedEnv: Record<string, string | undefined> = {};
    before(async () => {
      // The links in emails sent from the request paths (first sign-in, payment) read the deployment's settings.
      for (const [k, v] of Object.entries(ENV)) {
        savedEnv[k] = process.env[k];
        process.env[k] = v;
      }
      t = await factory();
      setEmailProviderForTests({
        name: "log",
        async send(message) {
          if (failSends) return { status: "failed", provider: "log" };
          sent.push(message);
          return { status: "sent", provider: "log" };
        },
      });
    });
    after(async () => {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      setEmailProviderForTests(null);
      await t?.close();
    });

    it("ClinDesk: a 14-day trial waiting for the first sign-in, the clinic system and Reports on, 10 free reports, 10 trial texts, limits", async () => {
      const c = await signedUpClinic("clinic");
      const r = await start(c, "clinic");
      assert.equal(r.created, true);
      const trial = await getSelfTrial({ db: t.db }, c.tenantId);
      assert.deepEqual([trial?.brand, trial?.reportsIncluded, trial?.textsGranted, trial?.repeatReason], ["clinic", 10, 10, null]);
      assert.ok(trial && !trial.emailKey.includes("@") && !trial.networkKey.includes("198."), "keyed hashes only");
      const plan = await getClinicPlan({ db: t.db }, c.tenantId);
      assert.deepEqual([plan?.status, plan?.trialDays, plan?.startOnFirstSignIn, plan?.trialEndsAt, plan?.livePerMinute, plan?.livePerDay], ["trial", 14, true, null, 5, 60]);
      assert.equal((await getEntitlement({ db: t.db }, c.tenantId, "clinic"))?.status, "trial");
      assert.equal((await getEntitlement({ db: t.db }, c.tenantId, "reports"))?.status, "trial");
      const pkg = await getClinicPackage({ db: t.db }, c.tenantId);
      assert.deepEqual([pkg?.package, pkg?.reportsIncluded, pkg?.monthlyPricePence, pkg?.extraReportPence], ["trial", 10, 0, null]);
      assert.equal((await getSmsCreditAccount({ db: t.db }, c.tenantId)).balance, 10);
      const ledger = await listSmsCreditEntries({ db: t.db }, c.tenantId);
      assert.deepEqual(ledger.map((e) => [e.kind, e.credits, e.reason]), [["adjustment", 10, TRIAL_TEXTS_REASON]], "labelled as trial credits");
      assert.ok((await listAudit({ db: t.db }, c.tenantId, { limit: 20 })).some((e) => e.action === "clinic.trial_self_serve"));
      // Idempotent: a retried sign-up gives nothing twice.
      const again = await start(c, "clinic");
      assert.equal(again.created, false);
      assert.equal((await getSmsCreditAccount({ db: t.db }, c.tenantId)).balance, 10);
      assert.equal((await listSmsCreditEntries({ db: t.db }, c.tenantId)).length, 1);
      assert.equal((await listAudit({ db: t.db }, c.tenantId, { limit: 50 })).filter((e) => e.action === "clinic.trial_self_serve").length, 1);
    });

    it("ClinForms: Reports (the default) with 10 free reports, no texts, no clinic system; settings from the environment", async () => {
      const c = await signedUpClinic("clinforms");
      await start(c, "clinforms");
      assert.equal(await getEntitlement({ db: t.db }, c.tenantId, "clinic"), null);
      assert.equal((await getSmsCreditAccount({ db: t.db }, c.tenantId)).balance, 0);
      assert.equal((await getClinicPackage({ db: t.db }, c.tenantId))?.reportsIncluded, 10);
      const d = await signedUpClinic("clinic");
      await start(d, "clinic", undefined, { CLINFORMS_TRIAL_DAYS: "7", CLINFORMS_TRIAL_REPORTS: "3", CLINFORMS_TRIAL_TEXTS: "0" });
      assert.equal((await getClinicPlan({ db: t.db }, d.tenantId))?.trialDays, 7);
      assert.equal((await getClinicPackage({ db: t.db }, d.tenantId))?.reportsIncluded, 3);
      assert.equal((await getSmsCreditAccount({ db: t.db }, d.tenantId)).balance, 0);
      const e = await signedUpClinic("clinic");
      await start(e, "clinic", undefined, { CLINFORMS_TRIAL_DAYS: "999", CLINFORMS_TRIAL_REPORTS: "x" });
      assert.equal((await getClinicPlan({ db: t.db }, e.tenantId))?.trialDays, 14, "out of range: the default");
      assert.equal((await getClinicPackage({ db: t.db }, e.tenantId))?.reportsIncluded, 10);
    });

    it("abuse: the same address again (case, +tag, gmail dots), a busy network, a busy own domain – the trial without free reports or texts", async () => {
      const a = await signedUpClinic("clinic", "dana.lark@gmail.com");
      await start(a, "clinic", "203.0.113.10");
      assert.equal((await getSelfTrial({ db: t.db }, a.tenantId))?.repeatReason, null);
      const b = await signedUpClinic("clinic", "Dan.aLark+physio@googlemail.com");
      await start(b, "clinic", "192.0.2.50");
      const bt = await getSelfTrial({ db: t.db }, b.tenantId);
      assert.deepEqual([bt?.repeatReason, bt?.reportsIncluded, bt?.textsGranted], ["email", 0, 0]);
      assert.equal((await getSmsCreditAccount({ db: t.db }, b.tenantId)).balance, 0);
      assert.equal((await getClinicPlan({ db: t.db }, b.tenantId))?.status, "trial", "still a trial – only the free allowance is withheld");
      // Network: 2 trials with an allowance per /24 in 30 days; the third gets none; another /24 is fine.
      const n1 = await signedUpClinic("clinic", "one@north-physio.example");
      await start(n1, "clinic", "203.0.113.77");
      const n2 = await signedUpClinic("clinic", "two@south-physio.example");
      await start(n2, "clinic", "203.0.113.200");
      assert.equal((await getSelfTrial({ db: t.db }, n2.tenantId))?.repeatReason, "network", "203.0.113.0/24 already had two");
      const n3 = await signedUpClinic("clinic", "three@east-physio.example");
      await start(n3, "clinic", "198.18.0.1");
      assert.equal((await getSelfTrial({ db: t.db }, n3.tenantId))?.repeatReason, null);
      // A month later the network may start again.
      clock += 31 * DAY;
      const n4 = await signedUpClinic("clinic", "four@west-physio.example");
      await start(n4, "clinic", "203.0.113.9");
      assert.equal((await getSelfTrial({ db: t.db }, n4.tenantId))?.repeatReason, null);
      // Own domain: 3 per 30 days; webmail never counts as a domain.
      const ips = ["10.1.1.1", "10.2.1.1", "10.3.1.1"];
      for (let i = 0; i < ips.length; i++) await start(await signedUpClinic("clinic", `p${i}@riverbend-physio.example`), "clinic", ips[i]);
      const d4 = await signedUpClinic("clinic", "p4@riverbend-physio.example");
      await start(d4, "clinic", "10.4.1.1");
      assert.equal((await getSelfTrial({ db: t.db }, d4.tenantId))?.repeatReason, "domain");
      assert.equal(trialKeys(SECRET, "x@gmail.com", "1.2.3.4").domainKey, null);
      clock -= 31 * DAY;
    });

    it("the first sign-in starts the 14 days and sends the welcome once; the banner shows the free reports and the plan link", async () => {
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      const access = await firstVisit(c);
      assert.equal(access?.state, "trial");
      const plan = await getClinicPlan({ db: t.db }, c.tenantId);
      assert.equal(Date.parse(plan?.trialEndsAt ?? "") - Date.parse(plan?.trialStartsAt ?? ""), 14 * DAY);
      const welcome = sent.filter((m) => m.to.email === c.email);
      assert.equal(welcome.length, 1);
      assert.match(welcome[0].subject, /Welcome to ClinDesk – your 14-day free trial has started/);
      assert.equal(welcome[0].brand, "clinic");
      assert.match(welcome[0].html, /Stop these tips emails/);
      assert.match(welcome[0].html, /http:\/\/clinic\.localhost:3000\/app\/start/);
      await firstVisit(c);
      await sendTrialEmailNow(t.db, c.tenantId, "welcome", { env: ENV, now });
      await sweep();
      assert.equal(sent.filter((m) => m.to.email === c.email).length, 1, "never twice");
      const banner = await trialBannerState(t.db, c.tenantId, access, true);
      assert.deepEqual(banner && "selfServe" in banner ? banner.selfServe : null, { reportsIncluded: 10, reportsUsed: 0, canChoosePlan: true });
      // A trial set by ClinForms staff by hand: no self-serve extras, no welcome email.
      const manual = await signedUpClinic("clinforms");
      await setClinicTrial({ db: t.db, now }, manual.tenantId, { days: 3, startOnFirstSignIn: true });
      const before = sent.length;
      const ma = await firstVisit(manual);
      assert.equal(sent.length, before);
      const mb = await trialBannerState(t.db, manual.tenantId, ma, true);
      assert.ok(mb && !("selfServe" in mb && mb.selfServe));
    });

    it("10 free reports: the Report API's profile carries the count; an 11th new report cannot be drafted, a counted one can", async () => {
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      await firstVisit(c);
      let profile = await loadClinicProfile(t.db, c.tenantId, now());
      assert.deepEqual(profile?.trialReports, { included: 10, used: 0, addon: true });
      for (let i = 1; i <= 10; i++) {
        await recordUsageEvent({ db: t.db, now }, c.tenantId, { kind: "drafting_call", reportId: `rpt_trial_${i}`, episodeFp: "fp_trial_episode_0001", succeeded: true, usage: { inputTokens: 1000, outputTokens: 200 } });
      }
      assert.equal(await countBillableReports({ db: t.db }, c.tenantId), 10);
      profile = await loadClinicProfile(t.db, c.tenantId, now());
      assert.deepEqual(profile?.trialReports, { included: 10, used: 10, addon: true });
      assert.equal(await isReportCounted({ db: t.db }, c.tenantId, "rpt_trial_3", "fp_trial_episode_0001"), true);
      assert.equal(await isReportCounted({ db: t.db }, c.tenantId, "rpt_trial_11", "fp_trial_episode_0001"), false);
      // A ClinForms clinic: "choose a plan" (no add-on).
      const f = await signedUpClinic("clinforms");
      await start(f, "clinforms");
      assert.equal((await loadClinicProfile(t.db, f.tenantId, now()))?.trialReports?.addon, false);
      // Another clinic's reports never count here (tenant isolation).
      assert.equal(await countBillableReports({ db: t.db }, f.tenantId), 0);
    });

    it("after the end: the clinic system is read-only (reading allowed, buying credits allowed), records kept; a manual trial is unaffected", async () => {
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      await firstVisit(c);
      const ctx = { db: t.db, cipher, now };
      await createPatient(ctx, c.tenantId, { firstName: "Megan", lastName: "Hart" }, { userId: c.userId, sessionId: null });
      assert.equal(await selfTrialEnded(t.db, c.tenantId, now()), false);
      const end = Date.parse((await getClinicPlan({ db: t.db }, c.tenantId))?.trialEndsAt ?? "");
      assert.equal(await selfTrialEnded(t.db, c.tenantId, new Date(end + 1000)), true);
      for (const p of ["patients.view", "diary.view", "clinical.view", "billing.view", "reports.all", "reports.export", "clinic.view"]) assert.equal(pausedByEndedTrial(p), false, p);
      for (const p of ["patients.edit", "diary.book", "clinical.write", "billing.edit", "billing.pay", "messages.send", "settings.setup", "settings.members"]) assert.equal(pausedByEndedTrial(p), true, p);
      assert.equal(pausedByEndedTrial("messages.send", true), false, "buying text credits stays possible");
      assert.equal(await countPatients(ctx, c.tenantId), 1);
      const manual = await signedUpClinic("clinforms");
      await setClinicTrial({ db: t.db, now }, manual.tenantId, { days: 1, startOnFirstSignIn: false });
      assert.equal(await selfTrialEnded(t.db, manual.tenantId, new Date(clock + 3 * DAY)), false, "only self-serve trials");
      // Public booking / portal pages: shown while the trial runs, gone once it has ended.
      await updateBookingSettings(ctx, c.tenantId, 0, { onlineBooking: true, portal: true } as never, { userId: c.userId, sessionId: null });
      assert.ok(await loadPublicClinic(ctx, c.tenantId));
      assert.equal(await loadPublicClinic({ db: t.db, now: () => new Date(end + 1000) }, c.tenantId), null);
    });

    it("the retention cron never deletes a trial clinic, its records or its trial (ended weeks ago)", async () => {
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      await firstVisit(c);
      const ctx = { db: t.db, cipher, now };
      await createPatient(ctx, c.tenantId, { firstName: "Daniel", lastName: "Brooks" }, { userId: c.userId, sessionId: null });
      const later = { db: t.db, now: () => new Date(clock + 75 * DAY) };
      await runRetention(later);
      assert.ok(await t.db.selectFrom("organization").select("id").where("slug", "=", c.tenantId).executeTakeFirst());
      assert.equal(await countPatients(ctx, c.tenantId), 1);
      assert.ok(await getSelfTrial({ db: t.db }, c.tenantId));
      assert.equal(clinicAccessOf(await getClinicPlan({ db: t.db }, c.tenantId), new Date(clock + 75 * DAY)).state, "trial_ended");
    });

    it("emails: welcome day 0, tips day 3, 4 days left day 10, last day day 13, ended day 14 – each once, UK days, a re-run sends nothing", async () => {
      const startAt = clock;
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      await firstVisit(c); // welcome (at once)
      const byDay = new Map<number, string[]>();
      for (let day = 0; day <= 18; day++) {
        clock = startAt + day * DAY - (6 * 60 + 15) * 60_000; // 03:15 UK (GMT in November), the cron's hour
        const before = kindsSent(c.email).length;
        await sweep();
        await sweep(); // the same night again: nothing more
        byDay.set(day, kindsSent(c.email).slice(before));
      }
      clock = startAt;
      assert.deepEqual(byDay.get(3), ["Three things to try in ClinDesk this week"]);
      assert.deepEqual(byDay.get(10), ["4 days left in your ClinDesk free trial"]);
      assert.deepEqual(byDay.get(13), ["Your ClinDesk free trial ends tomorrow"]);
      assert.deepEqual(byDay.get(14), [], "the trial ends at 09:30 on day 14 – the 03:17 run is before it");
      assert.deepEqual(byDay.get(15), ["Your ClinDesk free trial has ended – your data is safe"]);
      const total = kindsSent(c.email);
      assert.equal(total.length, 5);
      assert.equal(new Set(total).size, 5, "each once");
      const rows = await listTrialEmails({ db: t.db }, c.tenantId);
      assert.deepEqual(rows.map((r) => [r.kind, r.status]).sort(), [["ended", "sent"], ["four_days", "sent"], ["last_day", "sent"], ["tips", "sent"], ["welcome", "sent"]]);
      const ended = sent.filter((m) => m.to.email === c.email).at(-1)!;
      assert.match(ended.text, /Nothing has been deleted/);
      assert.match(ended.html, /Choose a plan/);
      assert.doesNotMatch(ended.html, /Stop these tips/, "account emails have no unsubscribe");
    });

    it("emails: concurrent runs send once; a failed send is retried (3 attempts at most); late ones are skipped; tips can be stopped", async () => {
      const startAt = clock;
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      failSends = true;
      await firstVisit(c);
      failSends = false;
      assert.equal(kindsSent(c.email).length, 0);
      assert.equal((await listTrialEmails({ db: t.db }, c.tenantId)).find((r) => r.kind === "welcome")?.status, "failed");
      await Promise.all([sweep(), sweep(), sweep()]);
      assert.deepEqual(kindsSent(c.email), ["Welcome to ClinDesk – your 14-day free trial has started"], "retried once, by one run");
      await setTrialTipsOff({ db: t.db, now }, c.tenantId);
      clock = startAt + 3 * DAY;
      await sweep();
      assert.equal((await listTrialEmails({ db: t.db }, c.tenantId)).find((r) => r.kind === "tips")?.status, "skipped", "tips stopped");
      // A clinic whose sweep was off for a week: the stale emails are skipped, only the current one goes.
      const late = await signedUpClinic("clinic");
      clock = startAt;
      await start(late, "clinic");
      await setTrialTipsOff({ db: t.db, now }, late.tenantId); // no welcome either
      await firstVisit(late);
      clock = startAt + 11 * DAY;
      await sweep();
      assert.deepEqual(kindsSent(late.email), ["4 days left in your ClinDesk free trial"]);
      const statuses = Object.fromEntries((await listTrialEmails({ db: t.db }, late.tenantId)).map((r) => [r.kind, r.status]));
      assert.deepEqual(statuses, { welcome: "skipped", tips: "skipped", four_days: "sent" });
      clock = startAt;
    });

    it("paying converts the trial: every record kept, the limits lifted at once, 'you're on a paid plan' once, no more trial emails", async () => {
      const startAt = clock;
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      await firstVisit(c);
      const ctx = { db: t.db, cipher, now };
      for (const [first, last] of [["Megan", "Hart"], ["Daniel", "Brooks"], ["Rebecca", "Lane"]]) await createPatient(ctx, c.tenantId, { firstName: first, lastName: last }, { userId: c.userId, sessionId: null });
      for (let i = 1; i <= 10; i++) await recordUsageEvent({ db: t.db, now }, c.tenantId, { kind: "drafting_call", reportId: `rpt_paid_${i}`, episodeFp: "fp_trial_episode_0002", succeeded: true, usage: { inputTokens: 10, outputTokens: 10 } });
      assert.equal((await loadClinicProfile(t.db, c.tenantId, now()))?.trialReports?.used, 10, "the free reports are used up");
      // The trial ended before paying (read-only), then the owner pays.
      clock = startAt + 16 * DAY;
      await sweep();
      assert.equal(await selfTrialEnded(t.db, c.tenantId, now()), true);
      await setCreditCustomer({ db: t.db, now }, c.tenantId, `cus_test_${c.tenantId.replace(/-/g, "_")}`, { userId: null, sessionId: null }, "test");
      const fake = new FakeSubscriptions();
      const sub = subscription({ id: `sub_test_${n}`, tenantId: c.tenantId, customer: `cus_test_${c.tenantId.replace(/-/g, "_")}`, keys: ["clindesk_small_monthly", "clindesk_reports_100_monthly"] });
      fake.subs.set(sub.id, sub);
      const notices: BillingNoticeKind[] = [];
      const notifier = emailBillingNotifier(() => t.db, ENV);
      const r = await syncSubscription({ db: t.db, now, env: {}, notify: async (tenantId, notice) => { notices.push(notice.kind); await notifier(tenantId, notice); }, alert: null }, fake, sub.id, { eventId: "evt_test_trial_paid" });
      assert.equal(r.status, "synced");
      assert.equal((await getClinicPlan({ db: t.db }, c.tenantId))?.status, "paid");
      assert.ok((await getSelfTrial({ db: t.db }, c.tenantId))?.convertedAt);
      assert.equal(await selfTrialEnded(t.db, c.tenantId, now()), false, "read-only lifted at once");
      assert.equal((await getEntitlement({ db: t.db }, c.tenantId, "clinic"))?.status, "active");
      assert.equal((await getEntitlement({ db: t.db }, c.tenantId, "reports"))?.status, "active");
      const pkg = await getClinicPackage({ db: t.db }, c.tenantId);
      assert.deepEqual([pkg?.package, pkg?.reportsIncluded], ["practice", 100], "the paid allowance replaces the 10 free reports");
      assert.equal((await loadClinicProfile(t.db, c.tenantId, now()))?.trialReports, undefined, "no trial cap any more");
      assert.equal(await countPatients(ctx, c.tenantId), 3, "every record kept");
      assert.equal(await countBillableReports({ db: t.db }, c.tenantId), 10);
      assert.equal((await getSmsCreditAccount({ db: t.db }, c.tenantId)).balance, 10, "trial texts kept");
      assert.ok(notices.includes("trial_converted"));
      const paid = sent.filter((m) => m.to.email === c.email && /paid/.test(m.subject));
      assert.equal(paid.length, 1);
      assert.match(paid[0].subject, /You're on a paid ClinDesk plan/);
      assert.match(paid[0].text, /ClinDesk Small with Reports/);
      // Re-read of the same subscription, and the nights after: nothing more.
      await syncSubscription({ db: t.db, now, env: {}, notify: notifier, alert: null }, fake, sub.id, { eventId: "evt_test_trial_paid_2" });
      for (let d = 0; d < 3; d++) {
        clock += DAY;
        await sweep();
      }
      assert.equal(sent.filter((m) => m.to.email === c.email && /paid/.test(m.subject)).length, 1);
      clock = startAt;
    });

    it("paying for ClinForms only after a ClinDesk trial never keeps the clinic system for free; ClinDesk without the add-on drops the free package", async () => {
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      await firstVisit(c);
      const fake = new FakeSubscriptions();
      const cus = `cus_test_${c.tenantId.replace(/-/g, "_")}`;
      await setCreditCustomer({ db: t.db, now }, c.tenantId, cus, { userId: null, sessionId: null }, "test");
      const sub = subscription({ id: `sub_test_forms_${n}`, tenantId: c.tenantId, customer: cus, keys: ["clinforms_starter_monthly"] });
      fake.subs.set(sub.id, sub);
      await syncSubscription({ db: t.db, now, env: {}, notify: null, alert: null }, fake, sub.id);
      assert.equal((await getEntitlement({ db: t.db }, c.tenantId, "clinic"))?.status, "paused");
      assert.equal((await getEntitlement({ db: t.db }, c.tenantId, "reports"))?.status, "active");
      const d = await signedUpClinic("clinic");
      await start(d, "clinic");
      await firstVisit(d);
      const cus2 = `cus_test_${d.tenantId.replace(/-/g, "_")}`;
      await setCreditCustomer({ db: t.db, now }, d.tenantId, cus2, { userId: null, sessionId: null }, "test");
      const sub2 = subscription({ id: `sub_test_desk_${n}`, tenantId: d.tenantId, customer: cus2, keys: ["clindesk_solo_monthly"] });
      fake.subs.set(sub2.id, sub2);
      await syncSubscription({ db: t.db, now, env: {}, notify: null, alert: null }, fake, sub2.id);
      assert.equal((await getEntitlement({ db: t.db }, d.tenantId, "clinic"))?.status, "active");
      assert.equal((await getEntitlement({ db: t.db }, d.tenantId, "reports"))?.status, "paused");
      assert.equal(await getClinicPackage({ db: t.db }, d.tenantId), null, "the free Trial package is gone");
    });

    it("platform page: every trial clinic (not the samples) with its state, reports and texts used, emails and conversion", async () => {
      const rows = await listTrialsForPlatform(t.db, now());
      assert.ok(rows.length >= 10);
      assert.ok(rows.every((r) => r.trial.sampleOf === null), "samples are not listed");
      const states = new Set(rows.map((r) => r.state));
      for (const s of ["waiting", "running", "converted"]) assert.ok(states.has(s as never), s);
      const converted = rows.find((r) => r.state === "converted" && r.reportsUsed === 10);
      assert.ok(converted, "the converted clinic with its 10 reports");
      assert.ok(converted.emails.some((e) => e.kind === "paid" && e.status === "sent"));
      assert.ok(rows.some((r) => r.trial.repeatReason === "email"));
    });

    it("a ClinForms trial's emails speak for ClinForms (its host, its words, no texts)", async () => {
      const c = await signedUpClinic("clinforms");
      await start(c, "clinforms");
      await firstVisit(c);
      const m = sent.filter((x) => x.to.email === c.email).at(-1)!;
      assert.match(m.subject, /Welcome to ClinForms/);
      assert.equal(m.brand, undefined);
      assert.match(m.html, /http:\/\/localhost:3000\/app\/start/);
      assert.doesNotMatch(m.text, /ClinDesk|texts/);
    });

    it("offboarded and sample clinics get no trial emails", async () => {
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      await t.db.updateTable("organization").set({ metadata: JSON.stringify({ offboardedAt: now().toISOString() }) }).where("slug", "=", c.tenantId).execute();
      await firstVisit(c);
      await sweep();
      assert.equal(kindsSent(c.email).length, 0);
    });

    it("sample clinic: a SEPARATE clinic, made-up data, demo flags, the trial's own window, no Reports – once only, never mixed with real records", { skip: options.sample === false ? "sample seed covered on SQLite/PGlite" : false }, async () => {
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      const ctx = { db: t.db, cipher, now };
      assert.deepEqual(await createSampleClinic({ db: t.db, cipher, now, patients: 12 }, { tenantId: c.tenantId, userId: c.userId }), { status: "unavailable", why: "not_running" }, "the trial must have started");
      await firstVisit(c);
      await createPatient(ctx, c.tenantId, { firstName: "Real", lastName: "Patient" }, { userId: c.userId, sessionId: null });
      assert.deepEqual(await createSampleClinic({ db: t.db, cipher, now, patients: 12 }, { tenantId: c.tenantId, userId: "u-not-the-owner" }), { status: "unavailable", why: "not_owner" });
      const [r1, r2] = await Promise.all([
        createSampleClinic({ db: t.db, cipher, now, patients: 12 }, { tenantId: c.tenantId, userId: c.userId }),
        createSampleClinic({ db: t.db, cipher, now, patients: 12 }, { tenantId: c.tenantId, userId: c.userId }),
      ]);
      const made = [r1, r2].find((r) => r.status === "created");
      assert.ok(made && made.status === "created", JSON.stringify([r1, r2]));
      assert.ok([r1, r2].some((r) => r.status === "busy"), "two clicks: one sample");
      const slug = made.sampleTenantId;
      assert.notEqual(slug, c.tenantId);
      const org = await t.db.selectFrom("organization").selectAll().where("slug", "=", slug).executeTakeFirstOrThrow();
      assert.match(org.name, /sample clinic \(fictional\)$/);
      const member = await t.db.selectFrom("member").selectAll().where("organizationId", "=", org.id).execute();
      assert.deepEqual(member.map((m) => [m.userId, m.role]), [[c.userId, "owner"]]);
      const plan = await getClinicPlan({ db: t.db }, slug);
      const real = await getClinicPlan({ db: t.db }, c.tenantId);
      assert.equal(plan?.demoClinic, true);
      assert.equal(plan?.trialEndsAt, real?.trialEndsAt, "ends with the trial");
      assert.equal((await getEntitlement({ db: t.db }, slug, "reports"))?.status, "paused");
      assert.equal((await getSmsCreditAccount({ db: t.db }, slug)).balance, 0, "no texts – nothing is ever sent");
      assert.equal(await countPatients(ctx, slug), 12);
      assert.equal(await countPatients(ctx, c.tenantId), 1, "the real clinic holds its own patient only");
      assert.deepEqual((await searchPatients(ctx, c.tenantId, {})).map((p) => p.lastName), ["Patient"], "no sample patient in the real clinic's search");
      assert.equal((await getSelfTrial({ db: t.db }, slug))?.sampleOf, c.tenantId);
      assert.equal((await getSelfTrial({ db: t.db }, c.tenantId))?.sampleState, "ready");
      const again = await createSampleClinic({ db: t.db, cipher, now, patients: 12 }, { tenantId: c.tenantId, userId: c.userId });
      assert.equal(again.status, "exists");
      assert.equal((await loadClinicProfile(t.db, slug, now()))?.trialReports, undefined);
      // After the trial: the sample is read-only too.
      assert.equal(await selfTrialEnded(t.db, slug, new Date(Date.parse(real?.trialEndsAt ?? "") + 1000)), true);
      // A ClinForms trial: no sample (it has no clinic system).
      const f = await signedUpClinic("clinforms");
      await start(f, "clinforms");
      await firstVisit(f);
      assert.deepEqual(await createSampleClinic({ db: t.db, cipher, now, patients: 12 }, { tenantId: f.tenantId, userId: f.userId }), { status: "unavailable", why: "not_clinic_brand" });
      // "No thanks" on another clinic: the offer stays away.
      const d = await signedUpClinic("clinic");
      await start(d, "clinic");
      await firstVisit(d);
      await declineSampleClinic(t.db, d.tenantId, now);
      assert.deepEqual(await createSampleClinic({ db: t.db, cipher, now, patients: 12 }, { tenantId: d.tenantId, userId: d.userId }), { status: "unavailable", why: "declined" });
    });
  });
}
