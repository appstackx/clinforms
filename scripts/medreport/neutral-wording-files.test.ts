/**
 * Neutral wording, file scan (sibling of neutral-wording.test.ts, which checks runtime objects).
 *
 * Reads every string literal, template-literal text and JSX text in the customer-facing host code –
 * the public website and legal pages, the sign-in pages, shared components (consent banner, marketing
 * chrome, analytics) and server-sent emails – and fails on:
 *   1. the banned technology/vendor terms of core/wording.ts (BANNED_TERM_PATTERNS) and model names;
 *   2. infrastructure vendor names in visible copy of the website, legal and sign-in pages and emails
 *      (the privacy policy lists sub-processor CATEGORIES; the DPA names the vendors).
 * Comments, import paths and type-only literals are not copy and are skipped.
 *
 * Allow-list: add an entry to ALLOW below ONLY for text that sits in a scanned file but legitimately needs a
 * term (for example, if the owner decides a page should name a sub-processor). Every entry needs a reason,
 * and the test fails when an entry no longer matches anything, so stale entries get removed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { BANNED_TERM_PATTERNS } from "@/modules/medreport/core/wording";

const ROOT = process.cwd();

/**
 * Folders whose strings are customer-facing (missing folders are skipped). src/app/app = the signed-in clinic area and its
 * Studio; src/lib/site = public-site copy kept outside the pages (the demo video's transcript and chapters).
 */
const BANNED_TERM_ROOTS = ["src/app/(marketing)", "src/app/(auth)", "src/app/app", "src/components", "src/lib/site", "src/server/email", "src/server/site"];

/**
 * Folders (or files) whose strings are visible copy, where infrastructure vendor names may not appear either.
 * For email only the templates are copy: the provider code legitimately names its provider.
 */
const VENDOR_ROOTS = ["src/app/(marketing)", "src/app/(auth)", "src/components/consent", "src/components/marketing", "src/lib/site", "src/server/email/templates.ts"];

const MODEL_PATTERNS: readonly RegExp[] = [/\b(opus|sonnet|haiku|fable)\b/i];
const VENDOR_PATTERNS: readonly RegExp[] = [
  /\bvercel\b/i,
  /\bcloudflare\b/i,
  /\bposthog\b/i,
  /\bmailersend\b/i,
  /\bsupabase\b/i,
  /\bopenai\b/i,
  /\bamazon web services\b|\baws\b/i,
  /\bgoogle analytics\b/i,
];

interface AllowEntry {
  /** Repo-relative file path (forward slashes). */
  file: string;
  /** The allowed text: matched against each extracted string. */
  text: RegExp;
  /** Why this text may contain the term (required). */
  reason: string;
}

/**
 * ALLOW-LIST – explicit, reviewed exceptions. Keep it empty unless the owner decides otherwise.
 * Example (not active):
 *   { file: "src/app/(marketing)/privacy/page.tsx", text: /^Anthropic PBC/, reason: "Owner decided to name the drafting sub-processor (DPA list)" },
 */
const ALLOW: AllowEntry[] = [];

export interface ExtractedString {
  text: string;
  line: number;
}

function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) return true;
  if (ts.isExternalModuleReference(parent)) return true;
  if (ts.isLiteralTypeNode(parent)) return true; // type-only string literal
  if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
    const callee = parent.expression;
    if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
    if (ts.isIdentifier(callee) && callee.text === "require") return true;
  }
  return false;
}

/** Every string literal, template text and JSX text in a TS/TSX source (comments are not tokens here). */
export function extractStrings(source: string, fileName = "file.tsx"): ExtractedString[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: ExtractedString[] = [];
  const push = (node: ts.Node, text: string) => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed) out.push({ text: trimmed, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  };
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !isModuleSpecifier(node)) push(node, node.text);
    else if (ts.isTemplateExpression(node)) {
      push(node.head, node.head.text);
      node.templateSpans.forEach((span) => push(span.literal, span.literal.text));
    } else if (ts.isJsxText(node)) push(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function filesUnder(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [rel];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path.relative(ROOT, full).split(path.sep).join("/"));
    }
  };
  walk(abs);
  return out.sort();
}

interface Finding {
  file: string;
  line: number;
  text: string;
  pattern: string;
}

const usedAllowEntries = new Set<AllowEntry>();

function scan(roots: readonly string[], patterns: readonly RegExp[]): { files: number; strings: number; findings: Finding[] } {
  const findings: Finding[] = [];
  let strings = 0;
  const files = Array.from(new Set(roots.flatMap(filesUnder)));
  for (const file of files) {
    for (const s of extractStrings(fs.readFileSync(path.join(ROOT, file), "utf8"), file)) {
      strings++;
      const hit = patterns.find((re) => re.test(s.text));
      if (!hit) continue;
      const allowed = ALLOW.find((a) => a.file === file && a.text.test(s.text));
      if (allowed) {
        usedAllowEntries.add(allowed);
        continue;
      }
      findings.push({ file, line: s.line, text: s.text.slice(0, 120), pattern: String(hit) });
    }
  }
  return { files: files.length, strings, findings };
}

test("the extractor reads literals, template text and JSX text, and skips imports, types and comments", () => {
  const src = `
    import x from "@anthropic-ai/sdk";
    // Claude in a comment is not copy
    type T = "AI";
    const a = "Plain text";
    const b = \`Hello \${name} from the AI team\`;
    export function C() { return <p title="Tooltip">Drafted by a bot <b>{"inner"}</b></p>; }
    const m = await import("posthog-js");
  `;
  const texts = extractStrings(src, "x.tsx").map((s) => s.text);
  assert.deepEqual(texts, ["Plain text", "Hello", "from the AI team", "Tooltip", "Drafted by a bot", "inner"]);
});

test("the banned-term patterns catch the terms and leave ordinary copy alone", () => {
  const banned = [...BANNED_TERM_PATTERNS, ...MODEL_PATTERNS];
  for (const bad of ["Powered by AI", "AI-assisted", "Claude drafts it", "an LLM", "our prompts", "a chat bot", "machine learning", "Sonnet 5.5"]) {
    assert.ok(banned.some((re) => re.test(bad)), bad);
  }
  for (const ok of ["Request access", "maintain", "said", "bottom", "Aisha", "prompt reply"]) {
    // "prompt reply" contains the banned word "prompt": it must be caught, so it is listed separately below.
    if (ok === "prompt reply") continue;
    assert.ok(!banned.some((re) => re.test(ok)), ok);
  }
  assert.ok(banned.some((re) => re.test("prompt reply")), "avoid 'prompt' in copy: it is a banned term");
});

test("customer-facing host files contain no banned technology, vendor or model terms", () => {
  const result = scan(BANNED_TERM_ROOTS, [...BANNED_TERM_PATTERNS, ...MODEL_PATTERNS]);
  assert.ok(result.files >= 20, `${result.files} files scanned`);
  assert.ok(result.strings >= 300, `${result.strings} strings scanned`);
  assert.deepEqual(result.findings, []);
});

test("website, legal, sign-in and email copy names no infrastructure vendor", () => {
  const result = scan(VENDOR_ROOTS, VENDOR_PATTERNS);
  assert.ok(result.files >= 10, `${result.files} files scanned`);
  assert.deepEqual(result.findings, []);
});

test("every allow-list entry has a reason and is still needed", () => {
  for (const entry of ALLOW) {
    assert.ok(entry.reason.trim().length >= 10, `allow-list entry for ${entry.file} needs a reason`);
    assert.ok(usedAllowEntries.has(entry), `stale allow-list entry: ${entry.file} ${entry.text}`);
  }
});
