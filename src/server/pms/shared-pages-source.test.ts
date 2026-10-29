/**
 * M10 review: source checks on the shared ClinForms pages the clinic system touches (no Next runtime in unit tests).
 * - The platform page never offers a one-click "Switch off" for Reports: the clinic id is typed and sent along
 *   (and checked on the server – src/server/pms/admin.test.ts).
 * - The two clinic layouts read the packages ONCE, alongside their other reads.
 * Run by `npm run test:pms`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("shared pages (source)", () => {
  it("platform page: Reports off needs the clinic id typed; the action passes it to the server check", () => {
    const page = read("src/app/app/platform/page.tsx");
    assert.match(page, /reportsSwitchOffNeedsTypedId\(/);
    assert.match(page, /name="confirmTenantId"[\s\S]{0,80}required/);
    const action = read("src/app/app/platform/actions.ts");
    assert.match(action, /confirmTenantId: String\(form\.get\("confirmTenantId"\)/);
  });

  it("studio layout: one package read (clinicPackages), no hasPackage", () => {
    const src = read("src/app/app/studio/layout.tsx");
    assert.equal(count(src, /\bclinicPackages\(/g), 1);
    assert.equal(count(src, /\bhasPackage\(/g), 0);
  });

  it("clinic layout: the package read runs inside the Promise.all with the trial and demo-clinic reads", () => {
    const src = read("src/app/app/(clinic)/layout.tsx");
    assert.equal(count(src, /\bclinicPackages\(/g), 1);
    const all = src.slice(src.indexOf("Promise.all(["), src.indexOf("]);", src.indexOf("Promise.all([")));
    for (const call of ["noteClinicVisit(", "isDemoClinic(", "clinicPackages("]) assert.ok(all.includes(call), call);
  });
});
