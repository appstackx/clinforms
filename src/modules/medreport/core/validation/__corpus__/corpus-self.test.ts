/**
 * Safety corpus self-tests (W0.2): each protection is shown to fire.
 * - the lock: the TypeScript and the plain-JavaScript hash agree on every case; a tampered case is detected;
 * - the guard (scripts/medreport/corpus-guard.mjs) on a throwaway git repository: a changed or removed case, a removed
 *   or changed lock entry, a passing case moved to pending, a removed ledger hook and an unapproved allowlist entry
 *   each fail; adding a new locked case passes;
 * - the runner: a failing case that is not pending is an unexpected failure; a pending case that holds is reported;
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
    const TOKEN = /(R-(?:safety|security|regression)-\d+|B\d-\d+|N-ATTR-\d+|C-ATTR-\d+|C-REV-\d+|C-FILL-\d+|C-\d+|NEW-\d+|N-\d+|Q-\d+|D-\d+|E\d+|F\d+)/g;
    for (const c of parseCorpusFiles(files).cases) for (const s of c.case.source) for (const m of Array.from(s.matchAll(TOKEN))) ids.add(m[1]);
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
