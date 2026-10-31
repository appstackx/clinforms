/** The Edge middleware: optimistic cookie redirect for /app only; never touches the demo or the APIs. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAMES } from "../../lib/session-cookie";
import { BRANDS } from "../../lib/brand";
import { CLINDESK_REDIRECTS, CLINDESK_SITE_PATHS, PUBLIC_SITE_PATHS, clindeskInternalPath, config, middleware } from "../../middleware";
import { createSqliteTestDb } from "../db/testing/databases";
import { createAuth } from "./create-auth";
import { createClinic } from "./platform";
import { CookieJar } from "./testing/cookie-jar";

type Matcher = string | { source: string; has?: { type: string; value: string }[] };
const entries = () => config.matcher as readonly Matcher[];
const plain = () => entries().filter((e): e is string => typeof e === "string");
const sourceOf = (e: Matcher) => (typeof e === "string" ? e : e.source);
/** The host pattern every ClinDesk public page entry must carry (see src/middleware.ts). */
const clindeskHostPattern = () =>
  Object.values(BRANDS)
    .filter((b) => b.publicSite === "clindesk")
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
  it("the matcher covers /app and the auth pages but never /api, /reports/… or /pms-sandbox", () => {
    const m = plain();
    for (const p of ["/app", "/app/:path*", "/login", "/two-factor", "/accept-invite", "/reset-password"]) assert.ok(m.includes(p), p);
    assert.ok(!entries().map(sourceOf).some((p) => p.startsWith("/api") || p.startsWith("/reports/") || p.startsWith("/pms-sandbox") || p === "/:path*"));
    // "/reports" itself only on ClinDesk's hosts (its "Referrer reports" page); ClinForms' public demo is never matched.
    const reports = entries().filter((e) => sourceOf(e) === "/reports");
    assert.equal(reports.length, 1);
    assert.equal(typeof reports[0], "object");
  });
  it("unconditionally, the matcher is main's plus the internal ClinDesk folder – public pages only on ClinDesk's hosts", () => {
    assert.deepEqual(plain(), ["/app", "/app/:path*", "/login", "/two-factor", "/accept-invite", "/reset-password", "/clindesk-site", "/clindesk-site/:path*"]);
    const conditional = entries().filter((e): e is Exclude<Matcher, string> => typeof e !== "string");
    assert.deepEqual(conditional.map((e) => e.source).sort(), [...CLINDESK_SITE_PATHS, ...Object.keys(CLINDESK_REDIRECTS)].sort());
    const pattern = clindeskHostPattern();
    assert.ok(pattern.length > 0);
    for (const e of conditional) {
      assert.deepEqual(e.has, [{ type: "host", value: pattern }], `${e.source}: the host list in src/middleware.ts must match src/lib/brand.ts`);
      // Next anchors the value (^…$) and matches the Host header without its port.
      const re = new RegExp(`^(?:${e.has?.[0].value})$`);
      for (const b of Object.values(BRANDS)) {
        for (const h of [...b.hosts, ...b.devHosts]) assert.equal(re.test(h), b.publicSite === "clindesk", `${h} (${b.id})`);
      }
      for (const h of ["clinforms-abc-team.vercel.app", "clinicxlocalhost", "evil.clinic.localhost.example", "clindeskxco.uk", "clindesk.co.uk.evil.example"]) {
        assert.equal(re.test(h), false, h);
      }
    }
  });
  it("public pages pass through untouched on ClinForms' hosts (no redirect, no rewrite, no noindex)", () => {
    for (const host of ["clinforms.co.uk", "www.clinforms.co.uk", "localhost:3180", "clinforms-abc-team.vercel.app"]) {
      for (const p of [...PUBLIC_SITE_PATHS, "/features", "/pricing", "/accessibility", "/robots.txt", "/sitemap.xml"]) {
        const res = middleware(new NextRequest(`https://${host}${p}`, { headers: { host } }));
        assert.equal(res.status, 200, `${host}${p}`);
        assert.equal(res.headers.get("location"), null);
        assert.equal(res.headers.get("x-middleware-rewrite"), null, `${host}${p} is not rewritten`);
        // ClinForms' own pages stay indexable; ClinDesk's paths do not exist there (the matcher never runs the
        // middleware for them on these hosts – see the host-pattern test – and Next answers 404).
        if ((PUBLIC_SITE_PATHS as readonly string[]).includes(p)) assert.equal(res.headers.get("x-robots-tag"), null, `${host}${p} stays indexable`);
      }
    }
  });
  it("ClinDesk's hosts: the public paths are rewritten to ClinDesk's website (indexable, no sign-in redirect)", () => {
    for (const host of ["clindesk.co.uk", "clinic.localhost:3180"]) {
      for (const p of CLINDESK_SITE_PATHS) {
        const proto = host.startsWith("clinic.localhost") ? "http" : "https";
        for (const cookie of ["", `${SESSION_COOKIE_NAMES[0]}=a.b`]) {
          const res = middleware(new NextRequest(`${proto}://${host}${p}`, { headers: { host, cookie } }));
          assert.equal(res.status, 200, `${host}${p}`);
          assert.equal(res.headers.get("location"), null, `${host}${p}`);
          assert.equal(res.headers.get("x-middleware-rewrite"), `${proto}://${host}${clindeskInternalPath(p)}`, `${host}${p}`);
          assert.equal(res.headers.get("x-robots-tag"), null, `${host}${p} is indexable`);
        }
      }
    }
    assert.equal(clindeskInternalPath("/"), "/clindesk-site");
    assert.equal(clindeskInternalPath("/demo/thanks"), "/clindesk-site/demo/thanks");
  });
  it("ClinDesk's hosts: /request-access goes to /demo; /app and the auth pages behave as on ClinForms", () => {
    const res = middleware(new NextRequest("https://clindesk.co.uk/request-access?x=1", { headers: { host: "clindesk.co.uk" } }));
    assert.equal(res.status, 308);
    assert.equal(res.headers.get("location"), "https://clindesk.co.uk/demo");
    const app = middleware(new NextRequest("https://clindesk.co.uk/app/clinic", { headers: { host: "clindesk.co.uk" } }));
    assert.equal(app.status, 307);
    assert.equal(app.headers.get("location"), "https://clindesk.co.uk/login?next=%2Fapp%2Fclinic");
    const login = middleware(new NextRequest("https://clindesk.co.uk/login", { headers: { host: "clindesk.co.uk" } }));
    assert.equal(login.status, 200);
    assert.equal(login.headers.get("x-robots-tag"), "noindex, nofollow");
    const signedIn = middleware(new NextRequest("https://clindesk.co.uk/app/clinic", { headers: { host: "clindesk.co.uk", cookie: `${SESSION_COOKIE_NAMES[0]}=a.b` } }));
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.headers.get("x-robots-tag"), "noindex, nofollow");
  });
  it("the internal folder is never served under its own name, on any host", () => {
    for (const host of ["clinforms.co.uk", "clindesk.co.uk", "clinic.localhost:3180", "localhost:3180"]) {
      for (const p of ["/clindesk-site", "/clindesk-site/features", "/clindesk-site/demo/thanks", "/clindesk-site/robots.txt"]) {
        const res = middleware(new NextRequest(`https://${host}${p}`, { headers: { host } }));
        assert.equal(res.headers.get("x-middleware-rewrite"), `https://${host}/_clindesk-not-found`, `${host}${p}`);
        assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
      }
    }
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
