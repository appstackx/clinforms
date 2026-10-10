/**
 * TESTS ONLY: the activity page and the platform page's data layer, run unchanged against every database the app
 * can use – node:sqlite and PGlite (src/server/admin/admin.test.ts), D1 through the in-process gateway Worker and
 * real local D1 (workers/data-gateway/test/admin-stack.test.ts).
 *
 * Who sees what (owners/administrators the whole clinic, clinicians/staff only their own entries, never another
 * clinic's or the platform's), cursor paging both ways with filters, the download's exact range, display names,
 * access requests marked as contacted, clinic creation from the platform, and the clinics overview.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { Database } from "../../db/schema";
import { setEmailProviderForTests } from "../../email";
import { PLATFORM_USER_ID } from "../../auth/create-auth";
import { findOpenInvitation } from "../../auth/membership";
import type { MemberRole } from "../../auth/roles";
import { createAccessRequest } from "../../repos/access-requests";
import { appendAudit, listAudit } from "../../repos/audit";
import type { DbContext } from "../../repos/context";
import {
  ACTIVITY_PAGE_SIZE,
  activityCsv,
  activityHref,
  activityQuery,
  activityScope,
  activityTargetHref,
  loadActivityLookups,
  loadActivityPage,
  loadActivityRange,
  parseActivityParams,
  presentActivity,
  type ActivityPage,
  type ActivityQuery,
  type ActivityViewer,
} from "../activity";
import {
  PLATFORM_AUDIT_TENANT,
  createClinicAsPlatform,
  lastActivityByTenant,
  listAccessRequestsForPlatform,
  listClinicsOverview,
  listPlatformActivity,
  markAccessRequest,
  type PlatformAdmin,
} from "../platform-console";
import { loadSetupChecklist } from "../setup-checklist";
import { upsertClinicProfile } from "../../repos/clinic-profile";
import { upsertMemberProfile } from "../../repos/member-profile";

export interface AdminSuiteDb {
  db: Kysely<Database>;
  close: () => Promise<void>;
}

const CLINIC = "activity-clinic";
const ORG = "org-activity-clinic";
const OTHER = "other-clinic";
const ORIGIN = "http://localhost:3000";
const LINK_SECRET = "admin-suite-secret-".padEnd(48, "s");

const PEOPLE: { userId: string; memberId: string; name: string; role: MemberRole }[] = [
  { userId: "u-owner", memberId: "m-owner", name: "Olivia Owner (fictional)", role: "owner" },
  { userId: "u-admin", memberId: "m-admin", name: "Adam Admin (fictional)", role: "admin" },
  { userId: "u-clin", memberId: "m-clin", name: "Clara Clinician (fictional)", role: "clinician" },
  { userId: "u-staff", memberId: "m-staff", name: "Sam Staff (fictional)", role: "staff" },
];

const ADMIN: PlatformAdmin = { userId: "u-platform-admin", sessionId: "s-platform-admin", email: "ops@platform.example", name: "Ops" };

function viewer(role: MemberRole): ActivityViewer {
  const person = PEOPLE.find((p) => p.role === role);
  assert.ok(person);
  return { tenantId: CLINIC, organizationId: ORG, role, userId: person.userId };
}

/** Every page of a query, following the older cursors from the newest page. */
async function walkOlder(ctx: DbContext, query: ActivityQuery, size: number): Promise<ActivityPage[]> {
  const pages: ActivityPage[] = [];
  let before: string | null = null;
  for (let i = 0; i < 100; i++) {
    const page = await loadActivityPage(ctx, { ...query, before, after: null }, size);
    pages.push(page);
    if (!page.olderCursor) return pages;
    before = page.olderCursor;
  }
  throw new Error("paging did not end");
}

export function defineAdminSuite(name: string, setup: () => Promise<AdminSuiteDb>, options: { skip?: string | false } = {}): void {
  describe(`activity and platform pages – ${name}`, { skip: options.skip }, () => {
    let t: AdminSuiteDb;
    let ctx: DbContext;
    let clock = Date.parse("2026-10-01T08:00:00.000Z");
    const tick = () => new Date((clock += 1000));
    /** Ids of the clinic's entries, newest first. */
    let clinicIds: string[] = [];

    before(async () => {
      t = await setup();
      ctx = { db: t.db, now: tick };
      setEmailProviderForTests({ name: "none", send: async () => ({ status: "not_sent", provider: "none" }) });
      const at = new Date(clock).toISOString();
      await t.db.insertInto("organization").values({ id: ORG, name: "Activity Clinic (fictional)", slug: CLINIC, logo: null, createdAt: at, metadata: null }).execute();
      for (const p of PEOPLE) {
        await t.db
          .insertInto("user")
          .values({ id: p.userId, name: p.name, email: `${p.userId}@clinic.example`, emailVerified: true, image: null, createdAt: at, updatedAt: at, twoFactorEnabled: true })
          .execute();
        await t.db.insertInto("member").values({ id: p.memberId, organizationId: ORG, userId: p.userId, role: p.role, createdAt: at }).execute();
      }
      // A former member: the account still exists, the membership does not.
      await t.db
        .insertInto("user")
        .values({ id: "u-former", name: "Fred Former (fictional)", email: "u-former@clinic.example", emailVerified: true, image: null, createdAt: at, updatedAt: at, twoFactorEnabled: true })
        .execute();

      // 125 entries in the clinic, by everyone, plus noise in another clinic and on the platform.
      const actions = ["auth.sign_in", "member.invite", "clinic.update", "api_key.create", "report.sign"];
      const writers = ["u-owner", "u-admin", "u-clin", "u-staff", "u-former"];
      for (let i = 0; i < 125; i++) {
        await appendAudit(ctx, CLINIC, { userId: writers[i % writers.length], sessionId: `s-${i}`, action: actions[i % actions.length], targetType: "user", targetId: writers[(i + 1) % writers.length] });
        if (i % 10 === 0) await appendAudit(ctx, OTHER, { userId: "u-owner", action: "auth.sign_in" });
        if (i % 25 === 0) await appendAudit(ctx, PLATFORM_AUDIT_TENANT, { userId: ADMIN.userId, action: "platform.clinic_create" });
      }
      await appendAudit(ctx, CLINIC, { userId: PLATFORM_USER_ID, action: "clinic.create", targetType: "organization", targetId: ORG, detail: { retentionDays: 365 } });
      await appendAudit(ctx, CLINIC, { userId: "u-deleted", action: "member.remove", targetType: "member", targetId: "m-owner", detail: { role: "clinician" } });
      clinicIds = (await listAudit(ctx, CLINIC, { limit: 500 })).map((e) => e.id);
      assert.equal(clinicIds.length, 127);
    });
    after(async () => {
      setEmailProviderForTests(null);
      await t?.close();
    });

    it("owners and administrators see the whole clinic (and may filter by person); clinicians and staff only their own entries, whatever they ask for", async () => {
      for (const role of ["owner", "admin"] as const) {
        const scope = activityScope(viewer(role));
        assert.equal(scope.everyone, true);
        const all = (await walkOlder(ctx, activityQuery(scope, parseActivityParams({})), 200)).flatMap((p) => p.entries);
        assert.deepEqual(
          all.map((e) => e.id),
          clinicIds,
          `${role}: every clinic entry, newest first`,
        );
        const byClin = await loadActivityPage(ctx, activityQuery(scope, parseActivityParams({ user: "u-clin" })), 200);
        assert.equal(byClin.entries.length, 25);
        assert.ok(byClin.entries.every((e) => e.userId === "u-clin"));
      }
      for (const role of ["clinician", "staff"] as const) {
        const me = viewer(role);
        const scope = activityScope(me);
        assert.equal(scope.everyone, false);
        for (const asked of [{}, { user: "u-owner" }, { user: "u-admin", action: "member.invite" }]) {
          const query = activityQuery(scope, parseActivityParams(asked));
          assert.equal(query.userId, me.userId, `${role} asked ${JSON.stringify(asked)}`);
          const page = await loadActivityPage(ctx, query, 200);
          assert.ok(page.entries.every((e) => e.userId === me.userId && e.tenantId === CLINIC));
        }
        const own = await loadActivityPage(ctx, activityQuery(scope, parseActivityParams({})), 200);
        assert.equal(own.entries.length, 25, `${role}: exactly their own 25 entries`);
      }
      // Never another clinic's rows, never the platform's.
      const everything = await loadActivityPage(ctx, activityQuery(activityScope(viewer("owner")), parseActivityParams({})), 200);
      assert.ok(everything.entries.every((e) => e.tenantId === CLINIC));
    });

    it("pages newest first: Older cursors walk the whole trail once, Newer cursors walk back, the newest page has no Newer link", async () => {
      const query = activityQuery(activityScope(viewer("admin")), parseActivityParams({}));
      const pages = await walkOlder(ctx, query, ACTIVITY_PAGE_SIZE);
      assert.deepEqual(
        pages.map((p) => p.entries.length),
        [50, 50, 27],
      );
      assert.deepEqual(
        pages.flatMap((p) => p.entries.map((e) => e.id)),
        clinicIds,
        "no gaps, no repeats",
      );
      assert.equal(pages[0].newerCursor, null);
      assert.equal(pages[2].olderCursor, null);
      // Back from the last page with the Newer cursor: exactly the middle page, then the newest page.
      const middle = await loadActivityPage(ctx, { ...query, after: pages[2].newerCursor }, ACTIVITY_PAGE_SIZE);
      assert.deepEqual(
        middle.entries.map((e) => e.id),
        pages[1].entries.map((e) => e.id),
      );
      const newest = await loadActivityPage(ctx, { ...query, after: middle.newerCursor }, ACTIVITY_PAGE_SIZE);
      assert.deepEqual(
        newest.entries.map((e) => e.id),
        pages[0].entries.map((e) => e.id),
      );
      assert.equal(newest.newerCursor, null, "a short run of newer entries shows the full newest page instead");
      // A cursor past the oldest entry: an empty page, nothing older.
      const beyond = await loadActivityPage(ctx, { ...query, before: clinicIds[clinicIds.length - 1] }, ACTIVITY_PAGE_SIZE);
      assert.deepEqual(beyond.entries, []);
      assert.equal(beyond.olderCursor, null);
    });

    it("filters by action (and by action + person) keep working across pages", async () => {
      const scope = activityScope(viewer("owner"));
      const query = activityQuery(scope, parseActivityParams({ action: "member.invite" }));
      const pages = await walkOlder(ctx, query, 10);
      const ids = pages.flatMap((p) => p.entries.map((e) => e.id));
      assert.equal(ids.length, 25);
      assert.equal(new Set(ids).size, 25);
      assert.ok(pages.flatMap((p) => p.entries).every((e) => e.action === "member.invite"));
      const both = await loadActivityPage(ctx, activityQuery(scope, parseActivityParams({ action: "member.invite", user: "u-admin" })), 200);
      assert.ok(both.entries.length > 0 && both.entries.every((e) => e.action === "member.invite" && e.userId === "u-admin"));
      // Malformed parameters are dropped, not passed on.
      assert.deepEqual(parseActivityParams({ action: "Bad Action", user: "x y", before: "not-a-ulid", after: "zz" }), {
        action: null,
        user: null,
        before: null,
        after: null,
        from: null,
        to: null,
        saves: false,
      });
    });

    it("fix wave 2: routine saves are hidden unless asked for (saves=1) or filtered on; rows link to the Studio", async () => {
      await appendAudit(ctx, CLINIC, { userId: "u-admin", action: "report.update", targetType: "report", targetId: "rpt_saves_1" });
      await appendAudit(ctx, CLINIC, { userId: "u-admin", action: "report.sign", targetType: "report", targetId: "rpt_saves_1" });
      const scope = activityScope(viewer("admin"));
      const hidden = await loadActivityPage(ctx, activityQuery(scope, parseActivityParams({})), 200);
      assert.ok(hidden.entries.some((e) => e.action === "report.sign" && e.targetId === "rpt_saves_1"));
      assert.ok(!hidden.entries.some((e) => e.action === "report.update"));
      const shown = await loadActivityPage(ctx, activityQuery(scope, parseActivityParams({ saves: "1" })), 200);
      assert.ok(shown.entries.some((e) => e.action === "report.update" && e.targetId === "rpt_saves_1"));
      const filtered = await loadActivityPage(ctx, activityQuery(scope, parseActivityParams({ action: "report.update" })), 200);
      assert.ok(filtered.entries.length > 0 && filtered.entries.every((e) => e.action === "report.update"));
      assert.equal(activityHref("/app/settings/activity", { saves: true }), "/app/settings/activity?saves=1");
      assert.equal(activityTargetHref({ targetType: "report", targetId: "rpt_saves_1" }), "/app/studio/rpt_saves_1");
      assert.equal(activityTargetHref({ targetType: "form", targetId: "frm_1" }), "/app/studio/forms/frm_1");
      assert.equal(activityTargetHref({ targetType: "user", targetId: "u-admin" }), null);
    });

    it("the download holds exactly the entries shown (inclusive range, same scope), ids and codes only", async () => {
      const query = activityQuery(activityScope(viewer("admin")), parseActivityParams({}));
      const pages = await walkOlder(ctx, query, ACTIVITY_PAGE_SIZE);
      const shown = pages[1].entries;
      const range = { newest: shown[0].id, oldest: shown[shown.length - 1].id };
      const before = await loadActivityRange(ctx, query, range);
      assert.deepEqual(
        before.map((e) => e.id),
        shown.map((e) => e.id),
      );
      await appendAudit(ctx, CLINIC, { userId: "u-admin", action: "auth.sign_in" }); // written after the page was shown
      assert.deepEqual(
        (await loadActivityRange(ctx, query, range)).map((e) => e.id),
        shown.map((e) => e.id),
      );
      // A staff member's download of the same range holds only their own entries.
      const staffQuery = activityQuery(activityScope(viewer("staff")), parseActivityParams({}));
      const staffRows = await loadActivityRange(ctx, staffQuery, range);
      assert.ok(staffRows.length > 0 && staffRows.every((e) => e.userId === "u-staff"));
      const csv = activityCsv(before);
      const lines = csv.trimEnd().split("\r\n");
      assert.equal(lines[0], "id,at,action,user_id,target_type,target_id");
      assert.equal(lines.length, shown.length + 1);
      assert.ok(!/fictional|@/.test(csv), "no names or email addresses");
      assert.ok(!/(^|,)s-\d/m.test(csv), "no session ids");
      clinicIds = (await listAudit(ctx, CLINIC, { limit: 500 })).map((e) => e.id);
    });

    it("names: current members, former members, ClinForms support, deleted accounts; details in plain words", async () => {
      const v = viewer("owner");
      const page = await loadActivityPage(ctx, activityQuery(activityScope(v), parseActivityParams({})), 200);
      const lookups = await loadActivityLookups(t.db, v, page.entries);
      const rows = presentActivity(page.entries, lookups);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const pick = (pred: (e: (typeof page.entries)[number]) => boolean) => {
        const entry = page.entries.find(pred);
        assert.ok(entry);
        return byId.get(entry.id);
      };
      assert.equal(pick((e) => e.userId === "u-clin")?.who, "Clara Clinician (fictional)");
      assert.equal(pick((e) => e.userId === "u-former")?.who, "Fred Former (fictional) (former member)");
      const created = pick((e) => e.action === "clinic.create");
      assert.equal(created?.who, "ClinForms support");
      assert.equal(created?.label, "Clinic account opened");
      assert.equal(created?.detail, "Reports kept for 365 days");
      assert.equal(created?.target, "Clinic account");
      const removed = pick((e) => e.action === "member.remove");
      assert.equal(removed?.who, "Deleted account");
      assert.equal(removed?.target, "Olivia Owner (fictional)");
      assert.equal(removed?.detail, "Role: Clinician");
      const aboutFormer = pick((e) => e.targetType === "user" && e.targetId === "u-former");
      assert.equal(aboutFormer?.target, "Fred Former (fictional) (former member)");
      const [selfRow] = presentActivity(
        [{ id: "01K0000000000000000000000X", tenantId: CLINIC, userId: "u-clin", sessionId: null, action: "auth.sign_in", targetType: "user", targetId: "u-clin", detail: { method: "backup_code" }, at: new Date(clock).toISOString() }],
        lookups,
      );
      assert.equal(selfRow.target, null, "an entry about the writer themselves names them once");
      const [joined] = presentActivity(
        [{ id: "01K0000000000000000000000Y", tenantId: CLINIC, userId: "u-staff", sessionId: null, action: "member.join", targetType: "member", targetId: "m-staff", detail: { role: "staff" }, at: new Date(clock).toISOString() }],
        lookups,
      );
      assert.deepEqual([joined.who, joined.target, joined.detail], ["Sam Staff (fictional)", null, "Role: Staff"]);
      assert.equal(selfRow.detail, "With a backup code");
      assert.equal(selfRow.label, "Signed in");
    });

    it("platform: access requests newest first, marked as contacted and back, audited under 'platform' with the administrator", async () => {
      const first = await createAccessRequest(ctx, { clinicName: "North Clinic (fictional)", contactName: "N", email: "n@north.example" });
      const second = await createAccessRequest(ctx, { clinicName: "South Clinic (fictional)", contactName: "S", email: "s@south.example", phone: "01234 567890" });
      const listed = await listAccessRequestsForPlatform(ctx);
      assert.deepEqual(
        listed.slice(0, 2).map((r) => r.id),
        [second.id, first.id],
      );
      assert.equal(listed[0].contactedAt, null);
      assert.equal(await markAccessRequest(ctx, ADMIN, first.id, true), true);
      const contactedAt = (await listAccessRequestsForPlatform(ctx)).find((r) => r.id === first.id)?.contactedAt;
      assert.ok(contactedAt && !Number.isNaN(Date.parse(contactedAt)));
      assert.equal(await markAccessRequest(ctx, ADMIN, first.id, true), false, "already contacted: keeps the first date, no new audit row");
      assert.equal((await listAccessRequestsForPlatform(ctx)).find((r) => r.id === first.id)?.contactedAt, contactedAt);
      assert.equal(await markAccessRequest(ctx, ADMIN, first.id, false), true);
      assert.equal((await listAccessRequestsForPlatform(ctx)).find((r) => r.id === first.id)?.contactedAt, null);
      assert.equal(await markAccessRequest(ctx, ADMIN, "ar_unknown", true), false);
      const audit = await listPlatformActivity(ctx, 50);
      const mine = audit.filter((e) => e.targetId === first.id);
      assert.deepEqual(
        mine.map((e) => e.action),
        ["platform.access_request_reopened", "platform.access_request_contacted"],
      );
      assert.ok(mine.every((e) => e.userId === ADMIN.userId && e.sessionId === ADMIN.sessionId && e.tenantId === PLATFORM_AUDIT_TENANT));
      assert.ok(!JSON.stringify(mine).includes("north.example"), "no contact details in the audit trail");
    });

    it("platform: create a clinic + owner invitation (link once), audited for the platform and the clinic; the clinic never sees platform rows", async () => {
      const created = await createClinicAsPlatform(t.db, ADMIN, {
        name: "Harbour Physio (fictional)",
        slug: "harbour-physio-test",
        ownerEmail: "Owner@Harbour.example",
        retentionDays: 400,
        appOrigin: ORIGIN,
        linkSecret: LINK_SECRET,
      });
      assert.match(created.inviteLink, /^http:\/\/localhost:3000\/accept-invite\?token=/);
      assert.equal((await findOpenInvitation(t.db, created.invitationId))?.email, "owner@harbour.example");
      const platformRows = (await listPlatformActivity(ctx, 50)).filter((e) => e.action === "platform.clinic_create" && e.targetId === created.organizationId);
      assert.equal(platformRows.length, 1);
      assert.equal(platformRows[0].userId, ADMIN.userId);
      assert.deepEqual(platformRows[0].detail, { tenantId: "harbour-physio-test", emailStatus: "not_sent" });
      const clinicRows = await listAudit(ctx, "harbour-physio-test");
      assert.deepEqual(
        clinicRows.map((e) => e.action),
        ["clinic.create"],
      );
      assert.ok(!JSON.stringify([...platformRows, ...clinicRows]).includes(created.inviteLink), "the link is never audited");
      const countCreates = async () => (await listPlatformActivity(ctx, 200)).filter((e) => e.action === "platform.clinic_create").length;
      const creates = await countCreates();
      await assert.rejects(
        createClinicAsPlatform(t.db, ADMIN, { name: "X", slug: PLATFORM_AUDIT_TENANT, ownerEmail: "x@y.example", appOrigin: ORIGIN, linkSecret: LINK_SECRET }),
        /reserved/,
      );
      await assert.rejects(
        createClinicAsPlatform(t.db, ADMIN, { name: "Again", slug: "harbour-physio-test", ownerEmail: "x@y.example", appOrigin: ORIGIN, linkSecret: LINK_SECRET }),
        /already exists/,
      );
      assert.equal(await countCreates(), creates, "failed attempts write nothing");
    });

    it("set-up checklist (fix wave 2): a new clinic's steps, read from its own rows only; drafting off until switched on", async () => {
      const clinic = { tenantId: CLINIC, organizationId: ORG };
      const at = new Date(clock).toISOString();
      const form = (tenant: string, id: string, status: string) => ({
        tenant_id: tenant, id, rev: 1, file_sha256: "c".repeat(64), status, title: "Progress report", referrer: null, kind: "docx", sample_id: null, payload_enc: "v1.k1.x.y", created_at: at, updated_at: at,
      });
      // Another clinic's confirmed form and signer count for nothing here.
      await t.db.insertInto("forms").values(form(OTHER, "frm_other", "confirmed")).execute();
      await upsertMemberProfile(ctx, "org-other", "u-other", { hcpcNumber: "PH111111", canSign: true });
      const fresh = await loadSetupChecklist(t.db, clinic, { members: 1, openInvitations: 0 });
      assert.deepEqual(fresh, { clinicDetails: false, draftingEnabled: false, team: false, signer: false, confirmedForm: false });

      await upsertClinicProfile(ctx, CLINIC, { organizationId: ORG, displayName: "Activity Clinic (fictional)", address: ["1 High Street"], postcode: "MK9 1AA" });
      await upsertMemberProfile(ctx, ORG, "u-clin", { hcpcNumber: "PH123456", canSign: false });
      await t.db.insertInto("forms").values(form(CLINIC, "frm_proposed", "proposed")).execute();
      const partly = await loadSetupChecklist(t.db, clinic, { members: 1, openInvitations: 1 });
      assert.deepEqual(partly, { clinicDetails: true, draftingEnabled: false, team: true, signer: false, confirmedForm: false }, "a new profile's drafting is off");

      await upsertClinicProfile(ctx, CLINIC, { organizationId: ORG, displayName: "Activity Clinic (fictional)", address: ["1 High Street"], postcode: "MK9 1AA", draftingEnabled: true });
      await upsertMemberProfile(ctx, ORG, "u-clin", { hcpcNumber: "PH123456", canSign: true });
      await t.db.insertInto("forms").values(form(CLINIC, "frm_confirmed", "confirmed")).execute();
      assert.deepEqual(await loadSetupChecklist(t.db, clinic, { members: 4, openInvitations: 0 }), {
        clinicDetails: true,
        draftingEnabled: true,
        team: true,
        signer: true,
        confirmedForm: true,
      });
    });

    it("platform: clinics overview with members, open invitations and the last recorded activity", async () => {
      const last = await lastActivityByTenant(t.db);
      const newestClinic = (await listAudit(ctx, CLINIC, { limit: 1 }))[0];
      assert.equal(last.get(CLINIC), newestClinic.at);
      assert.equal(last.get(OTHER), (await listAudit(ctx, OTHER, { limit: 1 }))[0].at);
      const overview = await listClinicsOverview(t.db);
      const mine = overview.find((c) => c.tenantId === CLINIC);
      assert.ok(mine);
      assert.equal(mine.members, 4);
      assert.equal(mine.owners, 1);
      assert.equal(mine.lastActivityAt, newestClinic.at);
      const harbour = overview.find((c) => c.tenantId === "harbour-physio-test");
      assert.ok(harbour);
      assert.equal(harbour.members, 0);
      assert.equal(harbour.pendingInvitations, 1);
      assert.equal(harbour.retentionDays, 400);
      assert.ok(harbour.lastActivityAt);
      assert.ok(!overview.some((c) => c.tenantId === PLATFORM_AUDIT_TENANT), "the platform is not a clinic");
    });
  });
}
