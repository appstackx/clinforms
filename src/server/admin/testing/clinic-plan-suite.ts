/**
 * TESTS ONLY: trials, drafting limits and demo clinics per clinic (10/2026) – the clinic_plan repository, the audited
 * admin layer (platform page and scripts), the owner's first visit, what the Report API sees (loadClinicProfile) and offboarding –
 * run unchanged on every database: node:sqlite and PGlite (src/server/admin/clinic-plan.test.ts), D1 through the
 * in-process gateway Worker and real local D1 (workers/data-gateway/test/admin-stack.test.ts).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../db/schema";
import { testCipher } from "../../db/testing/databases";
import { assertTenantMayCreate } from "../../../modules/medreport/auth/clinic-access";
import { PLATFORM_USER_ID } from "../../auth/create-auth";
import { clinicPlanForModule, loadClinicProfile } from "../../auth/medreport-actor";
import { offboardClinic } from "../../auth/platform";
import { appendAudit, listAudit } from "../../repos/audit";
import {
  clinicAccessOf,
  endClinicTrial,
  extendClinicTrial,
  getClinicPlan,
  noteOwnerAccess,
  setClinicDemoFlag,
  setClinicDraftingLimits,
  setClinicTrial,
  trialDaysLeft,
} from "../../repos/clinic-plan";
import { upsertClinicProfile } from "../../repos/clinic-profile";
import { RepoInputError } from "../../repos/context";
import { upsertMemberProfile } from "../../repos/member-profile";
import { endTrial, extendTrial, isDemoClinic, noteClinicVisit, setDemoClinic, setDraftingLimits, setTrial } from "../clinic-plan";
import { PLATFORM_AUDIT_TENANT, listClinicsOverview, type PlatformAdmin } from "../platform-console";

export interface ClinicPlanSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
}

const DAY = 86_400_000;
const ADMIN: PlatformAdmin = { userId: "u-plan-admin", sessionId: "s-plan-admin", email: "ops@platform.example", name: "Ops" };
/** A clinic whose owner has not signed in yet (invited only). */
const NEW = "trial-new-test";
/** A clinic whose owner already signed in. */
const OWNED = "trial-owned-test";
/** A clinic for the repository-level checks. */
const REPO = "trial-repo-test";

async function clinic(db: Kysely<Database>, slug: string, withOwner: boolean, at: string): Promise<void> {
  const orgId = `org-${slug}`;
  await db.insertInto("organization").values({ id: orgId, name: `${slug} (fictional)`, slug, logo: null, createdAt: at, metadata: null }).execute();
  await upsertClinicProfile({ db, now: () => new Date(at) }, slug, { organizationId: orgId, displayName: `${slug} (fictional)`, draftingEnabled: true });
  if (withOwner) {
    const userId = `u-owner-${slug}`;
    await db.insertInto("user").values({ id: userId, name: "Olive Owner (fictional)", email: `${userId}@clinic.example`, emailVerified: true, image: null, createdAt: at, updatedAt: at, twoFactorEnabled: true }).execute();
    await db.insertInto("member").values({ id: `m-${userId}`, organizationId: orgId, userId, role: "owner", createdAt: at }).execute();
  }
}

export function defineClinicPlanSuite(label: string, factory: () => Promise<ClinicPlanSuiteDb>, options: { skip?: string | false } = {}): void {
  describe(`clinic trials and drafting limits – ${label}`, { skip: options.skip }, () => {
    let t: ClinicPlanSuiteDb;
    let clock = Date.parse("2026-10-24T09:00:00.000Z");
    const now = () => new Date(clock);
    const ctx = () => ({ db: t.db, now });

    before(async () => {
      t = await factory();
      const at = now().toISOString();
      await clinic(t.db, NEW, false, at);
      await clinic(t.db, OWNED, true, at);
      await clinic(t.db, REPO, true, at);
    });
    after(async () => {
      await t?.close();
    });

    it("repository: a trial waits for the owner's first visit, starts once, and ends by the clock", async () => {
      assert.equal(await getClinicPlan(ctx(), REPO), null);
      assert.deepEqual(clinicAccessOf(null, now()), { state: "full", plan: "none" });

      const pending = await setClinicTrial(ctx(), REPO, { days: 3, startOnFirstSignIn: true });
      assert.equal(pending.status, "trial");
      assert.equal(pending.trialDays, 3);
      assert.equal(pending.startOnFirstSignIn, true);
      assert.equal(pending.trialStartsAt, null);
      assert.equal(pending.trialEndsAt, null);
      assert.deepEqual(clinicAccessOf(pending, now()), { state: "trial", daysLeft: 3, endsAt: null, pending: true });

      clock += 2 * DAY; // the owner signs in two days after the trial was set: the 3 days start then
      const visits = await Promise.all([noteOwnerAccess(ctx(), REPO), noteOwnerAccess(ctx(), REPO)]);
      assert.equal(visits.filter((v) => v.trialStarted).length, 1, "concurrent first visits start the trial once");
      assert.equal(visits.filter((v) => v.firstVisit).length, 1, "and record the first visit once");
      const started = await getClinicPlan(ctx(), REPO);
      assert.ok(started?.trialStartsAt && started.trialEndsAt);
      assert.equal(started.ownerFirstSignInAt, now().toISOString());
      assert.equal(started.trialStartsAt, now().toISOString());
      assert.equal(Date.parse(started.trialEndsAt) - Date.parse(started.trialStartsAt), 3 * DAY);
      const again = await noteOwnerAccess(ctx(), REPO);
      assert.equal(again.firstVisit, false);
      assert.equal(again.trialStarted, false);

      assert.deepEqual(clinicAccessOf(started, now()), { state: "trial", daysLeft: 3, endsAt: started.trialEndsAt, pending: false });
      assert.equal(trialDaysLeft(started.trialEndsAt, new Date(Date.parse(started.trialEndsAt) - DAY - 3600_000)), 2);
      assert.equal(clinicAccessOf(started, new Date(Date.parse(started.trialEndsAt) - 60_000)).state, "trial");
      assert.deepEqual(clinicAccessOf(started, new Date(Date.parse(started.trialEndsAt) - 60_000)), {
        state: "trial",
        daysLeft: 1,
        endsAt: started.trialEndsAt,
        pending: false,
      });
      assert.deepEqual(clinicAccessOf(started, new Date(Date.parse(started.trialEndsAt))), { state: "trial_ended", endedAt: started.trialEndsAt });
    });

    it("repository: extend (running, ended, pending), end now, convert to paid, limits, and input checks", async () => {
      const running = await getClinicPlan(ctx(), REPO);
      assert.ok(running?.trialEndsAt);
      const extended = await extendClinicTrial(ctx(), REPO, 2);
      assert.equal(Date.parse(extended.trialEndsAt ?? "") - Date.parse(running.trialEndsAt), 2 * DAY, "a running trial ends 2 days later");
      clock = Date.parse(extended.trialEndsAt ?? "") + 10 * DAY; // long after it ended
      assert.equal(clinicAccessOf(await getClinicPlan(ctx(), REPO), now()).state, "trial_ended");
      const revived = await extendClinicTrial(ctx(), REPO, 1);
      assert.equal(revived.trialEndsAt, new Date(clock + DAY).toISOString(), "an ended trial runs again from now");
      const ended = await endClinicTrial(ctx(), REPO, "now");
      assert.equal(ended.trialEndsAt, now().toISOString());
      assert.equal(clinicAccessOf(ended, now()).state, "trial_ended");
      const paid = await endClinicTrial(ctx(), REPO, "paid");
      assert.equal(paid.status, "paid");
      assert.deepEqual(clinicAccessOf(paid, now()), { state: "full", plan: "paid" });
      await assert.rejects(extendClinicTrial(ctx(), REPO, 1), RepoInputError, "no trial to extend once converted");
      await assert.rejects(endClinicTrial(ctx(), REPO, "paid"), RepoInputError);

      const limited = await setClinicDraftingLimits(ctx(), REPO, { perMinute: 30, perDay: 1500 });
      assert.equal(limited.status, "paid", "limits keep the plan");
      assert.equal(limited.livePerMinute, 30);
      assert.equal(limited.livePerDay, 1500);
      const back = await setClinicDraftingLimits(ctx(), REPO, { perMinute: null, perDay: null });
      assert.equal(back.livePerMinute, null);
      assert.equal(back.livePerDay, null);

      // A pending trial grows instead.
      const waiting = await setClinicTrial(ctx(), REPO, { days: 3, startOnFirstSignIn: true });
      assert.equal(waiting.status, "trial");
      assert.equal(waiting.ownerFirstSignInAt !== null, true, "the earlier first visit is kept…");
      assert.equal(waiting.trialStartsAt, null, "…but a new trial waits for the next one");
      assert.equal((await extendClinicTrial(ctx(), REPO, 4)).trialDays, 7);

      for (const bad of [0, -1, 1.5, 367, Number.NaN]) {
        await assert.rejects(setClinicTrial(ctx(), REPO, { days: bad, startOnFirstSignIn: false }), RepoInputError, `days ${bad}`);
      }
      for (const bad of [0, 601, 2.5]) await assert.rejects(setClinicDraftingLimits(ctx(), REPO, { perMinute: bad, perDay: null }), RepoInputError);
      await assert.rejects(setClinicDraftingLimits(ctx(), REPO, { perMinute: null, perDay: 100_001 }), RepoInputError);
      await assert.rejects(setClinicTrial(ctx(), "Not A Slug", { days: 3, startOnFirstSignIn: true }), RepoInputError);
      // A clinic with only its own limits: a "standard" row, full access.
      const standard = await setClinicDraftingLimits(ctx(), OWNED, { perMinute: 20, perDay: null });
      assert.equal(standard.status, "standard");
      assert.deepEqual(clinicAccessOf(standard, now()), { state: "full", plan: "standard" });
    });

    it("admin layer: set (owner not yet signed in → waits; owner signed in → starts now), every change audited twice", async () => {
      clock = Date.parse("2026-10-24T09:00:00.000Z");
      const actor = { kind: "platform" as const, admin: ADMIN };
      const fresh = await setTrial(t.db, actor, NEW, { days: 3, start: "first_sign_in" }, now());
      assert.equal(fresh.startedNow, false);
      assert.equal(fresh.plan.trialEndsAt, null);
      assert.equal(fresh.access.state, "trial");

      const owned = await setTrial(t.db, actor, OWNED, { days: 3, start: "first_sign_in" }, now());
      assert.equal(owned.startedNow, true, "an owner already exists: they have signed in");
      assert.equal(owned.plan.trialEndsAt, new Date(clock + 3 * DAY).toISOString());

      const clinicRows = await listAudit({ db: t.db }, OWNED, { action: "clinic.trial_set" });
      assert.equal(clinicRows.length, 1);
      assert.equal(clinicRows[0].userId, PLATFORM_USER_ID, "the clinic's trail names ClinForms");
      assert.deepEqual(clinicRows[0].detail, { days: 3, start: "now", ownerAlreadySignedIn: true, endsAt: owned.plan.trialEndsAt });
      const platformRows = await listAudit({ db: t.db }, PLATFORM_AUDIT_TENANT, { action: "platform.trial_set" });
      assert.equal(platformRows.length, 2);
      assert.equal(platformRows[0].userId, ADMIN.userId, "the platform's trail names the administrator");
      assert.equal(platformRows[0].detail?.tenantId, OWNED);

      clock += DAY;
      await extendTrial(t.db, actor, OWNED, 2, now());
      await setDraftingLimits(t.db, actor, OWNED, { perMinute: 30, perDay: 1500 }, now());
      await endTrial(t.db, { kind: "script" }, OWNED, "now", now());
      await endTrial(t.db, { kind: "script" }, OWNED, "paid", now());
      const actions = (await listAudit({ db: t.db }, OWNED)).map((e) => e.action);
      for (const a of ["clinic.trial_set", "clinic.trial_extended", "clinic.limits_set", "clinic.trial_ended", "clinic.trial_converted"]) {
        assert.ok(actions.includes(a), a);
      }
      const platformActions = (await listAudit({ db: t.db }, PLATFORM_AUDIT_TENANT)).map((e) => e.action);
      assert.ok(platformActions.includes("platform.trial_extended") && platformActions.includes("platform.limits_set"));
      assert.ok(!platformActions.includes("platform.trial_converted"), "a script's change is in the clinic's trail only");

      await assert.rejects(setTrial(t.db, actor, "no-such-clinic", { days: 3, start: "now" }, now()), RepoInputError);
    });

    it("the owner's first visit starts a waiting trial (audited under the owner); other roles never do", async () => {
      assert.equal((await getClinicPlan({ db: t.db }, NEW))?.trialStartsAt, null);
      const staffVisit = await noteClinicVisit(t.db, { tenantId: NEW, userId: "u-staff", role: "staff" }, now());
      assert.deepEqual(staffVisit, { state: "trial", daysLeft: 3, endsAt: null, pending: true });
      assert.equal((await getClinicPlan({ db: t.db }, NEW))?.trialStartsAt, null, "a staff member's visit does not start it");
      const ownerVisit = await noteClinicVisit(t.db, { tenantId: NEW, userId: "u-owner-new", sessionId: "s-1", role: "owner" }, now());
      assert.equal(ownerVisit?.state, "trial");
      const started = await getClinicPlan({ db: t.db }, NEW);
      assert.equal(started?.trialStartsAt, now().toISOString());
      const rows = await listAudit({ db: t.db }, NEW, { action: "clinic.trial_started" });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].userId, "u-owner-new");
      await noteClinicVisit(t.db, { tenantId: NEW, userId: "u-owner-new", role: "owner" }, now());
      assert.equal((await listAudit({ db: t.db }, NEW, { action: "clinic.trial_started" })).length, 1, "once");
      assert.equal(await noteClinicVisit(t.db, { tenantId: "no-plan-clinic", userId: "x", role: "owner" }, now()), null, "no plan: no banner");
    });

    it("what the Report API sees: trial state, own limits and the contact address; platform overview", async () => {
      const before = await loadClinicProfile(t.db, NEW, now());
      assert.equal(before?.trial?.state, "running");
      assert.equal(before?.trial?.daysLeft, 3);
      assert.ok(before?.contactEmail?.includes("@"));
      assert.equal(before?.draftingLimits, undefined);
      const later = new Date(clock + 4 * DAY);
      const ended = await loadClinicProfile(t.db, NEW, later);
      assert.equal(ended?.trial?.state, "ended");
      const owned = await loadClinicProfile(t.db, OWNED, now());
      assert.equal(owned?.trial, undefined, "converted: no trial");
      assert.deepEqual(owned?.draftingLimits, { perMinute: 30, perDay: 1500 });
      assert.deepEqual(clinicPlanForModule(null), {});

      const overview = await listClinicsOverview(t.db, now());
      const fresh = overview.find((c) => c.tenantId === NEW);
      assert.equal(fresh?.access.state, "trial");
      assert.equal(overview.find((c) => c.tenantId === OWNED)?.plan?.livePerDay, 1500);
    });

    it("security fix 24/10 (authz L1): an ended trial is enforced even when the clinic has no clinic_profile row", async () => {
      const slug = "trial-noprofile-test";
      await setClinicTrial(ctx(), slug, { days: 1, startOnFirstSignIn: false });
      assert.equal(await loadClinicProfile(t.db, slug, now()), null, "running trial without a profile: nothing to enforce yet");
      const ended = await loadClinicProfile(t.db, slug, new Date(clock + 2 * DAY));
      assert.ok(ended, "a minimal profile carries the ended trial");
      assert.equal(ended.trial?.state, "ended");
      assert.equal(ended.draftingEnabled, false);
      assert.equal(ended.displayName, "");
      assert.deepEqual(ended.addressLines, []);
      await assert.rejects(
        assertTenantMayCreate({ clinicProfile: (id: string) => loadClinicProfile(t.db, id, new Date(clock + 2 * DAY)) } as never, slug, "report"),
        (err: unknown) => (err as { status?: number; init?: { code?: string } }).status === 403 && (err as { init?: { code?: string } }).init?.code === "TRIAL_ENDED",
      );
      assert.equal(await loadClinicProfile(t.db, "no-plan-no-profile", now()), null);
    });

    it("offboarding exports the plan and deletes it with the clinic", async () => {
      await appendAudit({ db: t.db }, NEW, { action: "report.create" });
      const dry = await offboardClinic(t.db, null, { slug: NEW });
      assert.equal(dry.dryRun, true);
      assert.ok(await getClinicPlan({ db: t.db }, NEW), "a dry run deletes nothing");
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-plan-offboard-"));
      try {
        const done = await offboardClinic(t.db, testCipher(), { slug: NEW, confirm: true, exportDir: path.join(dir, "export") });
        assert.equal(done.dryRun, false);
        const exported = JSON.parse(fs.readFileSync(path.join(dir, "export", "clinic.json"), "utf8")) as { clinicPlan?: { status?: string } };
        assert.equal(exported.clinicPlan?.status, "trial");
        assert.equal(await getClinicPlan({ db: t.db }, NEW), null);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      await assert.rejects(setTrial(t.db, { kind: "script" }, NEW, { days: 3, start: "now" }, now()), /closed/, "a closed clinic gets no trial");
      await assert.rejects(setDemoClinic(t.db, { kind: "script" }, NEW, true, now()), /closed/, "nor a demo flag");
    });

    it("demo clinics (0008): platform staff only, audited both ways, independent of the trial and the limits; what the app sees", async () => {
      const slug = "demo-clinic-test";
      const orgId = `org-${slug}`;
      await clinic(t.db, slug, true, now().toISOString());
      const actor = { kind: "platform" as const, admin: ADMIN };
      assert.equal(await isDemoClinic(t.db, slug), false, "a new clinic is a real clinic");
      assert.equal((await loadClinicProfile(t.db, slug, now()))?.demoClinic, undefined);
      assert.deepEqual(await setClinicDemoFlag(ctx(), slug, false), { changed: false, plan: null }, "off without a row: nothing written");
      assert.equal(await getClinicPlan(ctx(), slug), null);

      // On, from the platform page: a "standard" row (no trial, default limits), audited under the clinic and the platform.
      assert.deepEqual(await setDemoClinic(t.db, actor, slug, true, now()), { demoClinic: true, changed: true, membersWithDemoNumbers: 0 });
      const plan = await getClinicPlan(ctx(), slug);
      assert.deepEqual(
        { status: plan?.status, demoClinic: plan?.demoClinic, trialDays: plan?.trialDays, perDay: plan?.livePerDay },
        { status: "standard", demoClinic: true, trialDays: null, perDay: null },
      );
      assert.deepEqual(clinicAccessOf(plan, now()), { state: "full", plan: "standard" }, "a demo clinic is not a trial");
      assert.equal(await isDemoClinic(t.db, slug), true);
      assert.equal((await loadClinicProfile(t.db, slug, now()))?.demoClinic, true, "the Report API sees it");
      assert.equal(clinicPlanForModule(plan, now()).demoClinic, true);
      const onRows = await listAudit({ db: t.db }, slug, { action: "clinic.demo_on" });
      assert.equal(onRows.length, 1);
      assert.equal(onRows[0].userId, PLATFORM_USER_ID, "the clinic's trail names ClinForms");
      assert.deepEqual(onRows[0].detail, { demoClinic: true, membersWithDemoNumbers: 0 });
      const platformOn = (await listAudit({ db: t.db }, PLATFORM_AUDIT_TENANT, { action: "platform.demo_on" })).filter((r) => r.targetId === slug);
      assert.equal(platformOn.length, 1);
      assert.equal(platformOn[0].userId, ADMIN.userId, "the platform's trail names the administrator");
      assert.deepEqual(platformOn[0].detail, { tenantId: slug, demoClinic: true, membersWithDemoNumbers: 0 });

      // Already on: nothing written, nothing audited.
      assert.equal((await setDemoClinic(t.db, actor, slug, true, now())).changed, false);
      assert.equal((await listAudit({ db: t.db }, slug, { action: "clinic.demo_on" })).length, 1);

      // A trial and limits keep the flag; the clinic's own settings never touch it.
      await setTrial(t.db, { kind: "script" }, slug, { days: 3, start: "now" }, now());
      await setDraftingLimits(t.db, { kind: "script" }, slug, { perMinute: 10, perDay: 100 }, now());
      await upsertClinicProfile(ctx(), slug, { organizationId: orgId, displayName: `${slug} renamed (fictional)`, draftingEnabled: false });
      const both = await getClinicPlan(ctx(), slug);
      assert.deepEqual({ demo: both?.demoClinic, status: both?.status, perDay: both?.livePerDay }, { demo: true, status: "trial", perDay: 100 });
      assert.equal((await listClinicsOverview(t.db, now())).find((c) => c.tenantId === slug)?.plan?.demoClinic, true, "the platform overview");

      // Off, with the admin script: members holding a made-up number are counted (they cannot approve in a real clinic);
      // the trial and the limits stay; a script's change is in the clinic's trail only. Counts and flags, never a number.
      await upsertMemberProfile(ctx(), orgId, "u-demo-sarah", { hcpcNumber: "PH-DEMO-01", canSign: true });
      await upsertMemberProfile(ctx(), orgId, "u-real-sam", { hcpcNumber: "PH123456", canSign: true });
      assert.deepEqual(await setDemoClinic(t.db, { kind: "script" }, slug, false, now()), { demoClinic: false, changed: true, membersWithDemoNumbers: 1 });
      const after = await getClinicPlan(ctx(), slug);
      assert.deepEqual({ demo: after?.demoClinic, status: after?.status, perDay: after?.livePerDay }, { demo: false, status: "trial", perDay: 100 });
      assert.equal(await isDemoClinic(t.db, slug), false);
      assert.equal((await loadClinicProfile(t.db, slug, now()))?.demoClinic, undefined, "a real clinic again");
      const offRows = await listAudit({ db: t.db }, slug, { action: "clinic.demo_off" });
      assert.deepEqual(offRows.map((r) => [r.userId, r.detail]), [[PLATFORM_USER_ID, { demoClinic: false, membersWithDemoNumbers: 1 }]]);
      assert.ok(!(await listAudit({ db: t.db }, PLATFORM_AUDIT_TENANT)).some((r) => r.action === "platform.demo_off" && r.targetId === slug));
      assert.ok(!JSON.stringify([...onRows, ...offRows, ...platformOn]).includes("PH-DEMO"), "no number in the audit rows");

      // Unknown clinics are refused, and an unknown clinic never reads as a demo clinic.
      await assert.rejects(setDemoClinic(t.db, actor, "no-such-clinic", true, now()), RepoInputError);
      assert.equal(await isDemoClinic(t.db, "no-such-clinic"), false);
    });

    it("verify fix: an extension past 366 days in all is refused with a clear message (a running trial too), nothing changed", async () => {
      const slug = "trial-cap-test";
      await clinic(t.db, slug, true, now().toISOString());
      await setTrial(t.db, { kind: "script" }, slug, { days: 3, start: "now" }, now());
      const before = await getClinicPlan(ctx(), slug);
      await assert.rejects(extendTrial(t.db, { kind: "script" }, slug, 366, now()), (err: Error) => err instanceof RepoInputError && /The trial with its extension must be 1–366 days/.test(err.message));
      assert.deepEqual(await getClinicPlan(ctx(), slug), before, "unchanged");
      const ok = await extendTrial(t.db, { kind: "script" }, slug, 363, now());
      assert.equal(ok.trialDays, 366);
    });
  });
}
