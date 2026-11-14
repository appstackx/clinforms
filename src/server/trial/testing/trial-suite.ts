/**
 * TESTS: the self-serve 14-day free trial (docs/clinic-system/trial.md) on a real database – SQLite and PGlite
 * (../trial.test.ts, npm run test:db) and D1 through the gateway Worker (workers/data-gateway/test/trial-stack.test.ts,
 * npm run test:gateway). Fictional clinics and people only; email captured by a test provider; the payment service
 * mocked (FakeSubscriptions). Covers: what a trial gets (both brands, configuration), the abuse brakes, the first
 * sign-in, the 10-report cap, read-only after the end, conversion by the first payment (every record kept, the limits
 * lifted at once), the email schedule (each email once, on its UK day, skipped when paid or late, retried when the
 * provider failed), no deletion by the retention cron, and the separate sample clinic (isolation, once only).
 * 14/11/2026: after an unpaid trial – kept 90 days, ONE deletion warning 14 days before, then deleted (the sample clinic
 * with it); never a clinic that paid, a hand-set trial or the sample of a paid clinic; the paid state re-read right
 * before deleting; double runs; the owner's "Remove sample clinic" after paying (owner only). These run LAST: they move
 * the clock months ahead.
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
import { selfTrialEnded, trialWriteBlock } from "../access";
import { clinicsWithClinicSystem } from "../../pms/comms/cron";
import { serve } from "../../pms/integration/api/http";
import { createApiKey, setApiEnabled } from "../../repos/pms/integration/api-keys";
import { runTrialEmailSweep, sendTrialEmailNow } from "../emails";
import { createSampleClinic, declineSampleClinic } from "../sample";
import { startSelfServeTrial, trialKeys, TRIAL_TEXTS_REASON } from "../start";
import { trialBannerState } from "../view";
import { listTrialsForPlatform } from "../platform";
import { assertTenantMayCreate } from "../../../modules/medreport/auth/clinic-access";
import { endTrial } from "../../admin/clinic-plan";
import { billExtraReports } from "../../billing/extras";
import type { SyncDeps } from "../../billing/sync";
import { getBillingExtra, getClinicSubscription } from "../../repos/clinic-subscription";
import { setClinicDraftingLimits } from "../../repos/clinic-plan";
import { setEntitlement } from "../../repos/pms/entitlements";
import { releaseTrialReport, reserveTrialReport } from "../../repos/self-trial";
import { dbUsageRecorder } from "../../usage/recorder";
import { sendTrialEmail } from "../emails";
import { clinicShellTrial } from "../view";
import { updateBookingSettings } from "../../repos/pms/portal/settings";
import { loadPublicClinic } from "../../pms/portal/public-clinic";
import { addUkDays, londonDay, ukDayStart } from "../../../lib/trial";
import { endClinicTrial, extendClinicTrial } from "../../repos/clinic-plan";
import { appendAudit } from "../../repos/audit";
import { markTrialConverted } from "../../repos/self-trial";
import { deleteUnpaidTrialClinic, runTrialRetentionSweep } from "../retention";
import { removeSampleClinic, sampleRemovalOffer } from "../sample";
import { clinicTrialRunning } from "../../admin/clinic-plan";

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
    let failFor: string | null = null;
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
          if (failSends || message.to.email === failFor) return { status: "failed", provider: "log" };
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
      // Network (review 9 – the sign-up limits' own rule, ipLimitSubject): an IPv4 address EXACTLY (a port dropped; its
      // neighbours on a shared mobile network are not caught), an IPv6 address by its /64 (brackets, ports normalised).
      // 2 trials with an allowance per network in 30 days; the third gets none.
      const n1 = await signedUpClinic("clinic", "one@north-physio.example");
      await start(n1, "clinic", "203.0.113.77");
      const n2 = await signedUpClinic("clinic", "two@south-physio.example");
      await start(n2, "clinic", "203.0.113.77:51234");
      const n2b = await signedUpClinic("clinic", "twob@south-physio.example");
      await start(n2b, "clinic", "203.0.113.77");
      assert.equal((await getSelfTrial({ db: t.db }, n2b.tenantId))?.repeatReason, "network", "the same address (with or without a port) had two");
      const n3 = await signedUpClinic("clinic", "three@east-physio.example");
      await start(n3, "clinic", "203.0.113.78");
      assert.equal((await getSelfTrial({ db: t.db }, n3.tenantId))?.repeatReason, null, "a neighbour address is another network");
      const v6a = await signedUpClinic("clinic", "v6a@harbour-physio.example");
      await start(v6a, "clinic", "2001:db8:5:6::1");
      const v6b = await signedUpClinic("clinic", "v6b@cliff-physio.example");
      await start(v6b, "clinic", "[2001:0db8:0005:0006:aaaa::9]:443");
      const v6c = await signedUpClinic("clinic", "v6c@dune-physio.example");
      await start(v6c, "clinic", "2001:db8:5:6:ffff::2");
      assert.equal((await getSelfTrial({ db: t.db }, v6c.tenantId))?.repeatReason, "network", "one IPv6 /64, however it is written");
      assert.equal(trialKeys(SECRET, "a@b.example", "203.0.113.77:443").networkKey, trialKeys(SECRET, "a@b.example", "203.0.113.77").networkKey);
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
      assert.equal((await trialWriteBlock(t.db, c.tenantId, "clinic", new Date(end + 1000)))?.reason, "trial_ended");
      assert.equal(await trialWriteBlock(t.db, c.tenantId, "clinic", now()), null, "while it runs: writes allowed");
      assert.equal(await countPatients(ctx, c.tenantId), 1);
      // Review 3 – every write path: the messages cron skips it (no reminders, no campaigns) …
      const later = { db: t.db, cipher, now: () => new Date(end + 1000) };
      assert.ok((await clinicsWithClinicSystem({ db: t.db, cipher, now })).includes(c.tenantId));
      assert.ok(!(await clinicsWithClinicSystem(later)).includes(c.tenantId), "no messages for an ended trial");
      // … and the clinic API: reads still answer, writes are refused (403 READ_ONLY).
      await setApiEnabled(ctx, c.tenantId, true, { userId: c.userId, sessionId: null });
      const key = await createApiKey(ctx, c.tenantId, { name: "Website (fictional)", scopes: ["appointments:write", "appointments:read"], siteIds: [], expiresInDays: 30 }, { userId: c.userId, sessionId: null });
      const endpoint = { scope: "appointments:write" as const, handle: async () => ({ status: 201, body: { data: { ok: true } } }) };
      const apiCall = async (method: "GET" | "POST", at: number) =>
        serve(
          new Request("https://clinic.example.com/api/clinic/v1/appointments", { method, headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json", "x-forwarded-for": "198.51.100.9", "idempotency-key": "trial-test-0001" }, body: method === "POST" ? "{}" : undefined }),
          {},
          method === "GET" ? { scope: "appointments:read" as const, handle: async () => ({ body: { data: [] } }) } : endpoint,
          ["GET", "POST"],
          { db: () => t.db, cipher: () => cipher, env: { CLINFORMS_CLINIC_API: "on" }, now: () => new Date(at) },
        );
      assert.equal((await apiCall("POST", clock)).status, 201, "while it runs");
      const refused = await apiCall("POST", end + 1000);
      assert.equal(refused.status, 403);
      assert.equal(((await refused.json()) as { error: { code: string } }).error.code, "READ_ONLY");
      assert.equal((await apiCall("GET", end + 1000)).status, 200, "reads still answer");
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
      // Review 1: the trial's drafting limits (5/min, 60/day) are lifted too – back to the defaults.
      const limits = await getClinicPlan({ db: t.db }, c.tenantId);
      assert.deepEqual([limits?.livePerMinute, limits?.livePerDay], [null, null]);
      assert.equal((await loadClinicProfile(t.db, c.tenantId, now()))?.draftingLimits, undefined);
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

    /** A paid subscription for a clinic (the payment service mocked). */
    async function pay(tenantId: string, keys: string[], fake = new FakeSubscriptions(), notify: SyncDeps["notify"] = null) {
      const cus = `cus_test_${tenantId.replace(/-/g, "_")}`;
      await setCreditCustomer({ db: t.db, now }, tenantId, cus, { userId: null, sessionId: null }, "test");
      const sub = subscription({ id: `sub_test_${tenantId.replace(/-/g, "_")}_${++n}`, tenantId, customer: cus, keys });
      fake.subs.set(sub.id, sub);
      const r = await syncSubscription({ db: t.db, now, env: {}, notify, alert: null }, fake, sub.id);
      assert.equal(r.status, "synced");
      return { fake, sub };
    }

    it("review 1: staff-set drafting limits are kept on conversion; only the trial's own values are lifted", async () => {
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      await firstVisit(c);
      await setClinicDraftingLimits({ db: t.db, now }, c.tenantId, { perMinute: 20, perDay: 900 });
      await pay(c.tenantId, ["clindesk_small_monthly"]);
      const plan = await getClinicPlan({ db: t.db }, c.tenantId);
      assert.deepEqual([plan?.status, plan?.livePerMinute, plan?.livePerDay], ["paid", 20, 900]);
    });

    it("review 2: a conversion left half-done (a crash, or converted by hand on the platform page) is finished by the next sync", async () => {
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      await firstVisit(c);
      // Converted by hand first: plan "paid", the clinic system still on its free "trial", converted_at empty.
      await endTrial(t.db, { kind: "script" }, c.tenantId, "paid", now());
      assert.equal((await getSelfTrial({ db: t.db }, c.tenantId))?.convertedAt, null);
      const { fake, sub } = await pay(c.tenantId, ["clindesk_small_monthly"]);
      assert.ok((await getSelfTrial({ db: t.db }, c.tenantId))?.convertedAt, "finished although the plan was already paid");
      assert.equal((await getEntitlement({ db: t.db }, c.tenantId, "clinic"))?.status, "active");
      // A crash after the subscription was saved: the packages back to the trial, converted_at empty – the next sync of
      // the SAME subscription (nothing changed at the payment service) repairs it.
      await setEntitlement({ db: t.db, now }, c.tenantId, "clinic", { status: "trial", note: "crash simulation" }, { userId: null, sessionId: null });
      await t.db.updateTable("self_trial").set({ converted_at: null }).where("tenant_id", "=", c.tenantId).execute();
      await syncSubscription({ db: t.db, now, env: {}, notify: null, alert: null }, fake, sub.id);
      assert.equal((await getEntitlement({ db: t.db }, c.tenantId, "clinic"))?.status, "active");
      assert.ok((await getSelfTrial({ db: t.db }, c.tenantId))?.convertedAt);
    });

    it("review 7: the trial's reports never become extras of the plan's first month", async () => {
      const startAt = clock;
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      await firstVisit(c);
      const draft = (id: string) => recordUsageEvent({ db: t.db, now }, c.tenantId, { kind: "drafting_call", reportId: id, episodeFp: "fp_trial_episode_0007", succeeded: true, usage: { inputTokens: 10, outputTokens: 10 } });
      for (let i = 1; i <= 10; i++) await draft(`rpt_trial_x_${i}`);
      clock += 60_000;
      const { fake } = await pay(c.tenantId, ["clindesk_small_monthly", "clindesk_reports_25_monthly"]);
      clock += 60_000;
      for (let i = 1; i <= 20; i++) await draft(`rpt_paid_x_${i}`); // 30 counted in November, 25 included
      clock = Date.parse("2026-12-02T10:00:00.000Z");
      const subRow = await getClinicSubscription({ db: t.db }, c.tenantId);
      assert.ok(subRow);
      const out = await billExtraReports({ db: t.db, now }, fake, subRow, null);
      assert.deepEqual(out.billed, [], "20 paid reports of 25 – no extras (the 10 trial ones were free)");
      const row = await getBillingExtra({ db: t.db }, c.tenantId, "2026-11");
      assert.deepEqual([row?.reportsCounted, row?.extraReports, row?.status], [20, 0, "skipped"]);
      clock = startAt;
    });

    it("review 8: a product the plan leaves out stays READABLE (read-only, 'add … to keep working on these') when the trial left data in it", async () => {
      // ClinDesk only: the trial's reports stay readable in the Studio, nothing new.
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      await firstVisit(c);
      // A report made during the trial (an encrypted row as the store writes it – the payload's content does not matter here).
      const at = now().toISOString();
      await t.db.insertInto("reports").values({ tenant_id: c.tenantId, id: "rpt_trial_kept", rev: 1, status: "draft", form_id: null, template_id: "ia-v1", payload_enc: "v1.t1.fictional.fictional", created_at: at, updated_at: at, delete_after: null }).execute();
      await pay(c.tenantId, ["clindesk_small_monthly"]);
      assert.equal((await getEntitlement({ db: t.db }, c.tenantId, "reports"))?.status, "trial", "kept on (readable), not paused");
      assert.equal((await trialWriteBlock(t.db, c.tenantId, "reports", now()))?.reason, "read_only");
      assert.equal(await trialWriteBlock(t.db, c.tenantId, "clinic", now()), null, "the paid product writes as normal");
      const profile = await loadClinicProfile(t.db, c.tenantId, now());
      assert.match(profile?.productReadOnly ?? "", /Read-only – these records are from your free trial[\s\S]*Add the Reports add-on/);
      await assert.rejects(
        assertTenantMayCreate({ clinicProfile: async () => profile } as never, c.tenantId as never, "report"),
        (err: unknown) => (err as { init?: { code?: string } }).init?.code === "READ_ONLY",
      );
      const banner = await trialBannerState(t.db, c.tenantId, clinicAccessOf(await getClinicPlan({ db: t.db }, c.tenantId), now()), true, "reports");
      assert.equal(banner?.state, "read_only");
      // A later sync (any change) never switches the kept product off; buying the add-on makes it active again.
      const again = await pay(c.tenantId, ["clindesk_small_monthly", "clindesk_reports_25_monthly"]);
      void again;
      assert.equal((await getEntitlement({ db: t.db }, c.tenantId, "reports"))?.status, "active");
      assert.equal(await trialWriteBlock(t.db, c.tenantId, "reports", now()), null);
      // ClinForms only after a ClinDesk trial with patients: the clinic system stays readable, writes refused.
      const f = await signedUpClinic("clinic");
      await start(f, "clinic");
      await firstVisit(f);
      await createPatient({ db: t.db, cipher, now }, f.tenantId, { firstName: "Megan", lastName: "Hart" }, { userId: f.userId, sessionId: null });
      await pay(f.tenantId, ["clinforms_starter_monthly"]);
      assert.equal((await getEntitlement({ db: t.db }, f.tenantId, "clinic"))?.status, "trial");
      assert.equal((await trialWriteBlock(t.db, f.tenantId, "clinic", now()))?.reason, "read_only");
      assert.match((await trialWriteBlock(t.db, f.tenantId, "clinic", now()))?.message ?? "", /Add ClinDesk to your plan/);
      assert.equal(await countPatients({ db: t.db, cipher, now }, f.tenantId), 1, "the record is kept and readable");
      assert.ok(!(await clinicsWithClinicSystem({ db: t.db, cipher, now })).includes(f.tenantId), "nothing sent from a read-only clinic system");
    });

    it("review 5: a trial ClinForms staff set by hand sees nothing new in the clinic system (no visit noted, no banner)", async () => {
      const manual = await signedUpClinic("clinic");
      await setClinicTrial({ db: t.db, now }, manual.tenantId, { days: 3, startOnFirstSignIn: true });
      assert.equal(await clinicShellTrial(t.db, { tenantId: manual.tenantId, userId: manual.userId, role: "owner" }, true), null);
      const plan = await getClinicPlan({ db: t.db }, manual.tenantId);
      assert.deepEqual([plan?.trialStartsAt, plan?.ownerFirstSignInAt], [null, null], "the shell did not start it");
      const self = await signedUpClinic("clinic");
      await start(self, "clinic");
      const b = await clinicShellTrial(t.db, { tenantId: self.tenantId, userId: self.userId, role: "owner" }, true);
      assert.equal(b?.state, "trial");
      assert.ok((await getClinicPlan({ db: t.db }, self.tenantId))?.trialStartsAt, "a self-serve trial starts there");
    });

    it("review 6: free reports are reserved atomically – 25 parallel reservations, never more than 10; a release gives one back", async () => {
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      const ctx = { db: t.db, now };
      const results = await Promise.all(Array.from({ length: 25 }, (_, i) => reserveTrialReport(ctx, c.tenantId, `rpt_par_${i}`, "fp_trial_episode_0006")));
      assert.equal(results.filter((r) => r === "reserved").length, 10);
      assert.equal(results.filter((r) => r === "full").length, 15);
      assert.equal((await getSelfTrial({ db: t.db }, c.tenantId))?.reportsReserved, 10);
      const held = results.findIndex((r) => r === "reserved");
      assert.equal(await reserveTrialReport(ctx, c.tenantId, `rpt_par_${held}`, "fp_trial_episode_0006"), "held");
      await releaseTrialReport(ctx, c.tenantId, `rpt_par_${held}`, "fp_trial_episode_0006");
      await releaseTrialReport(ctx, c.tenantId, `rpt_par_${held}`, "fp_trial_episode_0006"); // twice: once only
      assert.equal((await getSelfTrial({ db: t.db }, c.tenantId))?.reportsReserved, 9);
      assert.equal(await reserveTrialReport(ctx, c.tenantId, "rpt_par_new", "fp_trial_episode_0006"), "reserved");
      assert.equal(await reserveTrialReport(ctx, c.tenantId, "rpt_par_new2", "fp_trial_episode_0006"), "full");
      // Through the Report API's recorder (the production path).
      const recorder = dbUsageRecorder(() => t.db, { now });
      assert.equal(await recorder.reserveTrialReport?.(c.tenantId, "rpt_par_new3", ""), "full");
    });

    it("review 12: an owner who got an email never gets it again when another owner's send failed; paid meanwhile = skipped", async () => {
      const c = await signedUpClinic("clinic");
      const second = { id: `u-trial-second-${n}`, email: `second${n}@larkfield-physio.example` };
      const at = now().toISOString();
      const org = await t.db.selectFrom("organization").select("id").where("slug", "=", c.tenantId).executeTakeFirstOrThrow();
      await t.db.insertInto("user").values({ id: second.id, name: "Sam Second", email: second.email, emailVerified: true, image: null, createdAt: at, updatedAt: at, twoFactorEnabled: true }).execute();
      await t.db.insertInto("member").values({ id: `m-${second.id}`, organizationId: org.id, userId: second.id, role: "owner", createdAt: at }).execute();
      await start(c, "clinic");
      failFor = second.email;
      await firstVisit(c);
      failFor = null;
      assert.equal(kindsSent(c.email).length, 1);
      assert.equal(kindsSent(second.email).length, 0);
      await sweep();
      assert.equal(kindsSent(c.email).length, 1, "the owner who got it: not again");
      assert.equal(kindsSent(second.email).length, 1, "the other owner: retried");
      // A payment between the schedule and the send: a trial email that is not "paid" is skipped.
      const d = await signedUpClinic("clinic");
      await start(d, "clinic");
      await firstVisit(d);
      await t.db.updateTable("self_trial").set({ converted_at: now().toISOString() }).where("tenant_id", "=", d.tenantId).execute();
      const trial = await getSelfTrial({ db: t.db }, d.tenantId);
      assert.equal(await sendTrialEmail(t.db, trial!, "four_days", { env: ENV, now }), "skipped");
      assert.equal(kindsSent(d.email).filter((x) => /4 days/.test(x)).length, 0);
    });

    it("review 12: the 'paid' email speaks for the product bought (a ClinDesk trial paying for ClinForms → ClinForms)", async () => {
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      await firstVisit(c);
      const notifier = emailBillingNotifier(() => t.db, ENV);
      await pay(c.tenantId, ["clinforms_starter_monthly"], new FakeSubscriptions(), notifier);
      const paid = sent.filter((m) => m.to.email === c.email && /paid/.test(m.subject));
      assert.equal(paid.length, 1);
      assert.match(paid[0].subject, /You're on a paid ClinForms plan/);
      assert.equal(paid[0].brand, undefined, "ClinForms' sender");
      assert.match(paid[0].html, /http:\/\/localhost:3000\/app\/settings\/billing/);
    });

    it("review 10: the sample clinic is made in short resumable steps (no request runs long) and is its owner's alone", async () => {
      const c = await signedUpClinic("clinic");
      await start(c, "clinic");
      await firstVisit(c);
      const steps: string[] = [];
      let r = await createSampleClinic({ db: t.db, cipher, now, patients: 12, budgetMs: 0 }, { tenantId: c.tenantId, userId: c.userId });
      for (let i = 0; i < 10 && r.status === "in_progress"; i++) {
        steps.push(`${r.step}/${r.steps}`);
        r = await createSampleClinic({ db: t.db, cipher, now, patients: 12, budgetMs: 0 }, { tenantId: c.tenantId, userId: c.userId });
      }
      assert.equal(r.status, "created");
      assert.deepEqual(steps, ["1/6", "2/6", "3/6", "4/6", "5/6"], "one step per call");
      const slug = r.status === "created" ? r.sampleTenantId : "";
      const org = await t.db.selectFrom("organization").select(["id", "metadata"]).where("slug", "=", slug).executeTakeFirstOrThrow();
      assert.match(String(org.metadata), /"sampleOf"/, "marked as a sample (invitations and new members are refused – self-signup.test.ts)");
      assert.equal((await t.db.selectFrom("member").select("id").where("organizationId", "=", org.id).execute()).length, 1);
      assert.ok((await countPatients({ db: t.db, cipher, now }, slug)) >= 12);
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
    /* ------------------------------------------------------------ 14/11/2026: after an unpaid trial (run last) */

    /** 03:17 UTC on a UK day – the daily cron's moment. */
    const cronAt = (day: string) => Date.parse(`${day}T03:17:00.000Z`);
    const retention = () => runTrialRetentionSweep(t.db, { env: ENV, now, maxDeletions: 1000 });
    const warningsTo = (email: string) => sent.filter((m) => m.to.email === email && /trial clinic will be deleted/.test(m.subject));
    const orgRow = (slug: string) => t.db.selectFrom("organization").select(["id", "metadata"]).where("slug", "=", slug).executeTakeFirst();
    const closed = async (slug: string) => /"offboardedAt"/.test(String((await orgRow(slug))?.metadata ?? ""));
    /** A self-serve trial that has started (first sign-in), with one patient; its trial's end as a UK day. */
    async function endedTrialClinic(brand: "clinic" | "clinforms" = "clinic") {
      const c = await signedUpClinic(brand);
      await start(c, brand);
      await firstVisit(c);
      if (brand === "clinic") await createPatient({ db: t.db, cipher, now }, c.tenantId, { firstName: "Megan", lastName: "Hart" }, { userId: c.userId, sessionId: null });
      const endsAt = (await getClinicPlan({ db: t.db }, c.tenantId))?.trialEndsAt as string;
      return { ...c, endsAt, endDay: londonDay(endsAt) };
    }
    /** What the subscription sync's conversion leaves (plan paid + trial converted) – for a payment mid-deletion. */
    const markPaid = async (tenantId: string) => {
      await endClinicTrial({ db: t.db, now }, tenantId, "paid");
      await markTrialConverted({ db: t.db, now }, tenantId);
    };

    it("unpaid trial: kept read-only for 90 days, ONE warning 14 days before (with the date), deleted on day 91 – everything but the trial record and the audit trail", async () => {
      const saved = clock;
      const c = await endedTrialClinic("clinic");
      const ctx = { db: t.db, cipher, now };
      try {
        // 75 days after the end (the retention cron's old test) and day 76: nothing.
        for (const d of [75, 76]) {
          clock = cronAt(addUkDays(c.endDay, d));
          await retention();
        }
        assert.equal(warningsTo(c.email).length, 0, "no warning before day 77");
        assert.equal(await closed(c.tenantId), false);
        // Day 77 (14 days before day 91): one warning, the date in it, the date recorded.
        clock = cronAt(addUkDays(c.endDay, 77));
        await retention();
        await retention();
        const w = warningsTo(c.email);
        assert.equal(w.length, 1, "exactly one warning, a re-run sends nothing");
        const deletionDay = addUkDays(c.endDay, 91);
        const long = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(ukDayStart(deletionDay)).replace(",", "");
        assert.equal(w[0].subject, `Your ClinDesk trial clinic will be deleted on ${long}`);
        assert.equal(w[0].brand, "clinic");
        assert.match(w[0].html, /http:\/\/clinic\.localhost:3000\/app\/settings\/billing/);
        assert.match(w[0].text, /Export CSV/);
        assert.equal((await getSelfTrial({ db: t.db }, c.tenantId))?.deletionDueAt, ukDayStart(deletionDay).toISOString());
        // The banner says how long the data is kept (the same day).
        const banner = await trialBannerState(t.db, c.tenantId, clinicAccessOf(await getClinicPlan({ db: t.db }, c.tenantId), now()), true, "clinic");
        assert.equal(banner && "selfServe" in banner ? banner.selfServe?.keptUntil : null, deletionDay);
        // Day 90: still kept (the 90-day boundary).
        clock = cronAt(addUkDays(c.endDay, 90));
        assert.deepEqual(await deleteUnpaidTrialClinic(t.db, c.tenantId, { now }), { status: "skipped", why: "not_due" });
        await retention();
        assert.equal(await closed(c.tenantId), false, "day 90: kept");
        assert.equal(await countPatients(ctx, c.tenantId), 1);
        // Day 91: deleted.
        clock = cronAt(deletionDay);
        const r = await retention();
        assert.ok(r.deleted >= 1);
        assert.equal(await closed(c.tenantId), true, "the organization row stays as a tombstone");
        assert.equal(await countPatients(ctx, c.tenantId, "any"), 0, "the clinic system's records are gone");
        assert.equal(await getClinicPlan({ db: t.db }, c.tenantId), null);
        assert.equal((await t.db.selectFrom("member").select("id").where("organizationId", "=", (await orgRow(c.tenantId))!.id).execute()).length, 0);
        assert.equal(await t.db.selectFrom("user").select("id").where("id", "=", c.userId).executeTakeFirst(), undefined, "the owner's account (no other clinic) is gone");
        const trial = await getSelfTrial({ db: t.db }, c.tenantId);
        assert.ok(trial?.deletedAt, "the trial record is kept and marked (abuse brakes)");
        const audit = await listAudit({ db: t.db }, c.tenantId, { action: "clinic.offboard" });
        const off = audit.filter((a) => a.action === "clinic.offboard");
        assert.equal(off.length, 1);
        assert.equal((off[0].detail as Record<string, unknown>)?.withoutExport, "trial_expired");
        // Later nights: nothing more – no second deletion, no email.
        const before = sent.length;
        clock = cronAt(addUkDays(deletionDay, 1));
        await retention();
        await sweep();
        assert.equal(sent.length, before);
        assert.equal((await listAudit({ db: t.db }, c.tenantId, { action: "clinic.offboard" })).filter((a) => a.action === "clinic.offboard").length, 1);
      } finally {
        clock = saved;
      }
    });

    it("unpaid trial: two runs at once warn once and delete once; a ClinForms trial gets ClinForms' warning", async () => {
      const saved = clock;
      const c = await endedTrialClinic("clinforms");
      try {
        clock = cronAt(addUkDays(c.endDay, 77));
        await Promise.all([retention(), retention()]);
        const w = warningsTo(c.email);
        assert.equal(w.length, 1);
        assert.match(w[0].subject, /^Your ClinForms trial clinic will be deleted on /);
        assert.equal(w[0].brand, undefined, "ClinForms' sender");
        clock = cronAt(addUkDays(c.endDay, 91));
        await Promise.all([retention(), retention(), deleteUnpaidTrialClinic(t.db, c.tenantId, { now })]);
        assert.equal(await closed(c.tenantId), true);
        assert.equal((await listAudit({ db: t.db }, c.tenantId, { action: "clinic.offboard" })).filter((a) => a.action === "clinic.offboard").length, 1, "deleted once");
      } finally {
        clock = saved;
      }
    });

    it("no warning delivered = no deletion: the provider refused it → held; sent the next night with 14 days from THAT day", async () => {
      const saved = clock;
      const c = await endedTrialClinic("clinic");
      try {
        clock = cronAt(addUkDays(c.endDay, 77));
        failFor = c.email;
        const r1 = await retention();
        assert.ok(r1.held >= 1);
        assert.equal(warningsTo(c.email).length, 0);
        // Day 91 without a delivered warning: never deleted.
        failFor = null;
        clock = cronAt(addUkDays(c.endDay, 91));
        failFor = c.email;
        await retention();
        assert.equal(await closed(c.tenantId), false, "never deleted without a warning that reached the owner");
        failFor = null;
        // Day 92: the retry goes – it promises day 92 + 14 = day 106.
        clock = cronAt(addUkDays(c.endDay, 92));
        await retention();
        const w = warningsTo(c.email);
        assert.equal(w.length, 1);
        assert.equal((await getSelfTrial({ db: t.db }, c.tenantId))?.deletionDueAt, ukDayStart(addUkDays(c.endDay, 106)).toISOString());
        clock = cronAt(addUkDays(c.endDay, 105));
        await retention();
        assert.equal(await closed(c.tenantId), false, "day 105: the promised day has not come");
        clock = cronAt(addUkDays(c.endDay, 106));
        await retention();
        assert.equal(await closed(c.tenantId), true);
      } finally {
        failFor = null;
        clock = saved;
      }
    });

    it("never deleted: a clinic that paid after the warning, one converted by hand, a hand-set trial (Blue Heart's kind), an open subscription", async () => {
      const saved = clock;
      const paidLate = await endedTrialClinic("clinic");
      const byHand = await endedTrialClinic("clinforms");
      const subOpen = await endedTrialClinic("clinforms");
      const manual = await signedUpClinic("clinforms");
      await setClinicTrial({ db: t.db, now }, manual.tenantId, { days: 3, startOnFirstSignIn: false });
      const ctx = { db: t.db, cipher, now };
      try {
        // Converted by hand on the platform page (the plan only) before its warning day.
        await endClinicTrial({ db: t.db, now }, byHand.tenantId, "paid");
        clock = cronAt(addUkDays(paidLate.endDay, 77));
        await retention();
        assert.equal(warningsTo(paidLate.email).length, 1);
        // Paid after the warning (the subscription sync: plan paid + converted).
        await pay(paidLate.tenantId, ["clindesk_small_monthly"]);
        await t.db
          .insertInto("clinic_subscription")
          .values({
            tenant_id: subOpen.tenantId,
            customer_ref: "cus_test_fictional_0001",
            subscription_ref: "sub_test_fictional_0001",
            mode: "test",
            status: "incomplete",
            state: "pending_payment",
            rev: 1,
            created_at: now().toISOString(),
            updated_at: now().toISOString(),
          } as never)
          .execute();
        for (const d of [91, 120, 400]) {
          clock = cronAt(addUkDays(paidLate.endDay, d));
          await retention();
        }
        for (const c of [paidLate, byHand, subOpen, manual]) assert.equal(await closed(c.tenantId), false, c.tenantId);
        assert.equal(await countPatients(ctx, paidLate.tenantId), 1, "the paid clinic's records are kept");
        assert.equal(warningsTo(byHand.email).length, 0, "converted by hand before its warning day: no warning");
        assert.equal(warningsTo(manual.email).length, 0, "a hand-set trial gets nothing");
        assert.equal((await deleteUnpaidTrialClinic(t.db, paidLate.tenantId, { now })).status, "skipped");
        assert.deepEqual(await deleteUnpaidTrialClinic(t.db, manual.tenantId, { now }), { status: "skipped", why: "not_self_serve" });
        assert.deepEqual(await deleteUnpaidTrialClinic(t.db, subOpen.tenantId, { now }), { status: "skipped", why: "subscription" });
      } finally {
        clock = saved;
      }
    });

    it("the paid state is re-read right before the clinic is deleted (a payment while the deletion runs stops it)", { skip: options.sample === false ? "needs a sample clinic (covered on SQLite/PGlite)" : false }, async () => {
      const saved = clock;
      const c = await endedTrialClinic("clinic");
      try {
        // A sample clinic made during the trial.
        clock = Date.parse((await getClinicPlan({ db: t.db }, c.tenantId))?.trialStartsAt as string) + DAY;
        let s = await createSampleClinic({ db: t.db, cipher, now, patients: 12, budgetMs: 60_000 }, { tenantId: c.tenantId, userId: c.userId });
        for (let i = 0; i < 10 && s.status === "in_progress"; i++) s = await createSampleClinic({ db: t.db, cipher, now, patients: 12, budgetMs: 60_000 }, { tenantId: c.tenantId, userId: c.userId });
        assert.equal(s.status, "created");
        clock = cronAt(addUkDays(c.endDay, 77));
        await retention();
        clock = cronAt(addUkDays(c.endDay, 91));
        const r = await deleteUnpaidTrialClinic(t.db, c.tenantId, {
          now,
          // The payment lands while the sample clinic is being deleted (after its check, before the clinic's own).
          beforeDelete: async (id, reason) => {
            if (reason !== "trial_expired_sample") return;
            assert.notEqual(id, c.tenantId);
            await markPaid(c.tenantId);
          },
        });
        assert.deepEqual(r, { status: "skipped", why: "converted" });
        assert.equal(await closed(c.tenantId), false, "the clinic that paid is kept");
        assert.equal(await countPatients({ db: t.db, cipher, now }, c.tenantId), 1);
        assert.equal((await getSelfTrial({ db: t.db }, c.tenantId))?.deletionClaimedAt, null, "the claim was given back");
      } finally {
        clock = saved;
      }
    });

    it("an unpaid trial's sample clinic is deleted with it (first); a paid clinic's sample clinic is never touched", { skip: options.sample === false ? "sample seed covered on SQLite/PGlite" : false }, async () => {
      const saved = clock;
      const unpaid = await endedTrialClinic("clinic");
      const paid = await endedTrialClinic("clinic");
      const ctx = { db: t.db, cipher, now };
      try {
        const samples: Record<string, string> = {};
        for (const c of [unpaid, paid]) {
          clock = Date.parse((await getClinicPlan({ db: t.db }, c.tenantId))?.trialStartsAt as string) + DAY;
          let s = await createSampleClinic({ db: t.db, cipher, now, patients: 12, budgetMs: 60_000 }, { tenantId: c.tenantId, userId: c.userId });
          for (let i = 0; i < 10 && s.status === "in_progress"; i++) s = await createSampleClinic({ db: t.db, cipher, now, patients: 12, budgetMs: 60_000 }, { tenantId: c.tenantId, userId: c.userId });
          assert.equal(s.status, "created");
          samples[c.tenantId] = s.status === "created" ? s.sampleTenantId : "";
        }
        await pay(paid.tenantId, ["clindesk_small_monthly"]);
        for (const d of [77, 91, 200]) {
          clock = cronAt(addUkDays(unpaid.endDay, d));
          await retention();
        }
        assert.equal(await closed(unpaid.tenantId), true);
        assert.equal(await closed(samples[unpaid.tenantId]), true, "its sample clinic too");
        assert.equal(await countPatients(ctx, samples[unpaid.tenantId], "any"), 0);
        assert.ok((await getSelfTrial({ db: t.db }, samples[unpaid.tenantId]))?.deletedAt);
        assert.equal(await t.db.selectFrom("user").select("id").where("id", "=", unpaid.userId).executeTakeFirst(), undefined, "the owner (a member of both) is gone");
        assert.equal(await closed(paid.tenantId), false);
        assert.equal(await closed(samples[paid.tenantId]), false, "a paid clinic's sample clinic is untouched");
        assert.ok((await countPatients(ctx, samples[paid.tenantId])) >= 12);
      } finally {
        clock = saved;
      }
    });

    it("'Remove sample clinic': the OWNER of a paid clinic only, after a claim; removes the sample clinic only, audited; once", { skip: options.sample === false ? "sample seed covered on SQLite/PGlite" : false }, async () => {
      const saved = clock;
      const c = await endedTrialClinic("clinic");
      const ctx = { db: t.db, cipher, now };
      try {
        clock = Date.parse((await getClinicPlan({ db: t.db }, c.tenantId))?.trialStartsAt as string) + DAY;
        let s = await createSampleClinic({ db: t.db, cipher, now, patients: 12, budgetMs: 60_000 }, { tenantId: c.tenantId, userId: c.userId });
        for (let i = 0; i < 10 && s.status === "in_progress"; i++) s = await createSampleClinic({ db: t.db, cipher, now, patients: 12, budgetMs: 60_000 }, { tenantId: c.tenantId, userId: c.userId });
        const sample = s.status === "created" ? s.sampleTenantId : "";
        assert.ok(sample);
        // An administrator of the clinic (not its owner).
        const at = now().toISOString();
        const org = (await orgRow(c.tenantId))!;
        await t.db.insertInto("user").values({ id: `u-admin-${n}`, name: "Sam Reed", email: `sam${n}@larkfield-physio.example`, emailVerified: true, image: null, createdAt: at, updatedAt: at, twoFactorEnabled: true }).execute();
        await t.db.insertInto("member").values({ id: `m-admin-${n}`, organizationId: org.id, userId: `u-admin-${n}`, role: "admin", createdAt: at }).execute();
        // Before paying: no button, refused.
        assert.equal(await sampleRemovalOffer(t.db, c.tenantId, c.userId, "owner", now()), null);
        assert.deepEqual(await removeSampleClinic({ db: t.db, now }, { tenantId: c.tenantId, userId: c.userId }), { status: "unavailable", why: "not_paid" });
        await pay(c.tenantId, ["clindesk_small_monthly"]);
        // Owner only.
        assert.equal(await sampleRemovalOffer(t.db, c.tenantId, `u-admin-${n}`, "admin", now()), null);
        assert.deepEqual(await removeSampleClinic({ db: t.db, now }, { tenantId: c.tenantId, userId: `u-admin-${n}` }), { status: "unavailable", why: "not_owner" });
        assert.deepEqual(await removeSampleClinic({ db: t.db, now }, { tenantId: c.tenantId, userId: "u-not-a-member" }), { status: "unavailable", why: "not_owner" });
        assert.deepEqual(await sampleRemovalOffer(t.db, c.tenantId, c.userId, "owner", now()), { sampleTenantId: sample });
        // From the sample clinic itself: nothing to remove there.
        assert.equal(await sampleRemovalOffer(t.db, sample, c.userId, "owner", now()), null);
        // Two clicks at once: one removal.
        const [a, b] = await Promise.all([removeSampleClinic({ db: t.db, now }, { tenantId: c.tenantId, userId: c.userId }), removeSampleClinic({ db: t.db, now }, { tenantId: c.tenantId, userId: c.userId })]);
        assert.deepEqual([a, b].filter((x) => x.status === "removed").length, 1, JSON.stringify([a, b]));
        assert.equal(await closed(sample), true);
        assert.equal(await countPatients(ctx, sample, "any"), 0);
        assert.equal(await closed(c.tenantId), false, "the clinic itself is untouched");
        assert.equal(await countPatients(ctx, c.tenantId), 1, "its records too");
        assert.ok(await t.db.selectFrom("user").select("id").where("id", "=", c.userId).executeTakeFirst(), "the owner's account is kept");
        assert.equal((await getSelfTrial({ db: t.db }, c.tenantId))?.sampleState, "removed");
        const audit = await listAudit({ db: t.db }, c.tenantId, { action: "clinic.sample_removed" });
        assert.ok(audit.some((x) => x.action === "clinic.sample_removed" && x.userId === c.userId), "audited in the clinic, by the owner");
        const sampleAudit = await listAudit({ db: t.db }, sample, { action: "clinic.offboard" });
        assert.ok(sampleAudit.some((x) => x.action === "clinic.offboard" && (x.detail as Record<string, unknown>)?.withoutExport === "sample_removed"));
        // Afterwards: no button, nothing to remove, and the offer to create one never comes back.
        assert.equal(await sampleRemovalOffer(t.db, c.tenantId, c.userId, "owner", now()), null);
        assert.deepEqual(await removeSampleClinic({ db: t.db, now }, { tenantId: c.tenantId, userId: c.userId }), { status: "unavailable", why: "no_sample" });
      } finally {
        clock = saved;
      }
    });

    it("review H1: staff extend the trial after the warning → that warning no longer counts; a fresh one 14 days before the NEW date", async () => {
      const saved = clock;
      const c = await endedTrialClinic("clinforms");
      try {
        clock = cronAt(addUkDays(c.endDay, 77));
        await retention();
        assert.equal(warningsTo(c.email).length, 1);
        // Day 80: staff extend the ended trial by 7 days (from now).
        clock = cronAt(addUkDays(c.endDay, 80));
        await extendClinicTrial({ db: t.db, now }, c.tenantId, 7);
        const newEnd = (await getClinicPlan({ db: t.db }, c.tenantId))?.trialEndsAt as string;
        const newDay = londonDay(newEnd);
        // The old date comes and goes: nothing deleted (the trial even runs again for a while).
        for (const d of [91, 100]) {
          clock = cronAt(addUkDays(c.endDay, d));
          await retention();
          assert.equal(await closed(c.tenantId), false, `old day ${d}`);
        }
        // New end + 91 without a new warning: still nothing (the old warning promised another day).
        clock = cronAt(addUkDays(newDay, 91));
        assert.deepEqual(await deleteUnpaidTrialClinic(t.db, c.tenantId, { now }), { status: "skipped", why: "not_warned" });
        // The sweep at new end + 77: a second warning for the new date; then deleted on new end + 91.
        clock = cronAt(addUkDays(newDay, 77));
        await retention();
        assert.equal(warningsTo(c.email).length, 2, "a fresh warning for the new date");
        assert.equal((await getSelfTrial({ db: t.db }, c.tenantId))?.deletionDueAt, ukDayStart(addUkDays(newDay, 91)).toISOString());
        clock = cronAt(addUkDays(newDay, 90));
        await retention();
        assert.equal(await closed(c.tenantId), false);
        clock = cronAt(addUkDays(newDay, 91));
        await retention();
        assert.equal(await closed(c.tenantId), true);
      } finally {
        clock = saved;
      }
    });

    it("review M2: a deletion that stopped part-way keeps its claim and is finished by a later run (after 30 minutes)", async () => {
      const saved = clock;
      const c = await endedTrialClinic("clinic");
      try {
        clock = cronAt(addUkDays(c.endDay, 77));
        await retention();
        clock = cronAt(addUkDays(c.endDay, 91));
        // As if the offboarding's first batch ran (the plan row is gone) and the run then died.
        await assert.rejects(
          deleteUnpaidTrialClinic(t.db, c.tenantId, {
            now,
            beforeDelete: async (id) => {
              await t.db.deleteFrom("clinic_plan").where("tenant_id", "=", id).execute();
              throw new Error("killed");
            },
          }),
          /killed/,
        );
        assert.ok((await getSelfTrial({ db: t.db }, c.tenantId))?.deletionClaimedAt, "the claim is kept once deleting began");
        await retention();
        assert.equal(await closed(c.tenantId), false, "within 30 minutes: another run may still be working");
        clock += 31 * 60_000;
        const r = await retention();
        assert.ok(r.resumed >= 1);
        assert.equal(await closed(c.tenantId), true, "finished");
        assert.equal(await countPatients({ db: t.db, cipher, now }, c.tenantId, "any"), 0);
        assert.ok((await getSelfTrial({ db: t.db }, c.tenantId))?.deletedAt);
      } finally {
        clock = saved;
      }
    });

    it("review: a payment page opened in the last 48 hours holds the deletion", async () => {
      const saved = clock;
      const c = await endedTrialClinic("clinforms");
      try {
        clock = cronAt(addUkDays(c.endDay, 77));
        await retention();
        clock = cronAt(addUkDays(c.endDay, 91));
        await appendAudit({ db: t.db, now }, c.tenantId, { userId: c.userId, action: "clinic.subscription_checkout", targetType: "clinic_subscription", targetId: c.tenantId, detail: { plan: ["clinforms_starter_monthly"] } });
        assert.deepEqual(await deleteUnpaidTrialClinic(t.db, c.tenantId, { now }), { status: "skipped", why: "checkout" });
        await retention();
        assert.equal(await closed(c.tenantId), false);
        clock += 2 * DAY;
        await retention();
        assert.equal(await closed(c.tenantId), true, "the page expired unpaid: deleted");
      } finally {
        clock = saved;
      }
    });

    it("review M3: a sample clinic whose own trial row was never written (a crash) is still found by its organization and deleted with the clinic", { skip: options.sample === false ? "sample seed covered on SQLite/PGlite" : false }, async () => {
      const saved = clock;
      const c = await endedTrialClinic("clinic");
      try {
        clock = Date.parse((await getClinicPlan({ db: t.db }, c.tenantId))?.trialStartsAt as string) + DAY;
        const s1 = await createSampleClinic({ db: t.db, cipher, now, patients: 12, budgetMs: 0 }, { tenantId: c.tenantId, userId: c.userId });
        assert.equal(s1.status, "in_progress");
        const sample = s1.status === "in_progress" ? s1.sampleTenantId : "";
        await t.db.deleteFrom("self_trial").where("tenant_id", "=", sample).execute();
        // An unrelated clinic that happens to carry a sample-like id is never touched.
        clock = cronAt(addUkDays(c.endDay, 77));
        await retention();
        clock = cronAt(addUkDays(c.endDay, 91));
        await retention();
        assert.equal(await closed(c.tenantId), true);
        assert.equal(await closed(sample), true, "the orphan sample clinic went too");
        assert.equal(await t.db.selectFrom("user").select("id").where("id", "=", c.userId).executeTakeFirst(), undefined, "so the owner's account is gone");
      } finally {
        clock = saved;
      }
    });

    it("14/11/2026: a self-serve trial has no made-up-notes wording on the drafting switch; a hand-set trial keeps it", async () => {
      const c = await signedUpClinic("clinforms");
      await start(c, "clinforms");
      await firstVisit(c);
      assert.equal(await clinicTrialRunning(t.db, c.tenantId, now()), false, "self-serve: the standard wording");
      const manual = await signedUpClinic("clinforms");
      await setClinicTrial({ db: t.db, now }, manual.tenantId, { days: 3, startOnFirstSignIn: false });
      assert.equal(await clinicTrialRunning(t.db, manual.tenantId, now()), true, "hand-set: made-up notes only, as before");
    });
  });
}
