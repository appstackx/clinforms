#!/usr/bin/env node
/**
 * bh2 ownership guard (W0.4): refuses a workstream branch that touches files outside its map in
 * docs/bh2-ownership.json.
 *
 *   node scripts/medreport/ownership-guard.mjs                     the current branch, against bh2-base (or the merge
 *                                                                  base with origin/release/bh-trial-2), committed work
 *   node scripts/medreport/ownership-guard.mjs --head ws/bh2-issue another branch (the integrator, before a merge)
 *   node scripts/medreport/ownership-guard.mjs --workstream WB     say which map applies (default: from the branch name)
 *   node scripts/medreport/ownership-guard.mjs --base <ref>        diff against <ref> instead
 *   node scripts/medreport/ownership-guard.mjs --worktree          also count uncommitted changes in this checkout
 *   node scripts/medreport/ownership-guard.mjs --check-map         check the map itself (every path resolves, no overlaps)
 *   node scripts/medreport/ownership-guard.mjs --json              machine-readable result
 *
 * Exit 0 = allowed (or an exempt W0 / WI branch), 1 = refused (every refused path is listed with its owner),
 * 2 = usage or git error. Pure Node (no dependencies); the rules are in the map's `rules` and in classifyChange()
 * below, and scripts/medreport/ownership-guard.test.ts pins them. Owner: W0 (integrator after bh2-base).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAP_PATH = "docs/bh2-ownership.json";

/* ------------------------------------------------------------------------------------------------
 * Globs
 * ----------------------------------------------------------------------------------------------*/

/** A glob as a RegExp: `**` any depth (also none), `*` within one path segment, everything else literal. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      // "dir/**" matches the directory's files at any depth; "**/x" matches x in any directory.
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesGlob(file, glob) {
  return globToRegExp(glob).test(file);
}

/* ------------------------------------------------------------------------------------------------
 * The map
 * ----------------------------------------------------------------------------------------------*/

export function loadMap(root = process.cwd()) {
  return JSON.parse(fs.readFileSync(path.join(root, MAP_PATH), "utf8"));
}

/** The workstream whose map applies to a branch (exact branch, a branch glob, or a fix branch's owner), or null. */
export function workstreamForBranch(map, branch) {
  for (const [key, ws] of Object.entries(map.workstreams)) {
    if ((ws.branches ?? []).some((b) => (b.includes("*") ? matchesGlob(branch, b) : b === branch))) return key;
  }
  const fix = map.fixBranches?.pattern ? new RegExp(map.fixBranches.pattern).exec(branch) : null;
  if (fix) return resolveWorkstream(map, fix[1]);
  return null;
}

/** A workstream key from a key or an alias ("WB", "wb", "opinion"), or null. */
export function resolveWorkstream(map, name) {
  if (!name) return null;
  for (const [key, ws] of Object.entries(map.workstreams)) {
    if (key.toLowerCase() === name.toLowerCase() || (ws.aliases ?? []).includes(name.toLowerCase())) return key;
  }
  return null;
}

/** Owner of a path in `paths` (the most specific match: an exact path before a glob, a longer glob first). */
export function ownerOf(map, file) {
  if (Object.prototype.hasOwnProperty.call(map.paths, file)) return map.paths[file];
  const globs = Object.keys(map.paths)
    .filter((p) => p.includes("*") && matchesGlob(file, p))
    .sort((a, b) => b.length - a.length);
  return globs.length ? map.paths[globs[0]] : null;
}

const TEST_FILE = /\.test\.(?:ts|tsx|mjs|cjs|js)$/;
const CORPUS_APPEND_ONLY = ["src/modules/medreport/core/validation/__corpus__/cases/**", "src/modules/medreport/core/validation/__corpus__/fixtures/**"];
/**
 * The corpus lock: a workstream that adds a case adds its entry (corpus-lock.mjs --add re-sorts the file, so a line-level
 * "added lines only" test would refuse an entry that sorts last). corpus-guard.mjs compares every entry with the base and
 * refuses a changed or removed one – the integrator runs it at every merge (bh2-base integration).
 */
const CORPUS_LOCK = "src/modules/medreport/core/validation/__corpus__/safety-corpus.lock.json";

/**
 * One changed path for one workstream → {allowed, reason, owner?}.
 * change: {status: "A" | "M" | "D" | "R" | "C" | "T", path, deleted?: number (lines deleted), from?: string (rename source)}.
 */
export function classifyChange(map, workstream, change, opts = {}) {
  const file = change.path;
  const branch = opts.branch ?? "";
  const forbidden = (map.forbidden ?? []).find((f) => matchesGlob(file, f.glob));
  if (forbidden) return { allowed: false, reason: `never committed: ${forbidden.why}` };
  const ws = map.workstreams[workstream];
  if (ws?.exempt) return { allowed: true, reason: `${workstream} branches are exempt` };
  const grant = (map.grants ?? []).find((g) => g.workstream === workstream && (g.branch === undefined || g.branch === branch) && (g.path === file || (g.path.includes("*") && matchesGlob(file, g.path))));
  if (grant) return { allowed: true, reason: `granted by the integrator: ${grant.reason}` };
  if ((map.integratorOnly ?? []).includes(file)) return { allowed: false, owner: "integrator", reason: "integrator only" };
  const owner = ownerOf(map, file);
  if (owner === workstream) return { allowed: true, owner, reason: "owned" };
  if (file === CORPUS_LOCK) {
    if (change.status === "M") return { allowed: true, owner, reason: "corpus lock: new entries only – corpus-guard.mjs refuses a changed or removed entry at the merge" };
    return { allowed: false, owner: "integrator", reason: "corpus lock: only new entries (corpus-lock.mjs --add); never removed or replaced" };
  }
  if (CORPUS_APPEND_ONLY.some((g) => matchesGlob(file, g))) {
    if (change.status === "A" || (change.status === "M" && change.deleted === 0)) return { allowed: true, owner, reason: "corpus: cases and fixtures are append-only" };
    return { allowed: false, owner: "integrator", reason: "corpus: only the integrator changes or removes existing cases and fixtures" };
  }
  const crossCutting = (map.crossCutting ?? []).find((c) => c.paths.includes(file));
  if (crossCutting && (crossCutting.wiredBy ?? []).includes(workstream)) {
    return { allowed: true, owner: owner ?? crossCutting.owner, reason: `cross-cutting "${crossCutting.id}": keep its rule – ${crossCutting.rule}` };
  }
  if (TEST_FILE.test(file)) {
    if (change.status === "A") return { allowed: true, owner, reason: "a new test file" };
    if (change.status === "M" && change.deleted === 0) return { allowed: true, owner, reason: "shared test file: lines added only" };
    return { allowed: false, owner: owner ?? "integrator", reason: "an existing test this workstream does not own: only added lines (changed or removed expectations need an integrator grant)" };
  }
  if (owner) return { allowed: false, owner, reason: `owned by ${owner}` };
  if (crossCutting) return { allowed: false, owner: crossCutting.owner, reason: `cross-cutting "${crossCutting.id}" (wired by ${(crossCutting.wiredBy ?? []).join(", ")})` };
  return { allowed: false, owner: "integrator", reason: "not in any workstream's map (integrator)" };
}

/** Every changed path of a branch → the refused ones and the allowed ones. A rename is checked at both ends. */
export function checkChanges(map, workstream, changes, opts = {}) {
  const results = [];
  for (const change of changes) {
    const ends = change.status === "R" && change.from ? [{ ...change, path: change.from, status: "D" }, { ...change, status: "A" }] : [change];
    for (const end of ends) results.push({ ...end, ...classifyChange(map, workstream, end, opts) });
  }
  return { workstream, refused: results.filter((r) => !r.allowed), allowed: results.filter((r) => r.allowed) };
}

/* ------------------------------------------------------------------------------------------------
 * Map self-check
 * ----------------------------------------------------------------------------------------------*/

/** Problems with the map against a list of tracked files (empty = OK). */
export function checkMap(map, files) {
  const problems = [];
  const keys = Object.keys(map.workstreams);
  const isNew = (p) => (map.new ?? []).includes(p);
  for (const [p, owner] of Object.entries(map.paths)) {
    if (!keys.includes(owner)) problems.push(`${p}: unknown workstream "${owner}"`);
    const hits = p.includes("*") ? files.filter((f) => matchesGlob(f, p)) : files.filter((f) => f === p);
    if (hits.length === 0 && !isNew(p)) problems.push(`${p}: matches no tracked file and is not listed in "new"`);
    if (hits.length > 0 && isNew(p) && !p.includes("*")) problems.push(`${p}: listed in "new" but the file exists – take it off "new"`);
  }
  for (const p of map.new ?? []) if (!Object.prototype.hasOwnProperty.call(map.paths, p)) problems.push(`new: ${p} is not in "paths"`);
  // One owner per file: an exact path never also matches another workstream's glob.
  for (const f of files) {
    const owners = new Set(Object.entries(map.paths).filter(([p]) => (p.includes("*") ? matchesGlob(f, p) : p === f)).map(([, o]) => o));
    if (owners.size > 1) problems.push(`${f}: owned by ${Array.from(owners).join(" and ")}`);
  }
  for (const c of map.crossCutting ?? []) for (const p of c.paths) if (!files.includes(p) && !isNew(p)) problems.push(`crossCutting ${c.id}: ${p} is not a tracked file`);
  for (const g of map.grants ?? []) {
    if (!keys.includes(g.workstream)) problems.push(`grant ${g.path}: unknown workstream "${g.workstream}"`);
    if (!g.reason) problems.push(`grant ${g.path}: a grant needs a reason`);
  }
  const seen = new Map();
  for (const [key, ws] of Object.entries(map.workstreams)) {
    for (const b of ws.branches ?? []) {
      if (seen.has(b)) problems.push(`branch ${b}: listed for ${seen.get(b)} and ${key}`);
      seen.set(b, key);
    }
  }
  return problems;
}

/* ------------------------------------------------------------------------------------------------
 * Git
 * ----------------------------------------------------------------------------------------------*/

function git(args, root) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
}

function refExists(ref, root) {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], root);
    return true;
  } catch {
    return false;
  }
}

/** The base to diff against: --base, else tag bh2-base (when it is an ancestor of head), else the merge base with the fallback. */
export function resolveBase(map, head, root, explicit) {
  if (explicit) return git(["merge-base", explicit, head], root);
  const tag = map.base?.tag;
  if (tag && refExists(tag, root)) {
    try {
      git(["merge-base", "--is-ancestor", tag, head], root);
      return git(["rev-parse", `${tag}^{commit}`], root);
    } catch {
      // bh2-base is not under this branch: fall through.
    }
  }
  const fallback = map.base?.fallback ?? "origin/release/bh-trial-2";
  return git(["merge-base", fallback, head], root);
}

/** Changed paths between base and head (renames detected), with deleted line counts; optionally the worktree too. */
export function gitChanges(base, head, root, { worktree = false } = {}) {
  const range = worktree ? [base] : [base, head];
  const status = git(["diff", "--name-status", "-M", "--no-color", ...range], root);
  const numstat = git(["diff", "--numstat", "-M", "--no-color", ...range], root);
  const deleted = new Map();
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [, del, ...rest] = line.split("\t");
    const p = rest.join("\t");
    const target = p.includes(" => ") ? p.replace(/\{([^{}]*) => ([^{}]*)\}/, "$2").replace(/^.* => /, "").replace(/\/\/+/g, "/") : p;
    deleted.set(target, del === "-" ? Number.POSITIVE_INFINITY : Number(del));
  }
  const changes = [];
  for (const line of status.split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    const code = parts[0][0];
    if (code === "R" || code === "C") changes.push({ status: code, from: parts[1], path: parts[2], deleted: deleted.get(parts[2]) ?? 0 });
    else changes.push({ status: code, path: parts[1], deleted: deleted.get(parts[1]) ?? 0 });
  }
  if (worktree) {
    const untracked = git(["ls-files", "--others", "--exclude-standard"], root).split("\n").filter(Boolean);
    for (const p of untracked) if (!changes.some((c) => c.path === p)) changes.push({ status: "A", path: p, deleted: 0 });
  }
  return changes;
}

/* ------------------------------------------------------------------------------------------------
 * CLI
 * ----------------------------------------------------------------------------------------------*/

function parseArgs(argv) {
  const out = { head: "HEAD", base: null, workstream: null, worktree: false, json: false, checkMap: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--head") out.head = argv[++i];
    else if (a === "--base") out.base = argv[++i];
    else if (a === "--workstream") out.workstream = argv[++i];
    else if (a === "--worktree") out.worktree = true;
    else if (a === "--json") out.json = true;
    else if (a === "--check-map") out.checkMap = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(String(err.message ?? err));
    return 2;
  }
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
    return 0;
  }
  const map = loadMap(root);
  if (args.checkMap) {
    const files = git(["ls-files", "--cached", "--others", "--exclude-standard"], root).split("\n").filter(Boolean);
    const problems = checkMap(map, files);
    if (args.json) console.log(JSON.stringify({ ok: problems.length === 0, problems }, null, 2));
    else console.log(problems.length ? `Ownership map: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join("\n")}` : "Ownership map OK.");
    return problems.length ? 1 : 0;
  }
  let branch;
  try {
    branch = args.head === "HEAD" ? git(["rev-parse", "--abbrev-ref", "HEAD"], root) : args.head;
  } catch (err) {
    console.error(`git: ${err.message}`);
    return 2;
  }
  const workstream = args.workstream ? resolveWorkstream(map, args.workstream) : workstreamForBranch(map, branch);
  if (!workstream) {
    console.error(`No workstream for branch "${branch}". Pass --workstream <${Object.keys(map.workstreams).join("|")}> or use a mapped branch name (${MAP_PATH}).`);
    return 2;
  }
  let changes;
  let base;
  try {
    base = resolveBase(map, args.head, root, args.base);
    changes = gitChanges(base, args.head, root, { worktree: args.worktree });
  } catch (err) {
    console.error(`git: ${err.message}`);
    return 2;
  }
  const result = checkChanges(map, workstream, changes, { branch });
  if (args.json) {
    console.log(JSON.stringify({ branch, workstream, base, ...result }, null, 2));
  } else {
    console.log(`Ownership guard: ${branch} as ${workstream} (${map.workstreams[workstream].title}), ${changes.length} changed path(s) since ${base.slice(0, 7)}.`);
    if (map.workstreams[workstream].exempt) console.log(`  ${workstream} branches are exempt from the map (foundation and integration).`);
    else for (const r of result.allowed.filter((x) => x.reason !== "owned")) console.log(`  ok      ${r.path} – ${r.reason}`);
    for (const r of result.refused) console.log(`  REFUSED ${r.path} – ${r.reason}${r.owner && !r.reason.includes(r.owner) ? ` (owner ${r.owner})` : ""}`);
    console.log(result.refused.length ? `Refused: ${result.refused.length} path(s) outside ${workstream}'s map. Move the change to its owner or ask the integrator for a grant.` : "Allowed.");
  }
  return result.refused.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
