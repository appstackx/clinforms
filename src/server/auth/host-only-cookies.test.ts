/**
 * Every cookie the app sets is host-only (no Domain attribute). The privacy policy (section 3, "The demo video") says
 * the video carries no cookies: playback is an anonymous CORS request, but the fallback panel's "download the video"
 * link is an ordinary request to media.clinforms.co.uk, which would carry any cookie scoped to .clinforms.co.uk – for
 * example Better Auth's session cookie with `crossSubDomainCookies`, or a `domain` in its cookie attributes.
 *
 * Checked three ways: the sign-in cookies of a real Better Auth (production settings: secure cookies) carry no Domain;
 * the test cookie jar refuses a Domain cookie, so every identity suite (node:sqlite, PGlite, D1) checks it on every
 * response; and the auth configuration names no cookie domain. The consent cookie is checked in consent.test.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createSqliteTestDb, type TestDb } from "../db/testing/databases";
import { setEmailProviderForTests } from "../email";
import { createAuth, type Auth } from "./create-auth";
import { createClinic } from "./platform";
import { CookieJar } from "./testing/cookie-jar";

const ORIGIN = "https://clinforms.co.uk";
const SECRET = "host-only-cookies-secret-".padEnd(48, "s");
const PASSWORD = "correct horse battery staple";

function setCookieLines(headers: Headers | null | undefined): string[] {
  if (!headers) return [];
  return (headers as Headers & { getSetCookie: () => string[] }).getSetCookie();
}

describe("the app's cookies are host-only", () => {
  let t: TestDb;
  let auth: Auth;
  let invitationId: string;

  before(async () => {
    t = createSqliteTestDb();
    auth = createAuth({ db: t.db, dialect: "sqlite", secret: SECRET, baseUrl: { kind: "static", url: ORIGIN }, rateLimit: false });
    setEmailProviderForTests({ name: "none", send: async () => ({ status: "not_sent", provider: "none" }) });
    const clinic = await createClinic(t.db, {
      name: "Cookie Check Physio (fictional)",
      slug: "cookie-check",
      ownerEmail: "owner@cookie-check.example",
      appOrigin: ORIGIN,
      linkSecret: SECRET,
    });
    invitationId = clinic.invitationId;
  });
  after(async () => {
    setEmailProviderForTests(null);
    await t?.close();
  });

  it("sign-up, joining the clinic and sign-in set secure, host-only cookies", async () => {
    const lines: string[] = [];
    const signUp = await auth.api.signUpEmail({ body: { email: "owner@cookie-check.example", password: PASSWORD, name: "Owen Owner" }, returnHeaders: true });
    lines.push(...setCookieLines(signUp.headers));
    const cookie = setCookieLines(signUp.headers)
      .map((l) => l.split(";")[0])
      .join("; ");
    const accepted = await auth.api.acceptInvitation({ body: { invitationId }, headers: new Headers({ cookie }), returnHeaders: true });
    lines.push(...setCookieLines(accepted.headers));
    const signIn = await auth.api.signInEmail({ body: { email: "owner@cookie-check.example", password: PASSWORD }, returnHeaders: true });
    lines.push(...setCookieLines(signIn.headers));

    assert.ok(lines.length >= 2, `Set-Cookie lines seen: ${lines.length}`);
    for (const line of lines) {
      assert.doesNotMatch(line, /;\s*domain\s*=/i, line);
      // Production settings: the session cookies are Secure and carry the __Secure- prefix.
      assert.match(line, /^__Secure-clinforms\./, line);
      assert.match(line, /;\s*Secure/i, line);
    }
  });

  it("the test cookie jar refuses a cookie with a Domain attribute", () => {
    const jar = new CookieJar();
    jar.absorb(new Headers({ "set-cookie": "clinforms.session_token=abc; Path=/; HttpOnly; SameSite=Lax" }));
    assert.deepEqual(jar.names(), ["clinforms.session_token"]);
    assert.throws(
      () => new CookieJar().absorb(new Headers({ "set-cookie": "clinforms.session_token=abc; Domain=.clinforms.co.uk; Path=/" })),
      /must be host-only/,
    );
  });

  it("the auth configuration names no cookie domain", () => {
    const source = fs
      .readFileSync(path.join(process.cwd(), "src/server/auth/create-auth.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(source, /crossSubDomainCookies/);
    assert.doesNotMatch(source, /\bdomain\s*:/);
    assert.match(source, /defaultCookieAttributes: \{ sameSite: "lax", httpOnly: true \}/);
  });
});
