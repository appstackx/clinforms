/**
 * admin:load-forms on node:sqlite and PGlite (the D1 runs are in workers/data-gateway/test/admin-stack.test.ts), and
 * its argument handling. Run by `npm run test:db`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CliError, parseArgs } from "../../../scripts/admin/cli";
import { activityLabel, describeActivityDetail } from "../../lib/activity-copy";
import { loadFormsArgs, statusLabel } from "../../../scripts/admin/load-forms";
import { createPgliteTestDb, createSqliteTestDb } from "../db/testing/databases";
import { defineLoadFormsSuite } from "./testing/load-forms-suite";

defineLoadFormsSuite("node:sqlite", async () => createSqliteTestDb()); // with its raw handle: the hook cases run here too
defineLoadFormsSuite("PGlite (Postgres)", async () => createPgliteTestDb());

describe("admin:load-forms arguments", () => {
  const args = (line: string) => parseArgs(line.split(" ").filter(Boolean));
  it("needs a clinic, a folder and maps (or --read-missing); preview unless --confirm", () => {
    const a = loadFormsArgs(args("--slug blue-heart --dir /tmp/t --maps /tmp/m.json"));
    assert.deepEqual(a, { slug: "blue-heart", dir: "/tmp/t", mapsPath: "/tmp/m.json", readMissing: false, confirm: false, replaceProposed: false });
    assert.equal(loadFormsArgs(args("--slug x --dir /tmp/t --maps /tmp/m.json --replace-proposed")).replaceProposed, true);
    assert.equal(loadFormsArgs(args("--slug x --dir /tmp/t --read-missing --confirm")).confirm, true);
    assert.deepEqual(loadFormsArgs(args("--slug x --dir /tmp/t --read-missing --referrer Medcare --referrer-type mlc")).referrer, { name: "Medcare", type: "mlc" });
    for (const bad of ["--dir /tmp/t --maps m.json", "--slug x --maps m.json", "--slug x --dir /tmp/t", "--slug x --dir /tmp/t --read-missing --referrer-type nope"]) {
      assert.throws(() => loadFormsArgs(args(bad)), bad.includes("--slug") && bad.includes("--dir") ? CliError : Error, bad);
    }
  });
  it("--replace-proposed prints REPLACE / LOAD / SKIP / REFUSED (then REPLACED / LOADED); the normal mode is unchanged", () => {
    assert.deepEqual(
      (["replace", "ready", "skipped", "refused", "replaced", "loaded"] as const).map((s) => statusLabel(s, true)),
      ["REPLACE", "LOAD", "SKIP", "REFUSED", "REPLACED", "LOADED"],
    );
    assert.deepEqual((["ready", "loaded", "skipped", "refused"] as const).map((s) => statusLabel(s, false)), ["READY", "LOADED", "SKIPPED", "REFUSED"]);
  });
  it("the clinic's activity log words the replace rows (counts only)", () => {
    assert.equal(activityLabel("form.replace"), "Form replaced by an updated version from ClinForms");
    assert.equal(describeActivityDetail("form.replace", { via: "onboarding", replaces: ["frm_1"], fields: 12 }), "12 questions to check and confirm");
    assert.equal(activityLabel("clinic.forms_replaced"), "Forms updated in the library by ClinForms");
    assert.equal(describeActivityDetail("clinic.forms_replaced", { replaced: 15, forms: 1, refused: 2, skipped: 0 }), "16 forms to check and confirm");
    assert.equal(describeActivityDetail("clinic.forms_replaced", { replaced: 0, forms: 0 }), null);
  });
});
