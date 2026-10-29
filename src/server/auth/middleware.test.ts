/** The Edge middleware: optimistic cookie redirect for /app only; never touches the demo or the APIs. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAMES } from "../../lib/session-cookie";
import { BRANDS } from "../../lib/brand";
import { PUBLIC_SITE_PATHS, config, middleware } from "../../middleware";
import { createSqliteTestDb } from "../db/testing/databases";
import { createAuth } from "./create-auth";
import { createClinic } from "./platform";
import { CookieJar } from "./testing/cookie-jar";

type Matcher = string | { source: string; has?: { type: string; value: string }[] };
const entries = () => config.matcher as readonly Matcher[];
const plain = () => entries().filter((e): e is string => typeof e === "string");
const sourceOf = (e: Matcher) => (typeof e === "string" ? e : e.source);
/** The host pattern every app-only brand's public page entry must carry (see src/middleware.ts). */
const appOnlyHostPattern = () =>
  Object.values(BRANDS)
    .filter((b) => !b.publicSite)
    .flatMap((b) => [...b.hosts, ...b.devHosts])
    .map((h) => h.replace(/\./g, "\\."))
    .join("|");

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
    const m = plain();
    for (const p of ["/app", "/app/:path*", "/login", "/two-factor", "/accept-invite", "/reset-password"]) assert.ok(m.includes(p), p);
    assert.ok(!entries().map(sourceOf).some((p) => p.startsWith("/api") || p.startsWith("/reports") || p.startsWith("/pms-sandbox") || p === "/:path*"));
  });
  it("M10: unconditionally, the matcher is main's again – public pages only with an app-only brand's host", () => {
    assert.deepEqual(plain(), ["/app", "/app/:path*", "/login", "/two-factor", "/accept-invite", "/reset-password"]);
    const conditional = entries().filter((e): e is Exclude<Matcher, string> => typeof e !== "string");
    assert.deepEqual(conditional.map((e) => e.source).sort(), [...PUBLIC_SITE_PATHS].sort());
    const pattern = appOnlyHostPattern();
    assert.ok(pattern.length > 0);
    for (const e of conditional) {
      assert.deepEqual(e.has, [{ type: "host", value: pattern }], `${e.source}: the host list in src/middleware.ts must match src/lib/brand.ts`);
      // Next anchors the value (^…$) and matches the Host header without its port.
      const re = new RegExp(`^${e.has?.[0].value}$`);
      for (const b of Object.values(BRANDS)) {
        for (const h of [...b.hosts, ...b.devHosts]) assert.equal(re.test(h), !b.publicSite, `${h} (${b.id})`);
      }
      for (const h of ["clinforms-abc-team.vercel.app", "clinicxlocalhost", "evil.clinic.localhost.example"]) assert.equal(re.test(h), false, h);
    }
  });
  it("public pages pass through untouched on ClinForms' hosts (no redirect, no noindex)", () => {
    for (const host of ["clinforms.co.uk", "www.clinforms.co.uk", "localhost:3180", "clinforms-abc-team.vercel.app"]) {
      for (const p of PUBLIC_SITE_PATHS) {
        const res = middleware(new NextRequest(`https://${host}${p}`, { headers: { host } }));
        assert.equal(res.status, 200, `${host}${p}`);
        assert.equal(res.headers.get("location"), null);
        assert.equal(res.headers.get("x-robots-tag"), null, `${host}${p} stays indexable`);
      }
    }
  });
  it("public pages on an app-only brand's host go to sign-in (or the app start page when signed in)", () => {
    const res = middleware(new NextRequest("http://clinic.localhost:3180/", { headers: { host: "clinic.localhost:3180" } }));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), "http://clinic.localhost:3180/login?next=%2Fapp%2Fclinic");
    const signedIn = middleware(new NextRequest("http://clinic.localhost:3180/privacy", { headers: { host: "clinic.localhost:3180", cookie: `${SESSION_COOKIE_NAMES[0]}=a.b` } }));
    assert.equal(signedIn.headers.get("location"), "http://clinic.localhost:3180/app/clinic");
  });
  it("the cookie names match what Better Auth sets (secure and plain)", async () => {
    for (const [url, expected] of [
      ["https://clinforms.co.uk", "__Secure-clinforms.session_token"],
      ["http://localhost:3000", "clinforms.session_token"],
    ] as const) {
      const t = createSqliteTestDb();
      const auth = createAuth({ db: t.db, dialect: "sqlite", secret: "m".repeat(40), baseUrl: { kind: "static", url }, rateLimit: false });
      const clinic = await createClinic(t.db, { name: "Cookie Clinic (fictional)", slug: "cookie-clinic", ownerEmail: "o@cookie.example", appOrigin: url, linkSecret: "m".repeat(40) });
      assert.ok(clinic.invitationId);
      const res = await auth.api.signUpEmail({ body: { email: "o@cookie.example", password: "long enough password", name: "O" }, returnHeaders: true });
      const jar = new CookieJar().absorb(res.headers);
      assert.ok(jar.names().includes(expected), `${jar.names().join(",")} has ${expected}`);
      assert.ok(SESSION_COOKIE_NAMES.includes(expected));
      await t.close();
    }
  });
});
