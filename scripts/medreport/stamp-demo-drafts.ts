/**
 * Stamp every demo draft in src/modules/medreport/ai/demo-drafts/ with the fingerprint of the demo
 * record it belongs to (ai/bundle-fingerprint.ts), so recorded answers are only ever replayed for
 * exactly that simulated-TM3 record. Run after the demo fixtures' notes change (no AI call):
 *
 *   node --import ./scripts/medreport/test-setup.mjs --import tsx scripts/medreport/stamp-demo-drafts.ts
 *
 * Fictional organisation names in recorded answers can be renamed with --rename="Old=>New" (repeatable);
 * the file's note then says so.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bundleNotesFingerprint } from "@/modules/medreport/ai/bundle-fingerprint";
import { getDemoBundle } from "./dev-bundles";

const DIR = path.join(process.cwd(), "src/modules/medreport/ai/demo-drafts");
const renames = process.argv
  .filter((a) => a.startsWith("--rename="))
  .map((a) => a.slice("--rename=".length).split("=>"))
  .filter((p): p is [string, string] => p.length === 2 && Boolean(p[0]));

let changed = 0;
for (const name of readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
  const file = path.join(DIR, name);
  let text = readFileSync(file, "utf8");
  const before = text;
  for (const [from, to] of renames) text = text.split(from).join(to);
  const json = JSON.parse(text) as Record<string, unknown>;
  const bundle = getDemoBundle(String(json.patientId));
  const fingerprint = bundleNotesFingerprint(bundle);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(json)) {
    if (k === "bundleFingerprint") continue;
    out[k] = v;
    if (k === "patientId") out.bundleFingerprint = fingerprint;
  }
  if (text !== before && typeof out.note === "string" && !out.note.includes("renamed after recording")) {
    out.note = `${out.note} Fictional organisation names renamed after recording (${renames.map(([a, b]) => `“${a}” → “${b}”`).join(", ")}); nothing else changed.`;
  }
  const next = `${JSON.stringify(out, null, 2)}\n`;
  if (next !== readFileSync(file, "utf8")) {
    writeFileSync(file, next);
    changed += 1;
  }
  console.log(`${name}: ${fingerprint.slice(0, 12)}…`);
}
console.log(`${changed} file(s) updated.`);
