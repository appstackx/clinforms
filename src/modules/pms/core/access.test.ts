/** Pure rules of configurable access (src/modules/pms/core/access.ts): site scope, exceptions, wording, CSV. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MemberAccessInputSchema,
  describeChangeItem,
  formatUkDateTime,
  historyCsv,
  lockedExceptions,
  lockedRoleChanges,
  memberLead,
  memberSummary,
  normaliseExceptions,
  visibleSiteIds,
} from "./access";

describe("configurable access", () => {
  it("site scope: works at ∪ can see; every site by default, with 'all sites' and for the owner", () => {
    const sites = [
      { siteId: "site_a", worksAt: true, canSee: false },
      { siteId: "site_b", worksAt: false, canSee: true },
      { siteId: "site_c", worksAt: false, canSee: false },
    ];
    assert.deepEqual(Array.from(visibleSiteIds("staff", { allSites: false, sites }) ?? []).sort(), ["site_a", "site_b"]);
    assert.equal(visibleSiteIds("staff", null), null, "nothing stored = every site");
    assert.equal(visibleSiteIds("staff", { allSites: true, sites }), null);
    assert.equal(visibleSiteIds("owner", { allSites: false, sites }), null, "the owner cannot be limited");
    assert.deepEqual(Array.from(visibleSiteIds("admin", { allSites: false, sites }) ?? []).sort(), ["site_a", "site_b"], "admins can be limited");
  });

  it("member access input needs at least one visible site unless 'all sites'", () => {
    assert.equal(MemberAccessInputSchema.safeParse({ exceptions: {}, allSites: false, sites: [] }).success, false);
    assert.equal(MemberAccessInputSchema.safeParse({ exceptions: {}, allSites: true, sites: [] }).success, true);
    assert.equal(MemberAccessInputSchema.safeParse({ exceptions: { "not.a.permission": true }, allSites: true, sites: [] }).success, false);
  });

  it("exceptions: equal-to-role ones are dropped; locked ones are found", () => {
    assert.deepEqual(normaliseExceptions("staff", { "diary.book": true, "diary.override": true, "billing.refund": false }, {}), { "diary.override": true });
    assert.deepEqual(normaliseExceptions("staff", { "billing.refund": false }, { "billing.refund": true }), { "billing.refund": false }, "relative to the clinic's role");
    assert.deepEqual(lockedExceptions("staff", { "clinical.view": true, "diary.override": true }), ["clinical.view"]);
    assert.deepEqual(lockedExceptions("clinician", { "clinical.view": false }), []);
    assert.deepEqual(lockedRoleChanges([{ role: "staff", permission: "messages.letters", allowed: true }, { role: "owner", permission: "diary.view", allowed: false }, { role: "admin", permission: "reports.export", allowed: true }]).length, 2);
  });

  it("what a member can and cannot do, in plain words, with exceptions marked", () => {
    const s = memberSummary("staff", { "billing.refund": true }, { "diary.override": true, "billing.refund": false });
    assert.ok(s.can.some((l) => l.text === "Override diary clashes" && l.exception));
    assert.ok(s.cannot.some((l) => l.text === "Give refunds and credit notes" && l.exception));
    assert.ok(s.cannot.some((l) => l.text === "See clinical notes and outcomes – never, for reception" && !l.exception));
    assert.equal(s.can.length + s.cannot.length, 26);
    assert.equal(memberLead("Jess", "staff", ["Harbour Road", "Kingsmead"], 3, 11, 2), "Jess is a reception who works at Harbour Road and Kingsmead and can see 3 of 11 sites. 2 exceptions to the role.");
    assert.equal(memberLead("Priya", "admin", [], "all", 3, 0), "Priya is an admin who works at no sites yet and can see all 3 sites. No exceptions to the role.");
  });

  it("history lines and the CSV hold permission names, never patient data; CSV cells are formula-safe", () => {
    assert.equal(describeChangeItem({ type: "role_permission", role: "staff", permission: "billing.refund", from: false, to: true }), "Reception · Refunds and credit notes: not allowed → allowed");
    assert.equal(describeChangeItem({ type: "exception", permission: "diary.override", to: true }), "Added “Override clashes”");
    const csv = historyCsv(
      [{ id: "acc_1", at: "2026-10-28T05:02:00.000Z", byUserId: "u1", kind: "member", subjectRole: "staff", subjectUserId: "u2", items: [{ type: "active", to: false }] }],
      (id) => (id === "u1" ? "=Helen Ward" : "Jess Taylor"),
      () => "28/10/2026 05:02",
    );
    assert.equal(formatUkDateTime("2026-10-28T05:02:00.000Z"), "28/10/2026 05:02", "GMT in winter");
    assert.equal(formatUkDateTime("2026-08-20T10:42:00.000Z"), "20/08/2026 11:42", "BST in summer");
    assert.equal(csv, "When,Who,What,Change\r\n28/10/2026 05:02,'=Helen Ward,Member access: Jess Taylor,Clinic-system access switched off (deactivated)\r\n");
  });
});
