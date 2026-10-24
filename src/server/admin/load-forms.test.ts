/**
 * admin:load-forms on node:sqlite and PGlite (the D1 runs are in workers/data-gateway/test/admin-stack.test.ts), and
 * its argument handling. Run by `npm run test:db`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CliError, parseArgs } from "../../../scripts/admin/cli";
import { loadFormsArgs } from "../../../scripts/admin/load-forms";
import { createPgliteTestDb, createSqliteTestDb } from "../db/testing/databases";
import { defineLoadFormsSuite } from "./testing/load-forms-suite";

defineLoadFormsSuite("node:sqlite", async () => createSqliteTestDb());
defineLoadFormsSuite("PGlite (Postgres)", async () => createPgliteTestDb());

describe("admin:load-forms arguments", () => {
  const args = (line: string) => parseArgs(line.split(" ").filter(Boolean));
  it("needs a clinic, a folder and maps (or --read-missing); preview unless --confirm", () => {
    const a = loadFormsArgs(args("--slug blue-heart --dir /tmp/t --maps /tmp/m.json"));
    assert.deepEqual(a, { slug: "blue-heart", dir: "/tmp/t", mapsPath: "/tmp/m.json", readMissing: false, confirm: false });
    assert.equal(loadFormsArgs(args("--slug x --dir /tmp/t --read-missing --confirm")).confirm, true);
    assert.deepEqual(loadFormsArgs(args("--slug x --dir /tmp/t --read-missing --referrer Medcare --referrer-type mlc")).referrer, { name: "Medcare", type: "mlc" });
    for (const bad of ["--dir /tmp/t --maps m.json", "--slug x --maps m.json", "--slug x --dir /tmp/t", "--slug x --dir /tmp/t --read-missing --referrer-type nope"]) {
      assert.throws(() => loadFormsArgs(args(bad)), bad.includes("--slug") && bad.includes("--dir") ? CliError : Error, bad);
    }
  });
});
