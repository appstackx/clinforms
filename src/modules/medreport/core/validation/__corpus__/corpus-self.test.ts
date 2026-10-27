/**
 * Safety corpus self-tests (W0.2): each protection is shown to fire.
 * - the lock: the TypeScript and the plain-JavaScript hash agree on every case; a tampered case is detected;
 * - the guard (scripts/medreport/corpus-guard.mjs) on a throwaway git repository: a changed or removed case, a removed
 *   or changed lock entry, a passing case moved to pending, a removed ledger hook and an unapproved allowlist entry
 *   each fail; adding a new locked case passes; a recorded retirement passes, and un-retiring, changing a retirement,
 *   a retirement without its decision or superseding case, a retired id reused or a retired row put in pending fail;
 * - the runner: a failing case that is not pending is an unexpected failure; a pending case that holds is reported;
 *   a retired row is reported but never counted; a retirement whose superseding case fails is reported;
 * - retired.json (harness/retired.ts and corpus-lib.mjs agree): a retired id is never reused, never pending, and is
 *   superseded only by existing, live hand-written cases;
 * - the format: a PASS case without a BLOCK twin is refused;
 * - the mutations: the anti-strip carriers around a neutral sentence never block on their own (so a mutation that
 *   still blocks proves the guard, not the carrier);
 * - the ledger: a seam that turns a PASS red counts, one that changes nothing does not;
 * - the third-party wording check fires on a planted 4-word run;
 * - coverage: every required finding (required-sources.json) is pinned by a case's `source`;
 * - the fictional forms: every anchor of every field exists in the generated Word file's outline.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCorpusFiles } from "./harness/corpus";
import { caseLockHash, checkLock, type LockFile } from "./harness/lock";
import { runCorpus } from "./harness/run";
import { checkRetired, type RetiredFile } from "./harness/retired";
import { ledgerSeamItems, type LedgerFile } from "./harness/ledger";
import { STRIP_CARRIERS } from "./harness/mutations";
import { sharedNgrams } from "./harness/ngram";
import { buildCase, buildForm } from "./harness/build";
import { CANDIDATE_ENGINE } from "./harness/engine";
import { validateBuilt } from "./harness/evaluate";
import { INCIDENTAL_CODES } from "./harness/judge";
import { FORMS } from "./harness/fixtures";
import type { CorpusCase, PendingFile } from "./harness/types";
import { buildDocxOutline } from "../../../forms/docx-outline";

process.env.MEDREPORT_AI_MODE = "demo";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "../../../../../..");
const read = (name: string) => fs.readFileSync(path.join(DIR, name), "utf8");
const files = fs
  .readdirSync(path.join(DIR, "cases"))
  .filter((f) => f.endsWith(".jsonl"))
  .sort()
  .map((f) => ({ name: `cases/${f}`, text: read(`cases/${f}`) }));

describe("corpus self-test: lock", () => {
  it("the TypeScript and the JavaScript lock hash agree on every case", async () => {
    const lib = (await import(path.join(REPO, "scripts/medreport/corpus-lib.mjs"))) as { caseLockHash(raw: unknown): string };
    for (const c of parseCorpusFiles(files).cases) assert.equal(await caseLockHash(c.raw), lib.caseLockHash(c.raw), c.case.id);
  });
  it("a tampered case (expectation changed) is detected", async () => {
    const loaded = parseCorpusFiles(files).cases.slice(0, 3).map((c) => c.raw);
    const lock: LockFile = { algorithm: "", entries: {} };
    for (const raw of loaded) lock.entries[String(raw.id)] = await caseLockHash(raw);
    assert.deepEqual(await checkLock(loaded, lock), []);
    const tampered = loaded.map((raw, i) => (i === 1 ? { ...raw, expect: raw.expect === "PASS" ? "FLAG" : "PASS" } : raw));
    assert.deepEqual(await checkLock(tampered, lock), [{ id: String(loaded[1].id), problem: "changed" }]);
    const inputTampered = loaded.map((raw, i) => (i === 2 ? { ...raw, input: { ...(raw.input as object), box: "prognosis-x" } } : raw));
    assert.deepEqual(await checkLock(inputTampered, lock), [{ id: String(loaded[2].id), problem: "changed" }]);
    assert.deepEqual(await checkLock(loaded.slice(1), lock), [{ id: String(loaded[0].id), problem: "orphan" }]);
  });
});

describe("corpus self-test: guard (throwaway repository)", () => {
  const hasGit = spawnSync("git", ["--version"]).status === 0;
  it("fires on every kind of weakening and passes an added case", { skip: hasGit ? false : "git not available" }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-guard-"));
    try {
      const corpus = path.join(tmp, "src/modules/medreport/core/validation/__corpus__");
      fs.mkdirSync(path.join(corpus, "cases"), { recursive: true });
      const sh = (...args: string[]) => execFileSync("git", args, { cwd: tmp, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
      const caseLines = read("cases/opn.jsonl").split("\n").filter(Boolean).slice(0, 4);
      const lib = path.join(REPO, "scripts/medreport/corpus-lib.mjs");
      const guard = path.join(REPO, "scripts/medreport/corpus-guard.mjs");
      const lock = { algorithm: "x", entries: {} as Record<string, string> };
      const libMod = (await import(lib)) as { caseLockHash(raw: unknown): string };
      const hashOf = (line: string) => libMod.caseLockHash(JSON.parse(line));
      for (const l of caseLines) lock.entries[(JSON.parse(l) as { id: string }).id] = hashOf(l);
      const write = (rel: string, text: string) => fs.writeFileSync(path.join(corpus, rel), text);
      const ledger = { minBlock: 5, hooks: [{ id: "h1", kind: "allow", where: "x", owner: "WB", note: "x" }] };
      write("cases/opn.jsonl", `${caseLines.join("\n")}\n`);
      write("safety-corpus.lock.json", JSON.stringify(lock));
      write("pending.json", JSON.stringify({ cases: {} }));
      write("ledger.json", JSON.stringify(ledger));
      write("allowlist.json", JSON.stringify({ entries: {} }));
      sh("init", "-q");
      sh("add", ".");
      sh("commit", "-qm", "base");
      sh("tag", "base");
      const run = () => spawnSync(process.execPath, [guard, "base"], { cwd: tmp, encoding: "utf8" });
      const reset = () => {
        sh("checkout", "-q", "--", ".");
        sh("clean", "-qfd");
      };
      assert.equal(run().status, 0, run().stderr);
      // a changed case
      write("cases/opn.jsonl", `${caseLines.map((l, i) => (i === 0 ? l.replace('"expect":"BLOCK"', '"expect":"FLAG"') : l)).join("\n")}\n`);
      assert.match(run().stderr, /changed/);
      reset();
      // a removed case
      write("cases/opn.jsonl", `${caseLines.slice(1).join("\n")}\n`);
      assert.match(run().stderr, /was removed/);
      reset();
      // a lock entry removed
      const { [Object.keys(lock.entries)[0]]: _gone, ...rest } = lock.entries;
      write("safety-corpus.lock.json", JSON.stringify({ ...lock, entries: rest }));
      assert.match(run().stderr, /lock entry .* was removed/);
      reset();
      // a passing base case (or its mutation, or its differential item) moved to pending
      const first = (JSON.parse(caseLines[0]) as { id: string }).id;
      for (const id of [first, `${first}~strip-prefix`, `DIFF:${first}`]) {
        write("pending.json", JSON.stringify({ cases: { [id]: { owner: "WB", reason: "moved back for the self-test" } } }));
        assert.match(run().stderr, /may not move back to pending/, id);
        reset();
      }
      // a ledger hook removed
      write("ledger.json", JSON.stringify({ ...ledger, hooks: [] }));
      assert.match(run().stderr, /ledger hook h1 was removed/);
      reset();
      // an allowlist entry without Khuram's approval
      write("allowlist.json", JSON.stringify({ entries: { [first]: { decision: "fine" } } }));
      assert.match(run().stderr, /no recorded approval by Khuram/);
      reset();
      // a recorded retirement (the case line and its lock entry stay) passes …
      const second = (JSON.parse(caseLines[1]) as { id: string }).id;
      const retirement = (over: Record<string, unknown> = {}) => ({
        kind: "case",
        lockHash: lock.entries[first],
        retiredOn: "2026-10-26",
        decidedBy: "the self-test",
        decision: "Retired for the self-test: superseded by the second case.",
        reason: "It cannot hold as written (the self-test says so).",
        supersededBy: [second],
        ...over,
      });
      write("retired.json", JSON.stringify({ entries: { [first]: retirement() } }));
      const retiredOk = run();
      assert.equal(retiredOk.status, 0, retiredOk.stderr);
      // … but not without its decision, its superseding case, a superseding case that exists, or a pin that matches
      for (const [over, re] of [
        [{ decision: "" }, /needs decision/],
        [{ supersededBy: [] }, /needs supersededBy/],
        [{ supersededBy: ["OPN-selftest-nowhere"] }, /superseding case OPN-selftest-nowhere does not exist/],
        [{ lockHash: "0".repeat(64) }, /never reused/],
      ] as Array<[Record<string, unknown>, RegExp]>) {
        write("retired.json", JSON.stringify({ entries: { [first]: retirement(over) } }));
        assert.match(run().stderr, re, JSON.stringify(over));
      }
      // … nor a retired row that is pending
      write("retired.json", JSON.stringify({ entries: { [first]: retirement() } }));
      write("pending.json", JSON.stringify({ cases: { [first]: { owner: "WB", reason: "retired and pending for the self-test" } } }));
      assert.match(run().stderr, /a retired row is never pending/);
      reset();
      // retired.json is append-only: once committed, a retirement is never removed or changed …
      write("retired.json", JSON.stringify({ entries: { [first]: retirement() } }));
      sh("add", ".");
      sh("commit", "-qm", "retire");
      sh("tag", "-f", "base");
      assert.equal(run().status, 0, run().stderr);
      write("retired.json", JSON.stringify({ entries: {} }));
      assert.match(run().stderr, /was un-retired/);
      reset();
      write("retired.json", JSON.stringify({ entries: { [first]: retirement({ reason: "Another reason, written later on." }) } }));
      assert.match(run().stderr, /entry changed – retired.json is append-only/);
      reset();
      // … and its id is never reused: the retired case replaced by another under the same id (new lock entry) fails
      const reused = caseLines[0].replace(/"expect":"[A-Z_]+"/, '"expect":"FLAG"').replace(/,"ack":"[a-z]+"/, "");
      write("cases/opn.jsonl", `${[reused, ...caseLines.slice(1)].join("\n")}\n`);
      write("safety-corpus.lock.json", JSON.stringify({ ...lock, entries: { ...lock.entries, [first]: hashOf(reused) } }));
      const reusedRun = run().stderr;
      assert.match(reusedRun, /never reused/);
      assert.match(reusedRun, new RegExp(`case ${first} changed`));
      reset();
      // adding a new, locked case passes (and a new pending entry for it is allowed)
      const added = caseLines[1].replace(/"id":"[^"]+"/, '"id":"OPN-selftest-added"');
      write("cases/opn.jsonl", `${caseLines.join("\n")}\n${added}\n`);
      write("safety-corpus.lock.json", JSON.stringify({ ...lock, entries: { ...lock.entries, "OPN-selftest-added": hashOf(added) } }));
      write("pending.json", JSON.stringify({ cases: { "OPN-selftest-added": { owner: "WB", reason: "a new case allowed to fail" } } }));
      const ok = run();
      assert.equal(ok.status, 0, ok.stderr);
      // …but not without its lock entry
      write("safety-corpus.lock.json", JSON.stringify(lock));
      assert.match(run().stderr, /has no lock entry/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("corpus self-test: runner and format", () => {
  const ledger = JSON.parse(read("ledger.json")) as LedgerFile;
  it("a failing case that is not pending is an unexpected failure; a pending case that holds is stale", async () => {
    const failing = "OPN-recall-recovery-01";
    const holding = "OPN-carrier-01";
    const empty: PendingFile = { cases: {} };
    const r1 = await runCorpus({ files, pending: empty, ledger, oneClicks: false, ledgerItems: false, filter: (id) => id === failing || id === holding });
    const failRow = r1.rows.find((r) => r.id === failing);
    if (failRow && !failRow.ok) assert.ok(r1.unexpectedFailures.some((r) => r.id === failing));
    const r2 = await runCorpus({ files, pending: { cases: { [holding]: { owner: "WB", reason: "pretend pending for the self-test" } } }, ledger, oneClicks: false, ledgerItems: false, filter: (id) => id === holding });
    assert.deepEqual(r2.stalePending.map((r) => r.id), [holding]);
  });
  it("a retired row runs and is reported but never counted; a retirement whose superseding case fails is reported", async () => {
    const retiredFile = JSON.parse(read("retired.json")) as RetiredFile;
    const id = "COM-colleague-01";
    const entry = retiredFile.entries[id];
    assert.ok(entry, `${id} is retired`);
    const only = (x: string) => x === id || x === "COM-selftest-fails" || entry.supersededBy.includes(x);
    const none: RetiredFile = { entries: {} };
    const asIs = await runCorpus({ files, pending: { cases: {} }, ledger, retired: none, oneClicks: false, ledgerItems: false, filter: only });
    assert.ok(asIs.unexpectedFailures.some((r) => r.id === id), "not retired: an unexpected failure");
    const retiredRun = await runCorpus({ files, pending: { cases: {} }, ledger, retired: { entries: { [id]: entry } }, oneClicks: false, ledgerItems: false, filter: only });
    assert.deepEqual(retiredRun.loadErrors, []);
    assert.equal(retiredRun.unexpectedFailures.some((r) => r.id === id), false, "retired: not a failure");
    assert.deepEqual(retiredRun.retiredRows.map((r) => r.id), [id]);
    assert.equal(retiredRun.counts.retired, 1);
    assert.deepEqual(retiredRun.retiredUncovered, []);
    // The same retirement superseded by a case that fails (a copy of the retired case under a new id) is not covered.
    const copy = files.find((f) => f.name === "cases/com.jsonl")!.text.split("\n").find((l) => l.includes(`"id":"${id}"`))!.replace(`"id":"${id}"`, '"id":"COM-selftest-fails"');
    const withCopy = [...files, { name: "cases/zz-selftest.jsonl", text: `${copy}\n` }];
    const uncovered = await runCorpus({ files: withCopy, pending: { cases: {} }, ledger, retired: { entries: { [id]: { ...entry, supersededBy: ["COM-selftest-fails"] } } }, oneClicks: false, ledgerItems: false, filter: only });
    assert.match(uncovered.retiredUncovered.join("\n"), /superseding case COM-selftest-fails does not hold/);
  });
  it("a retired id is never reused, never pending, and superseded only by existing, live hand-written cases (TypeScript and JavaScript agree)", async () => {
    const lib = (await import(path.join(REPO, "scripts/medreport/corpus-lib.mjs"))) as {
      checkRetiredFile(retired: unknown, cases: Map<string, unknown>, pending: unknown): string[];
    };
    const retiredFile = JSON.parse(read("retired.json")) as RetiredFile;
    const loaded = parseCorpusFiles(files).cases;
    const jsCases = (ls: typeof loaded) => new Map(ls.map((c) => [c.case.id, c.raw as unknown]));
    const both = async (r: RetiredFile, ls = loaded, pend: PendingFile = { cases: {} }) => {
      const ts = await checkRetired(r, ls, pend);
      assert.deepEqual(lib.checkRetiredFile(r, jsCases(ls), pend.cases), ts);
      return ts.join("\n");
    };
    assert.equal(await both(retiredFile), "");
    const id = "COM-colleague-01";
    const entry = retiredFile.entries[id];
    // Reused: another case under the retired id (here: the retired case with its input changed).
    const reused = loaded.map((c) => (c.case.id === id ? { ...c, raw: { ...c.raw, input: { ...(c.raw.input as object), box: "treatment_provided" } } } : c));
    assert.match(await both(retiredFile, reused), new RegExp(`retired ${id}: the case with this id is not the one retired.*never reused`));
    // A generated row's parent changed.
    const gen = "OPN-twin-priya~origin-staff";
    const parentChanged = loaded.map((c) => (c.case.id === "OPN-twin-priya" ? { ...c, raw: { ...c.raw, expect: "FLAG" } } : c));
    assert.match(await both(retiredFile, parentChanged), new RegExp(`retired ${gen}: its case OPN-twin-priya is not the one.*never reused`));
    // Never pending.
    assert.match(await both(retiredFile, loaded, { cases: { [id]: { owner: "WB", reason: "retired and pending (self-test)" } } }), /a retired row is never pending/);
    // Superseded by something that does not exist, by a retired case, by a generated row, by itself.
    for (const [sup, re] of [
      ["COM-selftest-nowhere", /does not exist/],
      ["COM-colleague-02", /is retired itself/],
      ["COM-colleague-09~strip-prefix", /must be a hand-written case/],
      [id, /cannot be superseded by .* itself/],
    ] as Array<[string, RegExp]>) {
      assert.match(await both({ entries: { ...retiredFile.entries, [id]: { ...entry, supersededBy: [sup] } } }), re, sup);
    }
    // A decision record is required.
    assert.match(await both({ entries: { [id]: { ...entry, decidedBy: "", decision: "ok" } } }), /needs decidedBy[\s\S]*needs decision/);
    // A PASS case whose negativeTwin is retired.
    const twinRetired: RetiredFile = { entries: { ...retiredFile.entries, "REP-remove-block-02": { ...retiredFile.entries["REP-remove-pass-02"], lockHash: undefined } } };
    assert.match(await both(twinRetired), /REP-remove-block-02: the case with this id is not the one retired[\s\S]*its negativeTwin REP-remove-block-02 is retired/);
  });
  it("a PASS case without a BLOCK twin is refused", () => {
    const line = JSON.stringify({ id: "OPN-selftest-pass", group: "OPN", title: "t", source: ["x"], owner: "WB", paths: ["validate"], input: {}, expect: "PASS" });
    assert.match(parseCorpusFiles([{ name: "t.jsonl", text: line }]).errors.join("\n"), /negativeTwin/);
  });
});

describe("corpus self-test: mutations are not vacuous", () => {
  it("around a neutral, cited sentence, nothing blocks but the carrier's own words (which a mutation does not count)", async () => {
    for (const carrier of STRIP_CARRIERS) {
      const built = await buildCase({ box: "progress_current_status", paragraph: { text: carrier.apply("He attended his appointments."), cites: ["N-001"], origin: "ai" } } as CorpusCase["input"]);
      const res = validateBuilt(built, CANDIDATE_ENGINE);
      const own = res.blocking.filter(
        (f) => f.sectionKey === "progress_current_status" && !INCIDENTAL_CODES.has(f.code) && !carrier.apply("").toLowerCase().includes((f.evidence ?? "").toLowerCase()),
      );
      assert.deepEqual(own.map((f) => `${f.code}:${f.evidence ?? ""}`), [], carrier.id);
    }
  });
});

describe("corpus self-test: ledger seam", () => {
  it("a seam that turns a tagged PASS case red counts; one that changes nothing does not", async () => {
    const ledger: LedgerFile = { minBlock: 1, hooks: [{ id: "h1", kind: "allow", where: "x", owner: "WB", note: "x" }, { id: "h2", kind: "allow", where: "x", owner: "WB", note: "x" }] };
    const pass = (id: string, hook: string) => ({ id, tags: [`hook:${hook}`], expect: "PASS" }) as unknown as CorpusCase;
    let disabled: string | null = null;
    const registry = {
      HOOK_IDS: ["h1", "h2"],
      async withHookDisabled<T>(id: string, fn: () => Promise<T>): Promise<T> {
        disabled = id;
        try {
          return await fn();
        } finally {
          disabled = null;
        }
      },
    };
    const items = await ledgerSeamItems(ledger, [pass("A", "h1"), pass("B", "h2")], registry, async (c) => !(c.id === "A" && disabled === "h1"));
    assert.deepEqual(items.map((i) => [i.id, i.ok]), [["LEDGER-h1-seam", true], ["LEDGER-h2-seam", false]]);
    const none = await ledgerSeamItems(ledger, [pass("A", "h1")], null, async () => true);
    assert.equal(none.every((i) => !i.ok), true);
  });
});

describe("corpus self-test: third-party wording check", () => {
  it("fires on a planted 4-word run and ignores ClinForms' own wording and common words", () => {
    const planted = sharedNgrams([{ where: "planted", text: "The claimant may resume light work duties next month." }], ["Claimant may resume light work duties from week 6"]);
    assert.ok(planted.some((o) => o.gram === "may resume light work"), JSON.stringify(planted));
    assert.deepEqual(sharedNgrams([{ where: "own", text: "Typed by staff on each report." }], ["Typed by staff on each report."], { ownWording: ["Typed by staff on each report."] }), []);
    assert.deepEqual(sharedNgrams([{ where: "common", text: "it is in the" }], ["it is in the"]), []);
  });
});

describe("corpus self-test: coverage and fixtures", () => {
  it("every required finding is pinned by a case's source (or listed as not pinnable with a reason)", () => {
    const req = JSON.parse(read("required-sources.json")) as { reviewFindings: string[]; triageHighMedium: string[]; newFindings: string[]; notPinnable: Record<string, string> };
    const ids = new Set<string>();
    // A whole id only: "plan WD-4" does not pin D-4, nor "B1-16" pin B1-1.
    const TOKEN = /(?:^|[^A-Za-z0-9])(R-(?:safety|security|regression)-\d+|B\d-\d+|N-ATTR-\d+|C-ATTR-\d+|C-REV-\d+|C-FILL-\d+|C-\d+|NEW-\d+|N-\d+|Q-\d+|D-\d+|E\d+|F\d+)(?![0-9])/g;
    // A retired case (retired.json) pins nothing any more: its superseding cases carry its sources.
    const retiredCases = new Set(Object.entries((JSON.parse(read("retired.json")) as RetiredFile).entries).filter(([, e]) => e.kind === "case").map(([id]) => id));
    for (const c of parseCorpusFiles(files).cases.filter((x) => !retiredCases.has(x.case.id))) for (const s of c.case.source) for (const m of Array.from(s.matchAll(TOKEN))) ids.add(m[1]);
    const missing = [...req.reviewFindings, ...req.triageHighMedium, ...req.newFindings].filter((id) => !ids.has(id) && !req.notPinnable[id]);
    assert.deepEqual(missing, []);
    for (const [id, why] of Object.entries(req.notPinnable)) assert.ok(why.length > 20, `${id}: a reason`);
  });
  it("every anchor of every fictional form exists in its generated Word file", async () => {
    for (const id of Object.keys(FORMS)) {
      const { form, bytes } = await buildForm(id, "clinic-corpus");
      const blocks = new Set(buildDocxOutline(bytes).blocks.map((b) => b.id));
      for (const f of form.fields) {
        const a = f.anchor as { blockId?: string; optionGlyphs?: Array<{ blockId: string }>; optionCells?: Array<{ blockId: string }> };
        for (const b of [a.blockId, ...(a.optionGlyphs ?? []).map((g) => g.blockId), ...(a.optionCells ?? []).map((g) => g.blockId)]) {
          if (b) assert.ok(blocks.has(b), `${id} ${f.id}: ${b}`);
        }
      }
    }
  });
});
