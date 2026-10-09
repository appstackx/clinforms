import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { applyTarget, appUrl, CliError, parseArgs, requireYesForProduction, resolveTarget, safeExportDir } from "./cli";

describe("admin script helpers", () => {
  it("parses --flag value and boolean flags", () => {
    const a = parseArgs(["--name", "Riverside Physio", "--confirm", "--slug", "riverside"]);
    assert.equal(a.get("name"), "Riverside Physio");
    assert.equal(a.get("confirm"), true);
    assert.throws(() => parseArgs(["stray"]), CliError);
  });
  it("targets: current by default; preview/production read PREFIXED values from the secrets file only", () => {
    assert.equal(resolveTarget(parseArgs([])), "current");
    assert.equal(resolveTarget(parseArgs(["--env", "preview"])), "preview");
    assert.throws(() => resolveTarget(parseArgs(["--env", "staging"])), CliError);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-cli-"));
    const file = path.join(dir, "secrets.env");
    fs.writeFileSync(file, "PREVIEW_CLINFORMS_DB=d1\nPREVIEW_CLINFORMS_D1_GATEWAY_URL=https://g.example\nPRODUCTION_CLINFORMS_DB=postgres\nPREVIEW_UNRELATED=x\n");
    const env: Record<string, string | undefined> = {};
    assert.deepEqual(applyTarget("preview", env, file), ["CLINFORMS_DB", "CLINFORMS_D1_GATEWAY_URL"]);
    assert.equal(env.CLINFORMS_DB, "d1");
    assert.equal(env.UNRELATED, undefined);
    assert.throws(() => applyTarget("preview", {}, path.join(dir, "missing.env")), /PREVIEW_CLINFORMS_DB/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("production changes need --yes", () => {
    assert.throws(() => requireYesForProduction("production", parseArgs([]), "X"), /--yes/);
    requireYesForProduction("production", parseArgs(["--yes"]), "X");
    requireYesForProduction("preview", parseArgs([]), "X");
  });
  it("app URL: --app-url, BETTER_AUTH_URL, production default; preview must say which deployment", () => {
    assert.equal(appUrl("production", parseArgs([]), {}), "https://clinforms.co.uk");
    assert.equal(appUrl("current", parseArgs([]), {}), "http://localhost:3000");
    assert.equal(appUrl("preview", parseArgs(["--app-url", "https://clinforms-git-x.vercel.app/path"]), {}), "https://clinforms-git-x.vercel.app");
    assert.throws(() => appUrl("preview", parseArgs([]), {}), /--app-url is required/);
    assert.throws(() => appUrl("current", parseArgs(["--app-url", "http://evil.example"]), {}), /https/);
  });
  it("exports never go inside the repository", () => {
    assert.throws(() => safeExportDir("./exports", "x", process.cwd()), /outside the repository/);
    assert.throws(() => safeExportDir(process.cwd(), "x", process.cwd()), /outside the repository/);
    assert.ok(safeExportDir(undefined, "riverside").startsWith(path.join(os.homedir(), "clinforms-exports", "riverside-")));
  });
});

describe("auth settings provisioning plan", () => {
  it("keeps an existing secret, generates one otherwise; production also sets the public URL; preview never does", async () => {
    const { planAuthSettings } = await import("./provision-auth-secrets");
    const fresh = planAuthSettings("preview", new Map(), () => "generated-secret");
    assert.equal(fresh.generated, true);
    assert.deepEqual(fresh.file, { PREVIEW_BETTER_AUTH_SECRET: "generated-secret", PREVIEW_CLINFORMS_EMAIL_PROVIDER: "none" });
    assert.deepEqual(fresh.vercel.map(([n, , s]) => [n, s]), [["BETTER_AUTH_SECRET", true], ["CLINFORMS_EMAIL_PROVIDER", false]]);
    const kept = planAuthSettings("production", new Map([["PRODUCTION_BETTER_AUTH_SECRET", "existing"], ["PRODUCTION_CLINFORMS_EMAIL_PROVIDER", "mailersend"]]), () => "never");
    assert.equal(kept.generated, false);
    assert.equal(kept.file.PRODUCTION_BETTER_AUTH_SECRET, "existing");
    assert.equal(kept.file.PRODUCTION_BETTER_AUTH_URL, "https://clinforms.co.uk");
    assert.deepEqual(kept.vercel.map(([n, v]) => [n, n === "BETTER_AUTH_SECRET" ? "…" : v]), [
      ["BETTER_AUTH_SECRET", "…"],
      ["CLINFORMS_EMAIL_PROVIDER", "mailersend"],
      ["BETTER_AUTH_URL", "https://clinforms.co.uk"],
    ]);
  });
});
