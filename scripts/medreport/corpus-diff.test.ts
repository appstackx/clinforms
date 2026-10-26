/**
 * Safety corpus differential gate (W0.2) in test:medreport: every corpus input that blocks on the production validators
 * (e132057 – what production runs) still blocks here, unless allowlist.json records Khuram's approval for it or
 * pending.json lists it as `DIFF:<id>` with the owning workstream (only the integrator edits either file).
 *
 * Needs the git history (the production snapshot is `git archive e132057 src/modules/medreport`); skipped where there
 * is none. CORPUS_DIFF_REPLAY=<dir> adds the recorded drafts (gitignored demo-assets/bh2-replay/).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runDiff } from "./corpus-diff";

process.env.MEDREPORT_AI_MODE = "demo";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const BASE = process.env.CORPUS_DIFF_BASE ?? "e132057";

function hasBase(): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", `${BASE}^{commit}`], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("safety corpus: differential gate against production", () => {
  it(`everything that blocks on ${BASE} still blocks (or is allowlisted by Khuram / pending with an owner)`, { skip: hasBase() ? false : `no git history for ${BASE}`, timeout: 10 * 60_000 }, async () => {
    const pending = (JSON.parse(fs.readFileSync(path.join(ROOT, "src/modules/medreport/core/validation/__corpus__/pending.json"), "utf8")) as { cases: Record<string, unknown> }).cases ?? {};
    const report = await runDiff({ base: BASE, ...(process.env.CORPUS_DIFF_REPLAY ? { replay: process.env.CORPUS_DIFF_REPLAY } : {}) });
    const unexpected = report.regressions.filter((r) => !pending[`DIFF:${r.id}`]).map((r) => `${r.id}: ${r.detail}`);
    // bh2-base2: an allowlisted regression (Khuram's approval) may stay pending until its owner's merge – reported apart.
    const allowlisted = new Set(report.rows.filter((r) => r.allowlisted).map((r) => `DIFF:${r.id}`));
    const diffPending = Object.keys(pending).filter((k) => k.startsWith("DIFF:"));
    const stillPending = diffPending.filter((k) => allowlisted.has(k));
    const stale = diffPending.filter((k) => !allowlisted.has(k)).filter((k) => !report.regressions.some((r) => `DIFF:${r.id}` === k));
    console.log(
      `differential against ${report.base}: ${report.inputs} inputs, ${report.rows.filter((r) => r.production).length} block on production, ${report.regressions.length} regression(s) (${unexpected.length} not pending), ${allowlisted.size} allowlisted, ${report.stricter} stricter here`,
    );
    if (stillPending.length) console.log(`allowlisted and still pending (their owners land them; the integrator removes them at that merge): ${stillPending.join(", ")}`);
    if (stale.length) console.log(`stale DIFF pending (now block again – the integrator removes them): ${stale.join(", ")}`);
    assert.deepEqual(unexpected, []);
    // Release (empty pending.json): neither stale nor allowlisted-but-pending entries may remain.
    if (process.env.CORPUS_STRICT_PENDING === "1") assert.deepEqual([...stale, ...stillPending], []);
  });
});
