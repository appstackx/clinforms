/**
 * Safety corpus loader: parses cases/*.jsonl (passed in as text) and checks the corpus's own rules.
 *
 * Rules (each a test in safety-corpus.test.ts):
 * - every line parses and matches CaseSchema; ids are unique across files;
 * - every PASS case on an approval path (validate, sign, render, store, reducer) names a negativeTwin that exists and
 *   expects BLOCK;
 * - every case's paths fit its expectation (REFUSED_* need sign/store/render, IDENTICAL needs render);
 * - pending entries name existing cases (or generated mutations of them) and an owner.
 *
 * Pure.
 */
import { CaseSchema, type CasePath, type CorpusCase } from "./types";

/**
 * Paths on which PASS means "may be approved / issued". A PASS case on one of them names a BLOCK twin. On the other
 * paths (fill, lint, assemble, split, scope, probe) PASS means "the check holds" – itself a restriction – and a twin is
 * optional.
 */
const APPROVAL_PATHS: ReadonlySet<CasePath> = new Set<CasePath>(["validate", "sign", "render", "store", "reducer"]);

export interface LoadedCase {
  file: string;
  line: number;
  raw: Record<string, unknown>;
  case: CorpusCase;
}

export interface LoadResult {
  cases: LoadedCase[];
  errors: string[];
}

export function parseCorpusFiles(files: ReadonlyArray<{ name: string; text: string }>): LoadResult {
  const cases: LoadedCase[] = [];
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const f of files) {
    f.text.split("\n").forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith("//")) return;
      let raw: unknown;
      try {
        raw = JSON.parse(t);
      } catch (e) {
        errors.push(`${f.name}:${i + 1}: not JSON (${e instanceof Error ? e.message : String(e)})`);
        return;
      }
      const parsed = CaseSchema.safeParse(raw);
      if (!parsed.success) {
        const id = (raw as { id?: unknown })?.id;
        errors.push(`${f.name}:${i + 1} ${String(id ?? "")}: ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
        return;
      }
      const c = parsed.data;
      const where = `${f.name}:${i + 1}`;
      if (seen.has(c.id)) errors.push(`${where}: duplicate id ${c.id} (first at ${seen.get(c.id)})`);
      seen.set(c.id, where);
      cases.push({ file: f.name, line: i + 1, raw: raw as Record<string, unknown>, case: c });
    });
  }
  const byId = new Map(cases.map((c) => [c.case.id, c.case]));
  for (const { case: c, file, line } of cases) {
    const where = `${file}:${line} ${c.id}`;
    if (c.expect === "PASS" && (c.negativeTwin || c.paths.some((p) => APPROVAL_PATHS.has(p)))) {
      if (!c.negativeTwin) errors.push(`${where}: a PASS case must name a BLOCK negativeTwin`);
      else if (!byId.has(c.negativeTwin)) errors.push(`${where}: negativeTwin ${c.negativeTwin} does not exist`);
      else if (!["BLOCK", "REFUSED_403", "REFUSED_409"].includes(byId.get(c.negativeTwin)?.expect ?? "")) errors.push(`${where}: negativeTwin ${c.negativeTwin} must expect BLOCK (or a refusal)`);
    }
    if ((c.expect === "REFUSED_403" || c.expect === "REFUSED_409") && !c.paths.some((p) => p === "sign" || p === "store" || p === "render")) {
      errors.push(`${where}: ${c.expect} needs a sign, store or render path`);
    }
    if (c.expect === "IDENTICAL" && !c.paths.includes("render")) errors.push(`${where}: IDENTICAL needs the render path`);
    if (c.ack && c.expect !== "BLOCK") errors.push(`${where}: ack is only for BLOCK cases`);
    if (c.mutate?.denyList && c.expect !== "PASS") errors.push(`${where}: anti-deny-list mutations are for PASS cases`);
    if ((c.tags.includes("narrated") || c.tags.includes("anchored")) && c.expect === "PASS" && !c.mutate?.denyList) {
      errors.push(`${where}: a narrated or anchored PASS case needs an anti-deny-list insertion point (mutate.denyList)`);
    }
  }
  return { cases, errors };
}
