/**
 * M10 review (production readiness): the offboarding's delete batch against the data gateway's statement limit
 * (GATEWAY_MAX_STATEMENTS, src/server/db/dialects/d1-http.ts – cross-checked with the Worker's LIMITS by
 * workers/data-gateway/test/gateway.test.ts). Pure: statements are built, never run. Run by `npm run test:auth`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GATEWAY_MAX_STATEMENTS } from "../db/dialects/d1-http";
import { PMS_TENANT_TABLES } from "../db/pms-schema";
import { createSqliteTestDb } from "../db/testing/databases";
import type { BatchQuery } from "../db/batch";
import { OFFBOARD_USER_IDS_PER_STATEMENT, offboardBatches, offboardDeleteQueries, type OffboardDeleteInput } from "./platform";

const t = createSqliteTestDb();
const base = (over: Partial<OffboardDeleteInput> = {}): OffboardDeleteInput => ({
  tenantId: "riverside-demo",
  organizationId: "org_riverside",
  pmsTables: [],
  releaseSlug: false,
  deleteUserIds: [],
  now: "2026-10-29T09:00:00.000Z",
  ...over,
});
const users = (n: number) => Array.from({ length: n }, (_, i) => `user_${String(i).padStart(4, "0")}`);
const sqlOf = (q: BatchQuery) => ("compile" in q && typeof q.compile === "function" ? q.compile() : (q as { sql: string; parameters: readonly unknown[] }));

describe("offboarding batch vs the gateway's statement limit", () => {
  it("worst case – every clinic-system table holds rows, the id is released – is ONE batch within the limit", () => {
    const worst = offboardDeleteQueries(t.db, base({ pmsTables: PMS_TENANT_TABLES, releaseSlug: true, deleteUserIds: users(OFFBOARD_USER_IDS_PER_STATEMENT) }));
    assert.ok(worst.length <= GATEWAY_MAX_STATEMENTS, `${worst.length} statements > ${GATEWAY_MAX_STATEMENTS}`);
    assert.equal(offboardBatches(worst).length, 1, "one atomic batch");
    // Headroom kept visible: the fixed part (no users) and how many member accounts still fit in one batch.
    const fixed = offboardDeleteQueries(t.db, base({ pmsTables: PMS_TENANT_TABLES, releaseSlug: true })).length;
    const usersThatFit = (GATEWAY_MAX_STATEMENTS - fixed) * OFFBOARD_USER_IDS_PER_STATEMENT;
    assert.ok(usersThatFit >= 450, `only ${usersThatFit} member accounts fit next to every clinic-system table`);
  });

  it("only the tables that hold the clinic's rows are named – a ClinForms-only clinic sends no clinic-system statement", () => {
    const clinforms = offboardDeleteQueries(t.db, base({ deleteUserIds: users(3) }));
    assert.ok(!clinforms.some((q) => /\bpms_|clinic_entitlements|clinic_usage_counters/.test(sqlOf(q).sql)), "no clinic-system table");
    // = main's offboarding: 8 ClinForms tables + member_profile, partner_keys, invitation, member, session, 1 user batch, organization.
    assert.equal(clinforms.length, 15);
    const two = offboardDeleteQueries(t.db, base({ pmsTables: ["pms_patients", "clinic_entitlements"] }));
    const pms = two.map((q) => sqlOf(q).sql).filter((s) => /\bpms_|clinic_entitlements/.test(s));
    assert.equal(pms.length, 2);
    // Children before parents, as PMS_TENANT_TABLES reversed (patients were added after the entitlements table).
    assert.ok(pms[0].includes("pms_patients") && pms[1].includes("clinic_entitlements"), pms.join(" | "));
  });

  it("every statement stays within D1's 100 bound parameters", () => {
    const qs = offboardDeleteQueries(t.db, base({ pmsTables: PMS_TENANT_TABLES, releaseSlug: true, deleteUserIds: users(1000) }));
    for (const q of qs) assert.ok(sqlOf(q).parameters.length <= 100, sqlOf(q).sql.slice(0, 80));
  });

  it("past the limit (hundreds of accounts): ordered batches within the limit, the organization LAST", () => {
    const qs = offboardDeleteQueries(t.db, base({ pmsTables: PMS_TENANT_TABLES, releaseSlug: false, deleteUserIds: users(5000) }));
    assert.ok(qs.length > GATEWAY_MAX_STATEMENTS);
    const batches = offboardBatches(qs);
    assert.ok(batches.length >= 2);
    for (const b of batches) assert.ok(b.length >= 1 && b.length <= GATEWAY_MAX_STATEMENTS);
    assert.deepEqual(batches.flat(), qs, "same statements, same order");
    const last = batches[batches.length - 1];
    assert.match(sqlOf(last[last.length - 1]).sql, /^update "organization"/, "the tombstone goes last: a stop part-way leaves the clinic open");
    assert.match(sqlOf(batches[0][0]).sql, /^delete from "pms_/, "the clinic system's rows first");
    assert.throws(() => offboardBatches(qs, 0));
  });
});
