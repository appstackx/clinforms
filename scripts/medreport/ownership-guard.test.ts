/**
 * The bh2 ownership map (docs/bh2-ownership.json) and its guard (scripts/medreport/ownership-guard.mjs, W0.4): the map
 * resolves against this tree with no file owned twice, and the guard refuses a workstream branch that touches files
 * outside its map – another workstream's file, an integrator-only file, a changed corpus case or expectation, demo assets.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  checkChanges,
  checkMap,
  classifyChange,
  globToRegExp,
  loadMap,
  ownerOf,
  resolveWorkstream,
  workstreamForBranch,
} from "./ownership-guard.mjs";

const map = loadMap();
const M = "src/modules/medreport";
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n").filter(Boolean);
const change = (path: string, status = "M", deleted = 0, from?: string) => ({ status, path, deleted, ...(from ? { from } : {}) });

describe("bh2 ownership map", () => {
  it("resolves against this tree: every mapped path exists or is declared new, no file has two owners, no branch two maps", () => {
    assert.deepEqual(checkMap(map, files), []);
  });

  it("maps the split files to the plan's owners", () => {
    const expect: Array<[string, string]> = [
      [`${M}/ui/components/review/status.ts`, "WA1"],
      [`${M}/ui/components/review/gaps.ts`, "WC"],
      [`${M}/ui/components/review/fixes.ts`, "WD"],
      [`${M}/core/forms/answers.ts`, "WA1"],
      [`${M}/core/forms/record-paths.ts`, "WE"],
      [`${M}/core/forms/answer-shape.ts`, "WD"],
      [`${M}/core/validation/run.ts`, "WA1"],
      [`${M}/core/validation/acknowledge.ts`, "WC"],
      [`${M}/core/validation/registry.ts`, "W0"],
      [`${M}/core/validation/draft-fit/commentary.ts`, "WB"],
      [`${M}/core/validation/draft-fit/repeats.ts`, "WD"],
      [`${M}/core/validation/attribution-opinion-boxes.ts`, "WB"],
      [`${M}/api/handlers/sign/index.ts`, "WA1"],
      [`${M}/api/handlers/sign/checks/roles.ts`, "WC"],
      [`${M}/api/handlers/sign/checks/voice.ts`, "WB"],
      [`${M}/core/session-dates.ts`, "WE"],
      [`${M}/core/rtf/docx-writer.ts`, "WA2"],
    ];
    for (const [path, owner] of expect) assert.equal(ownerOf(map, path), owner, path);
    assert.equal(ownerOf(map, `${M}/core/reuse.ts`), null, "unmapped: the integrator's");
  });

  it("knows each workstream's branches, fix branches and aliases", () => {
    assert.equal(workstreamForBranch(map, "ws/bh2-issue"), "WA1");
    assert.equal(workstreamForBranch(map, "ws/bh2-review-ui"), "WC", "WC may run two agents");
    assert.equal(workstreamForBranch(map, "ws/bh2-fix1-wb"), "WB");
    assert.equal(workstreamForBranch(map, "ws/bh2-fix2-review-labels"), "WC");
    assert.equal(workstreamForBranch(map, "ws/bh2-split"), "W0");
    assert.equal(workstreamForBranch(map, "release/bh-trial-2"), "WI");
    assert.equal(workstreamForBranch(map, "feature/other"), null);
    assert.equal(resolveWorkstream(map, "opinion"), "WB");
  });

  it("globs: * stays in one segment, ** spans any depth", () => {
    assert.ok(globToRegExp(`${M}/core/validation/attribution-*.ts`).test(`${M}/core/validation/attribution-x.ts`));
    assert.ok(!globToRegExp(`${M}/core/validation/attribution-*.ts`).test(`${M}/core/validation/attribution-x/y.ts`));
    assert.ok(globToRegExp(`${M}/core/rtf/**`).test(`${M}/core/rtf/a/b.ts`));
    assert.ok(globToRegExp("**/.env*").test(".env.local"));
  });
});

describe("bh2 ownership guard", () => {
  it("allows a workstream its own files, new tests anywhere, and lines added to a shared test or a corpus case file", () => {
    const r = checkChanges(map, "WB", [
      change(`${M}/core/validation/opinion-language.ts`),
      change(`${M}/core/validation/attribution-new-check.ts`, "A"),
      change(`${M}/core/validation/find-anchor.test.ts`, "A"),
      change(`${M}/core/validation/validation.test.ts`, "M", 0),
      change(`${M}/core/validation/__corpus__/cases/opn.jsonl`, "M", 0),
    ]);
    assert.deepEqual(r.refused, []);
  });

  it("refuses another workstream's file, an unmapped file, an integrator-only file and demo assets – naming the owner", () => {
    const r = checkChanges(map, "WB", [
      change(`${M}/core/forms/answers.ts`),
      change(`${M}/core/reuse.ts`),
      change("README.md"),
      change(`${M}/core/validation/__corpus__/pending.json`),
      change("docs/bh2-ownership.json"),
      change("demo-assets/blue-heart-templates/maps/x.json", "A"),
    ]);
    assert.deepEqual(
      r.refused.map((x) => [x.path, x.owner ?? null]),
      [
        [`${M}/core/forms/answers.ts`, "WA1"],
        [`${M}/core/reuse.ts`, "integrator"],
        ["README.md", "integrator"],
        [`${M}/core/validation/__corpus__/pending.json`, "integrator"],
        ["docs/bh2-ownership.json", "integrator"],
        ["demo-assets/blue-heart-templates/maps/x.json", null],
      ],
    );
  });

  it("refuses a changed or removed expectation in a test or corpus case it does not own", () => {
    assert.equal(classifyChange(map, "WD", change(`${M}/core/validation/validation.test.ts`, "M", 2)).allowed, false);
    assert.equal(classifyChange(map, "WD", change(`${M}/core/validation/validation.test.ts`, "D", 400)).allowed, false);
    assert.equal(classifyChange(map, "WD", change(`${M}/core/validation/__corpus__/cases/opn.jsonl`, "M", 1)).allowed, false);
    assert.equal(classifyChange(map, "WE", change("scripts/medreport/bh-maps.test.ts", "M", 5)).allowed, true, "its own test");
  });

  it("lets a workstream add corpus lock entries (corpus-lock.mjs --add) but never remove or replace the lock; pending.json stays the integrator's", () => {
    const lock = `${M}/core/validation/__corpus__/safety-corpus.lock.json`;
    const add = classifyChange(map, "WB", change(lock, "M", 1));
    assert.equal(add.allowed, true, "a re-sorted lock with a new entry");
    assert.match(add.reason, /corpus-guard/);
    assert.equal(classifyChange(map, "WB", change(lock, "D", 500)).allowed, false);
    assert.equal(classifyChange(map, "WB", change(lock, "R", 0, lock)).allowed, false);
    assert.equal(classifyChange(map, "WB", change(`${M}/core/validation/__corpus__/pending.json`, "M", 0)).allowed, false);
    assert.equal(classifyChange(map, "WB", change(`${M}/core/validation/__corpus__/allowlist.json`, "M", 0)).allowed, false);
  });

  it("checks a rename at both ends", () => {
    const r = checkChanges(map, "WD", [change(`${M}/core/validation/draft-fit/fragments.ts`, "R", 0, `${M}/core/validation/draft-fit/commentary.ts`)]);
    assert.deepEqual(r.refused.map((x) => x.path), [`${M}/core/validation/draft-fit/commentary.ts`], "commentary.ts is WB's");
  });

  it("cross-cutting paths: the workstreams the entry names may wire them, keeping its rule; others may not", () => {
    const generate = `${M}/ui/components/new/generate.ts`;
    const wc = classifyChange(map, "WC", change(generate));
    assert.equal(wc.allowed, true);
    assert.match(wc.reason, /reuse-notes/);
    assert.equal(classifyChange(map, "WE", change(generate)).allowed, false);
  });

  it("an integrator grant lets one workstream touch one path on one branch", () => {
    const granted = { ...map, grants: [{ path: `${M}/auth/sign-receipt.ts`, workstream: "WA1", branch: "ws/bh2-issue", reason: "receipt MAC fields (seam receipt-mac)" }] };
    assert.equal(classifyChange(granted, "WA1", change(`${M}/auth/sign-receipt.ts`), { branch: "ws/bh2-issue" }).allowed, true);
    assert.equal(classifyChange(granted, "WA1", change(`${M}/auth/sign-receipt.ts`), { branch: "ws/bh2-fix1-wa1" }).allowed, false);
    assert.equal(classifyChange(map, "WA1", change(`${M}/auth/sign-receipt.ts`)).allowed, false, "not granted in the committed map");
  });

  it("W0 and the integrator are exempt", () => {
    assert.deepEqual(checkChanges(map, "W0", [change("README.md"), change(`${M}/core/forms/answers.ts`)]).refused, []);
    assert.deepEqual(checkChanges(map, "WI", [change(`${M}/core/validation/__corpus__/pending.json`)]).refused, []);
    assert.equal(classifyChange(map, "WI", change("demo-assets/x.docx", "A")).allowed, false, "demo assets are never committed, by anyone");
  });
});
