/**
 * The tenant Studio's guard (/app/studio/**): no session → /login?next=…, no two-step verification →
 * /two-factor, no active clinic → /app/select-clinic; a signed-in member with two-step gets the Studio's
 * context (clinic name, drafting switch, member and signing details). Real Better Auth on node:sqlite.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAMES } from "../../lib/session-cookie";
import { middleware } from "../../middleware";
import { createSqliteTestDb, type TestDb } from "../db/testing/databases";
import { setEmailProviderForTests } from "../email";
import { upsertClinicProfile } from "../repos/clinic-profile";
import { upsertMemberProfile } from "../repos/member-profile";
import { createAuth, type Auth } from "./create-auth";
import { createClinic } from "./platform";
import { STUDIO_BASE_PATH, resolveStudioAccess, studioLoginRedirect } from "./studio-access";
import { CookieJar } from "./testing/cookie-jar";
import { parseOtpAuthUri, totp } from "./testing/totp";

const ORIGIN = "http://localhost:3000";
const SECRET = "studio-access-secret-".padEnd(48, "s");
const PASSWORD = "correct horse battery staple";

describe("middleware: /app/studio without a session cookie", () => {
  it("redirects to /login with the Studio path as next", () => {
    const res = middleware(new NextRequest("https://clinforms.co.uk/app/studio/forms/form_1?x=1"));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), "https://clinforms.co.uk/login?next=%2Fapp%2Fstudio%2Fforms%2Fform_1%3Fx%3D1");
  });
  it("passes the path on (for the layout's own check) when a cookie is present", () => {
    const req = new NextRequest("https://clinforms.co.uk/app/studio/new", { headers: { cookie: `${SESSION_COOKIE_NAMES[0]}=abc.def` } });
    const res = middleware(req);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-middleware-request-x-clinforms-path"), "/app/studio/new");
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
  });
});

describe("studioLoginRedirect", () => {
  it("keeps Studio paths and refuses anything outside /app", () => {
    assert.equal(STUDIO_BASE_PATH, "/app/studio");
    assert.equal(studioLoginRedirect("/app/studio/rpt_1"), "/login?next=%2Fapp%2Fstudio%2Frpt_1");
    assert.equal(studioLoginRedirect(null), "/login?next=%2Fapp%2Fstudio");
    assert.equal(studioLoginRedirect("https://evil.example/app"), "/login?next=%2Fapp%2Fstudio");
    assert.equal(studioLoginRedirect("//evil.example"), "/login?next=%2Fapp%2Fstudio");
    assert.equal(studioLoginRedirect("/reports"), "/login?next=%2Fapp%2Fstudio");
  });
});

describe("resolveStudioAccess (real sign-in on node:sqlite)", () => {
  let t: TestDb;
  let auth: Auth;
  let clinic: Awaited<ReturnType<typeof createClinic>>;
  let jar: CookieJar;

  before(async () => {
    t = createSqliteTestDb();
    auth = createAuth({ db: t.db, dialect: "sqlite", secret: SECRET, baseUrl: { kind: "static", url: ORIGIN }, rateLimit: false });
    setEmailProviderForTests({ name: "none", send: async () => ({ status: "not_sent", provider: "none" }) });
    clinic = await createClinic(t.db, {
      name: "Studio Test Physio (fictional)",
      slug: "studio-test",
      ownerEmail: "owner@studio-test.example",
      appOrigin: ORIGIN,
      linkSecret: SECRET,
    });
  });
  after(async () => {
    setEmailProviderForTests(null);
    await t?.close();
  });

  const access = (headers: Headers, path = "/app/studio/new") => resolveStudioAccess({ auth, db: t.db, headers, path });

  it("no session → /login?next=<the Studio path>", async () => {
    assert.deepEqual(await access(new Headers()), { kind: "redirect", to: "/login?next=%2Fapp%2Fstudio%2Fnew" });
    // a cookie that is not a valid session is the same as none
    const forged = new Headers({ cookie: `${SESSION_COOKIE_NAMES[1] ?? SESSION_COOKIE_NAMES[0]}=forged.value` });
    assert.deepEqual(await access(forged, "/app/studio"), { kind: "redirect", to: "/login?next=%2Fapp%2Fstudio" });
  });

  it("signed in without two-step verification → /two-factor", async () => {
    jar = new CookieJar();
    const res = await auth.api.signUpEmail({ body: { email: "owner@studio-test.example", password: PASSWORD, name: "Olivia Owner" }, returnHeaders: true });
    jar.absorb(res.headers);
    const accepted = await auth.api.acceptInvitation({ body: { invitationId: clinic.invitationId }, headers: jar.headers(), returnHeaders: true });
    jar.absorb(accepted.headers);
    assert.deepEqual(await access(jar.headers()), { kind: "redirect", to: "/two-factor" });
  });

  it("with two-step verification: the clinic and the member, signing details from the clinic profile", async () => {
    const enabled = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: jar.headers() });
    const otp = parseOtpAuthUri(String((enabled as { totpURI?: string }).totpURI));
    const verified = await auth.api.verifyTOTP({ body: { code: totp(otp) }, headers: jar.headers(), returnHeaders: true });
    jar.absorb(verified.headers);

    const first = await access(jar.headers());
    assert.equal(first.kind, "ok");
    if (first.kind !== "ok") return;
    const userId = (await auth.api.getSession({ headers: jar.headers() }))!.user.id;
    assert.deepEqual(first.context, {
      tenantId: "studio-test",
      clinicName: "Studio Test Physio (fictional)",
      draftingEnabled: false,
      // userId (fix wave 2) scopes the Studio's in-memory records to this member.
      member: { name: "Olivia Owner", userId, email: "owner@studio-test.example", role: "owner", roleLabel: "Owner", canSign: false },
    });

    await upsertMemberProfile({ db: t.db }, clinic.organizationId, (await auth.api.getSession({ headers: jar.headers() }))!.user.id, {
      jobTitle: "Physiotherapist",
      hcpcNumber: "PH123456",
      canSign: true,
    });
    await upsertClinicProfile({ db: t.db }, "studio-test", { organizationId: clinic.organizationId, displayName: "Studio Test Physio (fictional)", draftingEnabled: true });
    const second = await access(jar.headers());
    assert.equal(second.kind, "ok");
    if (second.kind !== "ok") return;
    assert.equal(second.context.draftingEnabled, true);
    assert.deepEqual(second.context.member, {
      name: "Olivia Owner",
      userId,
      email: "owner@studio-test.example",
      role: "owner",
      roleLabel: "Owner",
      hcpc: "PH123456",
      jobTitle: "Physiotherapist",
      canSign: true,
    });
    // nothing secret or identifying beyond what the member's own Studio shows
    const text = JSON.stringify(second.context);
    for (const secret of [clinic.organizationId, clinic.invitationId]) assert.ok(!text.includes(secret));
  });

  it("signed out → back to /login (the session is read past the cookie cache)", async () => {
    await auth.api.signOut({ headers: jar.headers() });
    assert.deepEqual(await access(jar.headers(), "/app/studio/forms"), { kind: "redirect", to: "/login?next=%2Fapp%2Fstudio%2Fforms" });
  });
});
