#!/usr/bin/env node
/**
 * Safety corpus guard (W0.2): compare the corpus in the working tree with a base ref and refuse anything that weakens
 * it.
 *
 *   node scripts/medreport/corpus-guard.mjs <base-ref>      e.g. bh2-base, origin/release/bh-trial-2
 *
 * Fails (exit 1) when, compared with <base-ref>:
 * - a case was removed, or its id, input or expectation changed (its lock hash differs);
 * - a lock entry was removed or changed;
 * - the lock does not match the cases (a case without an entry, a stale entry, an entry without a case);
 * - an item that existed at the base and was not pending there is pending now (a passing case moved back to pending) –
 *   a case, a generated mutation or one-click variant of a base case (`<id>~…`), a differential item of one
 *   (`DIFF:<id>`), or a ledger item of a base hook;
 * - a ledger hook was removed or `minBlock` lowered;
 * - a differential allowlist entry has no Khuram approval recorded (`approvedBy`, `approvedOn`, `decision`);
 * - a retired row (retired.json) was un-retired or its entry changed, or a retirement lacks its decision record
 *   (retiredOn, decidedBy, decision, reason), its superseding case(s) or its pin (the retired case's lock hash, or the
 *   parent case's for a generated row – so a retired id is never reused), names a superseding case that does not
 *   exist or is retired, or is pending (corpus-lib.mjs checkRetiredFile).
 * Retirement is the only supported way a locked row stops counting: the case line and its lock entry stay, and the
 * runner requires every superseding case to hold. Workstream and fix agents may only ADD cases (with lock entries:
 * corpus-lock.mjs --add). Only the integrator edits pending.json, the allowlist and retired.json. Run from the
 * repository root; needs git.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CASES_DIR, CORPUS_DIR, LOCK_FILE, PENDING_FILE, RETIRED_FILE, canonical, caseLockHash, checkRetiredFile, parseCases } from "./corpus-lib.mjs";

const LEDGER_FILE = `${CORPUS_DIR}/ledger.json`;
const ALLOWLIST_FILE = `${CORPUS_DIR}/allowlist.json`;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function baseFile(ref, file) {
  try {
    return git(["show", `${ref}:${file}`]);
  } catch {
    return null;
  }
}

function baseCaseFiles(ref) {
  let names = [];
  try {
    names = git(["ls-tree", "--name-only", `${ref}:${CASES_DIR}`]).split("\n").filter((n) => n.endsWith(".jsonl"));
  } catch {
    return [];
  }
  return names.map((n) => ({ name: n, text: baseFile(ref, `${CASES_DIR}/${n}`) ?? "" }));
}

function headCaseFiles() {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => ({ name: f, text: fs.readFileSync(path.join(CASES_DIR, f), "utf8") }));
}

function json(text, fallback) {
  return text ? JSON.parse(text) : fallback;
}

export function guard(ref) {
  const problems = [];
  try {
    git(["rev-parse", "--verify", `${ref}^{commit}`]);
  } catch {
    return [`base ref ${ref} is not a commit here`];
  }
  const baseCases = parseCases(baseCaseFiles(ref));
  const headCases = parseCases(headCaseFiles());
  const baseLock = json(baseFile(ref, LOCK_FILE), { entries: {} });
  const headLock = json(fs.existsSync(LOCK_FILE) ? fs.readFileSync(LOCK_FILE, "utf8") : null, { entries: {} });
  const basePending = json(baseFile(ref, PENDING_FILE), { cases: {} }).cases ?? {};
  const headPending = json(fs.existsSync(PENDING_FILE) ? fs.readFileSync(PENDING_FILE, "utf8") : null, { cases: {} }).cases ?? {};
  const baseLedger = json(baseFile(ref, LEDGER_FILE), { minBlock: 0, hooks: [] });
  const headLedger = json(fs.existsSync(LEDGER_FILE) ? fs.readFileSync(LEDGER_FILE, "utf8") : null, { minBlock: 0, hooks: [] });
  const baseRetired = json(baseFile(ref, RETIRED_FILE), { entries: {} });
  const headRetired = json(fs.existsSync(RETIRED_FILE) ? fs.readFileSync(RETIRED_FILE, "utf8") : null, { entries: {} });

  // Cases: never removed, never changed.
  for (const [id, raw] of baseCases) {
    const now = headCases.get(id);
    if (!now) problems.push(`case ${id} was removed`);
    else if (caseLockHash(now) !== caseLockHash(raw)) problems.push(`case ${id} changed (input or expectation) – cases are append-only`);
  }
  // Lock: never loses or changes an entry, and matches the cases.
  for (const [id, hash] of Object.entries(baseLock.entries ?? {})) {
    if (!headLock.entries?.[id]) problems.push(`lock entry ${id} was removed`);
    else if (headLock.entries[id] !== hash) problems.push(`lock entry ${id} changed`);
  }
  for (const [id, raw] of headCases) {
    const want = headLock.entries?.[id];
    if (!want) problems.push(`case ${id} has no lock entry (node scripts/medreport/corpus-lock.mjs --add)`);
    else if (want !== caseLockHash(raw)) problems.push(`case ${id} does not match its lock entry`);
  }
  for (const id of Object.keys(headLock.entries ?? {})) if (!headCases.has(id)) problems.push(`lock entry ${id} has no case`);
  // Pending: nothing that existed at the base and held there may move (back) to pending.
  const baseHooks = new Set((baseLedger.hooks ?? []).map((h) => h.id));
  for (const id of Object.keys(headPending)) {
    if (basePending[id]) continue;
    const bare = id.replace(/^DIFF:/, "");
    const parent = bare.includes("~") ? bare.slice(0, bare.indexOf("~")) : bare;
    const ledger = /^LEDGER-(.+)-(?:count|seam)$/.exec(id);
    if (baseCases.has(parent)) problems.push(`${id} passed at ${ref} and is pending now – a passing case may not move back to pending`);
    else if (ledger && baseHooks.has(ledger[1])) problems.push(`${id} held at ${ref} and is pending now`);
  }
  for (const [id, e] of Object.entries(headPending)) if (!e || !e.owner || !e.reason) problems.push(`pending ${id} needs an owner and a reason`);
  // Ledger: only grows.
  const headHooks = new Set((headLedger.hooks ?? []).map((h) => h.id));
  for (const id of baseHooks) if (!headHooks.has(id)) problems.push(`ledger hook ${id} was removed`);
  if ((headLedger.minBlock ?? 0) < (baseLedger.minBlock ?? 0)) problems.push(`ledger minBlock lowered from ${baseLedger.minBlock} to ${headLedger.minBlock}`);
  // Retired rows: append-only, each with its decision record, its pin and existing, live superseding cases.
  for (const [id, e] of Object.entries(baseRetired.entries ?? {})) {
    const now = headRetired.entries?.[id];
    if (!now) problems.push(`retired ${id} was un-retired (its retired.json entry was removed) – retired.json is append-only`);
    else if (canonical(now) !== canonical(e)) problems.push(`retired ${id}: its retired.json entry changed – retired.json is append-only`);
  }
  problems.push(...checkRetiredFile(headRetired, headCases, headPending));
  // Differential allowlist: Khuram's approval on every entry.
  const allow = json(fs.existsSync(ALLOWLIST_FILE) ? fs.readFileSync(ALLOWLIST_FILE, "utf8") : null, { entries: {} });
  for (const [id, e] of Object.entries(allow.entries ?? {})) {
    if (!e || e.approvedBy !== "Khuram" || !e.approvedOn || !e.decision) problems.push(`allowlist ${id} has no recorded approval by Khuram (approvedBy, approvedOn, decision)`);
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const ref = process.argv[2];
  if (!ref) {
    console.error("usage: node scripts/medreport/corpus-guard.mjs <base-ref>");
    process.exit(2);
  }
  const problems = guard(ref);
  if (problems.length) {
    console.error(`corpus guard against ${ref}: ${problems.length} problem(s)\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log(`corpus guard against ${ref}: ok`);
}
