/**
 * Self-serve sign-up (tracker l01, docs/auth.md §1b) – the switch, the input rules, the bot checks and the whole flow
 * with real Better Auth on node:sqlite and PGlite: start → the one-time link by email (brand-correct) → confirm with
 * the password → createClinic() for the brand → the owner's account and membership → acceptance recorded and audited.
 * Never reveals whether an address has an account. Run by `npm run test:auth` (and `test:db`).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { sql } from "kysely";
import { BANNED_TERM_PATTERNS } from "../../modules/medreport/core/wording";
import { DPA, DPA_VERSION, dpaIsDraft, fillDpa } from "../../lib/legal/dpa";
import {
  SIGNUP_LIMITS,
  clinicNameProblem,
  isDisposableEmail,
  normaliseSignupEmail,
  ownerNameProblem,
  selfSignupBrands,
  selfSignupEnabled,
  slugBaseFromClinicName,
  termsVersion,
} from "../../lib/self-signup";
import { authBool } from "../db/schema";
import { createPgliteTestDb, createSqliteTestDb, type TestDb } from "../db/testing/databases";
import { setEmailProviderForTests, signupConfirmEmail, signupExistingAccountEmail, type EmailMessage } from "../email";
import { listAudit } from "../repos/audit";
import { hitRateLimit, peekRateLimit } from "../repos/rate-limits";
import { listSignupAcceptances, takeOverStaleSignupClaim } from "../repos/signup";
import { ipLimitSubject, signupClientIp } from "../signup/client-ip";
import { checkFormStamp, confirmSignup, issueFormStamp, signupHostServed, startSignup, viewSignupLink, type SignupDeps } from "../signup/self-signup";
import { baseUrlSetting } from "./config";
import { createAuth, type Auth } from "./create-auth";
import { createClinic } from "./platform";

const SECRET = "self-signup-secret-".padEnd(48, "s");
const PASSWORD = "a long fictional pass phrase";
const FORMS = "http://localhost:3000";
const DESK = "http://clinic.localhost:3000";
const BASE = baseUrlSetting({ BETTER_AUTH_URL: FORMS, CLINFORMS_AUTH_ORIGINS: DESK });

describe("self sign-up – the switch (CLINFORMS_SELF_SIGNUP)", () => {
  it("is off unless a brand is named; unknown words never switch it on", () => {
    assert.deepEqual(Array.from(selfSignupBrands({})), []);
    assert.deepEqual(Array.from(selfSignupBrands({ CLINFORMS_SELF_SIGNUP: "" })), []);
    assert.deepEqual(Array.from(selfSignupBrands({ CLINFORMS_SELF_SIGNUP: "on" })), []);
    assert.deepEqual(Array.from(selfSignupBrands({ CLINFORMS_SELF_SIGNUP: "1" })), []);
    assert.deepEqual(Array.from(selfSignupBrands({ CLINFORMS_SELF_SIGNUP: "clinic" })), ["clinic"]);
    assert.deepEqual(Array.from(selfSignupBrands({ CLINFORMS_SELF_SIGNUP: "forms" })), ["clinforms"]);
    assert.deepEqual(Array.from(selfSignupBrands({ CLINFORMS_SELF_SIGNUP: " Clinic , forms ,x" })).sort(), ["clinforms", "clinic"]);
    assert.equal(selfSignupEnabled("clinic", { CLINFORMS_SELF_SIGNUP: "forms" }), false);
    assert.equal(selfSignupEnabled("clinforms", { CLINFORMS_SELF_SIGNUP: "forms" }), true);
    assert.equal(selfSignupEnabled(null, { CLINFORMS_SELF_SIGNUP: "clinic,forms" }), false);
  });
});

describe("self sign-up – input rules", () => {
  it("clinic names: length, characters, letters, no web addresses", () => {
    assert.equal(clinicNameProblem("Larkfield Physio & Sports (Leeds)"), null);
    assert.equal(clinicNameProblem("Clinique Élan – Physio".replace("–", "-")), null);
    assert.equal(clinicNameProblem("St. Mary's Physio, 2nd floor"), null);
    assert.ok(clinicNameProblem("A"));
    assert.ok(clinicNameProblem("x".repeat(101)));
    assert.ok(clinicNameProblem("<script>alert(1)</script>"));
    assert.ok(clinicNameProblem("Physio @ home"));
    assert.ok(clinicNameProblem("12345"));
    assert.ok(clinicNameProblem("Cheap pills www.spam.example"));
    assert.ok(clinicNameProblem("Visit spam.com now"));
    assert.equal(ownerNameProblem("Dana O'Lark-Smith"), null);
    assert.ok(ownerNameProblem("D"));
    assert.ok(ownerNameProblem("http://x"));
  });
  it("emails: normalised; disposable domains (and their subdomains) refused", () => {
    assert.equal(normaliseSignupEmail("  Dana@Larkfield.Example "), "dana@larkfield.example");
    assert.equal(normaliseSignupEmail("not an email"), null);
    assert.equal(isDisposableEmail("x@mailinator.com"), true);
    assert.equal(isDisposableEmail("x@eu.mailinator.com"), true);
    assert.equal(isDisposableEmail("x@yopmail.fr"), true);
    assert.equal(isDisposableEmail("x@larkfield-physio.co.uk"), false);
    assert.equal(isDisposableEmail("x@notmailinator.com"), false);
  });
  it("emails: a trailing dot is the same address; invisible characters are refused and never slip past the list", () => {
    assert.equal(normaliseSignupEmail("dana@larkfield.example."), "dana@larkfield.example");
    assert.equal(normaliseSignupEmail("dana@larkfield.example.."), "dana@larkfield.example");
    assert.equal(isDisposableEmail("x@mailinator.com."), true);
    assert.equal(isDisposableEmail("x@MAILINATOR.COM."), true);
    for (const bad of ["x@mail\u200Binator.com", "x@mailinator\u200D.com", "x\u2060y@larkfield.example", "x@larkfield\u00AD.example", "x@yop\uFEFFmail.com", "x@larkfield.example\u200B", "x@a..example", "x@.larkfield.example"]) {
      assert.equal(normaliseSignupEmail(bad), null, JSON.stringify(bad));
    }
    // The list check alone (whatever reaches it) sees through them, and through full-width letters and dots.
    assert.equal(isDisposableEmail("x@mail\u200Binator.com"), true);
    assert.equal(isDisposableEmail("x@ｍａｉｌｉｎａｔｏｒ．ｃｏｍ"), true);
    assert.equal(isDisposableEmail("x@mailinator\u3002com"), true);
  });
  it("the clinic id from the name", () => {
    assert.equal(slugBaseFromClinicName("Larkfield Physio & Sports (Leeds)"), "larkfield-physio-sports-leeds");
    assert.equal(slugBaseFromClinicName("Clinique Élan"), "clinique-elan");
    assert.ok(slugBaseFromClinicName("x".repeat(80)).length <= 40);
  });
  it("versions: the terms page's date per brand, the DPA's own version (a draft, marked as one)", () => {
    assert.match(termsVersion("clinic"), /^clindesk-terms-\d{4}-\d{2}-\d{2}$/);
    assert.match(termsVersion("clinforms"), /^clinforms-terms-\d{4}-\d{2}-\d{2}$/);
    assert.equal(DPA_VERSION, DPA.version);
    assert.equal(dpaIsDraft(), true, "the DPA is a draft pending legal review: the page must say so");
    assert.match(DPA.status, /DRAFT/);
  });
  it("neutral wording: the DPA text and the two new emails", () => {
    const texts = [DPA.title, DPA.intro, DPA.statusNote, ...DPA.sections.flatMap((s) => [s.heading, ...s.paragraphs])].map((t) => fillDpa(t, { product: "ClinDesk", company: "Appstack X Ltd" }));
    const confirm = signupConfirmEmail({ to: { email: "a@b.example" }, brand: "clinic", clinicName: "C", link: "https://x.example/l", expiresAt: new Date().toISOString() });
    const existing = signupExistingAccountEmail({ to: { email: "a@b.example" }, signInLink: "https://x.example/login", resetLink: "https://x.example/reset-password" });
    for (const t of [...texts, confirm.subject, confirm.text, confirm.html, existing.subject, existing.text, existing.html]) {
      assert.equal(BANNED_TERM_PATTERNS.find((re) => re.test(t)), undefined, t.slice(0, 80));
    }
    assert.match(confirm.subject, /ClinDesk/);
    assert.doesNotMatch(`${confirm.subject}${confirm.text}`, /ClinForms/);
    assert.equal(confirm.brand, "clinic");
  });
});

describe("self sign-up – the client's address and the network the limits count", () => {
  it("on Vercel: x-vercel-forwarded-for, then x-real-ip, then the first x-forwarded-for; elsewhere as before", () => {
    const h = new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1", "x-real-ip": "198.51.100.8", "x-vercel-forwarded-for": "198.51.100.9" });
    assert.equal(signupClientIp(h, { VERCEL: "1" }), "198.51.100.9");
    assert.equal(signupClientIp(new Headers({ "x-forwarded-for": "198.51.100.7", "x-real-ip": "198.51.100.8" }), { VERCEL: "1" }), "198.51.100.8");
    assert.equal(signupClientIp(new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }), { VERCEL: "1" }), "198.51.100.7");
    assert.equal(signupClientIp(h, {}), "198.51.100.7", "off Vercel: the first x-forwarded-for entry (as clientIp())");
    assert.equal(signupClientIp(new Headers(), {}), "local");
  });
  it("IPv4 as it is; IPv6 by its /64; IPv4-mapped as IPv4", () => {
    assert.equal(ipLimitSubject("203.0.113.5"), "203.0.113.5");
    assert.equal(ipLimitSubject("203.0.113.5:4431"), "203.0.113.5");
    assert.equal(ipLimitSubject("2001:db8:1:2::1"), "2001:db8:1:2::/64");
    assert.equal(ipLimitSubject("2001:0DB8:0001:0002:ffff:eeee:dddd:cccc"), "2001:db8:1:2::/64");
    assert.equal(ipLimitSubject("[2001:db8:1:2::abcd]"), "2001:db8:1:2::/64");
    assert.equal(ipLimitSubject("2001:db8:1:2::abcd%en0"), "2001:db8:1:2::/64");
    assert.notEqual(ipLimitSubject("2001:db8:1:3::1"), ipLimitSubject("2001:db8:1:2::1"));
    assert.equal(ipLimitSubject("::ffff:203.0.113.5"), "203.0.113.5");
    assert.equal(ipLimitSubject("::1"), "0:0:0:0::/64");
    assert.equal(ipLimitSubject("local"), "local");
  });
});

describe("self sign-up – only where the brand's own host is served", () => {
  it("a deployment without ClinDesk's host refuses ClinDesk sign-ups (never a link to ClinForms' host)", () => {
    assert.equal(signupHostServed(BASE, "clinic"), true);
    assert.equal(signupHostServed(BASE, "clinforms"), true);
    const formsOnly = baseUrlSetting({ BETTER_AUTH_URL: FORMS });
    assert.equal(signupHostServed(formsOnly, "clinic"), false);
    assert.equal(signupHostServed(formsOnly, "clinforms"), true);
  });
});

describe("self sign-up – the form's signed time stamp", () => {
  it("too fast, fine, too old, forged, other brand", () => {
    const t0 = new Date("2026-11-12T10:00:00.000Z");
    const stamp = issueFormStamp(SECRET, "clinic", t0);
    assert.equal(checkFormStamp(SECRET, "clinic", stamp, new Date(t0.getTime() + 500)), "too_fast");
    assert.equal(checkFormStamp(SECRET, "clinic", stamp, new Date(t0.getTime() + SIGNUP_LIMITS.minFillMs + 1)), "ok");
    assert.equal(checkFormStamp(SECRET, "clinic", stamp, new Date(t0.getTime() + SIGNUP_LIMITS.maxFormAgeMs + 1)), "expired");
    assert.equal(checkFormStamp(SECRET, "clinforms", stamp, new Date(t0.getTime() + 10_000)), "expired", "a stamp is for one brand");
    const [ms] = stamp.split(".");
    assert.equal(checkFormStamp(SECRET, "clinic", `${Number(ms) - 60_000}.${stamp.split(".")[1]}`, new Date(t0.getTime() + 10_000)), "expired", "an older time cannot be forged");
    assert.equal(checkFormStamp("another-secret".padEnd(48, "x"), "clinic", stamp, new Date(t0.getTime() + 10_000)), "expired");
    assert.equal(checkFormStamp(SECRET, "clinic", "", t0), "expired");
  });
});

function defineFlow(label: string, open: () => Promise<TestDb>, dialect: "sqlite" | "postgres"): void {
  describe(`self sign-up – the flow on ${label}`, () => {
    let t: TestDb;
    let auth: Auth;
    const sent: EmailMessage[] = [];
    let clock = Date.parse("2026-11-12T10:00:00.000Z");
    const now = () => new Date(clock);
    let ipCounter = 0;
    const platformAdmins = new Set(["staff@platform.example"]);

    const deps = (over: Partial<SignupDeps> = {}): SignupDeps => ({
      db: t.db,
      secret: SECRET,
      baseUrl: BASE,
      brand: "clinic",
      ip: `203.0.113.${ipCounter}`,
      userAgent: "Mozilla/5.0 (fictional test browser)",
      isPlatformAdminEmail: (e) => platformAdmins.has(e),
      now,
      ...over,
    });
    const form = (over: Record<string, unknown> = {}, brand: "clinic" | "clinforms" = "clinic") => ({
      clinicName: "Larkfield Physio (fictional)",
      ownerName: "Dana Lark",
      email: `dana.${Math.random().toString(36).slice(2, 8)}@larkfield-physio.example`,
      password: PASSWORD,
      confirm: PASSWORD,
      accept: "on",
      website: "",
      stamp: issueFormStamp(SECRET, brand, new Date(clock - 10_000)),
      ...over,
    });
    const headersFor = (origin: string) => new Headers({ host: new URL(origin).host, origin, "user-agent": "fictional", "x-forwarded-for": "203.0.113.9" });
    const tokenOf = (m: EmailMessage | undefined) => decodeURIComponent((m?.link ?? "").split("token=")[1] ?? "");
    const lastTo = (email: string) => sent.filter((m) => m.to.email === email).at(-1);

    before(async () => {
      t = await open();
      auth = createAuth({ db: t.db, dialect, secret: SECRET, baseUrl: BASE, rateLimit: false, isPlatformAdminEmail: (e) => platformAdmins.has(e) });
      setEmailProviderForTests({
        name: "log",
        async send(message) {
          sent.push(message);
          return { status: "sent", provider: "log" };
        },
      });
    });
    after(async () => {
      setEmailProviderForTests(null);
      await t?.close();
    });

    it("ClinDesk: start → link email (ClinDesk, clinic host) → wrong password → right password → clinic, owner, acceptance, audit", async () => {
      ipCounter++;
      const f = form();
      const out = await startSignup(f, deps());
      assert.equal(out.kind, "check_email");
      assert.equal(out.detail, "sent");
      const mail = lastTo(f.email as string);
      assert.ok(mail);
      assert.equal(mail.kind, "signup_confirm");
      assert.equal(mail.brand, "clinic");
      assert.ok(mail.link?.startsWith(`${DESK}/start-trial/confirm?token=`), mail.link);
      // Stored: hashes only – never the token or the password.
      const row = await t.db.selectFrom("signup_requests").selectAll().where("email", "=", f.email as string).executeTakeFirstOrThrow();
      const token = tokenOf(mail);
      assert.notEqual(row.token_hash, token);
      assert.ok(row.password_hash && !row.password_hash.includes(PASSWORD));
      assert.ok(!row.ip_hash.includes("203.0.113"));
      assert.equal(row.terms_version, termsVersion("clinic"));
      assert.equal(row.dpa_version, DPA_VERSION);

      assert.deepEqual(await viewSignupLink(t.db, token, "clinforms", now()), { kind: "wrong_host", brand: "clinic" });
      const view = await viewSignupLink(t.db, token, "clinic", now());
      assert.equal(view.kind, "ok");
      const confirmDeps = { db: t.db, auth, secret: SECRET, baseUrl: BASE, brand: "clinic" as const, headers: headersFor(DESK), isPlatformAdminEmail: (e: string) => platformAdmins.has(e), now };
      assert.equal((await confirmSignup({ token, password: "not the right password" }, confirmDeps)).kind, "wrong_password");
      assert.equal((await confirmSignup({ token, password: PASSWORD }, { ...confirmDeps, brand: "clinforms", headers: headersFor(FORMS) })).kind, "invalid", "only on the brand's own host");
      const done = await confirmSignup({ token, password: PASSWORD }, confirmDeps);
      assert.equal(done.kind, "created");
      if (done.kind !== "created") return;
      assert.match(done.tenantId, /^larkfield-physio-fictional/);
      // The clinic: created for the clinic brand, Reports paused, as the platform page does.
      const org = await t.db.selectFrom("organization").selectAll().where("slug", "=", done.tenantId).executeTakeFirstOrThrow();
      assert.equal(org.name, "Larkfield Physio (fictional)");
      assert.match(String(org.metadata), /"signupBrand":"clinic"/);
      const ent = await t.db.selectFrom("clinic_entitlements").selectAll().where("tenant_id", "=", done.tenantId).execute();
      assert.deepEqual(ent.map((e) => [e.package, e.status]), [["reports", "paused"]]);
      // The owner: account (email verified by the link), owner membership, no two-step yet, a session.
      const user = await t.db.selectFrom("user").selectAll().where("email", "=", f.email as string).executeTakeFirstOrThrow();
      assert.equal(user.name, "Dana Lark");
      assert.equal(authBool(user.emailVerified), true);
      assert.notEqual(authBool(user.twoFactorEnabled), true);
      const member = await t.db.selectFrom("member").selectAll().where("userId", "=", user.id).executeTakeFirstOrThrow();
      assert.equal(member.organizationId, org.id);
      assert.equal(member.role, "owner");
      const session = await auth.api.getSession({ headers: new Headers({ cookie: done.cookie, host: "clinic.localhost:3000" }), query: { disableCookieCache: true } });
      assert.equal(session?.user.id, user.id);
      assert.equal((session?.session as { activeOrganizationId?: string }).activeOrganizationId, org.id);
      // Acceptance recorded; audited; the request used up (password hash gone); no invitation email was sent.
      const acc = await listSignupAcceptances({ db: t.db }, done.tenantId);
      assert.equal(acc.length, 1);
      assert.deepEqual([acc[0].userId, acc[0].termsVersion, acc[0].dpaVersion, acc[0].brand, acc[0].acceptedAt], [user.id, termsVersion("clinic"), DPA_VERSION, "clinic", row.created_at]);
      assert.equal(acc[0].ipHash, row.ip_hash);
      const audit = await listAudit({ db: t.db }, done.tenantId, { limit: 20 });
      const actions = audit.map((a) => a.action);
      for (const a of ["clinic.create", "member.join", "clinic.self_signup"]) assert.ok(actions.includes(a), `${a} in ${actions.join(",")}`);
      const selfRow = audit.find((a) => a.action === "clinic.self_signup");
      assert.equal(selfRow?.userId, user.id);
      assert.deepEqual(selfRow?.detail, { brand: "clinic", termsVersion: termsVersion("clinic"), dpaVersion: DPA_VERSION, acceptance: acc[0].id });
      const used = await t.db.selectFrom("signup_requests").selectAll().where("email", "=", f.email as string).executeTakeFirstOrThrow();
      assert.equal(used.password_hash, null);
      assert.equal(used.tenant_id, done.tenantId);
      assert.ok(!sent.some((m) => m.kind === "invitation" && m.to.email === f.email), "the owner joins at once: no invitation email");
      // The link works once.
      assert.equal((await confirmSignup({ token, password: PASSWORD }, confirmDeps)).kind, "invalid");
      assert.equal((await viewSignupLink(t.db, token, "clinic", now())).kind, "invalid");
    });

    it("ClinForms: the clinic is a ClinForms clinic (Reports as today), link and email on ClinForms' host", async () => {
      ipCounter++;
      const f = form({ clinicName: "Harbour Physio (fictional)" }, "clinforms");
      assert.equal((await startSignup(f, deps({ brand: "clinforms" }))).detail, "sent");
      const mail = lastTo(f.email as string);
      assert.equal(mail?.brand, undefined, "ClinForms' messages carry no brand field (as before)");
      assert.ok(mail?.link?.startsWith(`${FORMS}/start-trial/confirm?token=`));
      assert.match(mail?.subject ?? "", /ClinForms/);
      const done = await confirmSignup(
        { token: tokenOf(mail), password: PASSWORD },
        { db: t.db, auth, secret: SECRET, baseUrl: BASE, brand: "clinforms", headers: headersFor(FORMS), isPlatformAdminEmail: () => false, now },
      );
      assert.equal(done.kind, "created");
      if (done.kind !== "created") return;
      const org = await t.db.selectFrom("organization").selectAll().where("slug", "=", done.tenantId).executeTakeFirstOrThrow();
      assert.equal(org.metadata, null);
      assert.equal((await t.db.selectFrom("clinic_entitlements").select("package").where("tenant_id", "=", done.tenantId).execute()).length, 0);
      assert.equal((await listSignupAcceptances({ db: t.db }, done.tenantId))[0].termsVersion, termsVersion("clinforms"));
    });

    it("an address with an account: the same answer, a 'sign in' email, nothing stored", async () => {
      ipCounter++;
      const owner = "existing.owner@riverside.example";
      const clinic = await createClinic(t.db, { name: "Riverside (fictional)", slug: `riverside-ss-${dialect}`, ownerEmail: owner, appOrigin: FORMS, linkSecret: SECRET, sendEmail: false });
      await auth.api.signUpEmail({ body: { email: owner, password: PASSWORD, name: "Rita River" } });
      void clinic;
      const before = await t.db.selectFrom("signup_requests").select("id").execute();
      const out = await startSignup(form({ email: "Existing.Owner@Riverside.example" }), deps());
      assert.equal(out.kind, "check_email", "never reveals that the address has an account");
      assert.equal(out.detail, "existing_account");
      const mail = lastTo(owner);
      assert.equal(mail?.kind, "signup_existing_account");
      assert.match(mail?.text ?? "", new RegExp(`${DESK}/login`));
      assert.equal(mail?.link, undefined);
      assert.equal((await t.db.selectFrom("signup_requests").select("id").execute()).length, before.length);
    });

    it("an account made between the form and the link: no second account", async () => {
      ipCounter++;
      const f = form();
      await startSignup(f, deps());
      const token = tokenOf(lastTo(f.email as string));
      await createClinic(t.db, { name: "Other (fictional)", slug: `other-ss-${dialect}`, ownerEmail: f.email as string, appOrigin: FORMS, linkSecret: SECRET, sendEmail: false });
      await auth.api.signUpEmail({ body: { email: f.email as string, password: PASSWORD, name: "Dana Lark" } });
      const out = await confirmSignup({ token, password: PASSWORD }, { db: t.db, auth, secret: SECRET, baseUrl: BASE, brand: "clinic", headers: headersFor(DESK), isPlatformAdminEmail: () => false, now });
      assert.equal(out.kind, "existing_account");
      assert.equal((await t.db.selectFrom("user").select("id").where("email", "=", f.email as string).execute()).length, 1);
    });

    it("bots: honeypot and a form filled too fast get the same answer and nothing happens; an old or forged stamp asks to reload", async () => {
      ipCounter++;
      const count = sent.length;
      const rows = (await t.db.selectFrom("signup_requests").select("id").execute()).length;
      assert.deepEqual(await startSignup(form({ website: "http://spam.example" }), deps()), { kind: "check_email", detail: "spam" });
      assert.deepEqual(await startSignup(form({ stamp: issueFormStamp(SECRET, "clinic", new Date(clock - 500)) }), deps()), { kind: "check_email", detail: "too_fast" });
      assert.deepEqual(await startSignup(form({ stamp: issueFormStamp(SECRET, "clinic", new Date(clock - 3 * 3600_000)) }), deps()), { kind: "expired" });
      assert.deepEqual(await startSignup(form({ stamp: "123.abc" }), deps()), { kind: "expired" });
      assert.equal(sent.length, count);
      assert.equal((await t.db.selectFrom("signup_requests").select("id").execute()).length, rows);
    });

    it("field checks: names, disposable address, password rules, the tick-box", async () => {
      ipCounter++;
      const out = await startSignup(form({ clinicName: "<b>x</b>", ownerName: "", email: "a@mailinator.com", password: "short", accept: "" }), deps());
      assert.equal(out.kind, "invalid");
      if (out.kind !== "invalid") return;
      assert.deepEqual(Object.keys(out.fieldErrors).sort(), ["accept", "clinicName", "email", "ownerName", "password"]);
      assert.match(out.fieldErrors.email, /work email/);
      const mismatch = await startSignup(form({ confirm: "something else entirely" }), deps());
      assert.equal(mismatch.kind === "invalid" && Object.keys(mismatch.fieldErrors).join(), "confirm");
      const long = await startSignup(form({ password: "x".repeat(129), confirm: "x".repeat(129) }), deps());
      assert.equal(long.kind === "invalid" && Object.keys(long.fieldErrors).join(), "password");
    });

    it("limits: 3 sign-ups per IP a day; 3 emails per address a day (quietly); a platform administrator's address never", async () => {
      ipCounter++;
      for (let i = 0; i < 3; i++) assert.equal((await startSignup(form(), deps())).detail, "sent");
      const fourth = await startSignup(form(), deps());
      assert.equal(fourth.kind, "rate_limited");
      clock += 86_400_000; // the next day
      assert.equal((await startSignup(form(), deps())).detail, "sent");

      const email = "same.person@larkfield-physio.example";
      for (let i = 0; i < 3; i++) {
        ipCounter++;
        assert.equal((await startSignup(form({ email }), deps())).detail, "sent");
      }
      ipCounter++;
      const before = sent.filter((m) => m.to.email === email).length;
      assert.deepEqual(await startSignup(form({ email }), deps()), { kind: "check_email", detail: "address_limit" });
      assert.equal(sent.filter((m) => m.to.email === email).length, before);

      ipCounter++;
      assert.deepEqual(await startSignup(form({ email: "staff@platform.example" }), deps()), { kind: "check_email", detail: "platform_address" });
      assert.equal(lastTo("staff@platform.example"), undefined);
    });

    it("the link: expires after 24 hours; 5 wrong passwords then waits; two clicks at once create one clinic", async () => {
      ipCounter++;
      const f = form({ clinicName: "Expiry Physio (fictional)" });
      await startSignup(f, deps());
      const token = tokenOf(lastTo(f.email as string));
      clock += SIGNUP_LIMITS.linkTtlMs + 1000;
      const cd = { db: t.db, auth, secret: SECRET, baseUrl: BASE, brand: "clinic" as const, headers: headersFor(DESK), isPlatformAdminEmail: () => false, now };
      assert.equal((await confirmSignup({ token, password: PASSWORD }, cd)).kind, "invalid");

      ipCounter++;
      const g = form({ clinicName: "Guess Physio (fictional)" });
      await startSignup(g, deps());
      const token2 = tokenOf(lastTo(g.email as string));
      for (let i = 0; i < SIGNUP_LIMITS.confirmAttemptsPerLink; i++) assert.equal((await confirmSignup({ token: token2, password: `wrong guess ${i} xxxx` }, cd)).kind, "wrong_password");
      assert.equal((await confirmSignup({ token: token2, password: PASSWORD }, cd)).kind, "too_many");
      clock += 16 * 60_000;
      assert.equal((await confirmSignup({ token: token2, password: PASSWORD }, cd)).kind, "created");

      ipCounter++;
      const h = form({ clinicName: "Twice Physio (fictional)" });
      await startSignup(h, deps());
      const token3 = tokenOf(lastTo(h.email as string));
      const [a, b] = await Promise.all([confirmSignup({ token: token3, password: PASSWORD }, cd), confirmSignup({ token: token3, password: PASSWORD }, cd)]);
      const kinds = [a.kind, b.kind].sort();
      assert.ok(kinds.includes("created"), kinds.join());
      assert.equal((await t.db.selectFrom("organization").select("id").where("name", "=", "Twice Physio (fictional)").execute()).length, 1);
      assert.equal((await t.db.selectFrom("user").select("id").where("email", "=", h.email as string).execute()).length, 1);
    });

    it("two clinics with the same name get different ids", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        ipCounter++;
        const f = form({ clinicName: "Same Name Physio (fictional)" });
        await startSignup(f, deps());
        const done = await confirmSignup(
          { token: tokenOf(lastTo(f.email as string)), password: PASSWORD },
          { db: t.db, auth, secret: SECRET, baseUrl: BASE, brand: "clinic", headers: headersFor(DESK), isPlatformAdminEmail: () => false, now },
        );
        assert.equal(done.kind, "created");
        if (done.kind === "created") ids.push(done.tenantId);
      }
      assert.equal(ids[0], "same-name-physio-fictional");
      assert.match(ids[1], /^same-name-physio-fictional-[a-z0-9]{4}$/);
    });

    const confirmDepsFor = (over: Partial<Parameters<typeof confirmSignup>[1]> = {}) => ({
      db: t.db,
      auth,
      secret: SECRET,
      baseUrl: BASE,
      brand: "clinic" as const,
      headers: headersFor(DESK),
      isPlatformAdminEmail: () => false,
      now,
      ...over,
    });

    it("the host is not served: refused with a message, nothing stored or sent", async () => {
      ipCounter++;
      const count = sent.length;
      const out = await startSignup(form(), deps({ baseUrl: baseUrlSetting({ BETTER_AUTH_URL: FORMS }) }));
      assert.equal(out.kind, "unavailable");
      assert.equal(sent.length, count);
    });

    it("IPv6: one /64 is one network for the daily limit", async () => {
      clock += 86_400_000;
      for (let i = 1; i <= 3; i++) assert.equal((await startSignup(form(), deps({ ip: `2001:db8:${dialect.length}:77::${i}` }))).detail, "sent");
      assert.equal((await startSignup(form(), deps({ ip: `2001:db8:${dialect.length}:77::ffff:1` }))).kind, "rate_limited");
      assert.equal((await startSignup(form(), deps({ ip: `2001:db8:${dialect.length}:78::1` }))).detail, "sent", "the next /64 is another network");
    });

    it("the site-wide daily count alerts (log + one platform audit row) and never blocks", async () => {
      clock += 86_400_000;
      const ctx = { db: t.db, now };
      const current = (await peekRateLimit(ctx, "signup:all-day", 86_400_000)).count;
      if (SIGNUP_LIMITS.allPerDayAlert - current > 0) await hitRateLimit(ctx, "signup:all-day", 86_400_000, SIGNUP_LIMITS.allPerDayAlert - current);
      const lines: string[] = [];
      const info = console.info;
      console.info = (line: unknown) => void lines.push(String(line));
      try {
        for (let i = 0; i < 2; i++) {
          ipCounter++;
          assert.equal((await startSignup(form(), deps())).detail, "sent", "a real sign-up is never blocked by the site-wide count");
        }
      } finally {
        console.info = info;
      }
      assert.equal(lines.filter((l) => l.includes('"event":"signup.global_cap"')).length, 2);
      const rows = await listAudit({ db: t.db }, "platform", { limit: 50 });
      assert.equal(rows.filter((r) => r.action === "platform.signup_global_cap").length, 1, "one audit row per day");
      clock += 86_400_000;
    });

    it("a stale claim is taken over by ONE conditional update: two at once, one clinic", async () => {
      ipCounter++;
      const f = form({ clinicName: "Stale Physio (fictional)" });
      await startSignup(f, deps());
      const token = tokenOf(lastTo(f.email as string));
      const old = new Date(clock - 5 * 60_000).toISOString();
      await t.db.updateTable("signup_requests").set({ claimed_at: old }).where("email", "=", f.email as string).execute();
      const row = await t.db.selectFrom("signup_requests").select("id").where("email", "=", f.email as string).executeTakeFirstOrThrow();
      const takeovers = await Promise.all([takeOverStaleSignupClaim({ db: t.db, now }, row.id, old), takeOverStaleSignupClaim({ db: t.db, now }, row.id, old)]);
      assert.deepEqual(takeovers.sort(), [false, true]);
      // Through confirmSignup: make it stale again, two tries at once.
      await t.db.updateTable("signup_requests").set({ claimed_at: old }).where("id", "=", row.id).execute();
      const [a, b] = await Promise.all([confirmSignup({ token, password: PASSWORD }, confirmDepsFor()), confirmSignup({ token, password: PASSWORD }, confirmDepsFor())]);
      assert.ok([a.kind, b.kind].includes("created"), `${a.kind},${b.kind}`);
      assert.equal((await t.db.selectFrom("organization").select("id").where("name", "=", "Stale Physio (fictional)").execute()).length, 1);
    });

    it("partial failure after the account (acceptance step): the retry records the acceptance and the audit once", async () => {
      ipCounter++;
      const f = form({ clinicName: "Retry Physio (fictional)" });
      await startSignup(f, deps());
      const token = tokenOf(lastTo(f.email as string));
      await sql`alter table signup_acceptances rename to signup_acceptances_away`.execute(t.db);
      try {
        await assert.rejects(confirmSignup({ token, password: PASSWORD }, confirmDepsFor()));
      } finally {
        await sql`alter table signup_acceptances_away rename to signup_acceptances`.execute(t.db);
      }
      assert.equal((await t.db.selectFrom("user").select("id").where("email", "=", f.email as string).execute()).length, 1, "the account was made");
      const retry = await confirmSignup({ token, password: PASSWORD }, confirmDepsFor());
      assert.equal(retry.kind, "created", "not 'existing account' with no record");
      if (retry.kind !== "created") return;
      assert.equal((await listSignupAcceptances({ db: t.db }, retry.tenantId)).length, 1);
      const audit = await listAudit({ db: t.db }, retry.tenantId, { limit: 50 });
      assert.equal(audit.filter((a) => a.action === "clinic.self_signup").length, 1);
      const used = await t.db.selectFrom("signup_requests").selectAll().where("email", "=", f.email as string).executeTakeFirstOrThrow();
      assert.ok(used.completed_at);
      assert.equal(used.password_hash, null);
      assert.equal((await confirmSignup({ token, password: PASSWORD }, confirmDepsFor())).kind, "invalid", "then the link is used up");
      assert.equal(await recordAgain(retry.tenantId), 1);
    });

    const recordAgain = async (tenantId: string) => (await listSignupAcceptances({ db: t.db }, tenantId)).length;

    it("partial failure after the account (membership step): the retry joins the clinic and records the acceptance", async () => {
      ipCounter++;
      const f = form({ clinicName: "Join Retry Physio (fictional)" });
      await startSignup(f, deps());
      const token = tokenOf(lastTo(f.email as string));
      const flaky = {
        ...auth,
        api: {
          ...auth.api,
          acceptInvitation: async () => {
            throw new Error("fictional failure");
          },
        },
      } as unknown as Auth;
      assert.equal((await confirmSignup({ token, password: PASSWORD }, confirmDepsFor({ auth: flaky }))).kind, "failed");
      assert.equal((await confirmSignup({ token, password: "not the right password" }, confirmDepsFor())).kind, "wrong_password");
      const retry = await confirmSignup({ token, password: PASSWORD }, confirmDepsFor());
      assert.equal(retry.kind, "created");
      if (retry.kind !== "created") return;
      const member = await t.db.selectFrom("member").select("role").where("userId", "=", retry.userId).executeTakeFirstOrThrow();
      assert.equal(member.role, "owner");
      assert.equal((await listSignupAcceptances({ db: t.db }, retry.tenantId)).length, 1);
      const session = await auth.api.getSession({ headers: new Headers({ cookie: retry.cookie, host: "clinic.localhost:3000" }), query: { disableCookieCache: true } });
      assert.equal(session?.user.id, retry.userId);
    });

    if (dialect === "sqlite") {
      it("timing: a new address, an existing account and a platform address take the same time (email after the answer)", async () => {
        const owner = "timing.owner@riverside.example";
        await createClinic(t.db, { name: "Timing (fictional)", slug: "timing-ss", ownerEmail: owner, appOrigin: FORMS, linkSecret: SECRET, sendEmail: false });
        await auth.api.signUpEmail({ body: { email: owner, password: PASSWORD, name: "Tim Ing" } });
        // A slow email provider (as a real one): it must not show in the answer's time.
        const slowSent: EmailMessage[] = [];
        setEmailProviderForTests({
          name: "log",
          async send(message) {
            await new Promise((r) => setTimeout(r, 40));
            slowSent.push(message);
            return { status: "sent", provider: "log" };
          },
        });
        const pending: Promise<void>[] = [];
        const defer = (task: () => Promise<void>) => void pending.push(task());
        const times: Record<"new" | "existing" | "platform", number[]> = { new: [], existing: [], platform: [] };
        try {
          const run = async (kind: keyof typeof times, email: string) => {
            ipCounter++;
            const f = form({ email });
            const t0 = process.hrtime.bigint();
            const out = await startSignup(f, deps({ defer }));
            times[kind].push(Number(process.hrtime.bigint() - t0) / 1e6);
            assert.equal(out.kind, "check_email");
          };
          for (let round = 0; round < 7; round++) {
            clock += 86_400_000; // a fresh day: the per-address limit never kicks in
            await run("new", `timing.new.${round}.${dialect}@larkfield-physio.example`);
            await run("existing", owner);
            await run("platform", "staff@platform.example");
          }
          await Promise.all(pending);
        } finally {
          setEmailProviderForTests({
            name: "log",
            async send(message) {
              sent.push(message);
              return { status: "sent", provider: "log" };
            },
          });
        }
        const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
        const m = { new: median(times.new), existing: median(times.existing), platform: median(times.platform) };
        const ratio = Math.max(m.new, m.existing, m.platform) / Math.min(m.new, m.existing, m.platform);
        assert.ok(ratio < 1.5, `medians ms ${JSON.stringify(m)} (ratio ${ratio.toFixed(2)})`);
        // The deferred work still happened: 7 links, 7 "sign in" emails, nothing for the platform address.
        assert.equal(slowSent.filter((x) => x.kind === "signup_confirm").length, 7);
        assert.equal(slowSent.filter((x) => x.kind === "signup_existing_account" && x.to.email === owner).length, 7);
        assert.equal(slowSent.filter((x) => x.to.email === "staff@platform.example").length, 0);
      });
    }
  });
}

defineFlow("SQLite (node:sqlite)", async () => createSqliteTestDb(), "sqlite");
defineFlow("Postgres (PGlite)", () => createPgliteTestDb(), "postgres");
