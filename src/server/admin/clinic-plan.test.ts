/**
 * Trials and drafting limits per clinic on node:sqlite and PGlite (the D1 runs are in
 * workers/data-gateway/test/admin-stack.test.ts), and the platform page's wiring of them. Run by `npm run test:db`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createPgliteTestDb, createSqliteTestDb } from "../db/testing/databases";
import { defineClinicPlanSuite } from "./testing/clinic-plan-suite";

defineClinicPlanSuite("node:sqlite", async () => createSqliteTestDb());
defineClinicPlanSuite("PGlite (Postgres)", async () => createPgliteTestDb());

describe("platform page: trial and limit actions are guarded and audited", () => {
  it("every new action re-checks the platform administrator and goes through the audited admin layer", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/app/platform/actions.ts"), "utf8");
    for (const name of ["setTrialAction", "changeTrialAction", "setLimitsAction"]) {
      const at = src.indexOf(`export async function ${name}`);
      assert.ok(at >= 0, name);
      assert.match(src.slice(at, at + 400), /const admin = await platformActionAdmin\(\);\n\s+if \(!admin\) return/, name);
    }
    assert.match(src, /setTrial\(getDb\(\), \{ kind: "platform", admin \}/);
    assert.match(src, /extendTrial\(getDb\(\), actor/);
    assert.match(src, /setDraftingLimits\(getDb\(\), \{ kind: "platform", admin \}/);
  });

  it("the clinic layout and the Studio layout record the visit and show the banner", () => {
    const clinicLayout = fs.readFileSync(path.join(process.cwd(), "src/app/app/(clinic)/layout.tsx"), "utf8");
    assert.match(clinicLayout, /noteClinicVisit\(getDb\(\)/);
    // 13/11/2026: the banner state adds a self-serve free trial's facts (src/server/trial/view.ts trialBannerState).
    assert.match(clinicLayout, /const trialBanner = await trialBannerState\(getDb\(\), membership\.tenantId, trial, manager\)/);
    assert.match(clinicLayout, /<TrialBannerBar access=\{trialBanner\} contactEmail=\{brand\.contactEmail\} \/>/);
    const studioLayout = fs.readFileSync(path.join(process.cwd(), "src/app/app/studio/layout.tsx"), "utf8");
    assert.match(studioLayout, /trialBannerState\(getDb\(\), context\.tenantId, context\.trial, manager\)/);
    assert.match(studioLayout, /<TrialBannerBar access=\{trial\} contactEmail=\{contactEmail\} \/>/);
    // …and the clinic system's shell (the first visit there starts a ClinDesk trial).
    const shell = fs.readFileSync(path.join(process.cwd(), "src/app/app/clinic/layout.tsx"), "utf8");
    assert.match(shell, /clinicShellTrial\(getDb\(\), \{ tenantId: actor\.tenantId/);
    assert.doesNotMatch(shell, /noteClinicVisit\(/, "only through clinicShellTrial (self-serve trials only)");
    assert.match(shell, /\{trial \? <TrialBannerBar access=\{trial\}/);
    const studioAccess = fs.readFileSync(path.join(process.cwd(), "src/server/auth/studio-access.ts"), "utf8");
    assert.match(studioAccess, /noteClinicVisit\(deps\.db/);
  });
});
