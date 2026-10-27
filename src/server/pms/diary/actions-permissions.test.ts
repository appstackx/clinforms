/**
 * Source check of the diary's entry points (src/app/app/clinic/diary/**): every server action asks the actor for
 * exactly the permission its server-layer function enforces (DIARY_ACTION_PERMISSIONS) and calls that function;
 * every route handler goes through clinicRoute() with the permission listed here. The server layer checks the
 * permission again (service suite), so this guards against an action that asks for less and works by accident.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { DIARY_ACTION_PERMISSIONS } from "./writes";

const ROOT = path.resolve(__dirname, "../../../..");
const DIARY = path.join(ROOT, "src/app/app/clinic/diary");

function files(dir: string, name: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(full, name));
    else if (entry.name === name) out.push(full);
  }
  return out;
}

/** Route (relative to the diary folder) → method → the permission clinicRoute() must ask for. */
const ROUTES: Record<string, Record<string, string>> = {
  "api/appointments/[appointmentId]/route.ts": { GET: "diary.view" },
  "api/day-sheet/route.ts": { GET: "diary.view" },
  "api/patients/route.ts": { POST: "patients.view" },
  "api/patients/[patientId]/route.ts": { GET: "diary.book" },
  "api/patients/[patientId]/appointments/route.ts": { GET: "diary.view" },
  "api/rotas/route.ts": { GET: "diary.view" },
  "api/slots/route.ts": { GET: "diary.view" },
  "api/view/route.ts": { GET: "diary.view" },
  "api/waiting-list/route.ts": { GET: "diary.view" },
  "api/waiting-list/[entryId]/route.ts": { GET: "diary.view" },
};

describe("diary entry points ask for the right permission (source check)", () => {
  it("each server action: the permission of DIARY_ACTION_PERMISSIONS, then its server-layer function", () => {
    const seen = new Set<string>();
    for (const file of files(DIARY, "actions.ts")) {
      const source = fs.readFileSync(file, "utf8");
      for (const m of Array.from(source.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n\s*const actor = await clinicActionActor\(\{ permission: "([a-z.]+)" \}\);\n[^\n]*\n\s*return done\(await (\w+)\(await diaryCallerOf\(actor\), input\)\);\n\}/g))) {
        const [, name, permission, fn] = m;
        assert.ok(name in DIARY_ACTION_PERMISSIONS, `${name} is not in DIARY_ACTION_PERMISSIONS`);
        assert.equal(permission, DIARY_ACTION_PERMISSIONS[name as keyof typeof DIARY_ACTION_PERMISSIONS], `${name} asks for ${permission}`);
        assert.equal(fn, name.replace(/Action$/, "For"), `${name} calls ${fn}`);
        seen.add(name);
      }
      const exported = Array.from(source.matchAll(/export async function (\w+)/g)).map((x) => x[1]);
      assert.deepEqual(exported.filter((n) => !seen.has(n)), [], `${path.relative(ROOT, file)}: an action that does not follow the pattern`);
    }
    assert.deepEqual(Object.keys(DIARY_ACTION_PERMISSIONS).filter((n) => !seen.has(n)), [], "every server-layer write has its action");
  });

  it("each route handler: clinicRoute() with the listed permission; no other routes", () => {
    const found = files(path.join(DIARY, "api"), "route.ts").map((f) => path.relative(DIARY, f));
    assert.deepEqual(found.sort(), Object.keys(ROUTES).sort());
    for (const [rel, methods] of Object.entries(ROUTES)) {
      const source = fs.readFileSync(path.join(DIARY, rel), "utf8");
      const handlers = Array.from(source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) = clinicRoute\(\{ permission: "([a-z.]+)" \}/g)).map((m) => [m[1], m[2]]);
      assert.deepEqual(Object.fromEntries(handlers), methods, rel);
    }
  });
});
