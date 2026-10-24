/**
 * The contract's machine-checked parts (docs/clinic-system/contract.md): migration ranges and twins, navigation,
 * record tabs and audit labels per module, product naming, and the generated ESLint boundary being up to date.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { BANNED_TERM_PATTERNS } from "../../src/modules/medreport/core/wording";
import { PMS_AUDIT_LABELS, PMS_AUDIT_TARGETS } from "../../src/modules/pms/audit";
import { PMS_NAV } from "../../src/modules/pms/nav";
import { PMS_RECORD_TABS } from "../../src/modules/pms/record-tabs";
import { CLINIC_BASE_PATH, PMS_MODULES, PMS_MODULE_IDS, moduleForMigration, postgresTwinName } from "../../src/modules/pms/core/modules";
import { PMS_PERMISSIONS } from "../../src/modules/pms/core/permissions";

const ROOT = process.cwd();

describe("migration ranges (contract §3)", () => {
  it("module ranges are disjoint and in migration order", () => {
    const ranges = PMS_MODULE_IDS.map((id) => PMS_MODULES[id].sqlite);
    for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i][0] > ranges[i - 1][1], PMS_MODULE_IDS[i]);
    assert.equal(moduleForMigration(5), null);
    assert.equal(moduleForMigration(100), "foundation");
    assert.equal(moduleForMigration(115), "diary");
    assert.equal(moduleForMigration(179), "integration");
    assert.equal(postgresTwinName("0110_diary_core.sql"), "20261024000110_diary_core.sql");
  });

  it("every clinic-system migration is inside a module range and has its Postgres twin (and no twin is orphaned)", () => {
    const sqlite = fs.readdirSync(path.join(ROOT, "db/migrations/sqlite")).filter((f) => /^\d{4}_/.test(f));
    const postgres = new Set(fs.readdirSync(path.join(ROOT, "supabase/migrations")));
    const ours = sqlite.filter((f) => Number(f.slice(0, 4)) >= 100);
    assert.ok(ours.length >= 3);
    for (const file of ours) {
      const n = Number(file.slice(0, 4));
      assert.ok(moduleForMigration(n), `${file}: ${n} is in no module's range (src/modules/pms/core/modules.ts)`);
      const twin = postgresTwinName(file);
      assert.ok(twin && postgres.has(twin), `${file}: missing supabase/migrations/${twin}`);
    }
    for (const file of Array.from(postgres).filter((f) => f.startsWith("2026102400"))) {
      const n = file.slice(10, 14);
      assert.ok(sqlite.some((s) => s.startsWith(`${n}_`) && postgresTwinName(s) === file), `${file} has no SQLite twin`);
    }
  });
});

describe("navigation, record tabs and audit labels (contract §5–7)", () => {
  it("navigation entries: unique ids, under /app/clinic, order in the module's band, a known permission", () => {
    const ids = new Set<string>();
    for (const e of PMS_NAV) {
      assert.ok(!ids.has(e.id), `duplicate nav id ${e.id}`);
      ids.add(e.id);
      assert.ok(e.id.startsWith(`${e.module}.`), `${e.id} starts with its module`);
      assert.ok(e.href === CLINIC_BASE_PATH || e.href.startsWith(`${CLINIC_BASE_PATH}/`), e.href);
      const band = PMS_MODULE_IDS.indexOf(e.module) * 10;
      assert.ok(e.order >= band && e.order < band + 10, `${e.id}: order ${e.order} outside ${band}–${band + 9}`);
      assert.ok((PMS_PERMISSIONS as readonly string[]).includes(e.permission), e.permission);
    }
    assert.equal(new Set(PMS_NAV.map((e) => e.href)).size, PMS_NAV.length, "one entry per page");
  });

  it("record tabs: unique ids and segments", () => {
    assert.equal(new Set(PMS_RECORD_TABS.map((t) => t.id)).size, PMS_RECORD_TABS.length);
    assert.equal(new Set(PMS_RECORD_TABS.map((t) => t.segment)).size, PMS_RECORD_TABS.length);
    for (const t of PMS_RECORD_TABS) assert.ok(/^[a-z0-9-]*$/.test(t.segment) && t.id.startsWith(`${t.module}.`), t.id);
  });

  it("audit codes are pms.<entity>.<verb> (plus the package change) and every label is neutral", () => {
    for (const code of Object.keys(PMS_AUDIT_LABELS)) {
      assert.ok(/^pms\.[a-z0-9_]+\.[a-z0-9_]+$/.test(code) || code === "clinic.package_change" || code === "platform.entitlement_set", code);
    }
    for (const text of [...Object.values(PMS_AUDIT_LABELS), ...Object.values(PMS_AUDIT_TARGETS), ...PMS_NAV.map((e) => e.label), ...PMS_RECORD_TABS.map((t) => t.label)]) {
      assert.equal(BANNED_TERM_PATTERNS.find((re) => re.test(text)), undefined, text);
    }
  });
});

/** Files of the clinic system (code and copy). */
function clinicSystemFiles(): string[] {
  const roots = ["src/modules/pms", "src/server/pms", "src/server/repos/pms", "src/server/db/pms-schema", "src/app/app/clinic", "src/components/pms", "scripts/pms", "src/lib/brand.ts"];
  const out: string[] = [];
  const walk = (p: string) => {
    const full = path.join(ROOT, p);
    if (!fs.existsSync(full)) return;
    if (fs.statSync(full).isFile()) return void out.push(p);
    for (const e of fs.readdirSync(full)) walk(path.join(p, e));
  };
  roots.forEach(walk);
  return out.filter((f) => /\.(ts|tsx|md)$/.test(f));
}

/**
 * Product naming (contract §2): the clinic system has a placeholder name only (src/lib/brand.ts). Never a
 * competitor's product name, never "Practice" as a name (a Reports plan), never an earlier project name. Exceptions
 * need an entry here with a reason.
 */
const NAMING_ALLOW: { file: string; text: RegExp; reason: string }[] = [
  { file: "scripts/pms/contract.test.ts", text: /./, reason: "this test lists the banned names" },
  { file: "src/lib/brand.ts", text: /never "TM3", never a competitor's name, never "Practice"/, reason: "the rule itself" },
];
const BANNED_NAMES: { re: RegExp; what: string }[] = [
  { re: /\bTM3\b/, what: "TM3" },
  { re: /care ?connect/i, what: "CareConnect" },
  { re: /\bPractice\b(?! management)/, what: '"Practice" as a name' },
  { re: /killer/i, what: "killer" },
];

describe("product naming in the clinic system (contract §2)", () => {
  it("no competitor or earlier product names in its code, copy or comments", () => {
    const hits: string[] = [];
    for (const file of clinicSystemFiles()) {
      const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const b of BANNED_NAMES) {
          if (!b.re.test(line)) continue;
          if (NAMING_ALLOW.some((a) => a.file === file && a.text.test(line))) continue;
          hits.push(`${file}:${i + 1} ${b.what}`);
        }
      });
    }
    assert.deepEqual(hits, []);
  });
});

describe("the generated ESLint boundary is up to date", () => {
  it("regenerating .eslintrc.json changes nothing (run npm run medreport:eslint-boundary)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-eslint-"));
    fs.copyFileSync(path.join(ROOT, ".eslintrc.json"), path.join(tmp, ".eslintrc.json"));
    fs.mkdirSync(path.join(tmp, "src/modules"), { recursive: true });
    fs.symlinkSync(path.join(ROOT, "src/modules/medreport"), path.join(tmp, "src/modules/medreport"));
    execFileSync(process.execPath, [path.join(ROOT, "scripts/medreport/gen-eslint-boundary.mjs")], { cwd: tmp, stdio: "pipe" });
    assert.equal(fs.readFileSync(path.join(tmp, ".eslintrc.json"), "utf8"), fs.readFileSync(path.join(ROOT, ".eslintrc.json"), "utf8"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

/** Files under a folder (recursive), repository-relative. */
function filesUnder(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    const full = path.join(ROOT, p);
    if (!fs.existsSync(full)) return;
    if (fs.statSync(full).isFile()) {
      if (match.test(p)) out.push(p);
      return;
    }
    for (const e of fs.readdirSync(full)) walk(path.join(p, e));
  };
  walk(dir);
  return out;
}

describe("every clinic-system entry point checks the actor first (contract §6, source checks)", () => {
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

  it("pages and layouts under /app/clinic call requireClinicActor() before anything reads data", () => {
    const files = filesUnder("src/app/app/clinic", /\/(page|layout)\.tsx$/);
    assert.ok(files.length >= 2);
    for (const file of files) {
      const body = read(file).slice(read(file).indexOf("export default async function"));
      const guard = body.indexOf("await requireClinicActor(");
      assert.ok(guard > 0, `${file} calls requireClinicActor()`);
      for (const touch of ["getDb()", "repo()", "repoContext()"]) {
        const at = body.indexOf(touch);
        assert.ok(at === -1 || at > guard, `${file}: ${touch} before the guard`);
      }
    }
  });

  it("server actions start with clinicActionActor(); route handlers go through clinicRoute()", () => {
    for (const file of filesUnder("src/app/app/clinic", /\/actions\.ts$/)) {
      const fns = Array.from(read(file).matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n([^\n]*)\n([^\n]*)/g));
      for (const m of fns) {
        assert.match(m[2], /const actor = await clinicActionActor\(/, `${file} ${m[1]}`);
        assert.match(m[3], /if \("error" in actor\) return/, `${file} ${m[1]}`);
      }
    }
    for (const file of filesUnder("src/app/app/clinic", /\/route\.ts$/)) {
      const source = read(file);
      for (const m of Array.from(source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) = (\w+)\(/g))) {
        assert.equal(m[2], "clinicRoute", `${file} ${m[1]} uses clinicRoute()`);
      }
      assert.ok(!/export (async )?function (GET|POST|PUT|PATCH|DELETE)\b/.test(source), `${file}: export handlers built with clinicRoute()`);
    }
  });
});
