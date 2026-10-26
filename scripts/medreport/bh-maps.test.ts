/**
 * T3 / T3b (bh2 WE design 7) – ENV-GATED, never in CI: a clinic's prepared maps (Dell's v2 maps, gitignored) checked
 * against their template files with this release's tools. Prints file names, field ids, rule ids and counts only –
 * never the forms' wording. Registers no test when BLUE_HEART_MAPS_DIR is unset (the default chain).
 *
 *   BLUE_HEART_MAPS_DIR=<v2 maps dir>  BLUE_HEART_TEMPLATES_DIR=<templates root>
 *   [BLUE_HEART_MAPS_V1_DIR=<maps the clinic holds now>  BLUE_HEART_T3B_ALLOWLIST=<allowlist.json>]
 *   [BLUE_HEART_EXPECT=<expectations.json>]
 *   node --import ./scripts/medreport/test-setup.mjs --import tsx --test scripts/medreport/bh-maps.test.ts
 *
 * T3, per template: the release's own load path accepts it (admin:load-forms preview on a fictional clinic: every
 * anchor in the release converter's file, checkFormDefinition, the source pin, the map lint with 0 errors – accepted
 * findings listed); no merge code in a conditional box; the per-file question and merge-code counts and the expected
 * source per field id (BLUE_HEART_EXPECT); every attended-session field's index = the number in its printed label +
 * the template's offset (CLM and Physio-Link: + 1, stored in table reading order).
 * T3b: what the runtime reads from each field – its condition, recordSourceOf, compactPlace, the printed lead, the
 * session question, the guidance as it reads, the source, required – compared between the maps the clinic holds and
 * the v2 maps: every difference must be on the allowlist (template → field id → reader), and no allowlist entry stale.
 *
 * Owner: WE (data, maps and mapping page).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kysely } from "kysely";
import { conditionText } from "@/modules/medreport/core/conditions";
import { lintFormMap, lintErrors, lintSummary } from "@/modules/medreport/core/form-map-lint";
import { checkFormDefinition, recordSourceOf } from "@/modules/medreport/core/forms";
import { compactPlace } from "@/modules/medreport/core/forms/answer-shape";
import { currentGuidance } from "@/modules/medreport/core/forms/guidance";
import { hasMergeToken } from "@/modules/medreport/core/merge-fields";
import { sessionNumberOf, sessionQuestionOf } from "@/modules/medreport/core/session-dates";
import { FormFieldSchema } from "@/modules/medreport/core/schemas";
import type { FormField } from "@/modules/medreport/core/types";
import { loadClinicForms, parseMapsJson, type LoadFormsFileResult } from "@/server/admin/load-forms";
import { testCipher } from "@/server/db/testing/databases";
import { NodeSqliteDialect, openSqliteDatabase } from "@/server/db/dialects/sqlite-local";
import { applySqliteMigrations } from "@/server/db/migrations";
import type { Database } from "@/server/db/schema";

const MAPS = process.env.BLUE_HEART_MAPS_DIR;
const TEMPLATES = process.env.BLUE_HEART_TEMPLATES_DIR;
const V1 = process.env.BLUE_HEART_MAPS_V1_DIR;
const ALLOWLIST = process.env.BLUE_HEART_T3B_ALLOWLIST;
const EXPECT = process.env.BLUE_HEART_EXPECT;

type MapsFile = Record<string, { fields: unknown[]; file?: Record<string, string> }>;

function readMaps(dir: string): Record<string, MapsFile> {
  const out: Record<string, MapsFile> = {};
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".maps.json")).sort()) out[name] = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as MapsFile;
  return out;
}

/** The template's folder under the templates root (the clinic keeps one folder per referrer). */
function folderOf(root: string, template: string): string | null {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (fs.existsSync(path.join(root, entry.name, template))) return path.join(root, entry.name);
  }
  return fs.existsSync(path.join(root, template)) ? root : null;
}

const fieldsOf = (m: { fields: unknown[] }) => m.fields.map((f) => FormFieldSchema.parse(f));

/** What the runtime reads from one field (T3b), as comparable strings – never printed. */
function readers(fields: FormField[], f: FormField, analysis: { guidanceVersion?: number }): Record<string, string> {
  return {
    condition: conditionText(fields, f.id) ?? "",
    recordSource: recordSourceOf(f) ?? "",
    compactPlace: compactPlace(f) ?? "",
    session: JSON.stringify(sessionQuestionOf(f)),
    guidance: currentGuidance(f.guidance, f, { guidanceVersion: analysis.guidanceVersion }),
    source: JSON.stringify(f.fillSource),
    required: String(f.required),
  };
}

if (MAPS) {
  describe("T3 / T3b: the clinic's prepared maps (env-gated, ids only)", () => {
    const v2 = readMaps(MAPS);
    const expect = EXPECT ? (JSON.parse(fs.readFileSync(EXPECT, "utf8")) as { expectations?: Array<{ template: string; questions: number; mergeCodes: number }>; sources?: Record<string, Record<string, string>>; sessionOffsets?: Record<string, number> }) : {};

    test("T3: the release's load path accepts every map (anchors, checks, pin, lint 0 errors); counts and sources as expected", async () => {
      assert.ok(TEMPLATES, "BLUE_HEART_TEMPLATES_DIR is needed for T3");
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-bh-maps-"));
      const raw = openSqliteDatabase(path.join(tmp, "check.db"));
      applySqliteMigrations(raw);
      const db = new Kysely<Database>({ dialect: new NodeSqliteDialect({ database: raw }) });
      try {
        await db.insertInto("organization").values({ id: "org-bh-maps-check", name: "Maps check (fictional)", slug: "bh-maps-check", logo: null, createdAt: new Date().toISOString(), metadata: null }).execute();
        const ctx = { db, cipher: testCipher() };
        const results: Array<LoadFormsFileResult & { mapsFile: string }> = [];
        for (const [file, maps] of Object.entries(v2)) {
          for (const template of Object.keys(maps)) {
            const dir = folderOf(TEMPLATES, template);
            assert.ok(dir, `${template}: not under the templates folder`);
            // One template at a time: a folder of its own holding only this file.
            const own = fs.mkdtempSync(path.join(tmp, "t-"));
            fs.copyFileSync(path.join(dir, template), path.join(own, template));
            const r = await loadClinicForms(ctx, { tenantId: "bh-maps-check", dir: own, maps: parseMapsJson(JSON.stringify({ [template]: maps[template] })) });
            for (const f of r.files) results.push({ ...f, mapsFile: file });
          }
        }
        for (const r of results) {
          const accepted = r.lint?.accepted.length ? ` accepted ${r.lint.accepted.join(" ")}` : "";
          console.log(`# T3 ${r.status.toUpperCase().padEnd(7)} ${r.file}: ${r.questions ?? "?"} questions, ${r.mergeFields ?? "?"} merge codes${accepted}${r.status === "refused" ? ` – ${(r.reason ?? "").replace(/“[^”]*”/g, "“…”").slice(0, 300)}` : ""}`);
        }
        assert.deepEqual(results.filter((r) => r.status !== "ready").map((r) => r.file), [], "every map is accepted by the release's load path");
        assert.deepEqual(results.flatMap((r) => (r.lint?.errors ?? []).map((e) => `${r.file} ${e}`)), [], "lint: 0 errors");
        for (const e of expect.expectations ?? []) {
          const r = results.find((x) => x.file === e.template);
          assert.ok(r, `${e.template}: no result`);
          assert.equal(r.questions, e.questions, `${e.template}: questions`);
          assert.equal(r.mergeFields, e.mergeCodes, `${e.template}: merge codes`);
        }
      } finally {
        await db.destroy();
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    test("T3: no merge code in a conditional box; checkFormDefinition-clean fields; the expected source per id; session indexes from the printed labels", () => {
      const problems: string[] = [];
      for (const maps of Object.values(v2)) {
        for (const [template, map] of Object.entries(maps)) {
          const fields = fieldsOf(map);
          for (const f of fields) {
            if (f.anchor.kind === "docx" && (f.anchor.target === "replace_placeholder" || f.anchor.target === "delete_options") && !f.anchor.clearPlaceholder && hasMergeToken(f.anchor.placeholderText ?? "") && conditionText(fields, f.id)) {
              problems.push(`${template} ${f.id}: a merge code in a conditional box`);
            }
            const want = expect.sources?.[template]?.[f.id];
            if (want) {
              const got = f.fillSource.kind === "registration" ? `registration:${f.fillSource.path}` : f.fillSource.kind;
              if (got !== want) problems.push(`${template} ${f.id}: source ${got}, expected ${want}`);
            }
            if (f.fillSource.kind === "registration" && (f.fillSource.path === "episode.attendedDate" || f.fillSource.path === "episode.attendedTime") && f.fillSource.part) {
              const n = sessionNumberOf(f.label);
              const offset = expect.sessionOffsets?.[template] ?? 0;
              if (n === null || f.fillSource.part.index !== n + offset) problems.push(`${template} ${f.id}: session index ${f.fillSource.part.index}, label number ${n} + ${offset}`);
            }
          }
          for (const p of checkFormDefinition({ fields, kind: "docx" } as never)) if (/F-\d/.test(p)) problems.push(`${template}: checkFormDefinition (${p.match(/F-\d+/)?.[0]})`);
        }
      }
      assert.deepEqual(problems, []);
    });

    test("T3: the lint over the stored shape lists only accepted findings (ids only)", () => {
      for (const maps of Object.values(v2)) {
        for (const [template, map] of Object.entries(maps)) {
          const fields = fieldsOf(map);
          const issues = lintFormMap({ fields, analysis: { mode: "demo_prewritten", promptVersion: "check", at: new Date().toISOString(), warnings: [] }, file: { fileName: template, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sha256: "0".repeat(64), sizeBytes: 1, ...(map.file?.sourceSha256 ? { sourceSha256: map.file.sourceSha256 } : {}) } });
          const accepted = issues.filter((i) => i.severity === "accepted");
          if (accepted.length) console.log(`# T3 accepted ${template}: ${lintSummary(accepted)}`);
          // Without the template's text, L8 cannot see a printed lead the load path records (analysis.printedLeads).
          assert.deepEqual(lintSummary(lintErrors(issues).filter((i) => i.rule !== "L8")), "", template);
        }
      }
    });

    test("T3b: what the runtime reads from each field changes only where the allowlist says", { skip: !V1 ? "BLUE_HEART_MAPS_V1_DIR not set" : false }, () => {
      const v1 = readMaps(V1 as string);
      const allow = ALLOWLIST ? (JSON.parse(fs.readFileSync(ALLOWLIST, "utf8")) as { changes?: Record<string, Record<string, string[]>> }).changes ?? {} : {};
      const unexpected: string[] = [];
      const seen = new Set<string>();
      for (const [file, maps] of Object.entries(v2)) {
        for (const [template, map] of Object.entries(maps)) {
          const before = v1[file]?.[template];
          if (!before) {
            unexpected.push(`${template}: not in the earlier maps`);
            continue;
          }
          const a = fieldsOf(before);
          const b = fieldsOf(map);
          const vB = (map as { guidanceVersion?: number }).guidanceVersion;
          for (const f of b) {
            const old = a.find((x) => x.id === f.id);
            if (!old) {
              unexpected.push(`${template} ${f.id}: new question`);
              continue;
            }
            const ra = readers(a, old, {});
            const rb = readers(b, f, { guidanceVersion: vB });
            for (const k of Object.keys(ra)) {
              if (ra[k] === rb[k]) continue;
              const key = `${template} ${f.id} ${k}`;
              seen.add(key);
              if (!(allow[template]?.[f.id] ?? []).includes(k)) unexpected.push(key);
            }
          }
          for (const old of a) if (!b.some((x) => x.id === old.id)) unexpected.push(`${template} ${old.id}: removed`);
        }
      }
      const stale = Object.entries(allow).flatMap(([t, ids]) => Object.entries(ids).flatMap(([id, ks]) => ks.map((k) => `${t} ${id} ${k}`))).filter((k) => !seen.has(k));
      console.log(`# T3b ${seen.size} intended changes; ${unexpected.length} not on the allowlist; ${stale.length} allowlist entries unused`);
      assert.deepEqual(unexpected, [], "every runtime change is intended");
      assert.deepEqual(stale, [], "no allowlist entry is stale");
    });
  });
}
