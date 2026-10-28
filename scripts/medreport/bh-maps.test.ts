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
 * the template's offset (CLM and Physio-Link: + 1, stored in table reading order). Fix round 1 (R1T-WE-02): every
 * printed paragraph or cell of a template that reads as a clinical statement made for every patient (advice, treatments,
 * goals, targets, a percentage) is covered by a box – its placeholder or options – so the approver sees it on a card and
 * it prints only as decided; anything else of that kind must be on BLUE_HEART_EXPECT's `fixedText` list (template →
 * block id → reason code, ids only), and an entry that no longer matches fails too.
 * T3b: what the runtime reads from each field – its condition (conditionText), recordSourceOf, compactPlace, the
 * printed lead (printedLeadsOf on the template's text, with BLUE_HEART_TEMPLATES_DIR), the session question
 * (sessionQuestionOf), the guidance as it reads (currentGuidance), the source, required – compared between the maps the
 * clinic holds and the v2 maps: every difference must be on the allowlist (template → field id → reader; "added" for a
 * new question), and every allowlist entry must be a difference (an unused entry fails: the allowlist says exactly
 * what changes). The plan's yesNoInWords and sessionNotInRecord readers are not on this tree (WD's and WA1's
 * workstreams); the integrator adds them to readers() when those land.
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
import { loadClinicForms, parseMapsJson, printedLeadsOf, type LoadFormsFileResult } from "@/server/admin/load-forms";
import { buildDocxOutline } from "@/modules/medreport/forms/docx-outline";
import { decodeFormFile } from "@/modules/medreport/forms/file";
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

/** The template's printed text per Word block (the release converter's file), for the printed-lead reader. */
function templateBlocks(template: string): ((id: string) => string | null) | undefined {
  if (!TEMPLATES) return undefined;
  const dir = folderOf(TEMPLATES, template);
  if (!dir) return undefined;
  const file = decodeFormFile(fs.readFileSync(path.join(dir, template)).toString("base64"), { convertRtf: true });
  if (!/wordprocessingml/.test(file.mimeType)) return undefined;
  const blocks = new Map(buildDocxOutline(file.bytes).blocks.map((b) => [b.id, b.text] as const));
  return (id: string) => blocks.get(id) ?? blocks.get(id.replace(/\.p\d+$/, "")) ?? null;
}

/**
 * Fix round 1 (R1T-WE-02): printed text of a template that reads as a clinical statement made for every patient – advice
 * given, treatments, goals, targets, expected outcomes, a percentage – and not a question, an instruction or a heading.
 * Such text must be a box the approver sees on a card (the box's placeholder or options cover it), or be on the reviewed
 * list (BLUE_HEART_EXPECT `fixedText`: template → block id → reason code; ids only, never the wording).
 */
const CLINICAL_WORDS =
  /\b(?:advis\w*|advice|exercis\w*|therap\w*|treatment|treated|mobilis\w*|manipulat\w*|laser|ultrasound|electro\w*|goals?|recover\w*|pain|range[- ]of[- ]mo\w*|rom|pre-morbid|self-manag\w*|baseline|prognos\w*|discharg\w*|improv\w*|expected|reduc\w*|co-?operated)\b|\d\s*%/i;
const NOT_A_STATEMENT =
  /\?|:\s*$|^\s*(?:please|if|delete|indicate|give|state|list|detail|add|describe|does|do|did|is|are|has|have|was|were|how|what|when|where|which|who|why)\b|^\s*\(?[a-z0-9]{1,2}[.)]\s/i;
const MIN_STATEMENT_WORDS = 8;
const COVERED_SHARE = 0.8;

/** The template's leaf blocks (no block inside them) whose text reads as a fixed clinical statement (ids and text). */
function fixedStatements(blocks: ReadonlyArray<{ id: string; text?: string }>): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = [];
  for (const b of blocks) {
    if (blocks.some((c) => c.id.startsWith(`${b.id}.`))) continue;
    const text = (b.text ?? "").replace(/\s+/g, " ").trim();
    if (text.split(" ").filter(Boolean).length < MIN_STATEMENT_WORDS || !CLINICAL_WORDS.test(text) || NOT_A_STATEMENT.test(text)) continue;
    const heading = /^[^a-z]*[A-Z]{2,}[^a-z]*\s+[A-Z/&]{2,}\b/.test(text) && !/[.!]$/.test(text);
    const instruction = /\bplease\b/i.test(text) || /^\(.*\)$/.test(text);
    if (!heading && !instruction) out.push({ id: b.id, text });
  }
  return out;
}

/** How much of a block's printed text the map's boxes replace or remove (placeholders, printed options), 0–1. */
function coveredShare(fields: readonly FormField[], blockId: string, text: string): number {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const near = (id: string) => id === blockId || blockId.startsWith(`${id}.`) || id.startsWith(`${blockId}.`);
  const texts: string[] = [];
  for (const f of fields) {
    if (f.anchor.kind !== "docx") continue;
    const a = f.anchor;
    if (near(a.blockId)) texts.push(a.placeholderText ?? "", ...(a.target === "delete_options" ? (f.options ?? []) : []));
    for (const o of a.optionTexts ?? []) if (near(o.blockId)) texts.push(o.text);
  }
  const chars = texts.map(norm).filter((t) => t && text.includes(t)).reduce((n, t) => n + t.length, 0);
  return text.length ? chars / text.length : 1;
}

/** What the runtime reads from one field (T3b), as comparable strings – never printed. */
function readers(fields: FormField[], f: FormField, analysis: { guidanceVersion?: number }, leads: Record<string, string>): Record<string, string> {
  return {
    condition: conditionText(fields, f.id) ?? "",
    recordSource: recordSourceOf(f) ?? "",
    compactPlace: compactPlace(f) ?? "",
    printedLead: leads[f.id] ?? "",
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

    test("T3 (R1T-WE-02): every fixed clinical statement a template prints is a box on the card, or reviewed (ids only)", { skip: !TEMPLATES || !EXPECT ? "BLUE_HEART_TEMPLATES_DIR and BLUE_HEART_EXPECT are needed" : false }, () => {
      const reviewed = (expect as { fixedText?: Record<string, Record<string, string>> }).fixedText;
      assert.ok(reviewed, "BLUE_HEART_EXPECT has no fixedText list (template → block id → reason code)");
      const open: string[] = [];
      const seen = new Set<string>();
      for (const maps of Object.values(v2)) {
        for (const [template, map] of Object.entries(maps)) {
          const dir = folderOf(TEMPLATES as string, template);
          assert.ok(dir, `${template}: not under the templates folder`);
          const file = decodeFormFile(fs.readFileSync(path.join(dir, template)).toString("base64"), { convertRtf: true });
          if (!/wordprocessingml/.test(file.mimeType)) continue;
          const fields = fieldsOf(map);
          for (const s of fixedStatements(buildDocxOutline(file.bytes).blocks)) {
            if (coveredShare(fields, s.id, s.text) >= COVERED_SHARE) continue;
            const key = `${template} ${s.id}`;
            if (reviewed[template]?.[s.id]) seen.add(key);
            else open.push(key);
          }
        }
      }
      const stale = Object.entries(reviewed).flatMap(([t, ids]) => Object.keys(ids).map((id) => `${t} ${id}`)).filter((k) => !seen.has(k));
      console.log(`# T3 fixed text: ${seen.size} reviewed; ${open.length} printed for every patient with no box; ${stale.length} reviewed entries unused`);
      assert.deepEqual(open, [], "a fixed clinical statement prints on every form but no card shows it: map it as a box (or review it)");
      assert.deepEqual(stale, [], "every reviewed entry is still printed text with no box");
    });

    test("T3 (R1T-WE-03): a question about other treatment the patient is having, and its details box, exclude the physiotherapy being reported", () => {
      // The yes/no (whether the patient has other treatment) and the "If yes …" box that gives its details: drafted from the
      // notes, they must never count the physiotherapy this report is about as "other treatment" (a drafted Yes repeated
      // the physio plan as other treatment, R1-PC-04).
      const asksOther = (f: FormField) =>
        /\b(?:undergoing|receiving|having|attending|getting)\b[^?]{0,40}\bother\b[^?]{0,20}\b(?:treatments?|therap(?:y|ies)|care)\b/i.test(f.label) ||
        (/^\s*if (?:yes|so)\b/i.test(f.label) && /\bother treatment\b/i.test(f.guidance));
      const checked: string[] = [];
      const missing: string[] = [];
      for (const maps of Object.values(v2)) {
        for (const [template, map] of Object.entries(maps)) {
          for (const f of fieldsOf(map)) {
            if (!asksOther(f)) continue;
            checked.push(`${template} ${f.id}`);
            if (!/\bthe physiotherapy this report is about\b/i.test(f.guidance)) missing.push(`${template} ${f.id}`);
          }
        }
      }
      console.log(`# T3 other treatment: ${checked.length} questions checked`);
      assert.ok(checked.length > 0, "no other-treatment question found");
      assert.deepEqual(missing, [], "the guidance says the physiotherapy this report is about is not other treatment");
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
          const blockText = templateBlocks(template);
          const leadsA = printedLeadsOf(a, blockText);
          const leadsB = printedLeadsOf(b, blockText);
          for (const f of b) {
            const old = a.find((x) => x.id === f.id);
            if (!old) {
              // A question the edits add on purpose is on the allowlist as "added".
              if ((allow[template]?.[f.id] ?? []).includes("added")) seen.add(`${template} ${f.id} added`);
              else unexpected.push(`${template} ${f.id}: new question`);
              continue;
            }
            const ra = readers(a, old, {}, leadsA);
            const rb = readers(b, f, { guidanceVersion: vB }, leadsB);
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
      for (const k of stale) console.log(`# T3b unused: ${k}`);
      assert.deepEqual(unexpected, [], "every runtime change is intended");
      // check-WE minor 7: the allowlist says exactly what changes – an entry no field changes would let a later,
      // unintended change of that reader pass.
      assert.deepEqual(stale, [], "every allowlist entry is a change");
    });
  });
}
