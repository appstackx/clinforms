/**
 * A platform administrator (CLINFORMS_PLATFORM_ADMINS → /app/platform) is recognised by the account's email
 * address, so the account behind that address must only ever come from a platform invitation. While email is
 * off, a clinic administrator is shown the invitation links they create; without these rules they could invite a
 * platform administrator's address, open the link themselves and own an account that passes the platform gate.
 *
 *   - clinics cannot invite a platform administrator's address while no account exists for it;
 *   - an account for that address can only be created while every open invitation for it is a platform one;
 *   - once the real account exists, clinics may invite it like anyone else (joining needs that account).
 *
 * Runs on node:sqlite and PGlite with the full Better Auth stack.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createPgliteTestDb, createSqliteTestDb, type TestDb } from "../db/testing/databases";
import { setEmailProviderForTests } from "../email";
import { platformAdminFromSession, type PlatformSessionLike } from "../admin/platform-console";
import { PLATFORM_USER_ID, createAuth, type Auth, type AuthDialect } from "./create-auth";
import { createClinic } from "./platform";
import { CookieJar } from "./testing/cookie-jar";
import { parseOtpAuthUri, totp } from "./testing/totp";

const ORIGIN = "http://localhost:3000";
const SECRET = "platform-identity-secret-".padEnd(48, "p");
const PASSWORD = "correct horse battery staple";
const PLATFORM_ADMIN = "boss@platform.example";
const isPlatformAdminEmail = (email: string) => email.trim().toLowerCase() === PLATFORM_ADMIN;

async function apiError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const e = err as { body?: { code?: unknown } };
    return String(e.body?.code ?? (err as Error).message);
  }
  throw new Error("expected the call to fail, it succeeded");
}

function defineSuite(name: string, dialect: AuthDialect, setup: () => Promise<TestDb>): void {
  describe(`platform administrator addresses – ${name}`, () => {
    let t: TestDb;
    let auth: Auth;
    let ownerJar: CookieJar;

    async function signUp(email: string, invitationId: string): Promise<CookieJar> {
      const jar = new CookieJar();
      jar.absorb((await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: email.split("@")[0] }, returnHeaders: true })).headers);
      jar.absorb((await auth.api.acceptInvitation({ body: { invitationId }, headers: jar.headers(), returnHeaders: true })).headers);
      return jar;
    }

    async function turnOnTwoFactor(jar: CookieJar): Promise<void> {
      const enabled = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: jar.headers() });
      const otp = parseOtpAuthUri(String((enabled as { totpURI?: string }).totpURI));
      jar.absorb((await auth.api.verifyTOTP({ body: { code: totp(otp) }, headers: jar.headers(), returnHeaders: true })).headers);
    }

    before(async () => {
      t = await setup();
      auth = createAuth({ db: t.db, dialect, secret: SECRET, baseUrl: { kind: "static", url: ORIGIN }, rateLimit: false, isPlatformAdminEmail });
      setEmailProviderForTests({ name: "none", send: async () => ({ status: "not_sent", provider: "none" }) });
      const clinic = await createClinic(t.db, { name: "Ward Clinic (fictional)", slug: "ward-clinic", ownerEmail: "owner@ward.example", appOrigin: ORIGIN, linkSecret: SECRET });
      ownerJar = await signUp("owner@ward.example", clinic.invitationId);
      await turnOnTwoFactor(ownerJar);
    });
    after(async () => {
      setEmailProviderForTests(null);
      await t?.close();
    });

    it("a clinic cannot invite a platform administrator's address while it has no account (other addresses: fine)", async () => {
      assert.equal(await apiError(auth.api.createInvitation({ body: { email: PLATFORM_ADMIN, role: "admin" }, headers: ownerJar.headers() })), "PLATFORM_ADMIN_ADDRESS");
      assert.equal(await apiError(auth.api.createInvitation({ body: { email: "BOSS@Platform.example", role: "staff" }, headers: ownerJar.headers() })), "PLATFORM_ADMIN_ADDRESS");
      const ok = await auth.api.createInvitation({ body: { email: "colleague@ward.example", role: "staff" }, headers: ownerJar.headers() });
      assert.ok(ok.id);
    });

    it("no account for the address from a clinic's invitation – even next to a platform one – only from platform invitations", async () => {
      // An invitation from the clinic made before the address was listed (written directly: the API refuses it now).
      const ward = await t.db.selectFrom("organization").select("id").where("slug", "=", "ward-clinic").executeTakeFirstOrThrow();
      const owner = await t.db.selectFrom("user").select("id").where("email", "=", "owner@ward.example").executeTakeFirstOrThrow();
      const at = new Date().toISOString();
      const expires = new Date(Date.now() + 86_400_000).toISOString();
      await t.db
        .insertInto("invitation")
        .values({ id: "clinicInvitationForBoss0000000001", organizationId: ward.id, email: PLATFORM_ADMIN, role: "admin", status: "pending", expiresAt: expires, createdAt: at, inviterId: owner.id })
        .execute();
      const refused = await apiError(auth.api.signUpEmail({ body: { email: PLATFORM_ADMIN, password: PASSWORD, name: "Boss" } }));
      assert.equal(refused, "PLATFORM_INVITATION_REQUIRED");
      // The platform invites the address too: still refused while the clinic's invitation is open.
      const home = await createClinic(t.db, { name: "Platform Home (fictional)", slug: "platform-home", ownerEmail: PLATFORM_ADMIN, appOrigin: ORIGIN, linkSecret: SECRET });
      assert.equal(await apiError(auth.api.signUpEmail({ body: { email: PLATFORM_ADMIN, password: PASSWORD, name: "Boss" } })), "PLATFORM_INVITATION_REQUIRED");
      assert.equal(await t.db.selectFrom("user").select("id").where("email", "=", PLATFORM_ADMIN).executeTakeFirst(), undefined);
      // Once only platform invitations are open, the account can be created from the platform's link.
      await t.db.updateTable("invitation").set({ status: "canceled" }).where("id", "=", "clinicInvitationForBoss0000000001").execute();
      const bossJar = await signUp(PLATFORM_ADMIN, home.invitationId);
      const inviter = await t.db.selectFrom("invitation").select(["inviterId", "status"]).where("id", "=", home.invitationId).executeTakeFirstOrThrow();
      assert.deepEqual(inviter, { inviterId: PLATFORM_USER_ID, status: "accepted" });

      // The platform gate: not before two-step verification is on, then yes.
      const before2fa = await auth.api.getSession({ headers: bossJar.headers(), query: { disableCookieCache: true } });
      assert.equal(platformAdminFromSession(before2fa as unknown as PlatformSessionLike, isPlatformAdminEmail), null);
      await turnOnTwoFactor(bossJar);
      const after2fa = await auth.api.getSession({ headers: bossJar.headers(), query: { disableCookieCache: true } });
      assert.equal(platformAdminFromSession(after2fa as unknown as PlatformSessionLike, isPlatformAdminEmail)?.email, PLATFORM_ADMIN);
      // The owner of another clinic is not a platform administrator.
      const ownerSession = await auth.api.getSession({ headers: ownerJar.headers(), query: { disableCookieCache: true } });
      assert.equal(platformAdminFromSession(ownerSession as unknown as PlatformSessionLike, isPlatformAdminEmail), null);
    });

    it("once the account exists, a clinic may invite it (joining needs that account)", async () => {
      const inv = await auth.api.createInvitation({ body: { email: PLATFORM_ADMIN, role: "staff" }, headers: ownerJar.headers() });
      assert.ok(inv.id);
      // And a second account for the address can never be made.
      assert.notEqual(await apiError(auth.api.signUpEmail({ body: { email: PLATFORM_ADMIN, password: PASSWORD, name: "Boss again" } })), "");
      const accounts = await t.db.selectFrom("user").select("id").where("email", "=", PLATFORM_ADMIN).execute();
      assert.equal(accounts.length, 1);
    });
  });
}

defineSuite("node:sqlite", "sqlite", async () => createSqliteTestDb());
defineSuite("PGlite (Postgres)", "postgres", async () => createPgliteTestDb());
