/**
 * bh2 fix round 1 (R1T-WA1-07 – the C2 gate's replay rows; a W0 tooling exception made by WA1): `corpus-diff --replay`
 * compares a recorded report's blocking set by code and evidence ACROSS boxes (a merge code now raised on the box that
 * replaces it is still blocked), reads it in its approver's voice, and keys a row whose difference IS an approved
 * allowlist entry's behaviour to that entry (disabling the hook the entry's case pins brings the block back). No
 * allowlist entry is added. Fictional data only (the safety corpus's own cases as recorded drafts).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ReportFlag } from "../../src/modules/medreport/core/types";
import { CaseInputSchema, type CaseInput } from "../../src/modules/medreport/core/validation/__corpus__/harness/types";
import { buildCase } from "../../src/modules/medreport/core/validation/__corpus__/harness/build";
import { movedBlocks, replayVoiceOwner, runDiff } from "./corpus-diff";

process.env.MEDREPORT_AI_MODE = "demo";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const BASE = process.env.CORPUS_DIFF_BASE ?? "e132057";

const flag = (sectionKey: string, code: ReportFlag["code"], evidence?: string): ReportFlag => ({ id: `${code}:${sectionKey}:${evidence ?? ""}`, code, severity: "blocking", sectionKey, message: "m", ...(evidence ? { evidence } : {}) });

function hasBase(): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", `${BASE}^{commit}`], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("corpus-diff --replay rows (R1T-WA1-07)", () => {
  it("a block that moved to another box with the same code and evidence still counts; a different code, evidence or none does not", () => {
    const code = "mail-merge field <<P_REF>> in paragraph 3";
    assert.deepEqual(movedBlocks([flag("F-01", "MISSING_PLACEHOLDER", code)], [flag("F-04", "MISSING_PLACEHOLDER", code)]), ["F-04"]);
    assert.deepEqual(movedBlocks([flag("F-01", "MISSING_PLACEHOLDER", code)], [flag("F-04", "MISSING_PLACEHOLDER", "mail-merge field <<P_OTHER>> in paragraph 3")]), null);
    assert.deepEqual(movedBlocks([flag("F-01", "MISSING_PLACEHOLDER", code)], [flag("F-04", "OPINION_LANGUAGE", code)]), null);
    assert.deepEqual(movedBlocks([flag("F-01", "OPINION_LANGUAGE")], [flag("F-04", "OPINION_LANGUAGE")]), null, "no evidence: never matched across boxes");
    assert.deepEqual(movedBlocks([flag("F-01", "MISSING_PLACEHOLDER", code), flag("F-01", "OPEN_GAP", "g-1")], [flag("F-04", "MISSING_PLACEHOLDER", code)]), null, "every block of the box must be found");
  });

  it("a recorded report is read in its approver's voice (a staff-prepared report has no author)", () => {
    const sarah = { memberId: "mem_sarah", name: "Sarah Reid", hcpc: "PH-DEMO-01" };
    const tom = { name: "Tom Ellis", hcpc: "PH-DEMO-02" };
    assert.deepEqual(replayVoiceOwner({ approver: sarah, author: tom }), { name: "Sarah Reid", hcpc: "PH-DEMO-01" });
    assert.deepEqual(replayVoiceOwner({ approver: sarah }), { name: "Sarah Reid", hcpc: "PH-DEMO-01" });
    assert.deepEqual(replayVoiceOwner({ author: tom }), tom);
    assert.equal(replayVoiceOwner({}), null);
  });

  it("a recorded F1 narrated return (the approved DIFF:OPN-ok-f1 behaviour) is keyed to that entry; its twin still regresses nothing", { skip: hasBase() ? false : `no git history for ${BASE}`, timeout: 5 * 60_000 }, async () => {
    const corpus = fs
      .readdirSync(path.join(ROOT, "src/modules/medreport/core/validation/__corpus__/cases"))
      .flatMap((f) => fs.readFileSync(path.join(ROOT, "src/modules/medreport/core/validation/__corpus__/cases", f), "utf8").split("\n"))
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { id: string; input: unknown });
    const input = (id: string) => CaseInputSchema.parse(corpus.find((c) => c.id === id)?.input) as CaseInput;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-replay-"));
    try {
      const f1 = await buildCase(input("OPN-ok-f1"));
      fs.writeFileSync(path.join(dir, "f1.json"), JSON.stringify({ report: f1.report }));
      const twin = await buildCase(input("OPN-twin-f1"));
      fs.writeFileSync(path.join(dir, "twin.json"), JSON.stringify({ report: twin.report }));
      const report = await runDiff({ base: BASE, replay: dir, filter: (id) => id.startsWith("replay:") });
      const row = report.rows.find((r) => r.id === `replay:f1.json#${f1.box}`);
      assert.ok(row, "the F1 box is compared");
      assert.equal(row.production, true, row.detail);
      assert.equal(row.regression, true, row.detail);
      assert.equal(row.allowlisted, true, row.detail);
      assert.match(row.detail, /the approved DIFF:OPN-ok-f1 behaviour/);
      assert.equal(report.regressions.some((r) => r.id.startsWith("replay:f1.json")), false);
      // The twin (a need inserted into the same return) blocks on both: nothing to key.
      const t = report.rows.find((r) => r.id === `replay:twin.json#${twin.box}`);
      assert.equal(t?.candidate, true, t?.detail);
      assert.equal(t?.regression, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
