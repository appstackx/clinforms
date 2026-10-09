/** The Edge middleware: optimistic cookie redirect for /app only; never touches the demo or the APIs. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAMES } from "../../lib/session-cookie";
import { config, middleware } from "../../middleware";
import { createSqliteTestDb } from "../db/testing/databases";
import { createAuth } from "./create-auth";
import { createClinic } from "./platform";
import { CookieJar } from "./testing/cookie-jar";

describe("middleware", () => {
  it("redirects /app without a session cookie to /login?next=…", () => {
    const res = middleware(new NextRequest("https://clinforms.co.uk/app/settings/members?x=1"));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), "https://clinforms.co.uk/login?next=%2Fapp%2Fsettings%2Fmembers%3Fx%3D1");
  });
  it("lets /app through with a session cookie and passes the path to the layout", () => {
    for (const name of SESSION_COOKIE_NAMES) {
      const req = new NextRequest("https://clinforms.co.uk/app", { headers: { cookie: `${name}=abc.def` } });
      const res = middleware(req);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("x-middleware-request-x-clinforms-path"), "/app");
      assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
    }
  });
  it("the matcher covers /app and the auth pages but never /api, /reports or /pms-sandbox", () => {
    const m = config.matcher;
    for (const p of ["/app", "/app/:path*", "/login", "/two-factor", "/accept-invite", "/reset-password"]) assert.ok(m.includes(p), p);
    assert.ok(!m.some((p) => p.startsWith("/api") || p.startsWith("/reports") || p.startsWith("/pms-sandbox") || p === "/:path*"));
  });
  it("the cookie names match what Better Auth sets (secure and plain)", async () => {
    for (const [url, expected] of [
      ["https://clinforms.co.uk", "__Secure-clinforms.session_token"],
      ["http://localhost:3000", "clinforms.session_token"],
    ] as const) {
      const t = createSqliteTestDb();
      const auth = createAuth({ db: t.db, dialect: "sqlite", secret: "m".repeat(40), baseUrl: { kind: "static", url }, rateLimit: false });
      const clinic = await createClinic(t.db, { name: "Cookie Clinic (fictional)", slug: "cookie-clinic", ownerEmail: "o@cookie.example", appOrigin: url });
      assert.ok(clinic.invitationId);
      const res = await auth.api.signUpEmail({ body: { email: "o@cookie.example", password: "long enough password", name: "O" }, returnHeaders: true });
      const jar = new CookieJar().absorb(res.headers);
      assert.ok(jar.names().includes(expected), `${jar.names().join(",")} has ${expected}`);
      assert.ok(SESSION_COOKIE_NAMES.includes(expected));
      await t.close();
    }
  });
});
