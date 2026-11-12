/**
 * TESTS ONLY: bulk email's repository and sending suite (0146, tracker xt02) – the clinic's setting, drafts,
 * the audience (consent, deceased / archived / merged / anonymised, under 18, no email, one email per address, the
 * filters), schedule and cancel, sending through the outbox and the test provider (footer, headers, signed
 * unsubscribe link with the message), consent re-checked at send, the daily cap, the unsubscribe link (one click,
 * idempotent, counted per campaign), encryption at rest, two clinics, the permission gate (reception never, the
 * switch off = not found). Run on node:sqlite and PGlite (../campaigns-repos.test.ts) and on D1 through the gateway
 * (workers/data-gateway/test/pms-comms-campaigns-stack.test.ts). Ends with the tenant-scope guard.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import { canWith, effectivePermissions } from "../../../../../modules/pms/core/permissions";
import type { Database } from "../../../../db/schema";
import { testCipher } from "../../../../db/testing/databases";
import { listAudit } from "../../../audit";
import { RepoInputError, type RepoContext } from "../../../context";
import { createPractitioner, createService, createSite } from "../../directory";
import { setEntitlement } from "../../entitlements";
import { createPatient, getPatient, setPatientStatus, touchPatientLastSeen } from "../../patients";
import { unscopedStatements, type QueryLog } from "../../testing/guarded-db";
import {
  campaignReport,
  cancelCampaign,
  countAudience,
  createCampaign,
  getBulkEmailSettings,
  getCampaign,
  getCampaignSummary,
  listCampaigns,
  scheduleCampaign,
  updateBulkEmailSettings,
  updateCampaign,
} from "../campaigns";
import { changeConsent, listConsentEvents } from "../consent";
import { normaliseAudience, type AudienceFilters } from "../../../../../modules/pms/comms/campaigns";
import type { DispatchDeps } from "../../../../pms/comms/dispatch";
import { runCampaigns } from "../../../../pms/comms/campaigns/send";
import { audienceCountFor, bulkEmailAvailable, mayUseBulkEmail, saveCampaignFor, setMarketingConsentFor, marketingConsentFor, type CampaignActor } from "../../../../pms/comms/campaigns/service";
import { verifyStopToken } from "../../../../pms/comms/links";
import { outboxEmail, outboxSms } from "../../../../pms/comms/providers/outbox";
import { clearTestOutbox, testEmail, testOutbox, testSms } from "../../../../pms/comms/providers/test";
import { handleUnsubscribe } from "../../../../pms/comms/unsubscribe";

export interface CampaignsSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
  log?: QueryLog;
}

const A = "riverside-a";
const B = "harbour-b";
const OWNER = { userId: "user_owner_01", sessionId: "sess_01" };
const OWNER_B = { userId: "user_owner_b", sessionId: "sess_b" };
const LINK_SECRET = "campaigns-suite-link-secret-".padEnd(43, "x");
const ORIGIN = "https://clinic.example.com";

export function defineCampaignsRepoSuite(label: string, factory: () => Promise<CampaignsSuiteDb>): void {
  describe(`bulk email on ${label}`, () => {
    let suite: CampaignsSuiteDb;
    let ctx: RepoContext;
    // Thursday 12 November 2026, 10:00 UTC.
    let clock = Date.parse("2026-11-12T10:00:00.000Z");
    const ids: Record<string, string> = {};
    const outbox: DispatchDeps = {
      providers: { sms: outboxSms, email: outboxEmail },
      linkSecret: LINK_SECRET,
      linkOrigin: ORIGIN,
    };
    const test: DispatchDeps = {
      providers: { sms: testSms, email: testEmail },
      linkSecret: LINK_SECRET,
      linkOrigin: ORIGIN,
    };
    const marketing = (extra: Record<string, unknown> = {}) => ({
      marketingEmail: true,
      marketingConsentSource: "written" as const,
      ...extra,
    });
    const all: AudienceFilters = normaliseAudience({});
    const nowIsoText = () => new Date(clock).toISOString();
    const base = {
      name: "Winter newsletter",
      subject: "News from {clinic_name}",
      body: "Hello {first_name},\n\nOur new Pilates classes start in January.\n\n- Mondays 18:00\n- Thursdays 09:30",
      purpose: "marketing" as const,
    };

    const actorFor = (role: string, tenantId = A): CampaignActor => ({
      tenantId,
      userId: role === "staff" ? "user_reception_01" : OWNER.userId,
      name: "Helen Ward",
      email: "helen.ward@riverside-demo.example.com",
      role,
      can: canWith(effectivePermissions({ role })),
      actor: role === "staff" ? { userId: "user_reception_01", sessionId: "sess_r" } : OWNER,
      repo: () => ctx,
      siteIds: null,
    });

    async function appointment(patientId: string, startsAt: string, status = "booked") {
      const id = `appt_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
      const ends = new Date(Date.parse(startsAt) + 30 * 60_000).toISOString();
      await ctx.db
        .insertInto("pms_appointments")
        .values({
          tenant_id: A,
          id,
          rev: 1,
          kind: "appointment",
          site_id: ids.site,
          practitioner_id: ids.prac,
          room_id: null,
          patient_id: patientId,
          case_id: null,
          service_id: ids.svc,
          authorisation_id: null,
          series_id: null,
          starts_at: startsAt,
          ends_at: ends,
          starts_on: startsAt.slice(0, 10),
          status,
          source: "staff",
          fee_due: 0,
          auth_session_used: 0,
          created_at: nowIsoText(),
          updated_at: nowIsoText(),
        } as never)
        .execute();
    }

    before(async () => {
      suite = await factory();
      ctx = { db: suite.db, cipher: testCipher(), now: () => new Date(clock) };
      for (const [t, who] of [
        [A, OWNER],
        [B, OWNER_B],
      ] as const)
        await setEntitlement(ctx, t, "clinic", { status: "trial" }, who);
      const site = await createSite(
        ctx,
        A,
        {
          name: "Bletchley (fictional)",
          phone: "01632 960101",
          address: ["2 Station Parade (fictional)", "Bletchley"],
          postcode: "MK2 9ZZ",
        },
        OWNER,
      );
      const other = await createSite(
        ctx,
        A,
        {
          name: "Wolverton (fictional)",
          address: ["18 Market Row (fictional)"],
          postcode: "MK12 9ZZ",
        },
        OWNER,
      );
      const prac = await createPractitioner(
        ctx,
        A,
        {
          displayName: "Sarah Reid",
          registrationNumber: "PH-DEMO-01",
          defaultSiteId: site.id,
        },
        OWNER,
      );
      const svc = await createService(ctx, A, { name: "Follow-up", durationMinutes: 30 }, OWNER);
      Object.assign(ids, {
        site: site.id,
        other: other.id,
        prac: prac.id,
        svc: svc.id,
      });
      const mk = async (key: string, input: Record<string, unknown>, t = A, who = OWNER) => {
        ids[key] = (await createPatient(ctx, t, { lastName: "Example (fictional)", ...input } as never, who)).id;
      };
      await mk("megan", {
        firstName: "Megan",
        preferredName: "Meg",
        dateOfBirth: "1991-11-22",
        email: "Megan.Hart@example.com",
        ...marketing(),
      });
      await mk("daniel", {
        firstName: "Daniel",
        dateOfBirth: "1980-03-01",
        email: "daniel.brooks@example.com",
      });
      await mk("famA", {
        firstName: "Asha",
        dateOfBirth: "1975-01-01",
        email: "family@example.com",
        ...marketing(),
      });
      await mk("famB", {
        firstName: "Ben",
        dateOfBirth: "1977-01-01",
        email: "FAMILY@example.com",
        ...marketing(),
      });
      await mk("teen", {
        firstName: "Tia",
        dateOfBirth: "2012-05-05",
        email: "tia@example.com",
        ...marketing(),
      });
      await mk("dead", {
        firstName: "Dora",
        dateOfBirth: "1940-01-01",
        email: "dora@example.com",
        ...marketing(),
      });
      await mk("arch", {
        firstName: "Archie",
        dateOfBirth: "1960-01-01",
        email: "archie@example.com",
        ...marketing(),
      });
      await mk("anon", {
        firstName: "Ana",
        dateOfBirth: "1950-01-01",
        email: "ana@example.com",
        ...marketing(),
      });
      await mk("merged", {
        firstName: "Mo",
        dateOfBirth: "1950-01-01",
        email: "mo@example.com",
        ...marketing(),
      });
      await mk("noemail", {
        firstName: "Nell",
        dateOfBirth: "1970-01-01",
        ...marketing(),
      });
      await mk("bounce", {
        firstName: "Bo",
        dateOfBirth: "1985-01-01",
        email: "bounce@example.com",
        ...marketing(),
      });
      await mk("noDob", {
        firstName: "Nia",
        email: "nia@example.com",
        ...marketing(),
      });
      await mk("noReminders", {
        firstName: "Rex",
        dateOfBirth: "1970-01-01",
        email: "rex@example.com",
        reminderEmail: false,
      });
      await mk(
        "otherClinic",
        {
          firstName: "Olive",
          dateOfBirth: "1970-01-01",
          email: "olive@example.com",
          ...marketing(),
        },
        B,
        OWNER_B,
      );
      await setPatientStatus(ctx, A, ids.dead, "deceased", OWNER);
      await setPatientStatus(ctx, A, ids.arch, "archived", OWNER);
      await ctx.db.updateTable("pms_patients").set({ merged_into_id: ids.megan }).where("tenant_id", "=", A).where("id", "=", ids.merged).execute();
      await ctx.db
        .insertInto("pms_patient_anonymisations")
        .values({
          tenant_id: A,
          id: "anon_01JTESTANONYMISATION000001",
          patient_id: ids.anon,
          status: "done",
          started_at: nowIsoText(),
          done_at: nowIsoText(),
          by_user_id: OWNER.userId,
          counts_json: null,
          created_at: nowIsoText(),
          updated_at: nowIsoText(),
        })
        .execute();
      await touchPatientLastSeen(ctx, A, ids.megan, "2026-10-20");
      await touchPatientLastSeen(ctx, A, ids.famA, "2025-01-10");
      await appointment(ids.megan, "2026-11-20T10:00:00.000Z");
      await appointment(ids.famA, "2026-09-01T10:00:00.000Z", "attended");
      await appointment(ids.daniel, "2026-11-25T11:00:00.000Z");
    });
    after(async () => {
      await suite?.close();
    });

    it("the setting: off until an owner switches it on; revision-checked", async () => {
      const s0 = await getBulkEmailSettings(ctx, A);
      assert.deepEqual([s0.rev, s0.enabled, s0.dailyCap], [0, false, 500]);
      // Off: nothing is sent even for a due campaign (checked below once one exists).
      const r1 = await updateBulkEmailSettings(ctx, A, 0, { enabled: true, dailyCap: 500 }, OWNER);
      assert.equal(r1.ok, true);
      assert.deepEqual(await updateBulkEmailSettings(ctx, A, 0, { enabled: false, dailyCap: 500 }, OWNER), { ok: false, reason: "conflict", currentRev: 1 });
      await assert.rejects(updateBulkEmailSettings(ctx, A, 1, { enabled: true, dailyCap: 0 }, OWNER), RepoInputError);
      assert.equal((await getBulkEmailSettings(ctx, B)).enabled, false, "clinic B unaffected");
    });

    it("the audience: consent, the records never emailed, one per address, filters", async () => {
      const now = nowIsoText();
      // Marketing: megan, famA+famB (one address), bounce, noDob → 5 patients, 4 addresses. Never: teen (under 18),
      // dead, archived, anonymised, merged, no email, daniel (no consent), rex (no consent), clinic B.
      assert.deepEqual(await countAudience(ctx, A, all, "marketing", now), {
        patients: 5,
        addresses: 4,
      });
      // Service: everyone active with an email who has not stopped reminder emails: megan, daniel, famA, famB, teen, bounce, noDob.
      assert.deepEqual(await countAudience(ctx, A, all, "service", now), {
        patients: 7,
        addresses: 6,
      });
      assert.deepEqual(await countAudience(ctx, B, all, "marketing", now), {
        patients: 1,
        addresses: 1,
      });
      const f = (a: Record<string, unknown>) => normaliseAudience(a as never);
      assert.equal((await countAudience(ctx, A, f({ lastSeenMonths: 3 }), "marketing", now)).patients, 1, "megan seen in October");
      assert.equal((await countAudience(ctx, A, f({ lastSeenMonths: 24 }), "marketing", now)).patients, 2);
      assert.equal((await countAudience(ctx, A, f({ upcoming: "yes" }), "marketing", now)).patients, 1);
      assert.equal((await countAudience(ctx, A, f({ upcoming: "yes" }), "service", now)).patients, 2, "megan and daniel");
      assert.equal((await countAudience(ctx, A, f({ upcoming: "no" }), "marketing", now)).patients, 4);
      assert.equal((await countAudience(ctx, A, f({ siteId: ids.site }), "marketing", now)).patients, 2, "megan (booked) and famA (attended)");
      assert.equal((await countAudience(ctx, A, f({ siteId: ids.other }), "marketing", now)).patients, 0);
      assert.equal((await countAudience(ctx, A, f({ minAge: 40, maxAge: 49 }), "marketing", now)).patients, 2, "bounce (41) and Ben (49)");
      assert.equal((await countAudience(ctx, A, f({ minAge: 10, maxAge: 17 }), "service", now)).patients, 1, "teen gets service, never marketing");
      assert.equal((await countAudience(ctx, A, f({ minAge: 10, maxAge: 17 }), "marketing", now)).patients, 0);
    });

    it("drafts: validated, encrypted at rest, changed only while a draft, never seen by another clinic", async () => {
      await assert.rejects(createCampaign(ctx, A, { ...base, purpose: "service" }, OWNER), /service announcement/);
      await assert.rejects(createCampaign(ctx, A, { ...base, body: "<b>hi</b>" }, OWNER), /HTML/);
      const c = await createCampaign(ctx, A, base, OWNER);
      ids.c1 = c.id;
      const raw = await ctx.db.selectFrom("pms_email_campaigns").selectAll().where("tenant_id", "=", A).where("id", "=", c.id).executeTakeFirstOrThrow();
      assert.doesNotMatch(`${raw.subject_enc}${raw.body_enc}`, /News from|Pilates/, "no plaintext in the row");
      assert.equal((await getCampaign(ctx, A, c.id))?.subject, base.subject);
      assert.equal(await getCampaign(ctx, B, c.id), null);
      // A ciphertext moved to another row does not decrypt.
      const c2 = await createCampaign(ctx, A, { ...base, name: "Copy" }, OWNER);
      await ctx.db.updateTable("pms_email_campaigns").set({ body_enc: raw.body_enc }).where("tenant_id", "=", A).where("id", "=", c2.id).execute();
      await assert.rejects(getCampaign(ctx, A, c2.id));
      await cancelCampaign(ctx, A, c2.id, OWNER);
      const u = await updateCampaign(ctx, A, c.id, 1, { ...base, subject: "Pilates at {clinic_name}" }, OWNER);
      assert.equal(u.ok, true);
      assert.deepEqual(await updateCampaign(ctx, A, c.id, 1, base, OWNER), {
        ok: false,
        reason: "conflict",
        currentRev: 2,
      });
      assert.equal((await listCampaigns(ctx, B)).length, 0);
    });

    it("schedule in the future → not sent early; cancel before sending; a cancelled email stays cancelled", async () => {
      const c = await createCampaign(ctx, A, { ...base, name: "Later" }, OWNER);
      assert.equal(await scheduleCampaign(ctx, A, c.id, 1, "2026-11-20T09:00:00.000Z", OWNER), true);
      assert.equal(await scheduleCampaign(ctx, A, c.id, 1, "2026-11-20T09:00:00.000Z", OWNER), false, "no longer a draft");
      const r = await runCampaigns(ctx, A, outbox, { actor: OWNER });
      assert.equal(r.written, 0);
      assert.equal((await getCampaignSummary(ctx, A, c.id))?.status, "scheduled");
      assert.equal(await cancelCampaign(ctx, A, c.id, OWNER), true);
      assert.equal(await cancelCampaign(ctx, A, c.id, OWNER), false);
      clock = Date.parse("2026-11-21T10:00:00.000Z");
      assert.equal((await runCampaigns(ctx, A, outbox, { actor: OWNER })).written, 0);
      assert.equal((await getCampaignSummary(ctx, A, c.id))?.status, "cancelled");
      assert.equal((await campaignReport(ctx, A, c.id)).recipients, 0);
      clock = Date.parse("2026-11-12T10:00:00.000Z");
    });

    it("the clinic's setting off: a due campaign waits", async () => {
      const s = await getBulkEmailSettings(ctx, A);
      await updateBulkEmailSettings(ctx, A, s.rev, { enabled: false, dailyCap: 500 }, OWNER);
      const c = await createCampaign(ctx, A, { ...base, name: "Waits" }, OWNER);
      await scheduleCampaign(ctx, A, c.id, 1, nowIsoText(), OWNER);
      assert.equal((await runCampaigns(ctx, A, outbox, { actor: OWNER })).written, 0);
      assert.equal((await getCampaignSummary(ctx, A, c.id))?.status, "scheduled");
      await cancelCampaign(ctx, A, c.id, OWNER);
      const s2 = await getBulkEmailSettings(ctx, A);
      await updateBulkEmailSettings(ctx, A, s2.rev, { enabled: true, dailyCap: 500 }, OWNER);
    });

    it("send (outbox provider): one message per address, kept in the outbox, report counts", async () => {
      const c = await getCampaign(ctx, A, ids.c1);
      assert.ok(c);
      assert.equal(await scheduleCampaign(ctx, A, c.id, c.rev, nowIsoText(), OWNER), true);
      const r = await runCampaigns(ctx, A, outbox, {
        actor: OWNER,
        onlyCampaignId: c.id,
      });
      assert.deepEqual([r.campaigns, r.written, r.outbox, r.skipped, r.finished], [1, 4, 4, 0, 1]);
      const s = await getCampaignSummary(ctx, A, c.id);
      assert.deepEqual([s?.status, s?.recipientsTotal], ["sent", 4]);
      const report = await campaignReport(ctx, A, c.id);
      assert.deepEqual([report.recipients, report.outbox, report.sent, report.failed, report.unsubscribed], [4, 4, 0, 0, 0]);
      const msgs = await ctx.db.selectFrom("pms_messages").select(["purpose", "kind", "status", "address_key"]).where("tenant_id", "=", A).where("kind", "=", "marketing").execute();
      assert.equal(msgs.length, 4);
      assert.ok(msgs.every((m) => m.purpose === "marketing" && m.status === "outbox"));
      assert.equal(msgs.filter((m) => m.address_key === "family@example.com").length, 1, "one email per address");
      assert.equal(msgs.filter((m) => m.address_key === "megan.hart@example.com").length, 1, "address keys lower case");
      // Running again sends nothing more.
      assert.equal((await runCampaigns(ctx, A, outbox, { actor: OWNER })).written, 0);
    });

    it("send (test provider): footer, headers, a signed link for that patient and message; a bounce fails", async () => {
      clearTestOutbox();
      const c = await createCampaign(ctx, A, { ...base, name: "Test provider" }, OWNER);
      ids.c2 = c.id;
      await scheduleCampaign(ctx, A, c.id, 1, nowIsoText(), OWNER);
      const r = await runCampaigns(ctx, A, test, { actor: OWNER });
      assert.deepEqual([r.written, r.sent, r.failed], [4, 3, 1]);
      const meg = testOutbox.email.find((e) => e.to.toLowerCase() === "megan.hart@example.com");
      assert.ok(meg, "sent to her address");
      assert.equal(meg.subject, `News from ${meg.fromName}`);
      assert.match(meg.text, /^Hello Meg,/, "the preferred name");
      assert.match(meg.text, /2 Station Parade \(fictional\), Bletchley, MK2 9ZZ/, "a site's postal address when the clinic profile has none");
      assert.match(meg.text, /agreed to receive news and offers/);
      assert.equal(meg.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
      const url = /^<(.+)>$/.exec(meg.headers["List-Unsubscribe"])?.[1] ?? "";
      assert.ok(url.startsWith(`${ORIGIN}/api/clinic-messages/unsubscribe?t=`));
      assert.ok(meg.text.includes(url) && meg.html.includes(url.replace(/&/g, "&amp;")), "the link is in the footer too");
      const link = verifyStopToken(new URL(url).searchParams.get("t"), LINK_SECRET, clock);
      assert.deepEqual([link?.tenantId, link?.patientId, link?.purpose, link?.channel, link?.messageId], [A, ids.megan, "marketing", "email", meg.messageId]);
      assert.ok(!testOutbox.email.some((e) => /olive|tia|dora|archie|ana@|mo@|rex|daniel/i.test(e.to)), "nobody outside the audience");
      const report = await campaignReport(ctx, A, c.id);
      assert.deepEqual([report.sent, report.failed, report.outbox], [3, 1, 0]);
      ids.megUrl = url;
    });

    it("unsubscribe: GET changes nothing; one-click POST withdraws, records the message, idempotent, counted", async () => {
      const deps = { secret: LINK_SECRET, ctx: () => ctx, nowMs: () => clock };
      const get = await handleUnsubscribe(new Request(ids.megUrl), deps);
      assert.equal(get.status, 200);
      assert.match(await get.text(), /Stop news and offers by email from/);
      assert.equal((await getPatient(ctx, A, ids.megan))?.marketingEmail, true, "GET changes nothing");
      const post = () =>
        handleUnsubscribe(
          new Request(ids.megUrl, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: "List-Unsubscribe=One-Click",
          }),
          deps,
        );
      const p1 = await post();
      assert.equal(p1.status, 200);
      assert.equal((await getPatient(ctx, A, ids.megan))?.marketingEmail, false);
      const p2 = await post();
      assert.equal(p2.status, 200, "a second click answers the same");
      const events = (await listConsentEvents(ctx, A, ids.megan)).filter((e) => e.purpose === "marketing" && e.channel === "email" && e.action === "opt_out");
      assert.equal(events.length, 1, "recorded once");
      assert.equal(events[0].source, "email_link");
      assert.ok(events[0].messageId);
      assert.equal((await campaignReport(ctx, A, ids.c2)).unsubscribed, 1);
      assert.equal((await campaignReport(ctx, A, ids.c1)).unsubscribed, 0, "counted against the email it came in");
      assert.deepEqual(await countAudience(ctx, A, all, "marketing", nowIsoText()), { patients: 4, addresses: 3 }, "no more marketing to her");
      // The marketing-email consent as the record shows it.
      process.env.CLINFORMS_BULK_EMAIL = "on";
      try {
        const v = await marketingConsentFor(actorFor("owner"), ids.megan);
        assert.ok(v.ok);
        assert.deepEqual([v.value.agreed, v.value.withdrawnHow, Boolean(v.value.withdrawnAt)], [false, "email_link", true]);
      } finally {
        delete process.env.CLINFORMS_BULK_EMAIL;
      }
    });

    it("a service announcement's link stops reminder emails, named as such", async () => {
      clearTestOutbox();
      const c = await createCampaign(
        ctx,
        A,
        {
          ...base,
          name: "Closure",
          purpose: "service",
          serviceReason: "Bletchley closes 24/12 to 2/1",
          subject: "Christmas opening",
          body: "Hello {first_name}, we close from 24/12.",
        },
        OWNER,
      );
      await scheduleCampaign(ctx, A, c.id, 1, nowIsoText(), OWNER);
      const r = await runCampaigns(ctx, A, test, { actor: OWNER });
      assert.equal(r.written, 6);
      const dan = testOutbox.email.find((e) => e.to === "daniel.brooks@example.com");
      assert.ok(dan, "a service announcement needs no marketing consent");
      assert.match(dan.text, /service announcement/);
      const url = /^<(.+)>$/.exec(dan.headers["List-Unsubscribe"])?.[1] ?? "";
      const deps = { secret: LINK_SECRET, ctx: () => ctx, nowMs: () => clock };
      assert.match(await (await handleUnsubscribe(new Request(url), deps)).text(), /Stop reminder and announcement emails/);
      await handleUnsubscribe(
        new Request(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "confirm=1",
        }),
        deps,
      );
      assert.equal((await getPatient(ctx, A, ids.daniel))?.reminderEmail, false);
      assert.equal((await campaignReport(ctx, A, c.id)).unsubscribed, 1);
    });

    it("consent is checked again at the moment of sending; the daily cap holds the rest for tomorrow", async () => {
      const s = await getBulkEmailSettings(ctx, A);
      await updateBulkEmailSettings(ctx, A, s.rev, { enabled: true, dailyCap: 500 }, OWNER);
      // Today's campaign emails so far: 4 + 4 + 6 = 14. A cap of 15 leaves room for one.
      const s1 = await getBulkEmailSettings(ctx, A);
      await updateBulkEmailSettings(ctx, A, s1.rev, { enabled: true, dailyCap: 15 }, OWNER);
      await changeConsent(
        ctx,
        A,
        {
          patientId: ids.megan,
          channel: "email",
          purpose: "marketing",
          value: true,
          source: "staff",
          marketingConsentSource: "verbal",
        },
        OWNER,
      );
      const c = await createCampaign(ctx, A, { ...base, name: "Capped" }, OWNER);
      await scheduleCampaign(ctx, A, c.id, 1, nowIsoText(), OWNER);
      const r1 = await runCampaigns(ctx, A, outbox, { actor: OWNER });
      assert.deepEqual([r1.written, r1.capReached], [1, true]);
      assert.equal((await getCampaignSummary(ctx, A, c.id))?.status, "sending");
      // Before the rest goes: Asha's family address withdraws, Bo's record is archived.
      await changeConsent(
        ctx,
        A,
        {
          patientId: ids.famA,
          channel: "email",
          purpose: "marketing",
          value: false,
          source: "staff",
        },
        OWNER,
      );
      await setPatientStatus(ctx, A, ids.bounce, "archived", OWNER);
      clock = Date.parse("2026-11-13T10:00:00.000Z");
      const r2 = await runCampaigns(ctx, A, outbox, { actor: OWNER });
      assert.equal(r2.finished, 1);
      const report = await campaignReport(ctx, A, c.id);
      assert.equal(report.recipients, 4);
      assert.equal(report.outbox + report.skipped, 4);
      assert.ok(report.skipped >= 1, JSON.stringify(report));
      assert.ok((report.skipReasons.no_marketing_consent ?? 0) + (report.skipReasons.archived ?? 0) + (report.skipReasons.not_in_audience ?? 0) >= 1, JSON.stringify(report.skipReasons));
      clock = Date.parse("2026-11-12T10:00:00.000Z");
    });

    it("the gate: the switch off = not found; reception never; owners/admins only change the setting", async () => {
      delete process.env.CLINFORMS_BULK_EMAIL;
      assert.equal(bulkEmailAvailable(), false);
      const off = await audienceCountFor(actorFor("owner"), "marketing", {});
      assert.equal(off.ok ? null : off.code, "not_found");
      process.env.CLINFORMS_BULK_EMAIL = "on";
      try {
        assert.equal(mayUseBulkEmail(actorFor("owner")), true);
        assert.equal(mayUseBulkEmail(actorFor("admin")), true);
        assert.equal(mayUseBulkEmail(actorFor("clinician")), false, "no messages.templates by default");
        // Reception refused even with the permission granted.
        const reception = { ...actorFor("staff"), can: () => true };
        assert.equal(mayUseBulkEmail(reception), false);
        const r = await saveCampaignFor(reception, null, null, base);
        assert.equal(r.ok ? null : r.code, "forbidden");
        const ok = await audienceCountFor(actorFor("owner"), "marketing", {});
        assert.ok(ok.ok && ok.value.patients >= 1);
        // Reception may record consent on the record (patients.edit) – it cannot send marketing.
        const rec = await setMarketingConsentFor(actorFor("staff"), ids.daniel, true, "verbal");
        assert.deepEqual(rec, { ok: true, value: { changed: true } });
        const noHow = await setMarketingConsentFor(actorFor("staff"), ids.daniel, true, null);
        assert.equal(noHow.ok, false);
        assert.equal((await setMarketingConsentFor(actorFor("owner", B), ids.daniel, false, null)).ok, false, "another clinic's patient");
      } finally {
        delete process.env.CLINFORMS_BULK_EMAIL;
      }
    });

    it("audit rows: labelled codes, no patient data", async () => {
      const rows = await listAudit(ctx, A, { limit: 500 });
      const codes = new Set(rows.map((r) => r.action));
      for (const code of [
        "pms.bulk_email_settings.update",
        "pms.email_campaign.create",
        "pms.email_campaign.update",
        "pms.email_campaign.schedule",
        "pms.email_campaign.cancel",
        "pms.email_campaign.start",
        "pms.email_campaign.send",
        "pms.email_campaign.finish",
      ])
        assert.ok(codes.has(code), code);
      const text = JSON.stringify(rows.filter((r) => r.action.startsWith("pms.email_campaign")));
      assert.doesNotMatch(text, /example\.com|Megan|Pilates/);
    });

    it("tenant scope: every statement names tenant_id", () => {
      if (suite.log) assert.deepEqual(unscopedStatements(suite.log.statements), []);
    });
  });
}
