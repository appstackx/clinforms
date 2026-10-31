/**
 * Two brand hosts on one deployment (31/10/2026, docs/auth.md "Two brand hosts"): clinforms.co.uk and clindesk.co.uk.
 *
 * 1. Configuration: CLINFORMS_AUTH_ORIGINS turns the one static base URL into Better Auth's allow-listed dynamic base
 *    URL; without it production is exactly as before (static). Bad values are refused.
 * 2. Real Better Auth through its HTTP handler (node:sqlite), production settings (https, secure cookies, rate limits
 *    ON): sign-in on each host, the origin/CSRF check per host (and a foreign origin refused on both), host-only
 *    cookies per host, the authenticator entry named after the host's brand, invitation and reset links (and the
 *    emails' brand) by the clinic's package, single-use tokens across hosts, the sign-in rate limit shared by both
 *    hosts.
 * 3. Regression: with the static production setting the ClinForms flows and messages are byte-for-byte as before,
 *    and the clinic brand's origin is refused by the origin check.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BRANDS } from "../../lib/brand";
import { createSqliteTestDb, type TestDb } from "../db/testing/databases";
import { invitationEmail, passwordResetEmail, setEmailProviderForTests, twoFactorEnabledEmail, type EmailMessage } from "../email";
import { setEntitlement } from "../repos/pms/entitlements";
import { clinicLinkBrand, userLinkBrand, withLinkBrand } from "./brand-links";
import {
  AuthConfigError,
  baseUrlSetting,
  brandOrigin,
  extraAuthOrigins,
  linkTarget,
  requestBrand,
  trustedOriginsOf,
  usesSecureCookies,
  type BaseUrlSetting,
} from "./config";
import { createAuth, TWO_FACTOR_ISSUER, TWO_FACTOR_ISSUERS, type Auth } from "./create-auth";
import { createClinic } from "./platform";
import { CookieJar } from "./testing/cookie-jar";
import { parseOtpAuthUri, totp } from "./testing/totp";

const CLINFORMS = "https://clinforms.co.uk";
const CLINDESK = "https://clindesk.co.uk";
const SECRET = "brand-hosts-secret-".padEnd(48, "s");
const PASSWORD = "correct horse battery staple";
const PROD_ENV = { VERCEL: "1", VERCEL_ENV: "production", BETTER_AUTH_URL: CLINFORMS };

describe("brand hosts – configuration", () => {
  it("production without CLINFORMS_AUTH_ORIGINS: one static base URL, exactly as before", () => {
    const s = baseUrlSetting(PROD_ENV);
    assert.deepEqual(s, { kind: "static", url: CLINFORMS });
    assert.deepEqual(trustedOriginsOf(s), [CLINFORMS]);
    assert.equal(brandOrigin(s, "clinic"), CLINFORMS);
    assert.deepEqual(linkTarget(s, "clinic"), { origin: CLINFORMS, brand: "clinforms" });
  });

  it("production with CLINFORMS_AUTH_ORIGINS: allow-listed dynamic base URL, ClinForms as the fallback", () => {
    const s = baseUrlSetting({ ...PROD_ENV, CLINFORMS_AUTH_ORIGINS: " https://clindesk.co.uk , https://clinforms.co.uk " });
    assert.deepEqual(s, { kind: "dynamic", allowedHosts: ["clinforms.co.uk", "clindesk.co.uk"], fallback: CLINFORMS, protocol: "https" });
    assert.deepEqual(trustedOriginsOf(s), [CLINFORMS, CLINDESK]);
    assert.equal(usesSecureCookies(s), true);
    assert.equal(brandOrigin(s, "clinforms"), CLINFORMS);
    assert.equal(brandOrigin(s, "clinic"), CLINDESK);
    assert.deepEqual(linkTarget(s, "clinic"), { origin: CLINDESK, brand: "clinic" });
  });

  it("refuses anything but the brands' bare https origins on production", () => {
    for (const bad of [
      "https://evil.example",
      "http://clindesk.co.uk",
      "https://clindesk.co.uk/app",
      "https://clindesk.co.uk?x=1",
      "https://user@clindesk.co.uk",
      "clindesk.co.uk",
      "https://*.clindesk.co.uk",
      "http://clinic.localhost:3180",
    ]) {
      assert.throws(() => baseUrlSetting({ ...PROD_ENV, CLINFORMS_AUTH_ORIGINS: bad }), AuthConfigError, bad);
    }
    // A scheme other than BETTER_AUTH_URL's (locally): refused rather than mixing secure and plain cookies.
    assert.throws(() => baseUrlSetting({ BETTER_AUTH_URL: "http://localhost:3180", CLINFORMS_AUTH_ORIGINS: "https://clindesk.co.uk" }), AuthConfigError);
  });

  it("local: clinic.localhost next to localhost (same port); previews ignore the variable", () => {
    const local = baseUrlSetting({ BETTER_AUTH_URL: "http://localhost:3180", CLINFORMS_AUTH_ORIGINS: "http://clinic.localhost:3180" });
    assert.deepEqual(local, { kind: "dynamic", allowedHosts: ["localhost:3180", "clinic.localhost:3180"], fallback: "http://localhost:3180", protocol: "http" });
    assert.equal(brandOrigin(local, "clinic"), "http://clinic.localhost:3180");
    assert.equal(usesSecureCookies(local), false);
    assert.deepEqual(baseUrlSetting({ PORT: "3180" }), { kind: "static", url: "http://localhost:3180" });
    const preview = baseUrlSetting({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "clinforms-abc.vercel.app", CLINFORMS_AUTH_ORIGINS: CLINDESK });
    assert.deepEqual(preview, { kind: "dynamic", allowedHosts: ["clinforms-abc.vercel.app"], fallback: "https://clinforms-abc.vercel.app", protocol: "https" });
    assert.deepEqual(linkTarget(preview, "clinic"), { origin: "https://clinforms-abc.vercel.app", brand: "clinforms" });
    assert.deepEqual(extraAuthOrigins({}), []);
  });

  it("a request's brand only for the app's own hosts (a forged Host never picks a brand)", () => {
    const s = baseUrlSetting({ ...PROD_ENV, CLINFORMS_AUTH_ORIGINS: CLINDESK });
    assert.equal(requestBrand(s, new Headers({ host: "clindesk.co.uk" })), "clinic");
    assert.equal(requestBrand(s, new Headers({ host: "clinforms.co.uk" })), "clinforms");
    assert.equal(requestBrand(s, new Headers({ host: "evil.example" })), null);
    assert.equal(requestBrand(s, new Headers({ host: "www.clindesk.co.uk" })), null);
    assert.equal(requestBrand(s, null), null);
    assert.equal(requestBrand(baseUrlSetting(PROD_ENV), new Headers({ host: "clindesk.co.uk" })), null);
  });

  it("issuer names follow the brands; ClinForms' is unchanged", () => {
    assert.equal(TWO_FACTOR_ISSUER, "ClinForms");
    assert.deepEqual(TWO_FACTOR_ISSUERS, { clinforms: "ClinForms", clinic: BRANDS.clinic.productName });
  });

  it("ClinForms' email templates are byte-for-byte as before without a brand; the clinic brand only renames", () => {
    const base = { to: { email: "a@b.example", name: "Ann" }, link: "https://clinforms.co.uk/x", expiresAt: "2026-11-07T10:00:00.000Z" };
    const inv = { ...base, clinicName: "Riverside (fictional)", role: "clinician", inviterName: "Owen" };
    assert.deepEqual(invitationEmail(inv), invitationEmail({ ...inv, brand: "clinforms" }));
    assert.equal("brand" in invitationEmail(inv), false);
    const desk = invitationEmail({ ...inv, brand: "clinic" });
    assert.equal(desk.brand, "clinic");
    assert.equal(desk.subject, `Join Riverside (fictional) on ${BRANDS.clinic.productName}`);
    assert.doesNotMatch(desk.text + desk.html, /ClinForms/);
    assert.equal(desk.text.replaceAll(BRANDS.clinic.productName, "ClinForms"), invitationEmail(inv).text);
    assert.equal(passwordResetEmail({ ...base, brand: "clinic" }).subject, `Reset your ${BRANDS.clinic.productName} password`);
    assert.equal(passwordResetEmail(base).subject, "Reset your ClinForms password");
    assert.match(twoFactorEnabledEmail({ to: base.to, at: base.expiresAt, brand: "clinic" }).subject, new RegExp(BRANDS.clinic.productName));
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */

interface HostClient {
  jar: CookieJar;
  host: string;
  origin: string;
}

function setCookieLines(res: Response): string[] {
  return (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie();
}

describe("brand hosts – Better Auth over HTTP (production settings, both hosts)", () => {
  let t: TestDb;
  let auth: Auth;
  let setting: BaseUrlSetting;
  const sent: EmailMessage[] = [];
  let ip = 1;
  let clinicA: Awaited<ReturnType<typeof createClinic>>; // ClinForms only
  let clinicB: Awaited<ReturnType<typeof createClinic>>; // clinic package on
  let actionHeaders: Headers | null = null;
  /** A server action's call: auth.api with these request headers (Next's headers() in the app). */
  async function asAction<T>(headers: Headers, fn: (h: Headers) => Promise<T>): Promise<T> {
    actionHeaders = headers;
    try {
      return await fn(headers);
    } finally {
      actionHeaders = null;
    }
  }

  async function call(client: HostClient, path: string, body: unknown, extra: Record<string, string> = {}): Promise<Response> {
    const headers = client.jar.headers({
      host: client.host,
      origin: client.origin,
      "content-type": "application/json",
      "x-forwarded-for": extra["x-forwarded-for"] ?? `198.51.100.${ip}`,
      ...extra,
    });
    const res = await auth.handler(new Request(`https://${client.host}/api/auth${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
    client.jar.absorb(res.headers);
    return res;
  }

  function client(origin: string, host = new URL(origin).host): HostClient {
    return { jar: new CookieJar(), host, origin };
  }

  /** Account from an invitation + two-step on, on the given host. Returns the TOTP. */
  async function onboard(c: HostClient, invitationId: string, email: string): Promise<ReturnType<typeof parseOtpAuthUri>> {
    const signUp = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: email.split("@")[0] }, returnHeaders: true });
    c.jar.absorb(signUp.headers);
    await auth.api.acceptInvitation({ body: { invitationId }, headers: c.jar.headers() });
    const enabled = await call(c, "/two-factor/enable", { password: PASSWORD, issuer: "Forged issuer" });
    assert.equal(enabled.status, 200);
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const otp = parseOtpAuthUri(totpURI);
    const verified = await call(c, "/two-factor/verify-totp", { code: totp(otp) });
    assert.equal(verified.status, 200);
    return otp;
  }

  async function signIn(c: HostClient, email: string, otp: ReturnType<typeof parseOtpAuthUri>): Promise<Response> {
    const first = await call(c, "/sign-in/email", { email, password: PASSWORD });
    assert.equal(first.status, 200, `password step on ${c.host}`);
    assert.equal(((await first.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect, true);
    return call(c, "/two-factor/verify-totp", { code: totp(otp) });
  }

  before(async () => {
    t = createSqliteTestDb();
    setting = baseUrlSetting({ ...PROD_ENV, CLINFORMS_AUTH_ORIGINS: CLINDESK });
    // As in the app (auth.ts): the current server action's request headers, for calls without a Request.
    auth = createAuth({ db: t.db, dialect: "sqlite", secret: SECRET, baseUrl: setting, rateLimit: true, currentHeaders: async () => actionHeaders });
    setEmailProviderForTests({
      name: "none",
      async send(message) {
        sent.push(message);
        return { status: "not_sent", provider: "none" };
      },
    });
    clinicA = await createClinic(t.db, { name: "Forms Only Physio (fictional)", slug: "forms-only", ownerEmail: "owner@forms-only.example", appOrigin: CLINFORMS, linkSecret: SECRET, sendEmail: false });
    const desk = linkTarget(setting, "clinic");
    clinicB = await createClinic(t.db, { name: "Desk Physio (fictional)", slug: "desk-physio", ownerEmail: "owner@desk-physio.example", appOrigin: desk.origin, brand: desk.brand, linkSecret: SECRET, sendEmail: false });
    await setEntitlement({ db: t.db }, "desk-physio", "clinic", { status: "active" }, { userId: null, sessionId: null });
  });
  after(async () => {
    setEmailProviderForTests(null);
    await t?.close();
  });

  it("the clinic's link brand follows its package", async () => {
    assert.equal(await clinicLinkBrand(t.db, "forms-only"), "clinforms");
    assert.equal(await clinicLinkBrand(t.db, "desk-physio"), "clinic");
    assert.equal(await clinicLinkBrand(t.db, "no-such-clinic"), "clinforms");
    assert.match(clinicB.inviteLink, /^https:\/\/clindesk\.co\.uk\/accept-invite\?token=/);
    assert.match(clinicA.inviteLink, /^https:\/\/clinforms\.co\.uk\/accept-invite\?token=/);
  });

  let deskOtp: ReturnType<typeof parseOtpAuthUri>;
  let formsOtp: ReturnType<typeof parseOtpAuthUri>;
  let deskOwner: HostClient;
  let formsOwner: HostClient;

  it("two-step set-up on each host: the authenticator entry is that host's brand (a client-sent issuer is ignored)", async () => {
    deskOwner = client(CLINDESK);
    deskOtp = await onboard(deskOwner, clinicB.invitationId, "owner@desk-physio.example");
    assert.equal(deskOtp.issuer, BRANDS.clinic.productName);
    formsOwner = client(CLINFORMS);
    formsOtp = await onboard(formsOwner, clinicA.invitationId, "owner@forms-only.example");
    assert.equal(formsOtp.issuer, "ClinForms");
    const notices = sent.filter((m) => m.kind === "two_factor_enabled");
    assert.equal(notices.length, 2);
    assert.equal(notices[0].brand, "clinic");
    assert.equal("brand" in notices[1], false);
  });

  it("sign-in on each host works; cookies are secure and host-only; a session is the host's own", async () => {
    for (const [origin, email, otp] of [
      [CLINDESK, "owner@desk-physio.example", () => deskOtp],
      [CLINFORMS, "owner@forms-only.example", () => formsOtp],
    ] as const) {
      ip++;
      const c = client(origin);
      const res = await signIn(c, email, otp());
      assert.equal(res.status, 200, origin);
      const lines = setCookieLines(res);
      assert.ok(lines.length > 0);
      for (const line of lines) {
        assert.doesNotMatch(line, /;\s*domain\s*=/i, line);
        assert.match(line, /^__Secure-clinforms\./, line);
        assert.match(line, /;\s*Secure/i, line);
      }
      assert.ok(c.jar.has("session_token"));
      // The same jar on the other host: the browser would not send these cookies there (host-only) – and the
      // server, given no cookie, sees no session.
      const other = origin === CLINDESK ? CLINFORMS : CLINDESK;
      const none = await auth.handler(new Request(`${other}/api/auth/get-session`, { headers: { host: new URL(other).host } }));
      assert.equal(await none.json(), null);
    }
  });

  it("origin/CSRF check: each host's own origin passes, a foreign origin is refused on both, a cross-brand origin too", async () => {
    for (const [host, origin, ok] of [
      ["clindesk.co.uk", CLINDESK, true],
      ["clinforms.co.uk", CLINFORMS, true],
      ["clindesk.co.uk", "https://evil.example", false],
      ["clinforms.co.uk", "https://evil.example", false],
      ["clindesk.co.uk", "http://clindesk.co.uk", false],
    ] as const) {
      ip++;
      const c = client(origin, host);
      const res = await call(c, "/sign-in/email", { email: "owner@desk-physio.example", password: PASSWORD });
      if (ok) assert.equal(res.status, 200, `${origin} on ${host}`);
      else assert.equal(res.status, 403, `${origin} on ${host}`);
    }
  });

  it("invitations link to the inviting clinic's brand host, whichever host the inviter is on", async () => {
    sent.length = 0;
    ip++;
    // Desk Physio's owner invites from clinforms.co.uk (signed in there): the link still goes to clindesk.co.uk.
    const onForms = client(CLINFORMS);
    assert.equal((await signIn(onForms, "owner@desk-physio.example", deskOtp)).status, 200);
    const inv = await call(onForms, "/organization/invite-member", { email: "clin@desk-physio.example", role: "clinician", organizationId: clinicB.organizationId });
    assert.equal(inv.status, 200);
    // Forms Only's owner invites from clindesk.co.uk: the link goes to clinforms.co.uk, the email is ClinForms'.
    ip++;
    const onDesk = client(CLINDESK);
    assert.equal((await signIn(onDesk, "owner@forms-only.example", formsOtp)).status, 200);
    assert.equal((await call(onDesk, "/organization/invite-member", { email: "clin@forms-only.example", role: "clinician", organizationId: clinicA.organizationId })).status, 200);
    const [desk, forms] = sent.filter((m) => m.kind === "invitation");
    assert.match(desk.link ?? "", /^https:\/\/clindesk\.co\.uk\/accept-invite\?token=/);
    assert.equal(desk.brand, "clinic");
    assert.match(desk.subject, new RegExp(`on ${BRANDS.clinic.productName}$`));
    assert.match(forms.link ?? "", /^https:\/\/clinforms\.co\.uk\/accept-invite\?token=/);
    assert.equal("brand" in forms, false);
    assert.equal(forms.subject, "Join Forms Only Physio (fictional) on ClinForms");
  });

  it("reset links: the person's clinic brand; both brands → the host asked on (if ours); single use across hosts", async () => {
    sent.length = 0;
    const deskUser = await t.db.selectFrom("user").select("id").where("email", "=", "owner@desk-physio.example").executeTakeFirstOrThrow();
    const formsUser = await t.db.selectFrom("user").select("id").where("email", "=", "owner@forms-only.example").executeTakeFirstOrThrow();
    assert.equal(await userLinkBrand(t.db, deskUser.id, "clinforms"), "clinic");
    assert.equal(await userLinkBrand(t.db, formsUser.id, "clinic"), "clinforms");
    // Desk Physio's owner joins Forms Only too: both brands.
    await t.db
      .insertInto("member")
      .values({ id: "m-both-brands", organizationId: clinicA.organizationId, userId: deskUser.id, role: "admin", createdAt: new Date().toISOString() })
      .execute();
    assert.equal(await userLinkBrand(t.db, deskUser.id, "clinforms"), "clinforms");
    assert.equal(await userLinkBrand(t.db, deskUser.id, "clinic"), "clinic");
    assert.equal(await userLinkBrand(t.db, deskUser.id, null), "clinforms");

    const reset = (email: string, host: string) => asAction(new Headers({ host }), (headers) => auth.api.requestPasswordReset({ body: { email }, headers }));
    await reset("owner@forms-only.example", "clindesk.co.uk");
    await reset("owner@desk-physio.example", "clindesk.co.uk");
    await reset("owner@desk-physio.example", "evil.example");
    await withLinkBrand("clinic", () => reset("owner@forms-only.example", "clinforms.co.uk"));
    const links = sent.filter((m) => m.kind === "password_reset").map((m) => [m.link ?? "", m.brand ?? "clinforms"]);
    assert.equal(links.length, 4);
    assert.match(links[0][0], /^https:\/\/clinforms\.co\.uk\/reset-password\?token=/);
    assert.equal(links[0][1], "clinforms");
    assert.match(links[1][0], /^https:\/\/clindesk\.co\.uk\/reset-password\?token=/);
    assert.equal(links[1][1], "clinic");
    assert.match(links[2][0], /^https:\/\/clinforms\.co\.uk\//, "a forged host never picks the brand");
    assert.match(links[3][0], /^https:\/\/clindesk\.co\.uk\//, "an explicit brand (platform / named clinic)");

    // The token works once – on either host – and not again on the other.
    const token = new URL(links[1][0]).searchParams.get("token") as string;
    ip++;
    const used = await call(client(CLINDESK), "/reset-password", { token, newPassword: "a brand new password 1" });
    assert.equal(used.status, 200);
    const again = await call(client(CLINFORMS), "/reset-password", { token, newPassword: "a brand new password 2" });
    assert.equal(again.status, 400);
  });

  it("an invitation link works on either host, once", async () => {
    const inv = await t.db.selectFrom("invitation").select("id").where("email", "=", "clin@desk-physio.example").where("status", "=", "pending").executeTakeFirstOrThrow();
    const c = client(CLINFORMS);
    const signUp = await auth.api.signUpEmail({ body: { email: "clin@desk-physio.example", password: PASSWORD, name: "Clin" }, returnHeaders: true });
    c.jar.absorb(signUp.headers);
    ip++;
    assert.equal((await call(c, "/organization/accept-invitation", { invitationId: inv.id })).status, 200);
    ip++;
    const twice = await call(client(CLINDESK), "/organization/accept-invitation", { invitationId: inv.id });
    assert.notEqual(twice.status, 200);
  });

  it("the sign-in rate limit is per address of the client, shared by both hosts (no double budget)", async () => {
    const shared = "203.0.113.77";
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const c = client(i % 2 ? CLINDESK : CLINFORMS);
      const res = await call(c, "/sign-in/email", { email: "nobody@desk-physio.example", password: "wrong password here" }, { "x-forwarded-for": shared });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses.slice(0, 5).every((s) => s === 401), true, statuses.join(","));
    assert.equal(statuses[5], 429, statuses.join(","));
  });
});

describe("brand hosts – regression: production without CLINFORMS_AUTH_ORIGINS", () => {
  let t: TestDb;
  let auth: Auth;
  const sent: EmailMessage[] = [];

  before(async () => {
    t = createSqliteTestDb();
    auth = createAuth({ db: t.db, dialect: "sqlite", secret: SECRET, baseUrl: baseUrlSetting(PROD_ENV), rateLimit: false });
    setEmailProviderForTests({
      name: "none",
      async send(message) {
        sent.push(message);
        return { status: "not_sent", provider: "none" };
      },
    });
  });
  after(async () => {
    setEmailProviderForTests(null);
    await t?.close();
  });

  it("a clinic with the clinic package still gets clinforms.co.uk links and ClinForms emails; the clinic brand's origin is refused", async () => {
    const c = await createClinic(t.db, { name: "Desk Physio (fictional)", slug: "desk-physio", ownerEmail: "owner@desk-physio.example", appOrigin: CLINFORMS, linkSecret: SECRET, sendEmail: false });
    await setEntitlement({ db: t.db }, "desk-physio", "clinic", { status: "active" }, { userId: null, sessionId: null });
    const jar = new CookieJar();
    jar.absorb((await auth.api.signUpEmail({ body: { email: "owner@desk-physio.example", password: PASSWORD, name: "Owner" }, returnHeaders: true })).headers);
    await auth.api.acceptInvitation({ body: { invitationId: c.invitationId }, headers: jar.headers() });
    const enabled = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: jar.headers({ host: "clindesk.co.uk" }) });
    assert.equal(parseOtpAuthUri((enabled as { totpURI: string }).totpURI).issuer, "ClinForms");
    await auth.api.requestPasswordReset({ body: { email: "owner@desk-physio.example" }, headers: new Headers({ host: "clindesk.co.uk" }) });
    const reset = sent.find((m) => m.kind === "password_reset");
    assert.match(reset?.link ?? "", /^https:\/\/clinforms\.co\.uk\/reset-password\?token=/);
    assert.equal(reset?.subject, "Reset your ClinForms password");
    assert.equal(reset && "brand" in reset, false);
    const refused = await auth.handler(
      new Request(`${CLINDESK}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { host: "clindesk.co.uk", origin: CLINDESK, "content-type": "application/json", cookie: jar.header() },
        body: JSON.stringify({ email: "owner@desk-physio.example", password: PASSWORD }),
      }),
    );
    assert.equal(refused.status, 403);
  });
});
