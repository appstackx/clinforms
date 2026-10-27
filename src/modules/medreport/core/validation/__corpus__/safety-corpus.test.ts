/**
 * The pinned safety corpus (W0.2) – part of test:medreport.
 *
 * 1. The corpus is well-formed: every line parses, ids are unique, every PASS case names a BLOCK negativeTwin, every
 *    `hook:` tag names a ledger hook, every pending entry names something that runs and has an owner.
 * 2. The lock is intact: every case has its lock entry and the hash of (id, input, expectation) matches; no entry
 *    without a case. (corpus-guard.mjs compares the lock and the cases with the base branch.)
 * 3. Every case, generated mutation, one-click variant and ledger item holds – or is listed in pending.json with the
 *    workstream that owns it. A pending item that now holds is reported (CORPUS_STRICT_PENDING=1 fails on it: the
 *    integrator removes it).
 * 4. Retired rows (retired.json, harness/retired.ts): each has its decision record and pins the row it retires (a
 *    retired id is never reused), is never pending, and every superseding case holds. A retired row still runs and is
 *    reported; it counts neither as a failure nor as a hold.
 *
 * CORPUS_REPORT=<file> writes every result as JSON; CORPUS_ONLY=<regex> runs a subset (local use).
 * Fictional data only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseCorpusFiles } from "./harness/corpus";
import { checkLock, type LockFile } from "./harness/lock";
import { runCorpus, type RunReport } from "./harness/run";
import { checkRetired, type RetiredFile } from "./harness/retired";
import type { LedgerFile } from "./harness/ledger";
import { OWNERS, type PendingFile } from "./harness/types";

process.env.MEDREPORT_AI_MODE = "demo";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const read = (name: string) => fs.readFileSync(path.join(DIR, name), "utf8");

function corpusFiles(): Array<{ name: string; text: string }> {
  return fs
    .readdirSync(path.join(DIR, "cases"))
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => ({ name: `cases/${f}`, text: read(`cases/${f}`) }));
}

const files = corpusFiles();
const pending = JSON.parse(read("pending.json")) as PendingFile;
const ledger = JSON.parse(read("ledger.json")) as LedgerFile;
const lock = JSON.parse(read("safety-corpus.lock.json")) as LockFile;
const retired = JSON.parse(read("retired.json")) as RetiredFile;
const only = process.env.CORPUS_ONLY ? new RegExp(process.env.CORPUS_ONLY) : null;

describe("safety corpus: format", () => {
  it("every line parses; ids unique; PASS cases name a BLOCK twin; hook tags are registered", () => {
    const loaded = parseCorpusFiles(files);
    assert.deepEqual(loaded.errors, []);
    assert.ok(loaded.cases.length > 0);
  });
  it("retired rows have their decision record, pin what they retire, are not pending and name existing superseding cases", async () => {
    assert.deepEqual(await checkRetired(retired, parseCorpusFiles(files).cases, pending), []);
  });
  it("pending entries have an owner workstream and a reason", () => {
    for (const [id, e] of Object.entries(pending.cases ?? {})) {
      assert.ok((OWNERS as readonly string[]).includes(e.owner), `${id}: owner ${e.owner}`);
      assert.ok(e.reason && e.reason.length > 10, `${id}: a reason`);
    }
  });
});

describe("safety corpus: lock", () => {
  it("every case is locked with the hash of its id, input and expectation; no orphan entries", async () => {
    const loaded = parseCorpusFiles(files);
    const problems = await checkLock(
      loaded.cases.map((c) => c.raw),
      lock,
    );
    assert.deepEqual(problems, [], "run node scripts/medreport/corpus-lock.mjs --add for NEW cases only; never change an existing entry");
  });
});

describe("safety corpus: cases", () => {
  let report: RunReport;
  it("runs every case, mutation, one-click variant and ledger item", { timeout: 15 * 60_000 }, async () => {
    report = await runCorpus({ files, pending, ledger, retired, ...(only ? { filter: (id: string) => only.test(id) } : {}) });
    if (process.env.CORPUS_REPORT) fs.writeFileSync(process.env.CORPUS_REPORT, JSON.stringify(report, null, 1));
    const c = report.counts;
    console.log(
      `safety corpus: ${c.cases} cases, ${c.mutations} mutations, ${c.oneClicks} one-click variants, ${c.ledger} ledger items – ${c.pass} hold, ${c.fail} fail (${c.pending} pending); ${c.retired} retired`,
    );
    assert.deepEqual(report.loadErrors, []);
  });
  it("nothing fails that is not pending", () => {
    assert.ok(report, "the corpus ran");
    const lines = report.unexpectedFailures.map((r) => `${r.id} [${r.owner}] ${r.detail}`);
    assert.deepEqual(lines, [], `${lines.length} unexpected failure(s)`);
  });
  it("pending names only what runs", () => {
    assert.ok(report, "the corpus ran");
    assert.deepEqual(only ? [] : report.unknownPending, []);
  });
  it("every retirement is covered: its superseding cases hold (retired rows are reported, never counted)", () => {
    assert.ok(report, "the corpus ran");
    for (const r of report.retiredRows) console.log(`retired ${r.id} [${r.owner}] ${r.ok ? "(would hold)" : "(would fail)"} ${r.detail.slice(0, 160)}`);
    if (report.retiredNotRun.length) console.log(`retired rows that no longer run: ${report.retiredNotRun.join(", ")}`);
    assert.deepEqual(report.retiredUncovered, []);
  });
  it("pending items that now hold are reported (CORPUS_STRICT_PENDING=1 fails)", () => {
    assert.ok(report, "the corpus ran");
    const stale = report.stalePending.map((r) => `${r.id} [${r.owner}]`);
    if (stale.length) console.log(`stale pending (now hold – the integrator removes them): ${stale.join(", ")}`);
    if (process.env.CORPUS_STRICT_PENDING === "1") assert.deepEqual(stale, []);
  });
});
