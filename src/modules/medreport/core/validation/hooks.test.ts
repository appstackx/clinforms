/**
 * The safety corpus ledger's test seam (core/validation/hooks.ts, re-exported by registry.ts): the corpus runner finds
 * it under the contract's names, a hook is enabled except inside withHookDisabled, and disabling a wired hook is what
 * turns its tagged PASS case red in the ledger. Test-only hook ids; no product hook is registered here.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HOOK_IDS, defineHook, hookEnabled, withHookDisabled } from "./registry";
import { ledgerSeamItems, loadSeamRegistry, type LedgerFile } from "./__corpus__/harness/ledger";
import type { CorpusCase } from "./__corpus__/harness/types";

describe("ledger test seam (hooks.ts)", () => {
  it("the corpus runner loads registry.ts as its seam registry", async () => {
    const registry = await loadSeamRegistry();
    assert.ok(registry, "registry.ts exports HOOK_IDS and withHookDisabled");
    assert.equal(registry.HOOK_IDS, HOOK_IDS, "the same live list the product registers into");
  });

  it("a hook is enabled except inside withHookDisabled, and is restored afterwards – also after a throw", async () => {
    const id = defineHook("selftest-seam-a");
    assert.equal(defineHook("selftest-seam-a"), id, "idempotent");
    assert.equal(HOOK_IDS.filter((h) => h === id).length, 1);
    assert.equal(hookEnabled(id), true);
    const inside = await withHookDisabled(id, async () => [hookEnabled(id), hookEnabled("selftest-other")]);
    assert.deepEqual(inside, [false, true], "only the named hook is disabled");
    assert.equal(hookEnabled(id), true);
    await assert.rejects(withHookDisabled(id, async () => {
      throw new Error("boom");
    }), /boom/);
    assert.equal(hookEnabled(id), true, "restored after a throw");
  });

  it("refuses an unknown hook and a malformed id", async () => {
    await assert.rejects(withHookDisabled("selftest-never-defined", async () => 1), /no hook/);
    assert.throws(() => defineHook("bad id"), /letters, digits/);
  });

  it("a wired hook's seam turns its tagged PASS case red in the ledger; an unwired one stays 'no seam'", async () => {
    const wired = defineHook("selftest-seam-wired");
    const ledger: LedgerFile = {
      minBlock: 1,
      hooks: [
        { id: wired, kind: "allow", where: "test", owner: "W0", note: "test" },
        { id: "selftest-seam-unwired", kind: "allow", where: "test", owner: "WB", note: "test" },
      ],
    };
    const pass = (id: string, hook: string) => ({ id, tags: [`hook:${hook}`], expect: "PASS" }) as unknown as CorpusCase;
    // The "product": the case passes only while the hook applies.
    const runPass = async (c: CorpusCase) => !(c.id === "P1" && !hookEnabled(wired));
    const items = await ledgerSeamItems(ledger, [pass("P1", wired), pass("P2", "selftest-seam-unwired")], await loadSeamRegistry(), runPass);
    assert.deepEqual(items.map((i) => [i.id, i.ok, i.owner]), [
      [`LEDGER-${wired}-seam`, true, "W0"],
      ["LEDGER-selftest-seam-unwired-seam", false, "WB"],
    ]);
    assert.match(items[1].detail, /no seam/);
  });
});
