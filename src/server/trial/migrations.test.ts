/**
 * Migration 0011 (the self-serve trial) and its neighbours: both twins exist and are listed as reserved
 * (src/modules/pms/core/modules.ts CLINFORMS_OWN_MIGRATIONS); it creates NEW tables only and never touches the parked
 * branch's lifecycle_email tables (already on production) nor the other 0010's. Run by npm run test:db.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { CLINFORMS_OWN_MIGRATIONS } from "../../modules/pms/core/modules";

const ROOT = process.cwd();

describe("migration 0011_self_trial", () => {
  const sqlite = fs.readFileSync(path.join(ROOT, "db/migrations/sqlite/0011_self_trial.sql"), "utf8");
  const pg = fs.readFileSync(path.join(ROOT, "supabase/migrations/20261113000011_self_trial.sql"), "utf8");
  it("both twins, reserved in modules.ts, numbers below 0100 unique by file name and Postgres version", () => {
    assert.ok(CLINFORMS_OWN_MIGRATIONS.some((m) => m.number === 11 && m.postgres === "20261113000011"));
    const own = fs.readdirSync(path.join(ROOT, "db/migrations/sqlite")).filter((f) => /^00\d\d_/.test(f));
    assert.ok(own.includes("0011_self_trial.sql"));
    const versions = fs.readdirSync(path.join(ROOT, "supabase/migrations")).map((f) => f.slice(0, 14));
    assert.equal(new Set(versions).size, versions.length, "every Postgres version once");
  });
  it("new tables only (CREATE … IF NOT EXISTS), never the lifecycle or sign-up tables, no destructive statement", () => {
    for (const sql of [sqlite, pg]) {
      const body = sql.replace(/^--.*$/gm, "");
      assert.doesNotMatch(body, /\b(drop|alter\s+table\s+(?!public\.(self_trial|trial_email|trial_report_hold)\b)|delete|update|insert)\b/i);
      assert.doesNotMatch(body, /lifecycle_email|signup_requests|signup_acceptances/);
      assert.match(body, /create table if not exists (public\.)?self_trial/i);
      assert.match(body, /create table if not exists (public\.)?trial_email/i);
    }
    assert.match(pg, /enable row level security/);
  });
});
