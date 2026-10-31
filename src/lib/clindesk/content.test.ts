/** content/clindesk-site.json: the schema (build fails on a bad file), the placeholder rules and the page wiring. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CLINDESK_CONTENT,
  CLINDESK_CONTENT_KEYS,
  ClindeskContentError,
  TO_CONFIRM,
  contentText,
  isDraftBuild,
  isPlaceholderValue,
  parseClindeskContent,
  unfilledKeys,
} from "./content";

const ROOT = path.resolve(__dirname, "../../..");
const RAW = JSON.parse(fs.readFileSync(path.join(ROOT, "content/clindesk-site.json"), "utf8"));
const clone = () => JSON.parse(JSON.stringify(RAW));

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

describe("content/clindesk-site.json", () => {
  it("is valid, has exactly the listed keys, each with a value and a description", () => {
    assert.deepEqual(Object.keys(CLINDESK_CONTENT.values).sort(), [...CLINDESK_CONTENT_KEYS].sort());
    assert.equal(CLINDESK_CONTENT_KEYS.length, 57);
    for (const k of CLINDESK_CONTENT_KEYS) {
      assert.ok(CLINDESK_CONTENT.values[k].value.length > 0, k);
      assert.ok(CLINDESK_CONTENT.values[k].description.length >= 10, k);
    }
  });
  it("every key is used by a page and every <Fill k=…> names a key (nothing unused, nothing missing)", () => {
    const used = new Set<string>();
    for (const f of [...filesUnder("src/app/clindesk-site"), ...filesUnder("src/components/clindesk")]) {
      for (const m of Array.from(fs.readFileSync(path.join(ROOT, f), "utf8").matchAll(/<Fill k="([^"]+)"/g))) used.add(m[1]);
    }
    assert.deepEqual(Array.from(used).sort(), [...CLINDESK_CONTENT_KEYS].sort());
  });
  it("the documentation lists every key", () => {
    const doc = fs.readFileSync(path.join(ROOT, "docs/clinic-system/CLINDESK-SITE-CONTENT.md"), "utf8");
    for (const k of CLINDESK_CONTENT_KEYS) assert.ok(doc.includes(`\`${k}\``), k);
  });
  it("fails on an unknown key, a missing key, an empty value or a value only partly in brackets", () => {
    const cases: Array<[string, (c: ReturnType<typeof clone>) => void, RegExp]> = [
      ["unknown", (c) => (c.values["pricing.typo"] = { value: "x", description: "a description" }), /unknown key\(s\) pricing\.typo/],
      ["missing", (c) => delete c.values["company.number"], /company\.number/],
      ["empty", (c) => (c.values["company.number"].value = "  "), /values › company\.number › value: value must not be empty/],
      ["partly", (c) => (c.values["pricing.vat"].value = "exclude [to check]"), /pricing\.vat › value: value is partly in \[brackets\]/],
      ["html", (c) => (c.values["pricing.vat"].value = "<b>exclude</b>"), /plain text/],
      ["extra field", (c) => (c.values["pricing.vat"].note = "x"), /unknown key\(s\) note/],
      ["not text", (c) => (c.values["pricing.vat"].value = 12), /value must be text/],
    ];
    for (const [name, mutate, message] of cases) {
      const c = clone();
      mutate(c);
      assert.throws(() => parseClindeskContent(c), (e: unknown) => e instanceof ClindeskContentError && message.test(e.message), name);
    }
  });
  it("a value in [brackets] is unfilled: shown as written in drafts, as the neutral marker in production", () => {
    assert.equal(isPlaceholderValue("[£X]"), true);
    assert.equal(isPlaceholderValue("£49"), false);
    const c = parseClindeskContent(clone());
    assert.deepEqual(contentText("pricing.essentialsPrice", { content: c, draft: true }), { key: "pricing.essentialsPrice", filled: false, text: "[£X]" });
    assert.deepEqual(contentText("pricing.essentialsPrice", { content: c, draft: false }), { key: "pricing.essentialsPrice", filled: false, text: TO_CONFIRM });
    const filled = clone();
    filled.values["pricing.essentialsPrice"].value = " £49 ";
    const f = parseClindeskContent(filled);
    assert.deepEqual(contentText("pricing.essentialsPrice", { content: f, draft: false }), { key: "pricing.essentialsPrice", filled: true, text: "£49" });
    assert.equal(unfilledKeys(f).includes("pricing.essentialsPrice"), false);
  });
  it("drafts: next dev, Vercel previews or CLINDESK_SITE_DRAFT=1; production builds are not", () => {
    assert.equal(isDraftBuild({ NODE_ENV: "development" }), true);
    assert.equal(isDraftBuild({ NODE_ENV: "production", VERCEL_ENV: "preview" }), true);
    assert.equal(isDraftBuild({ NODE_ENV: "production", CLINDESK_SITE_DRAFT: "1" }), true);
    assert.equal(isDraftBuild({ NODE_ENV: "production", VERCEL_ENV: "production" }), false);
    assert.equal(isDraftBuild({ NODE_ENV: "production" }), false);
  });
});
