/**
 * Invitation links in the app's pages always carry the signed token (`<invitation id>.<MAC>`, invite-token.ts):
 * a link built from the bare invitation id is refused by /accept-invite, so it would always say "not valid".
 * (Regression: /app/select-clinic linked the bare id until wave 2's integration.)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { invitationIdFromToken, inviteToken } from "./invite-token";

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("invitation links in pages", () => {
  it("every /accept-invite?token= link in src/app is built from the signed token", () => {
    const offenders: string[] = [];
    for (const file of sources(path.resolve("src/app"))) {
      // The accept-invite route itself only passes on the (already signed) token it was opened with.
      if (file.split(path.sep).join("/").includes("/(auth)/accept-invite/")) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const m of Array.from(text.matchAll(/accept-invite\?token=\$\{([^}]*)\}/g))) {
        if (!/inviteToken\(/.test(m[1])) offenders.push(`${path.relative(process.cwd(), file)}: ${m[0]}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("the token a page builds is the one /accept-invite accepts", () => {
    const secret = "x".repeat(40);
    const token = inviteToken(secret, "AbCdEfGh12345678AbCdEfGh12345678");
    assert.equal(invitationIdFromToken(secret, token), "AbCdEfGh12345678AbCdEfGh12345678");
    assert.equal(invitationIdFromToken(secret, "AbCdEfGh12345678AbCdEfGh12345678"), null, "the bare id is refused");
  });
});
