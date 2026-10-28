/**
 * Third-party wording check (W0.2, env-gated): committed safety-corpus cases and fixtures never share 4 or more
 * consecutive words with a referrer's own forms. The referrers' maps are gitignored, so this runs only where they are:
 *
 *   CLINFORMS_THIRD_PARTY_MAPS=<dir with *.json maps or *.txt dumps> npm run test:medreport
 *
 * Without the variable no test is registered (the default chain allows no extra skips). It prints only the shared
 * 4-word runs and where in the corpus they are –
 * never anything else from the maps. ngram-ignore.json lists ClinForms' own generator wording (which the stored maps
 * also hold) and generic clinical English, each with a reason.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sharedNgrams, stringLeaves } from "./harness/ngram";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const MAPS = process.env.CLINFORMS_THIRD_PARTY_MAPS;

/**
 * merge:r1 (orchestrator decision 27/10/2026): a locked case whose text was found to share a run with a referrer map
 * cannot be deleted (the corpus is append-only), so it is retired for exactly that reason (retired.json, kind "case",
 * reason starting "shares a 4-word run with a referrer map") and superseded by a case in ClinForms' own words. Only those
 * rows are left out here – they are listed, never silently dropped; every other committed text is still checked.
 */
const WORDING_RETIRED = new Set(
  Object.entries((JSON.parse(fs.readFileSync(path.join(DIR, "retired.json"), "utf8")) as { entries?: Record<string, { kind?: string; reason?: string }> }).entries ?? {})
    .filter(([, e]) => e.kind === "case" && (e.reason ?? "").startsWith("shares a 4-word run with a referrer map"))
    .map(([id]) => id),
);

function corpusTexts(): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = [];
  for (const f of fs.readdirSync(path.join(DIR, "cases")).filter((x) => x.endsWith(".jsonl"))) {
    for (const line of fs.readFileSync(path.join(DIR, "cases", f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const c = JSON.parse(line) as { id: string };
      if (WORDING_RETIRED.has(c.id)) {
        console.log(`third-party wording check: ${c.id} not checked – retired for sharing a run with a referrer map (retired.json)`);
        continue;
      }
      for (const t of stringLeaves(c)) out.push({ where: `cases/${f} ${c.id}`, text: t });
    }
  }
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".json")) for (const t of stringLeaves(JSON.parse(fs.readFileSync(p, "utf8")))) out.push({ where: path.relative(DIR, p), text: t });
    }
  };
  walk(path.join(DIR, "fixtures"));
  return out;
}

function thirdPartyTexts(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".json")) out.push(...stringLeaves(JSON.parse(fs.readFileSync(p, "utf8"))));
      else if (e.name.endsWith(".txt")) out.push(fs.readFileSync(p, "utf8"));
    }
  };
  walk(dir);
  return out;
}

// Registered only when the maps are given: the default chain has no referrer files (and allows no extra skips).
if (!MAPS) console.log("third-party wording check: not run (set CLINFORMS_THIRD_PARTY_MAPS to a folder of referrer maps)");
if (MAPS) describe("third-party wording (env-gated)", () => {
  it("no committed corpus or fixture text shares 4+ consecutive words with a referrer's forms", () => {
    const ignore = JSON.parse(fs.readFileSync(path.join(DIR, "ngram-ignore.json"), "utf8")) as { clinformsWording: Array<{ text: string }>; generic: Array<{ text: string }> };
    const found = sharedNgrams(corpusTexts(), thirdPartyTexts(MAPS as string), {
      ownWording: ignore.clinformsWording.map((x) => x.text),
      ignore: ignore.generic.map((x) => x.text),
    });
    assert.deepEqual(found.map((o) => `${o.where}: “${o.gram}”`), []);
  });
});
