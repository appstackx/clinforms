/** admin:set-demo-clinic argument handling (10/2026). The operation itself is tested in src/server/admin (clinic-plan suite). */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CliError, parseArgs } from "./cli";
import { demoCommand } from "./set-demo-clinic";

const args = (line: string) => parseArgs(line.split(" ").filter(Boolean));

test("set-demo-clinic: exactly one of --on / --off / --show", () => {
  assert.equal(demoCommand(args("--slug khuram-test --on")), "on");
  assert.equal(demoCommand(args("--slug khuram-test --off --env production --yes")), "off");
  assert.equal(demoCommand(args("--slug khuram-test --show")), "show");
  for (const bad of ["--slug x", "--slug x --on --off", "--slug x --on --show", "--slug x --demo"]) {
    assert.throws(() => demoCommand(args(bad)), CliError, bad);
  }
});

test("set-demo-clinic: production changes need --yes, and the change goes through the audited admin layer", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "scripts/admin/set-demo-clinic.ts"), "utf8");
  assert.match(src, /if \(command !== "show"\) requireYesForProduction\(target, args,/);
  assert.match(src, /setDemoClinic\(db, \{ kind: "script" \}, slug, command === "on"\)/);
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts["admin:set-demo-clinic"] ?? "", /scripts\/admin\/set-demo-clinic\.ts$/);
});
