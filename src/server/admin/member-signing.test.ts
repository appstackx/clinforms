/**
 * admin:set-member-signing (16/11/2026, src/server/admin/member-signing.ts) on node:sqlite: the Members page's rules,
 * one member by exact name, preview by default, audited by ClinForms with flags only. Fictional members.
 * Run by `npm run test:db`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CliError, parseArgs } from "../../../scripts/admin/cli";
import { setMemberSigningArgs } from "../../../scripts/admin/set-member-signing";
import { describeActivityDetail } from "../../lib/activity-copy";
import { PLATFORM_USER_ID } from "../auth/create-auth";
import { createSqliteTestDb } from "../db/testing/databases";
import { listAudit } from "../repos/audit";
import { RepoInputError, type DbContext } from "../repos/context";
import { getMemberProfile, upsertMemberProfile } from "../repos/member-profile";
import { setMemberSigning } from "./member-signing";

const CLINIC = "signing-test";
const ORG = `org-${CLINIC}`;

describe("admin:set-member-signing – node:sqlite", () => {
  let t: Awaited<ReturnType<typeof createSqliteTestDb>>;
  let ctx: DbContext;
  const at = "2026-11-16T09:00:00.000Z";

  before(async () => {
    t = await createSqliteTestDb();
    ctx = { db: t.db, now: () => new Date(at) };
    await t.db.insertInto("organization").values({ id: ORG, name: "Signing Test Physio (fictional)", slug: CLINIC, logo: null, createdAt: at, metadata: null }).execute();
    await t.db.insertInto("organization").values({ id: "org-closed", name: "Closed (fictional)", slug: "signing-closed", logo: null, createdAt: at, metadata: JSON.stringify({ offboardedAt: at }) }).execute();
    const people: Array<[string, string, string]> = [
      ["u-sam", "Sam Ward (fictional)", "clinician"],
      ["u-pat", "Pat Morgan (fictional)", "staff"],
      ["u-twin-1", "Alex Twin (fictional)", "clinician"],
      ["u-twin-2", "Alex Twin (fictional)", "clinician"],
    ];
    for (const [id, name, role] of people) {
      await t.db.insertInto("user").values({ id, name, email: `${id}@example.com`, emailVerified: 1, image: null, createdAt: at, updatedAt: at, twoFactorEnabled: 0 }).execute();
      await t.db.insertInto("member").values({ id: `m-${id}`, organizationId: ORG, userId: id, role, createdAt: at }).execute();
    }
    await upsertMemberProfile(ctx, ORG, "u-sam", { jobTitle: "Senior Physiotherapist", hcpcNumber: null, canSign: false });
  });
  after(async () => {
    await t?.close();
  });

  it("refuses an unknown or closed clinic, an unknown or ambiguous name, a number in the wrong format, a made-up number and a signing staff member", async () => {
    const ok = { memberName: "Sam Ward (fictional)", hcpcNumber: "PH123456", maySign: true, confirm: true };
    await assert.rejects(setMemberSigning(ctx, { ...ok, tenantId: "no-such-clinic" }), RepoInputError);
    await assert.rejects(setMemberSigning(ctx, { ...ok, tenantId: "signing-closed" }), RepoInputError);
    await assert.rejects(setMemberSigning(ctx, { ...ok, tenantId: CLINIC, memberName: "Nobody Here" }), RepoInputError);
    await assert.rejects(setMemberSigning(ctx, { ...ok, tenantId: CLINIC, memberName: "Alex Twin (fictional)" }), /2 members/);
    await assert.rejects(setMemberSigning(ctx, { ...ok, tenantId: CLINIC, hcpcNumber: "12345" }), RepoInputError);
    await assert.rejects(setMemberSigning(ctx, { ...ok, tenantId: CLINIC, hcpcNumber: "PH-DEMO-01" }), RepoInputError, "a made-up number: demo clinics only");
    await assert.rejects(setMemberSigning(ctx, { ...ok, tenantId: CLINIC, memberName: "Pat Morgan (fictional)" }), /staff member cannot sign/);
    assert.equal((await getMemberProfile(ctx, ORG, "u-sam"))?.hcpcNumber, null);
    assert.equal((await listAudit(ctx, CLINIC)).length, 0);
  });

  it("previews by default; with confirm stores the normalised number and may-sign, keeps the job title, audits flags only", async () => {
    const preview = await setMemberSigning(ctx, { tenantId: CLINIC, memberName: "  sam ward (FICTIONAL) ", hcpcNumber: "ph 123456", maySign: true });
    assert.deepEqual({ dryRun: preview.dryRun, changed: preview.changed, before: preview.before, after: preview.after }, { dryRun: true, changed: true, before: { hasHcpc: false, maySign: false }, after: { hasHcpc: true, maySign: true } });
    assert.equal((await getMemberProfile(ctx, ORG, "u-sam"))?.hcpcNumber, null, "a preview stores nothing");

    const stored = await setMemberSigning(ctx, { tenantId: CLINIC, memberName: "Sam Ward (fictional)", hcpcNumber: "ph 123456", maySign: true, confirm: true });
    assert.equal(stored.dryRun, false);
    const profile = await getMemberProfile(ctx, ORG, "u-sam");
    assert.deepEqual({ hcpc: profile?.hcpcNumber, canSign: profile?.canSign, jobTitle: profile?.jobTitle }, { hcpc: "PH123456", canSign: true, jobTitle: "Senior Physiotherapist" });
    const audit = await listAudit(ctx, CLINIC);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].userId, PLATFORM_USER_ID);
    assert.equal(audit[0].action, "member.profile_update");
    assert.deepEqual(audit[0].detail, { via: "support", canSign: true, hasHcpc: true, hasJobTitle: true });
    assert.ok(!JSON.stringify(audit[0]).includes("PH123456"), "the number is never in the trail");
    assert.equal(describeActivityDetail("member.profile_update", audit[0].detail), "May sign forms");

    const again = await setMemberSigning(ctx, { tenantId: CLINIC, memberName: "Sam Ward (fictional)", hcpcNumber: "PH123456", maySign: true, confirm: true });
    assert.equal(again.changed, false);
    assert.equal((await listAudit(ctx, CLINIC)).length, 1, "the same details again: no second row");
  });
});

describe("admin:set-member-signing arguments", () => {
  it("needs the clinic, the member and the number; may sign unless --no-sign; preview unless --confirm", () => {
    assert.deepEqual(setMemberSigningArgs(parseArgs(["--slug", "x", "--member", "Sam Ward (fictional)", "--hcpc", "PH123456"])), { slug: "x", member: "Sam Ward (fictional)", hcpc: "PH123456", maySign: true, confirm: false });
    assert.deepEqual(setMemberSigningArgs(parseArgs(["--slug", "x", "--member", "S", "--hcpc", "PH123456", "--no-sign", "--confirm"])), { slug: "x", member: "S", hcpc: "PH123456", maySign: false, confirm: true });
    assert.throws(() => setMemberSigningArgs(parseArgs(["--slug", "x", "--hcpc", "PH123456"])), CliError);
    assert.throws(() => setMemberSigningArgs(parseArgs(["--slug", "x", "--member", "S"])), CliError);
  });
});
