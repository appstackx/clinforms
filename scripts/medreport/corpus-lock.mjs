#!/usr/bin/env node
/**
 * Safety corpus lock (W0.2): add lock entries for NEW cases only.
 *
 *   node scripts/medreport/corpus-lock.mjs --add     add an entry for every case that has none (prints the ids)
 *   node scripts/medreport/corpus-lock.mjs --check   exit 1 when a case has no entry, an entry is stale, or an entry
 *                                                    has no case
 *
 * It never changes or removes an existing entry: a changed case shows as stale and stays failing until the change is
 * undone (cases are append-only – add a new case instead). corpus-guard.mjs compares the lock with the base branch.
 * Run from the repository root.
 */
import fs from "node:fs";
import path from "node:path";
import { CASES_DIR, LOCK_ALGORITHM, LOCK_FILE, caseLockHash, parseCases } from "./corpus-lib.mjs";

const mode = process.argv.includes("--add") ? "add" : process.argv.includes("--check") ? "check" : null;
if (!mode) {
  console.error("usage: node scripts/medreport/corpus-lock.mjs --add | --check");
  process.exit(2);
}
const files = fs
  .readdirSync(CASES_DIR)
  .filter((f) => f.endsWith(".jsonl"))
  .sort()
  .map((f) => ({ name: f, text: fs.readFileSync(path.join(CASES_DIR, f), "utf8") }));
const cases = parseCases(files);
const lock = fs.existsSync(LOCK_FILE) ? JSON.parse(fs.readFileSync(LOCK_FILE, "utf8")) : { algorithm: LOCK_ALGORITHM, entries: {} };
const problems = [];
const added = [];
for (const [id, raw] of cases) {
  const hash = caseLockHash(raw);
  if (!lock.entries[id]) {
    if (mode === "add") {
      lock.entries[id] = hash;
      added.push(id);
    } else problems.push(`${id}: no lock entry`);
  } else if (lock.entries[id] !== hash) problems.push(`${id}: changed since it was locked (cases are append-only – undo the change, add a new case instead)`);
}
for (const id of Object.keys(lock.entries)) if (!cases.has(id)) problems.push(`${id}: locked but removed (cases are never removed)`);
if (mode === "add" && added.length) {
  const sorted = Object.fromEntries(Object.keys(lock.entries).sort().map((k) => [k, lock.entries[k]]));
  fs.writeFileSync(LOCK_FILE, `${JSON.stringify({ algorithm: LOCK_ALGORITHM, entries: sorted }, null, 1)}\n`);
  console.log(`locked ${added.length} new case(s): ${added.join(", ")}`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
if (mode === "check") console.log(`lock ok: ${cases.size} cases`);
