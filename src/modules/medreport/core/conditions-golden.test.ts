/**
 * bh2 WA1 design 3: a golden of how every question of the referrers' own forms is read as a condition (env-gated).
 * The referrers' maps – and the golden, which names their forms – are gitignored, so this runs only where they are:
 *
 *   CLINFORMS_THIRD_PARTY_MAPS=<dir with *.maps.json> CLINFORMS_CONDITION_GOLDEN=<golden.json> npm run test:medreport
 *   … CLINFORMS_CONDITION_GOLDEN_WRITE=1   writes the golden from the parser as it reads now (review it, then keep it)
 *
 * The golden holds ids and enums only – per form, per field id: the controlling field ids, what they must be
 * (yes / no / other), how several combine (any / all), unresolved – never wording. Without both variables no test is
 * registered (the default chain allows no extra skips). On a difference it prints the field ids only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { compileCondition, type ConditionField } from "./conditions";

const MAPS = process.env.CLINFORMS_THIRD_PARTY_MAPS;
const GOLDEN = process.env.CLINFORMS_CONDITION_GOLDEN;

type Reading = { c: string[]; w?: string; m?: string; u?: true } | null;
type Golden = Record<string, Record<string, Record<string, Reading>>>;

function readMaps(dir: string): Array<{ file: string; map: string; fields: ConditionField[] }> {
  const out: Array<{ file: string; map: string; fields: ConditionField[] }> = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Record<string, unknown>;
    const maps = (json.maps ?? json) as Record<string, { fields?: Array<ConditionField & { fillSource?: { kind?: string } }> }>;
    for (const [map, m] of Object.entries(maps)) {
      if (!m || !Array.isArray(m.fields)) continue;
      out.push({ file, map, fields: m.fields.filter((f) => f.fillSource?.kind !== "leave_blank") });
    }
  }
  return out;
}

function reading(fields: readonly ConditionField[], id: string): Reading {
  const c = compileCondition(fields, id);
  if (!c) return null;
  return { c: c.controllers, ...(c.wants ? { w: c.wants } : {}), ...(c.match ? { m: c.match } : {}), ...(c.unresolved ? { u: true as const } : {}) };
}

if (MAPS && GOLDEN) {
  describe("conditions: the referrers' forms read as the golden says (env-gated)", () => {
    it("every field of every map: controllers, wants, match, unresolved", () => {
      const now: Golden = {};
      for (const { file, map, fields } of readMaps(MAPS)) {
        now[file] ??= {};
        now[file][map] = Object.fromEntries(fields.map((f) => [f.id, reading(fields, f.id)]));
      }
      if (process.env.CLINFORMS_CONDITION_GOLDEN_WRITE === "1") {
        fs.writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`, { mode: 0o600 });
        return;
      }
      const golden = JSON.parse(fs.readFileSync(GOLDEN, "utf8")) as Golden;
      const differences: string[] = [];
      let conditional = 0;
      for (const [file, maps] of Object.entries(golden)) {
        for (const [map, fields] of Object.entries(maps)) {
          const ids = Object.keys(fields);
          ids.forEach((id, n) => {
            if (fields[id]) conditional += 1;
            if (JSON.stringify(now[file]?.[map]?.[id] ?? null) !== JSON.stringify(fields[id])) differences.push(`${file} #${Object.keys(maps).indexOf(map) + 1} ${id} (field ${n + 1})`);
          });
        }
      }
      assert.ok(conditional > 0, "the golden names the conditional fields");
      assert.deepEqual(differences, []);
    });
  });
}
