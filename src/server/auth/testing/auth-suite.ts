/**
 * TESTS ONLY: the identity flows, run unchanged against every database the app can use – node:sqlite and
 * PGlite (src/server/auth/auth.test.ts), D1 through the in-process gateway Worker and real local D1
 * (workers/data-gateway/test/auth-stack.test.ts).
 *
 * invite → accept (account + membership) → two-step setup with a TOTP computed here → sign out → sign in →
 * second factor (TOTP, backup code) → roles and permissions → tenant slug rules → password reset →
 * session expiry → audit trail → the module's AuthContext → offboarding.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { Kysely } from "kysely";
import type { DataCipher } from "../../crypto/envelope";
import { testCipher } from "../../db/testing/databases";
import { authBool, type Database } from "../../db/schema";
import { setEmailProviderForTests, type EmailMessage } from "../../email";
import { appendAudit, listAudit } from "../../repos/audit";
import { getClinicProfile } from "../../repos/clinic-profile";
import { createReport } from "../../repos/reports";
import { getMemberProfile, upsertMemberProfile } from "../../repos/member-profile";
import { createPartnerKey } from "../../repos/partner-keys";
import { createAuth, type Auth, type AuthDialect } from "../create-auth";
import { buildAuthContext, loadClinicProfile } from "../medreport-actor";
import { findInvitationForLink, findMembership, findOpenInvitation, listClinicMembers, listPendingInvitations } from "../membership";
import { createClinic, listClinics, offboardClinic, resetTwoFactor } from "../platform";
import { TenantSlugError } from "../tenant";
import { CookieJar } from "./cookie-jar";
import { parseOtpAuthUri, totp, wrongTotp, type OtpAuth } from "./totp";

export interface AuthTestDb {
  db: Kysely<Database>;
  dialect: AuthDialect;
  close: () => Promise<void>;
  /** Force Better Auth's start-up schema check on (the D1 test databases can be introspected; real D1 cannot). */
  validateSchema?: boolean;
}

const ORIGIN = "http://localhost:3000";
const SECRET = "auth-suite-secret-".padEnd(48, "s");
const PASSWORD = "correct horse battery staple";

type ApiErrorLike = { status?: unknown; statusCode?: unknown; body?: { code?: unknown; message?: unknown } };

async function apiError(promise: Promise<unknown>): Promise<{ code: string; status: number | string }> {
  try {
    await promise;
  } catch (err) {
    const e = err as ApiErrorLike;
    return { code: String(e.body?.code ?? (err as Error).message), status: (e.statusCode ?? e.status) as number | string };
  }
  throw new Error("expected the call to fail, it succeeded");
}

function totpSetup(result: { method: string; totpURI?: string; backupCodes?: string[] }): { totpURI: string; backupCodes: string[] } {
  assert.equal(result.method, "totp");
  assert.ok(result.totpURI && result.backupCodes);
  return { totpURI: result.totpURI, backupCodes: result.backupCodes };
}

export function defineAuthSuite(name: string, setup: () => Promise<AuthTestDb>, options: { skip?: string | false } = {}): void {
  describe(`identity flows – ${name}`, { skip: options.skip }, () => {
    let t: AuthTestDb;
    let auth: Auth;
    let cipher: DataCipher;
    const sent: EmailMessage[] = [];
    let ownerJar: CookieJar;
    let ownerOtp: OtpAuth;
    let ownerBackupCodes: string[] = [];
    let clinic: Awaited<ReturnType<typeof createClinic>>;
    let clinicianJar: CookieJar;

    async function signUpAndAccept(invitationId: string, email: string, name: string): Promise<CookieJar> {
      const jar = new CookieJar();
      const res = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name }, returnHeaders: true });
      jar.absorb(res.headers);
      const accepted = await auth.api.acceptInvitation({ body: { invitationId }, headers: jar.headers(), returnHeaders: true });
      jar.absorb(accepted.headers);
      const fresh = await auth.api.getSession({ headers: jar.headers(), query: { disableCookieCache: true }, returnHeaders: true });
      jar.absorb(fresh.headers);
      return jar;
    }

    async function enableTwoFactor(jar: CookieJar): Promise<{ otp: OtpAuth; backupCodes: string[] }> {
      const enabled = totpSetup(await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: jar.headers() }));
      const otp = parseOtpAuthUri(enabled.totpURI);
      const verified = await auth.api.verifyTOTP({ body: { code: totp(otp) }, headers: jar.headers(), returnHeaders: true });
      jar.absorb(verified.headers);
      return { otp, backupCodes: enabled.backupCodes };
    }

    async function signIn(email: string, otp: OtpAuth): Promise<CookieJar> {
      const jar = new CookieJar();
      const res = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
      jar.absorb(res.headers);
      assert.equal((res.response as { twoFactorRedirect?: boolean }).twoFactorRedirect, true);
      const verified = await auth.api.verifyTOTP({ body: { code: totp(otp) }, headers: jar.headers(), returnHeaders: true });
      jar.absorb(verified.headers);
      return jar;
    }

    async function onboard(email: string, name: string, role: "admin" | "clinician" | "staff"): Promise<{ jar: CookieJar; otp: OtpAuth; memberId: string }> {
      const inv = await auth.api.createInvitation({ body: { email, role }, headers: ownerJar.headers() });
      const jar = await signUpAndAccept(inv.id, email, name);
      const { otp } = await enableTwoFactor(jar);
      const user = await t.db.selectFrom("user").select("id").where("email", "=", email).executeTakeFirstOrThrow();
      const m = await findMembership(t.db, clinic.organizationId, user.id);
      assert.ok(m);
      return { jar, otp, memberId: m.memberId };
    }

    before(async () => {
      t = await setup();
      cipher = testCipher();
      auth = createAuth({
        db: t.db,
        dialect: t.dialect,
        secret: SECRET,
        baseUrl: { kind: "static", url: ORIGIN },
        rateLimit: false,
        validateSchema: t.validateSchema,
      });
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

    it("tenant slug rules: format, length, reserved 'demo'", async () => {
      await assert.rejects(createClinic(t.db, { name: "X", slug: "demo", ownerEmail: "a@b.example", appOrigin: ORIGIN, linkSecret: SECRET }), TenantSlugError);
      await assert.rejects(createClinic(t.db, { name: "X", slug: "Bad Slug", ownerEmail: "a@b.example", appOrigin: ORIGIN, linkSecret: SECRET }), TenantSlugError);
      await assert.rejects(createClinic(t.db, { name: "X", slug: "-lead", ownerEmail: "a@b.example", appOrigin: ORIGIN, linkSecret: SECRET }), TenantSlugError);
      await assert.rejects(createClinic(t.db, { name: "X", slug: "ab", ownerEmail: "a@b.example", appOrigin: ORIGIN, linkSecret: SECRET }), TenantSlugError);
      // an id with an earlier clinic's audit trail is never handed to a new clinic
      await appendAudit({ db: t.db }, "used-before", { action: "clinic.offboard" });
      await assert.rejects(
        createClinic(t.db, { name: "X", slug: "used-before", ownerEmail: "a@b.example", appOrigin: ORIGIN, linkSecret: SECRET }),
        /used by an earlier clinic/,
      );
      // a link secret that is too short changes nothing
      await assert.rejects(createClinic(t.db, { name: "X", slug: "short-secret", ownerEmail: "a@b.example", appOrigin: ORIGIN, linkSecret: "short" }));
      assert.equal(await t.db.selectFrom("organization").select("id").where("slug", "=", "short-secret").executeTakeFirst(), undefined);
    });

    it("the platform creates a clinic: organization + clinic profile + owner invitation (link printed, email attempted)", async () => {
      clinic = await createClinic(t.db, {
        name: "Riverside Physiotherapy (fictional)",
        slug: "riverside-test",
        ownerEmail: "Owner@Riverside.example",
        retentionDays: 400,
        appOrigin: ORIGIN,
        linkSecret: SECRET,
      });
      assert.equal(clinic.tenantId, "riverside-test");
      // The link carries `<invitation id>.<MAC>`: the id alone is not a link secret.
      const linkToken = new URL(clinic.inviteLink).searchParams.get("token") ?? "";
      assert.equal(clinic.inviteLink, `${ORIGIN}/accept-invite?token=${linkToken}`);
      assert.match(linkToken, new RegExp(`^${clinic.invitationId}\\.[A-Za-z0-9_-]{43}$`));
      assert.equal((await findInvitationForLink(t.db, SECRET, linkToken))?.id, clinic.invitationId);
      assert.equal(await findInvitationForLink(t.db, SECRET, clinic.invitationId), null, "the bare id is not a link");
      assert.equal(await findInvitationForLink(t.db, "another-secret-".padEnd(48, "z"), linkToken), null, "signed for another app");
      const tampered = `${linkToken.slice(0, -1)}${linkToken.endsWith("A") ? "B" : "A"}`;
      assert.equal(await findInvitationForLink(t.db, SECRET, tampered), null, "a changed MAC is refused");
      const profile = await getClinicProfile({ db: t.db }, "riverside-test");
      assert.equal(profile?.organizationId, clinic.organizationId);
      assert.equal(profile?.retentionDays, 400);
      const invitation = await findOpenInvitation(t.db, clinic.invitationId);
      assert.equal(invitation?.email, "owner@riverside.example");
      assert.equal(invitation?.role, "owner");
      assert.equal(invitation?.accountExists, false);
      assert.equal(sent.at(-1)?.kind, "invitation");
      assert.equal(sent.at(-1)?.link, clinic.inviteLink);
      await assert.rejects(
        createClinic(t.db, { name: "Again", slug: "riverside-test", ownerEmail: "x@y.example", appOrigin: ORIGIN, linkSecret: SECRET }),
        /already exists/,
      );
      const audit = await listAudit({ db: t.db }, "riverside-test");
      assert.equal(audit[0].action, "clinic.create");
      assert.ok(!JSON.stringify(audit).includes(clinic.invitationId), "the invitation link token is never written to the audit trail");
    });

    it("invite-only: no account without an open invitation; short passwords refused", async () => {
      const refused = await apiError(auth.api.signUpEmail({ body: { email: "stranger@elsewhere.example", password: PASSWORD, name: "S" } }));
      assert.equal(refused.code, "INVITATION_REQUIRED");
      const short = await apiError(auth.api.signUpEmail({ body: { email: "owner@riverside.example", password: "short-pass", name: "O" } }));
      assert.equal(short.code, "PASSWORD_TOO_SHORT");
      // the public sign-up endpoint is switched off entirely
      const res = await auth.handler(
        new Request(`${ORIGIN}/api/auth/sign-up/email`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN },
          body: JSON.stringify({ email: "owner@riverside.example", password: PASSWORD, name: "O" }),
        }),
      );
      assert.equal(res.status, 404);
    });

    it("the owner accepts: account + owner membership, active clinic set, no two-step yet", async () => {
      ownerJar = await signUpAndAccept(clinic.invitationId, "owner@riverside.example", "Olivia Owner");
      // The session was created at sign-up (before the membership): read past the 5-minute cookie cache, as the
      // app does right after accepting.
      const session = await auth.api.getSession({ headers: ownerJar.headers(), query: { disableCookieCache: true } });
      assert.ok(session);
      assert.equal((session.session as { activeOrganizationId?: string }).activeOrganizationId, clinic.organizationId);
      assert.notEqual(session.user.twoFactorEnabled, true);
      const m = await findMembership(t.db, clinic.organizationId, session.user.id);
      assert.equal(m?.role, "owner");
      assert.equal(m?.tenantId, "riverside-test");
      assert.equal(await findOpenInvitation(t.db, clinic.invitationId), null, "the invitation works once");
      const ctx = await buildAuthContext(auth, t.db, ownerJar.headers());
      assert.equal(ctx?.twoFactorVerified, false);
    });

    it("clinic management is refused until two-step verification is on", async () => {
      const e = await apiError(auth.api.createInvitation({ body: { email: "early@riverside.example", role: "staff" }, headers: ownerJar.headers() }));
      assert.equal(e.code, "TWO_FACTOR_REQUIRED");
    });

    it("two-step setup: a wrong code is refused; the right TOTP turns it on, replaces the session and sends a notice", async () => {
      const enabled = totpSetup(await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: ownerJar.headers() }));
      ownerOtp = parseOtpAuthUri(enabled.totpURI);
      ownerBackupCodes = enabled.backupCodes;
      assert.equal(ownerOtp.issuer, "ClinForms");
      assert.equal(ownerOtp.account, "owner@riverside.example");
      assert.equal(ownerBackupCodes.length, 10);
      const wrong = await apiError(auth.api.verifyTOTP({ body: { code: wrongTotp(ownerOtp) }, headers: ownerJar.headers() }));
      assert.equal(wrong.code, "INVALID_CODE");
      const oldHeaders = ownerJar.headers();
      const verified = await auth.api.verifyTOTP({ body: { code: totp(ownerOtp) }, headers: ownerJar.headers(), returnHeaders: true });
      ownerJar.absorb(verified.headers);
      const session = await auth.api.getSession({ headers: ownerJar.headers(), query: { disableCookieCache: true } });
      assert.equal(session?.user.twoFactorEnabled, true);
      assert.equal((session?.session as { activeOrganizationId?: string }).activeOrganizationId, clinic.organizationId);
      // the pre-two-step session is gone (only the cookie cache could still vouch for it, for ≤ 5 minutes)
      assert.equal(await auth.api.getSession({ headers: oldHeaders, query: { disableCookieCache: true } }), null);
      assert.equal(sent.at(-1)?.kind, "two_factor_enabled");
      const actions = (await listAudit({ db: t.db }, "riverside-test")).map((a) => a.action);
      assert.ok(actions.includes("auth.two_factor_enable"));
      assert.ok(actions.includes("member.join"));
      const ctx = await buildAuthContext(auth, t.db, ownerJar.headers());
      assert.equal(ctx?.twoFactorVerified, true);
      assert.equal(ctx?.role, "owner");
      assert.equal(ctx?.tenantId, "riverside-test");
    });

    it("two-step verification cannot be switched off and devices cannot be trusted", async () => {
      const res = await auth.handler(
        new Request(`${ORIGIN}/api/auth/two-factor/disable`, {
          method: "POST",
          headers: ownerJar.headers({ "content-type": "application/json", origin: ORIGIN }),
          body: JSON.stringify({ password: PASSWORD }),
        }),
      );
      assert.equal(res.status, 404);
      const jar = new CookieJar();
      jar.absorb((await auth.api.signInEmail({ body: { email: "owner@riverside.example", password: PASSWORD }, returnHeaders: true })).headers);
      const trusted = await apiError(auth.api.verifyTOTP({ body: { code: totp(ownerOtp), trustDevice: true }, headers: jar.headers() }));
      assert.equal(trusted.code, "TRUST_DEVICE_DISABLED");
    });

    it("sign out, then sign in: password → second factor (wrong code refused) → session with the clinic active", async () => {
      await auth.api.signOut({ headers: ownerJar.headers() });
      assert.equal(await auth.api.getSession({ headers: ownerJar.headers(), query: { disableCookieCache: true } }), null);
      const jar = new CookieJar();
      const bad = await apiError(auth.api.signInEmail({ body: { email: "owner@riverside.example", password: "wrong password here" } }));
      assert.equal(bad.code, "INVALID_EMAIL_OR_PASSWORD");
      const res = await auth.api.signInEmail({ body: { email: "owner@riverside.example", password: PASSWORD }, returnHeaders: true });
      jar.absorb(res.headers);
      assert.equal((res.response as { twoFactorRedirect?: boolean }).twoFactorRedirect, true);
      assert.ok(jar.has("two_factor"), "challenge cookie set");
      assert.equal(await auth.api.getSession({ headers: jar.headers() }), null, "no session before the second factor");
      const wrong = await apiError(auth.api.verifyTOTP({ body: { code: wrongTotp(ownerOtp) }, headers: jar.headers() }));
      assert.equal(wrong.code, "INVALID_CODE");
      const ok = await auth.api.verifyTOTP({ body: { code: totp(ownerOtp) }, headers: jar.headers(), returnHeaders: true });
      jar.absorb(ok.headers);
      const session = await auth.api.getSession({ headers: jar.headers() });
      assert.equal(session?.user.email, "owner@riverside.example");
      assert.equal((session?.session as { activeOrganizationId?: string }).activeOrganizationId, clinic.organizationId);
      ownerJar = jar;
      const signIns = (await listAudit({ db: t.db }, "riverside-test")).filter((a) => a.action === "auth.sign_in");
      assert.ok(signIns.length >= 1);
      assert.equal(signIns[0].sessionId, session?.session.id);
    });

    it("a backup code signs in once", async () => {
      const code = ownerBackupCodes[0];
      const jar = new CookieJar();
      jar.absorb((await auth.api.signInEmail({ body: { email: "owner@riverside.example", password: PASSWORD }, returnHeaders: true })).headers);
      const ok = await auth.api.verifyBackupCode({ body: { code }, headers: jar.headers(), returnHeaders: true });
      jar.absorb(ok.headers);
      assert.ok(await auth.api.getSession({ headers: jar.headers() }));
      const again = new CookieJar();
      again.absorb((await auth.api.signInEmail({ body: { email: "owner@riverside.example", password: PASSWORD }, returnHeaders: true })).headers);
      const reused = await apiError(auth.api.verifyBackupCode({ body: { code }, headers: again.headers() }));
      assert.equal(reused.code, "INVALID_BACKUP_CODE");
    });

    it("roles: owner invites a clinician; a clinician cannot invite or change roles; 'member' is not a ClinForms role", async () => {
      const badRole = await apiError(auth.api.createInvitation({ body: { email: "x@riverside.example", role: "member" as "staff" }, headers: ownerJar.headers() }));
      assert.equal(badRole.code, "INVALID_ROLE");
      const clinician = await onboard("clinician@riverside.example", "Sarah Reid (fictional)", "clinician");
      clinicianJar = clinician.jar;
      const invAudit = (await listAudit({ db: t.db }, "riverside-test")).find((a) => a.action === "member.invite");
      assert.equal(invAudit?.detail?.role, "clinician");
      assert.match(String(invAudit?.targetId), /^inv_[A-Za-z0-9_-]{16}$/);
      const forbidden = await apiError(
        auth.api.createInvitation({ body: { email: "y@riverside.example", role: "staff" }, headers: clinician.jar.headers() }),
      );
      assert.equal(forbidden.status, 403);
      const owner = await t.db.selectFrom("member").select("id").where("role", "=", "owner").where("organizationId", "=", clinic.organizationId).executeTakeFirstOrThrow();
      const cannot = await apiError(
        auth.api.updateMemberRole({ body: { memberId: owner.id, role: "staff" }, headers: clinician.jar.headers() }),
      );
      assert.equal(cannot.status, 403);
      const ctx = await buildAuthContext(auth, t.db, clinician.jar.headers());
      assert.equal(ctx?.role, "clinician");
      assert.equal(ctx?.clinician, undefined, "no signer identity until the member profile has one");
      await upsertMemberProfile({ db: t.db }, clinic.organizationId, ctx!.userId, { jobTitle: "Senior Physiotherapist", hcpcNumber: "PH999999", canSign: true });
      const withProfile = await buildAuthContext(auth, t.db, clinician.jar.headers());
      assert.deepEqual(withProfile?.clinician, { name: "Sarah Reid (fictional)", hcpc: "PH999999", jobTitle: "Senior Physiotherapist", canSign: true });
    });

    it("no member reads pending invitations over HTTP; the invitation email carries the signed link", async () => {
      const before = sent.length;
      const pending = await auth.api.createInvitation({ body: { email: "pending-admin@riverside.example", role: "admin" }, headers: ownerJar.headers() });
      const mail = sent.slice(before).find((m) => m.kind === "invitation");
      const token = new URL(mail?.link ?? "http://x/").searchParams.get("token");
      assert.equal((await findInvitationForLink(t.db, SECRET, token))?.id, pending.id);
      assert.notEqual(token, pending.id);
      // Better Auth lists a clinic's invitations (ids included) to ANY member: both endpoints are switched off.
      for (const jar of [clinicianJar, ownerJar]) {
        for (const endpoint of ["organization/list-invitations", "organization/get-full-organization"]) {
          const res = await auth.handler(new Request(`${ORIGIN}/api/auth/${endpoint}?organizationId=${clinic.organizationId}`, { headers: jar.headers({ origin: ORIGIN }) }));
          assert.equal(res.status, 404, endpoint);
          assert.ok(!(await res.text()).includes(pending.id), `${endpoint} leaks no invitation id`);
        }
      }
      // Knowing the id is not enough to take the invitation: the accept flow starts from the link token.
      assert.equal(await findInvitationForLink(t.db, SECRET, pending.id), null);
      await auth.api.cancelInvitation({ body: { invitationId: pending.id }, headers: ownerJar.headers() });
    });

    it("admins manage members but cannot make owners; role changes and removals are audited", async () => {
      const admin = await onboard("admin@riverside.example", "Adam Admin", "admin");
      const ownerInvite = await apiError(
        auth.api.createInvitation({ body: { email: "boss@riverside.example", role: "owner" }, headers: admin.jar.headers() }),
      );
      assert.equal(ownerInvite.status, 403);
      const staffInv = await auth.api.createInvitation({ body: { email: "staff@riverside.example", role: "staff" }, headers: admin.jar.headers() });
      assert.equal(staffInv.role, "staff");
      const pending = await listPendingInvitations(t.db, clinic.organizationId);
      assert.ok(pending.some((p) => p.id === staffInv.id));
      await auth.api.cancelInvitation({ body: { invitationId: staffInv.id }, headers: admin.jar.headers() });
      assert.equal(await findOpenInvitation(t.db, staffInv.id), null);

      const members = await listClinicMembers(t.db, clinic.organizationId);
      const clinician = members.find((m) => m.email === "clinician@riverside.example");
      assert.ok(clinician);
      assert.equal(clinician.canSign, true);
      await auth.api.updateMemberRole({ body: { memberId: clinician.memberId, role: "staff" }, headers: admin.jar.headers() });
      const owner = members.find((m) => m.role === "owner");
      const demote = await apiError(auth.api.updateMemberRole({ body: { memberId: owner!.memberId, role: "admin" }, headers: admin.jar.headers() }));
      assert.equal(demote.status, 403);
      await auth.api.removeMember({ body: { memberIdOrEmail: clinician.memberId }, headers: admin.jar.headers() });
      assert.equal(await getMemberProfile({ db: t.db }, clinic.organizationId, clinician.userId), null, "profile removed with the membership");
      const audit = await listAudit({ db: t.db }, "riverside-test");
      const change = audit.find((a) => a.action === "member.role_change");
      assert.deepEqual(change?.detail, { from: "clinician", to: "staff" });
      assert.equal(change?.userId, (await t.db.selectFrom("user").select("id").where("email", "=", "admin@riverside.example").executeTakeFirstOrThrow()).id);
      assert.ok(audit.some((a) => a.action === "member.remove"));
      assert.ok(audit.some((a) => a.action === "member.invite_cancel"));
      assert.equal(await buildAuthContext(auth, t.db, clinicianJar.headers()), null, "a removed member's session no longer acts for the clinic");
    });

    it("a clinic's id is immutable; its name can change", async () => {
      const slug = await apiError(
        auth.api.updateOrganization({ body: { data: { slug: "renamed-clinic" }, organizationId: clinic.organizationId }, headers: ownerJar.headers() }),
      );
      assert.equal(slug.code, "SLUG_IMMUTABLE");
      await auth.api.updateOrganization({ body: { data: { name: "Riverside Physio (fictional)" }, organizationId: clinic.organizationId }, headers: ownerJar.headers() });
      const org = await t.db.selectFrom("organization").select(["slug", "name"]).where("id", "=", clinic.organizationId).executeTakeFirstOrThrow();
      assert.deepEqual(org, { slug: "riverside-test", name: "Riverside Physio (fictional)" });
    });

    it("password reset by link: old sessions revoked, two-step still required afterwards", async () => {
      const before = sent.length;
      await auth.api.requestPasswordReset({ body: { email: "owner@riverside.example" } });
      const message = sent.slice(before).find((m) => m.kind === "password_reset");
      assert.ok(message?.link?.startsWith(`${ORIGIN}/reset-password?token=`));
      const token = new URL(message!.link!).searchParams.get("token")!;
      const newPassword = "a brand new long password";
      await auth.api.resetPassword({ body: { newPassword, token } });
      assert.equal(await auth.api.getSession({ headers: ownerJar.headers(), query: { disableCookieCache: true } }), null);
      const reused = await apiError(auth.api.resetPassword({ body: { newPassword: "yet another long password", token } }));
      assert.equal(reused.code, "INVALID_TOKEN");
      const jar = new CookieJar();
      const res = await auth.api.signInEmail({ body: { email: "owner@riverside.example", password: newPassword }, returnHeaders: true });
      jar.absorb(res.headers);
      assert.equal((res.response as { twoFactorRedirect?: boolean }).twoFactorRedirect, true);
      jar.absorb((await auth.api.verifyTOTP({ body: { code: totp(ownerOtp) }, headers: jar.headers(), returnHeaders: true })).headers);
      ownerJar = jar;
      assert.ok((await listAudit({ db: t.db }, "riverside-test")).some((a) => a.action === "auth.password_reset"));
      // put the original password back for the rest of the suite
      await auth.api.changePassword({ body: { currentPassword: newPassword, newPassword: PASSWORD }, headers: ownerJar.headers() });
    });

    it("expired sessions are refused (dates read back correctly on this database)", async () => {
      const session = await auth.api.getSession({ headers: ownerJar.headers(), query: { disableCookieCache: true } });
      assert.ok(session);
      await t.db.updateTable("session").set({ expiresAt: new Date(Date.now() - 60_000).toISOString() }).where("id", "=", session.session.id).execute();
      assert.equal(await auth.api.getSession({ headers: ownerJar.headers(), query: { disableCookieCache: true } }), null);
      ownerJar = await signIn("owner@riverside.example", ownerOtp);
    });

    it("a revoked session stops acting for the clinic at once (the seam reads past the cookie cache)", async () => {
      const other = await signIn("owner@riverside.example", ownerOtp);
      assert.equal((await buildAuthContext(auth, t.db, other.headers()))?.tenantId, "riverside-test");
      await auth.api.revokeOtherSessions({ headers: ownerJar.headers() });
      assert.equal(await buildAuthContext(auth, t.db, other.headers()), null);
      assert.equal((await buildAuthContext(auth, t.db, ownerJar.headers()))?.role, "owner");
    });

    it("the HTTP handler works too (schema check, session endpoint)", async () => {
      const res = await auth.handler(new Request(`${ORIGIN}/api/auth/get-session`, { headers: ownerJar.headers() }));
      assert.equal(res.status, 200);
      const body = (await res.json()) as { user?: { email?: string } };
      assert.equal(body.user?.email, "owner@riverside.example");
    });

    it("the module seam: clinic profile for the tenant", async () => {
      const profile = await loadClinicProfile(t.db, "riverside-test");
      assert.equal(profile?.displayName, "Riverside Physiotherapy (fictional)");
      assert.deepEqual(profile?.addressLines, []);
      assert.equal(await loadClinicProfile(t.db, "no-such-clinic"), null);
    });

    it("platform: list clinics, reset a member's two-step verification", async () => {
      const list = await listClinics(t.db);
      const mine = list.find((c) => c.tenantId === "riverside-test");
      assert.equal(mine?.owners, 1);
      assert.equal(mine?.offboardedAt, null);
      const dry = await resetTwoFactor(t.db, "owner@riverside.example");
      assert.equal(dry.dryRun, true);
      assert.equal(dry.hadTwoFactor, true);
      const done = await resetTwoFactor(t.db, "owner@riverside.example", { confirm: true });
      assert.equal(done.dryRun, false);
      assert.equal(await auth.api.getSession({ headers: ownerJar.headers(), query: { disableCookieCache: true } }), null);
      const user = await t.db.selectFrom("user").select("twoFactorEnabled").where("email", "=", "owner@riverside.example").executeTakeFirstOrThrow();
      assert.equal(authBool(user.twoFactorEnabled), false);
      // signs in with the password only now, and must set two-step verification up again
      const jar = new CookieJar();
      const res = await auth.api.signInEmail({ body: { email: "owner@riverside.example", password: PASSWORD }, returnHeaders: true });
      jar.absorb(res.headers);
      assert.notEqual((res.response as { twoFactorRedirect?: boolean }).twoFactorRedirect, true);
      const again = await enableTwoFactor(jar);
      ownerOtp = again.otp;
      ownerJar = jar;
      assert.ok((await listAudit({ db: t.db }, "riverside-test")).some((a) => a.action === "auth.two_factor_reset"));
    });

    it("offboarding: dry run counts only; confirm exports decrypted data, deletes it, removes members and their accounts", async () => {
      await createReport({ db: t.db, cipher }, "riverside-test", { id: "r-1", status: "draft", templateId: "t", payload: { fictional: true } });
      const key = await createPartnerKey({ db: t.db }, "riverside-test", { name: "PMS" });
      await assert.rejects(offboardClinic(t.db, cipher, { slug: "riverside-test", releaseSlug: true }), /audit rows/, "the id keeps its audit trail");
      const dry = await offboardClinic(t.db, cipher, { slug: "riverside-test" });
      assert.equal(dry.dryRun, true);
      assert.equal(dry.counts.reports, 1);
      assert.equal(dry.counts.members, 2);
      assert.ok(await getClinicProfile({ db: t.db }, "riverside-test"));
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clinforms-offboard-"));
      try {
        const done = await offboardClinic(t.db, cipher, { slug: "riverside-test", confirm: true, exportDir: path.join(dir, "export") });
        assert.equal(done.dryRun, false);
        const reports = JSON.parse(fs.readFileSync(path.join(dir, "export", "reports.json"), "utf8"));
        assert.deepEqual(reports[0].payload, { fictional: true });
        const exported = JSON.parse(fs.readFileSync(path.join(dir, "export", "clinic.json"), "utf8"));
        assert.equal(exported.members.length, 2);
        assert.equal((fs.statSync(path.join(dir, "export", "reports.json")).mode & 0o777).toString(8), "600");
        assert.equal(await getClinicProfile({ db: t.db }, "riverside-test"), null);
        assert.equal((await t.db.selectFrom("reports").select("id").where("tenant_id", "=", "riverside-test").execute()).length, 0);
        assert.equal((await t.db.selectFrom("member").select("id").where("organizationId", "=", clinic.organizationId).execute()).length, 0);
        assert.equal(await t.db.selectFrom("user").select("id").where("email", "=", "owner@riverside.example").executeTakeFirst(), undefined);
        const revoked = await t.db.selectFrom("partner_keys").select("revoked_at").where("id", "=", key.id).executeTakeFirstOrThrow();
        assert.ok(revoked.revoked_at);
        assert.equal(await auth.api.getSession({ headers: ownerJar.headers(), query: { disableCookieCache: true } }), null);
        const audit = await listAudit({ db: t.db }, "riverside-test");
        assert.equal(audit[0].action, "clinic.offboard");
        const listed = (await listClinics(t.db)).find((c) => c.tenantId === "riverside-test");
        assert.ok(listed?.offboardedAt, "the organization stays as a tombstone, so the id is never reused");
        await assert.rejects(createClinic(t.db, { name: "New", slug: "riverside-test", ownerEmail: "n@x.example", appOrigin: ORIGIN, linkSecret: SECRET }), /already exists/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}
