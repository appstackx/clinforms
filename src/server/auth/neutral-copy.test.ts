/**
 * Neutral wording for everything new and customer-facing in the identity layer: the copy object, the email
 * templates (rendered) and every string literal / JSX text in the sign-in pages, the clinic area and their
 * components – checked with the module's own banned terms (src/modules/medreport/core/wording.ts).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { BANNED_TERM_PATTERNS } from "../../modules/medreport/core/wording";
import { ACCOUNT_ERRORS, ROLE_DESCRIPTIONS, ROLE_LABELS } from "../../lib/account-copy";
import { invitationEmail, passwordResetEmail, twoFactorEnabledEmail } from "../email/templates";

function banned(text: string): RegExp | undefined {
  return BANNED_TERM_PATTERNS.find((re) => re.test(text));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** String literals and JSX text of a source file, comments removed. */
function visibleStrings(source: string): string[] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const strings: string[] = [];
  for (const m of Array.from(noComments.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g))) {
    strings.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  for (const m of Array.from(noComments.matchAll(/>([^<>{}]+)</g))) strings.push(m[1]);
  return strings.filter((s) => s.trim().length > 0);
}

describe("neutral wording – identity layer", () => {
  it("the copy object", () => {
    for (const text of [...Object.values(ACCOUNT_ERRORS), ...Object.values(ROLE_LABELS), ...Object.values(ROLE_DESCRIPTIONS)]) {
      assert.equal(banned(text), undefined, text);
    }
  });

  it("the email templates (subject, text and HTML)", () => {
    const messages = [
      invitationEmail({ to: { email: "a@b.example", name: "A" }, clinicName: "Clinic", role: "admin", inviterName: "B", link: "https://x.example/a", expiresAt: new Date().toISOString() }),
      invitationEmail({ to: { email: "a@b.example" }, clinicName: "Clinic", role: "owner", link: "https://x.example/a", expiresAt: new Date().toISOString() }),
      passwordResetEmail({ to: { email: "a@b.example" }, link: "https://x.example/r", expiresAt: new Date().toISOString() }),
      twoFactorEnabledEmail({ to: { email: "a@b.example" }, at: new Date().toISOString() }),
    ];
    for (const m of messages) for (const part of [m.subject, m.text, m.html]) assert.equal(banned(part), undefined, `${m.kind}: ${part.slice(0, 80)}`);
  });

  it("every string in the sign-in pages, the clinic area and their components", () => {
    const files = [
      ...walk(path.resolve("src/app/(auth)")),
      ...walk(path.resolve("src/app/app")),
      ...walk(path.resolve("src/components/account")),
      path.resolve("src/lib/account-copy.ts"),
      path.resolve("src/server/email/templates.ts"),
    ];
    assert.ok(files.length >= 15, `scanned ${files.length} files`);
    const hits: string[] = [];
    for (const file of files) {
      for (const text of visibleStrings(fs.readFileSync(file, "utf8"))) {
        const re = banned(text);
        if (re) hits.push(`${path.relative(process.cwd(), file)}: "${text.slice(0, 80)}" (${re})`);
      }
    }
    assert.deepEqual(hits, []);
  });
});
