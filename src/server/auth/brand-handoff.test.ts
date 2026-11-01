/**
 * 01/11/2026 – Khuram's R1/R2/R3: a clinic keeps its own brand and host.
 *  - a clinic created for the clinic brand records it and starts without Reports (no ClinForms Studio by default);
 *  - its brand stays the clinic brand before its plan is paid and after it lapses;
 *  - a clinic opened on the other brand's host is sent to its own host's sign-in page (never Plan and billing);
 *  - a member of clinics of both brands opens the one that belongs on the host they signed in on.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createSqliteTestDb, type TestDb } from "../db/testing/databases";
import { setEmailProviderForTests } from "../email";
import { listEntitlements, setEntitlement } from "../repos/pms/entitlements";
import { brandHandoffUrl, brandLandingPath, brandSignInUrl, HANDOFF_EXEMPT_PATHS, packageAreaOf } from "./brand-handoff";
import { clinicBrandFor, clinicLinkBrand, SIGNUP_BRAND_KEY, signupBrandOf } from "./brand-links";
import { baseUrlSetting, linkTarget } from "./config";
import { createClinic } from "./platform";

const PROD = { BETTER_AUTH_URL: "https://clinforms.co.uk", CLINFORMS_AUTH_ORIGINS: "https://clindesk.co.uk" };
const LOCAL = { BETTER_AUTH_URL: "http://localhost:3410", CLINFORMS_AUTH_ORIGINS: "http://clinic.localhost:3410" };
const SECRET = "s".repeat(48);

describe("the clinic's own brand (pure rules)", () => {
  it("clinic package → the clinic brand; otherwise the brand it was created for; otherwise ClinForms", () => {
    assert.equal(clinicBrandFor({ clinic: true }, null), "clinic");
    assert.equal(clinicBrandFor({ clinic: true }, "clinforms"), "clinic");
    assert.equal(clinicBrandFor({ clinic: false }, "clinic"), "clinic");
    assert.equal(clinicBrandFor({ clinic: false }, null), "clinforms");
  });
  it("reads the sign-up brand from the organization metadata, ignoring anything else", () => {
    assert.equal(signupBrandOf(JSON.stringify({ [SIGNUP_BRAND_KEY]: "clinic" })), "clinic");
    assert.equal(signupBrandOf(JSON.stringify({ [SIGNUP_BRAND_KEY]: "clinic", offboardedAt: "2026-11-01T00:00:00Z" })), "clinic");
    assert.equal(signupBrandOf(JSON.stringify({ [SIGNUP_BRAND_KEY]: "evil" })), null);
    assert.equal(signupBrandOf("not json"), null);
    assert.equal(signupBrandOf(null), null);
  });
});

describe("host hand-off (brand-handoff.ts)", () => {
  const prod = baseUrlSetting(PROD);
  it("the same brand stays", () => {
    assert.equal(brandHandoffUrl({ hostBrand: "clinic", clinicBrand: "clinic", setting: prod, path: "/app" }), null);
    assert.equal(brandHandoffUrl({ hostBrand: "clinforms", clinicBrand: "clinforms", setting: prod, path: "/app" }), null);
  });
  it("a ClinDesk clinic on ClinForms' host goes to ClinDesk's sign-in, landing on /app/start", () => {
    assert.equal(brandHandoffUrl({ hostBrand: "clinforms", clinicBrand: "clinic", setting: prod, path: "/app/settings/members" }), "https://clindesk.co.uk/login?next=%2Fapp%2Fstart&moved=1");
  });
  it("a ClinForms clinic on the clinic brand's host goes to ClinForms' sign-in, landing on /app", () => {
    assert.equal(brandHandoffUrl({ hostBrand: "clinic", clinicBrand: "clinforms", setting: prod, path: "/app/studio" }), "https://clinforms.co.uk/login?next=%2Fapp&moved=1");
  });
  it("locally, between localhost and clinic.localhost on the same port", () => {
    assert.equal(brandHandoffUrl({ hostBrand: "clinforms", clinicBrand: "clinic", setting: baseUrlSetting(LOCAL), path: "/app" }), "http://clinic.localhost:3410/login?next=%2Fapp%2Fstart&moved=1");
  });
  it("Plan and billing (and its done / cancelled pages) never hand off", () => {
    assert.deepEqual([...HANDOFF_EXEMPT_PATHS], ["/app/settings/billing"]);
    for (const path of ["/app/settings/billing", "/app/settings/billing?product=clindesk", "/app/settings/billing/done?session_id=cs_x", "/app/settings/billing/cancelled"]) {
      assert.equal(brandHandoffUrl({ hostBrand: "clinforms", clinicBrand: "clinic", setting: prod, path }), null, path);
    }
    assert.notEqual(brandHandoffUrl({ hostBrand: "clinforms", clinicBrand: "clinic", setting: prod, path: "/app/settings/billingx" }), null);
  });
  it("a deployment that does not serve the clinic's brand host keeps it (previews, one-host set-ups)", () => {
    const single = baseUrlSetting({ BETTER_AUTH_URL: "https://clinforms.co.uk" });
    assert.equal(brandHandoffUrl({ hostBrand: "clinforms", clinicBrand: "clinic", setting: single, path: "/app" }), null);
    assert.equal(brandSignInUrl(single, "clinic"), null);
  });
  it("the package each /app area needs (404 titles)", () => {
    assert.equal(packageAreaOf("/app/clinic"), "clinic");
    assert.equal(packageAreaOf("/app/clinic/patients/x?tab=1"), "clinic");
    assert.equal(packageAreaOf("/app/studio/forms"), "reports");
    assert.equal(packageAreaOf("/app/clinicx"), null);
    assert.equal(packageAreaOf("/app/settings/billing"), null);
    assert.equal(packageAreaOf(null), null);
  });
  it("landing pages per brand", () => {
    assert.equal(brandLandingPath("clinic"), "/app/start");
    assert.equal(brandLandingPath("clinforms"), "/app");
    assert.equal(brandSignInUrl(prod, "clinic"), "https://clindesk.co.uk/login?next=%2Fapp%2Fstart");
  });
});

describe("a clinic created for the clinic brand (createClinic)", () => {
  let t: TestDb;
  before(async () => {
    t = await createSqliteTestDb();
    setEmailProviderForTests({ name: "none", async send() { return { status: "not_sent", provider: "none" }; } });
  });
  after(async () => {
    setEmailProviderForTests(null);
    await t?.close();
  });

  it("records its brand and starts without Reports; a ClinForms clinic keeps the default", async () => {
    const desk = linkTarget(baseUrlSetting(PROD), "clinic");
    await createClinic(t.db, { name: "Desk New (fictional)", slug: "desk-new", ownerEmail: "o@desk-new.example", appOrigin: desk.origin, brand: desk.brand, linkSecret: SECRET, sendEmail: false });
    await createClinic(t.db, { name: "Forms New (fictional)", slug: "forms-new", ownerEmail: "o@forms-new.example", appOrigin: "https://clinforms.co.uk", linkSecret: SECRET, sendEmail: false });
    const org = await t.db.selectFrom("organization").select("metadata").where("slug", "=", "desk-new").executeTakeFirstOrThrow();
    assert.equal(signupBrandOf(org.metadata), "clinic");
    const rows = await listEntitlements({ db: t.db }, "desk-new");
    assert.deepEqual(rows.map((r) => [r.package, r.status]), [["reports", "paused"]]);
    assert.deepEqual(await listEntitlements({ db: t.db }, "forms-new"), []);
    // Before it pays: still the clinic brand (its invitations and resets go to clindesk.co.uk).
    assert.equal(await clinicLinkBrand(t.db, "desk-new"), "clinic");
    assert.equal(await clinicLinkBrand(t.db, "forms-new"), "clinforms");
  });

  it("keeps the clinic brand after its plan lapses, and a ClinForms clinic that buys ClinDesk becomes the clinic brand", async () => {
    await setEntitlement({ db: t.db }, "desk-new", "clinic", { status: "active" }, { userId: null, sessionId: null });
    assert.equal(await clinicLinkBrand(t.db, "desk-new"), "clinic");
    await setEntitlement({ db: t.db }, "desk-new", "clinic", { status: "cancelled" }, { userId: null, sessionId: null });
    assert.equal(await clinicLinkBrand(t.db, "desk-new"), "clinic");
    await setEntitlement({ db: t.db }, "forms-new", "clinic", { status: "active" }, { userId: null, sessionId: null });
    assert.equal(await clinicLinkBrand(t.db, "forms-new"), "clinic");
  });
});
