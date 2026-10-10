import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appOrigin, authSecret, baseUrlSetting, isPlatformAdmin, safeNextPath, usesSecureCookies } from "./config";
import { assignableRoles, parseMemberRole, roleCan } from "./roles";
import { RESERVED_TENANT_SLUGS, tenantSlugProblem } from "./tenant";
import { isValidHcpc, normaliseHcpc } from "../../lib/hcpc";

describe("auth configuration from the environment", () => {
  it("BETTER_AUTH_SECRET must be 32+ characters", () => {
    assert.throws(() => authSecret({}), /BETTER_AUTH_SECRET/);
    assert.throws(() => authSecret({ BETTER_AUTH_SECRET: "short" }), /BETTER_AUTH_SECRET/);
    assert.equal(authSecret({ BETTER_AUTH_SECRET: "x".repeat(32) }).length, 32);
  });

  it("base URL: static when BETTER_AUTH_URL is set, this deployment's own hosts on previews, required on production", () => {
    assert.deepEqual(baseUrlSetting({ BETTER_AUTH_URL: "https://clinforms.co.uk/some/path" }), { kind: "static", url: "https://clinforms.co.uk" });
    assert.deepEqual(baseUrlSetting({}), { kind: "static", url: "http://localhost:3000" });
    assert.deepEqual(baseUrlSetting({ PORT: "3107" }), { kind: "static", url: "http://localhost:3107" });
    const preview = baseUrlSetting({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "clinforms-abc123.vercel.app", VERCEL_BRANCH_URL: "clinforms-git-x.vercel.app" });
    assert.deepEqual(preview, {
      kind: "dynamic",
      allowedHosts: ["clinforms-git-x.vercel.app", "clinforms-abc123.vercel.app"],
      fallback: "https://clinforms-git-x.vercel.app",
      protocol: "https",
    });
    assert.throws(() => baseUrlSetting({ VERCEL: "1", VERCEL_ENV: "production", VERCEL_URL: "x.vercel.app" }), /BETTER_AUTH_URL must be set/);
    assert.throws(() => baseUrlSetting({ BETTER_AUTH_URL: "ftp://x" }), /not a valid/);
    assert.equal(usesSecureCookies(preview), true);
    assert.equal(usesSecureCookies({ kind: "static", url: "http://localhost:3000" }), false);
  });

  it("link origin: an allowed Host header is used, a forged one falls back", () => {
    const preview = baseUrlSetting({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "clinforms-abc123.vercel.app" });
    assert.equal(appOrigin(preview, new Headers({ host: "clinforms-abc123.vercel.app" })), "https://clinforms-abc123.vercel.app");
    assert.equal(appOrigin(preview, new Headers({ host: "evil.example" })), "https://clinforms-abc123.vercel.app");
    assert.equal(appOrigin({ kind: "static", url: "https://clinforms.co.uk" }, new Headers({ host: "evil.example" })), "https://clinforms.co.uk");
  });

  it("post-sign-in destinations stay inside the app (no open redirect)", () => {
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "/reports", "javascript:alert(1)", "/login", undefined, 42]) {
      assert.equal(safeNextPath(bad), "/app", String(bad));
    }
    assert.equal(safeNextPath("/app/settings/members"), "/app/settings/members");
    assert.equal(safeNextPath("/accept-invite?token=abc"), "/accept-invite?token=abc");
  });

  it("CLINFORMS_PLATFORM_ADMINS gates platform pages by email", () => {
    const env = { CLINFORMS_PLATFORM_ADMINS: " Khuram@AppstackX.co.uk , not-an-email, ops@example.com" };
    assert.equal(isPlatformAdmin("khuram@appstackx.co.uk", env), true);
    assert.equal(isPlatformAdmin("ops@example.com", env), true);
    assert.equal(isPlatformAdmin("someone@example.com", env), false);
    assert.equal(isPlatformAdmin("khuram@appstackx.co.uk", {}), false);
    assert.equal(isPlatformAdmin(null, env), false);
  });
});

describe("roles, tenant ids, HCPC numbers", () => {
  it("roles and permissions", () => {
    assert.equal(parseMemberRole("admin"), "admin");
    assert.equal(parseMemberRole("member"), null);
    assert.equal(parseMemberRole("admin,owner"), null);
    assert.equal(roleCan("admin", { apiKey: ["create"] }), true);
    assert.equal(roleCan("clinician", { apiKey: ["create"] }), false);
    assert.equal(roleCan("clinician", { report: ["sign"] }), true);
    assert.equal(roleCan("staff", { report: ["sign"] }), false);
    assert.deepEqual(assignableRoles("admin"), ["admin", "clinician", "staff"]);
    assert.deepEqual(assignableRoles("clinician"), []);
  });
  it("tenant slugs", () => {
    assert.ok(RESERVED_TENANT_SLUGS.has("demo"));
    assert.equal(tenantSlugProblem("demo"), "reserved");
    assert.equal(tenantSlugProblem("riverside-physio"), null);
    assert.equal(tenantSlugProblem("Riverside"), "format");
    assert.equal(tenantSlugProblem("a--b"), "format");
    assert.equal(tenantSlugProblem("ends-"), "format");
    assert.equal(tenantSlugProblem("ab"), "length");
    assert.equal(tenantSlugProblem("x".repeat(64)), "length");
  });
  it("HCPC numbers (format only)", () => {
    assert.equal(normaliseHcpc(" ph 123-456 "), "PH123456");
    assert.equal(isValidHcpc("PH123456"), true);
    assert.equal(isValidHcpc("OT12345"), true);
    assert.equal(isValidHcpc("PH-DEMO-01"), false);
    assert.equal(isValidHcpc("123456"), false);
  });
});

describe("Better Auth options per dialect", () => {
  it("schema check off on D1 only; transactions off everywhere; disabled HTTP paths", async () => {
    const { createAuth, DISABLED_PATHS } = await import("./create-auth");
    const { createSqliteTestDb } = await import("../db/testing/databases");
    const t = createSqliteTestDb();
    const opts = (dialect: "d1" | "sqlite" | "postgres") =>
      createAuth({ db: t.db, dialect, secret: "o".repeat(40), baseUrl: { kind: "static", url: "https://clinforms.co.uk" } }).options;
    assert.equal(opts("d1").advanced?.database?.validateSchema, false);
    assert.equal(opts("sqlite").advanced?.database?.validateSchema, true);
    assert.equal(opts("postgres").advanced?.database?.validateSchema, true);
    for (const d of ["d1", "sqlite", "postgres"] as const) {
      const o = opts(d);
      assert.equal((o.database as { transaction?: boolean }).transaction, false);
      assert.equal(o.advanced?.cookiePrefix, "clinforms");
      assert.equal(o.advanced?.useSecureCookies, true);
      assert.equal(o.session?.cookieCache?.maxAge, 300);
      assert.equal(o.rateLimit?.storage, "database");
      assert.equal(o.emailAndPassword?.minPasswordLength, 12);
    }
    for (const p of ["/sign-up/email", "/two-factor/disable", "/organization/create", "/organization/delete", "/update-user"]) assert.ok(DISABLED_PATHS.includes(p));
    await t.close();
  });
});
