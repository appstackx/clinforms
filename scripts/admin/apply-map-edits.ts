/**
 * Map edits for a clinic's prepared form maps (bh2 WE design 6): apply an EDIT LIST to a folder of maps files and write
 * the edited copies to another folder – the maps a later `admin:load-forms --replace-proposed` loads. Generic and
 * committed; the edit list (field ids plus ClinForms' own wording) and the maps stay gitignored next to each other
 * (demo-assets/…/load/). Local only: nothing is stored anywhere, no database, no service.
 *
 *   node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/admin/apply-map-edits.ts \
 *     --maps <dir of *.maps.json> --edits <edits.json> --out <dir> [--templates <dir>] [--expect <file.json>]
 *
 * The edit list: {"maps": {"<maps file>": {"<template file name>": TemplateEdits}}} where TemplateEdits is
 *   {
 *     "guidanceVersion": 2,          // the map is written in this release's wording (analysis.guidanceVersion)
 *     "dropWarnings": true,          // remove the map's own notes (load-forms adds its one "prepared" line)
 *     "pin": "source",               // pin the map to the template file as supplied (file.sourceSha256; needs --templates)
 *     "fields": {"F-12": {"set": {"guidance": "…", "note": null, …}, "replace": [{"key": "guidance", "find": "…", "with": "…"}]}},
 *     "sessions": [{"ids": ["F-17", …], "path": "episode.attendedDate", "of": 14, "offset": 1}],
 *     "add": [{"after": "F-11", "field": {…a whole question with a new id…}}]
 *   }
 * - `set` merges keys into the field (null removes a key); `replace` changes text that must be in the key exactly once;
 * - `sessions` maps numbered session questions to a record path, the index taken from the number in each question's
 *   printed label (+ offset) – never from the field's position (CLM and Physio-Link list them in table reading order);
 * - `add` puts a new question after an existing one (its id must be new; it is listed in form order, not by id);
 * - every edited field must parse (core/schemas.ts FormFieldSchema); an unknown file or field id, a find that does
 *   not match once, or a session question without a number in its label stops the run with nothing written.
 * With --templates (the folder of the clinic's template files, searched by file name in its sub-folders) each map is
 * pinned to its file as supplied and, with --expect, an ids-only expectations file is written per template: questions,
 * merge codes (the release converter's), the source and conversion SHA-256.
 *
 * Prints file names, field ids and counts only – never the forms' or the edits' wording.
 * Owner: WE (data, maps and mapping page) – docs/bh2-ownership.json.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { FormFieldSchema, MAX_SESSION_PART } from "../../src/modules/medreport/core/schemas";
import type { FormField } from "../../src/modules/medreport/core/types";
import { decodeFormFile } from "../../src/modules/medreport/forms/file";
import { findFormMergeFields } from "../../src/modules/medreport/forms/merge-scan";
import { sessionNumberOf } from "../../src/modules/medreport/core/session-dates";
import { CliError, parseArgs, runCli, str } from "./cli";

type Json = Record<string, unknown>;

export interface FieldEdit {
  set?: Json;
  replace?: Array<{ key: string; find: string; with: string }>;
}

export interface SessionEdit {
  ids: string[];
  path: "episode.attendedDate" | "episode.attendedTime";
  of: number;
  /** Added to the number in the printed label (1 = the sessions after the first assessment). */
  offset?: number;
}

export interface TemplateEdits {
  guidanceVersion?: number;
  dropWarnings?: boolean;
  pin?: "source";
  fields?: Record<string, FieldEdit>;
  sessions?: SessionEdit[];
  add?: Array<{ after?: string; field: Json }>;
}

export interface EditList {
  _about?: string;
  maps: Record<string, Record<string, TemplateEdits>>;
}

/** One maps file: {"<template file name>": map}. */
export type MapsFile = Record<string, Json & { fields: Json[]; file?: Json }>;

export interface EditReport {
  file: string;
  template: string;
  /** field id → the keys it changed. */
  changed: Record<string, string[]>;
  sessions: number;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Apply the edits of one template's map (pure): the edited map and what changed (ids and keys only). */
export function applyTemplateEdits(map: MapsFile[string], edits: TemplateEdits, where: string): { map: MapsFile[string]; changed: Record<string, string[]>; sessions: number } {
  const fields = map.fields.map((f) => JSON.parse(JSON.stringify(f)) as Json);
  const byId = new Map(fields.map((f) => [String(f.id), f] as const));
  const changed: Record<string, string[]> = {};
  const touch = (id: string, key: string) => {
    changed[id] = Array.from(new Set([...(changed[id] ?? []), key]));
  };
  for (const [id, edit] of Object.entries(edits.fields ?? {})) {
    const f = byId.get(id);
    if (!f) throw new CliError(`${where}: no field ${id} in the map.`);
    for (const r of edit.replace ?? []) {
      const text = typeof f[r.key] === "string" ? (f[r.key] as string) : "";
      const at = text.indexOf(r.find);
      if (!r.find || at < 0 || text.indexOf(r.find, at + 1) >= 0) throw new CliError(`${where} ${id}: the text to replace in "${r.key}" is not there exactly once.`);
      f[r.key] = `${text.slice(0, at)}${r.with}${text.slice(at + r.find.length)}`;
      touch(id, r.key);
    }
    for (const [key, value] of Object.entries(edit.set ?? {})) {
      if (key === "id") throw new CliError(`${where} ${id}: a field's id is never changed.`);
      if (value === null) {
        if (key in f) {
          delete f[key];
          touch(id, key);
        }
      } else if (!sameJson(f[key], value)) {
        f[key] = JSON.parse(JSON.stringify(value)) as unknown;
        touch(id, key);
      }
    }
  }
  let sessions = 0;
  for (const s of edits.sessions ?? []) {
    if (!Number.isInteger(s.of) || s.of < 1 || s.of > MAX_SESSION_PART) throw new CliError(`${where}: sessions "of" must be 1–${MAX_SESSION_PART}.`);
    for (const id of s.ids) {
      const f = byId.get(id);
      if (!f) throw new CliError(`${where}: no field ${id} in the map.`);
      const n = sessionNumberOf(String(f.label ?? ""));
      if (n === null) throw new CliError(`${where} ${id}: its printed label names no session number.`);
      const index = n + (s.offset ?? 0);
      if (index < 1 || index > s.of) throw new CliError(`${where} ${id}: session ${index} is outside 1–${s.of}.`);
      const next = { kind: "registration", path: s.path, part: { index, of: s.of } };
      if (!sameJson(f.fillSource, next)) {
        f.fillSource = next;
        touch(id, "fillSource");
      }
      sessions += 1;
    }
  }
  for (const a of edits.add ?? []) {
    const id = String(a.field.id ?? "");
    if (!id || byId.has(id)) throw new CliError(`${where}: an added question needs a new id (${id || "none"}).`);
    const at = a.after ? fields.findIndex((f) => f.id === a.after) : fields.length - 1;
    if (a.after && at < 0) throw new CliError(`${where}: no field ${a.after} to add ${id} after.`);
    const copy = JSON.parse(JSON.stringify(a.field)) as Json;
    fields.splice(at + 1, 0, copy);
    byId.set(id, copy);
    changed[id] = ["added"];
  }
  for (const f of fields) {
    const parsed = FormFieldSchema.safeParse(f);
    if (!parsed.success) throw new CliError(`${where} ${String(f.id)}: not a valid question after the edits (${parsed.error.issues[0]?.path.join(".") ?? ""}).`);
  }
  const out: MapsFile[string] = { ...map, fields };
  if (edits.guidanceVersion !== undefined) out.guidanceVersion = edits.guidanceVersion;
  if (edits.dropWarnings) delete out.warnings;
  return { map: out, changed, sessions };
}

/** Apply a whole edit list to maps files (pure): every edit must name a file and template that exist. */
export function applyEditList(files: Record<string, MapsFile>, list: EditList): { files: Record<string, MapsFile>; reports: EditReport[] } {
  const out: Record<string, MapsFile> = JSON.parse(JSON.stringify(files)) as Record<string, MapsFile>;
  const reports: EditReport[] = [];
  for (const [file, templates] of Object.entries(list.maps ?? {})) {
    const maps = out[file];
    if (!maps) throw new CliError(`The edit list names a maps file that is not in the folder: ${file}.`);
    for (const [template, edits] of Object.entries(templates)) {
      const map = maps[template];
      if (!map) throw new CliError(`${file}: no map for ${template}.`);
      const r = applyTemplateEdits(map, edits, `${file} / ${template}`);
      maps[template] = r.map;
      reports.push({ file, template, changed: r.changed, sessions: r.sessions });
    }
  }
  return { files: out, reports };
}

/** A template file by name anywhere under `dir` (the clinic's folders per referrer). */
function findTemplate(dir: string, name: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findTemplate(full, name);
      if (hit) return hit;
    } else if (entry.isFile() && entry.name === name) return full;
  }
  return null;
}

export interface Expectation {
  template: string;
  questions: number;
  mergeCodes: number;
  sourceSha256: string;
  sha256: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mapsDir = str(args, "maps", true) as string;
  const editsPath = str(args, "edits", true) as string;
  const outDir = str(args, "out", true) as string;
  const templates = str(args, "templates");
  const expectPath = str(args, "expect");
  if (path.resolve(outDir) === path.resolve(mapsDir)) throw new CliError("--out must be another folder than --maps (the earlier maps are kept).");
  const files: Record<string, MapsFile> = {};
  for (const name of fs.readdirSync(mapsDir).filter((n) => n.endsWith(".maps.json")).sort()) files[name] = JSON.parse(fs.readFileSync(path.join(mapsDir, name), "utf8")) as MapsFile;
  const list = JSON.parse(fs.readFileSync(editsPath, "utf8")) as EditList;
  const { files: edited, reports } = applyEditList(files, list);
  const expectations: Expectation[] = [];
  for (const [file, maps] of Object.entries(edited)) {
    for (const [template, map] of Object.entries(maps)) {
      const pin = list.maps?.[file]?.[template]?.pin;
      if (!templates) {
        if (pin) throw new CliError(`${template}: pinning to the source file needs --templates.`);
        continue;
      }
      const found = findTemplate(templates, template);
      if (!found) throw new CliError(`${template}: not found under --templates.`);
      const bytes = fs.readFileSync(found);
      const decoded = decodeFormFile(bytes.toString("base64"), { convertRtf: true });
      const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
      if (pin === "source") map.file = { ...(map.file ?? {}), fileName: template, sourceSha256, sha256: decoded.sha256 };
      expectations.push({ template, questions: map.fields.length, mergeCodes: (await findFormMergeFields(decoded)).length, sourceSha256, sha256: decoded.sha256 });
    }
  }
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  for (const [name, maps] of Object.entries(edited)) fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(maps, null, 1)}\n`, { mode: 0o600 });
  if (expectPath) fs.writeFileSync(expectPath, `${JSON.stringify({ expectations }, null, 1)}\n`, { mode: 0o600 });
  for (const r of reports) {
    const ids = Object.keys(r.changed);
    console.log(`${r.file} / ${r.template}: ${ids.length} questions changed${r.sessions ? `, ${r.sessions} session questions mapped` : ""}${ids.length ? ` (${ids.map((id) => `${id}:${r.changed[id].join("+")}`).join(" ")})` : ""}`);
  }
  for (const e of expectations) console.log(`  ${e.template}: ${e.questions} questions, ${e.mergeCodes} merge codes, source ${e.sourceSha256.slice(0, 12)}…, conversion ${e.sha256.slice(0, 12)}…`);
  console.log(`Wrote ${Object.keys(edited).length} maps files to ${outDir}${expectPath ? ` and the expectations to ${expectPath}` : ""}.`);
}

if (process.argv[1] && /apply-map-edits\.ts$/.test(process.argv[1])) void runCli(main);
