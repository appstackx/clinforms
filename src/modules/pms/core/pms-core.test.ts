/** Pure rules of the clinic system (src/modules/pms/core): packages, permissions, text, retention, authorisations. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorisationView, canUseAuthorisation } from "./authorisations";
import { PACKAGE_DEFAULT_ON, packageIsOn, usagePeriod } from "./entitlements";
import { hasPrefix } from "./ids";
import { visibleNav } from "./nav";
import { ACCESS_PERMISSIONS, ACCESS_PERMISSION_DEFS, PMS_PERMISSIONS, PMS_ROLES, canWith, effectivePermissions, lockOf, mayAmendNote, pmsCan, pmsPermissionsOf, resolvePermission } from "./permissions";
import { retentionReviewFrom } from "./retention";
import { CaseInputSchema, PostcodeSchema, fieldErrors, patientInputSchema } from "./schemas";
import { addYears, formatPence, formatUkDate, isIsoDate, isPlausiblePhone, normalisePostcode, phoneDigits, searchKey, ukToday, yearsBetween } from "./text";

describe("packages", () => {
  const now = new Date("2026-10-24T12:00:00.000Z");
  it("no row = the default: reports on, clinic off", () => {
    assert.deepEqual(PACKAGE_DEFAULT_ON, { reports: true, clinic: false });
    assert.equal(packageIsOn("reports", null, now), true);
    assert.equal(packageIsOn("clinic", undefined, now), false);
  });
  it("active and trial are on until their end; paused and cancelled are off", () => {
    assert.equal(packageIsOn("clinic", { status: "active", endsAt: null }, now), true);
    assert.equal(packageIsOn("clinic", { status: "trial", endsAt: "2026-11-01T00:00:00.000Z" }, now), true);
    assert.equal(packageIsOn("clinic", { status: "trial", endsAt: "2026-10-24T12:00:00.000Z" }, now), false);
    assert.equal(packageIsOn("reports", { status: "paused", endsAt: null }, now), false);
    assert.equal(packageIsOn("reports", { status: "cancelled", endsAt: null }, now), false);
    assert.equal(usagePeriod(now), "2026-10");
  });
});

describe("permissions", () => {
  it("the owner can do everything; reception never sees clinical notes; unknown roles nothing", () => {
    for (const p of PMS_PERMISSIONS) assert.ok(pmsCan("owner", p), p);
    assert.equal(pmsCan("staff", "clinical.view"), false);
    assert.equal(pmsCan("staff", "diary.book"), true);
    assert.equal(pmsCan("staff", "billing.edit"), true);
    assert.equal(pmsCan("clinician", "clinical.sign"), true);
    assert.equal(pmsCan("clinician", "billing.edit"), false);
    assert.equal(pmsCan("clinician", "settings.manage"), false);
    assert.equal(pmsCan("member", "clinic.view"), false, "Better Auth's own role is not a clinic role");
    assert.equal(pmsCan(null, "clinic.view"), false);
    assert.ok(pmsPermissionsOf("staff").every((p) => !p.startsWith("clinical.")));
    assert.ok(PMS_PERMISSIONS.every((p) => (pmsPermissionsOf("clinician") as string[]).includes(resolvePermission(p)) === pmsCan("clinician", p)));
  });

  // The first build's fixed matrix (22 ids). Every old id keeps its exact behaviour for the default roles except
  // where the round-2 roles design deliberately changed a default (listed – nothing else may differ).
  const OLD: Record<string, readonly string[]> = {
    owner: ["clinic.view", "patients.view", "patients.edit", "patients.export", "clinical.view", "clinical.edit", "clinical.sign", "diary.view", "diary.book", "diary.manage", "billing.view", "billing.edit", "billing.manage", "messages.view", "messages.send", "messages.manage", "booking.manage", "reports.view", "reports.export", "directory.edit", "settings.manage", "import.run"],
    clinician: ["clinic.view", "patients.view", "patients.edit", "clinical.view", "clinical.edit", "clinical.sign", "diary.view", "diary.book", "billing.view", "messages.view", "messages.send", "directory.edit"],
    staff: ["clinic.view", "patients.view", "patients.edit", "diary.view", "diary.book", "billing.view", "billing.edit", "messages.view", "messages.send", "directory.edit"],
  };
  OLD.admin = OLD.owner;
  const OLD_IDS = OLD.owner;
  const DELIBERATE: Record<string, boolean> = {
    "admin:patients.export": false, // → reports.export ("Export data"): owner only by default
    "admin:reports.export": false,
    "admin:clinical.edit": false, // → clinical.write: admins do not write or sign notes by default
    "admin:clinical.sign": false,
    "staff:diary.manage": true, // → diary.rota: reception edits rotas and the waiting list
    "clinician:directory.edit": false, // → settings.setup: set-up is owner/admin only
    "staff:directory.edit": false,
  };
  it("old ids are aliases: same answer as the first build's matrix, except the design's deliberate changes", () => {
    for (const role of PMS_ROLES) {
      for (const id of OLD_IDS) {
        const before = OLD[role].includes(id);
        const key = `${role}:${id}`;
        const expected = key in DELIBERATE ? DELIBERATE[key] : before;
        if (key in DELIBERATE) assert.notEqual(expected, before, `${key} is listed as a change but is not one`);
        assert.equal(pmsCan(role, id as never), expected, key);
      }
    }
  });

  it("the grid: 26 permissions in 7 groups with the design's defaults", () => {
    assert.equal(ACCESS_PERMISSIONS.length, 26);
    assert.deepEqual(Array.from(new Set(ACCESS_PERMISSION_DEFS.map((d) => d.group))), ["Diary", "Patients", "Clinical", "Billing", "Messages", "Reports", "Settings"]);
    const col = (role: (typeof PMS_ROLES)[number]) => ACCESS_PERMISSIONS.filter((p) => pmsCan(role, p));
    assert.deepEqual(col("admin").length, 26 - 4, "admin: all but write/sign, amend, export, change the owner");
    assert.deepEqual(ACCESS_PERMISSIONS.filter((p) => !pmsCan("admin", p)), ["clinical.write", "clinical.amend", "reports.export", "settings.owner"]);
    assert.deepEqual(ACCESS_PERMISSIONS.filter((p) => pmsCan("clinician", p)), [
      "diary.view", "diary.book", "patients.view", "patients.edit", "patients.referral", "clinical.view", "clinical.write", "clinical.amend",
      "billing.view", "messages.send", "messages.letters", "reports.own",
    ]);
    assert.deepEqual(ACCESS_PERMISSIONS.filter((p) => pmsCan("staff", p)), [
      "diary.view", "diary.book", "diary.rota", "patients.view", "patients.edit", "patients.referral", "billing.view", "billing.edit", "billing.pay", "messages.send",
    ]);
  });

  it("locks win over every stored choice", () => {
    const grantAll = Object.fromEntries(ACCESS_PERMISSIONS.map((p) => [p, true]));
    const denyAll = Object.fromEntries(ACCESS_PERMISSIONS.map((p) => [p, false]));
    const reception = effectivePermissions({ role: "staff", roleOverrides: grantAll, exceptions: grantAll });
    for (const p of ["clinical.view", "clinical.write", "clinical.amend", "messages.letters", "settings.owner"] as const) assert.equal(reception.has(p), false, p);
    assert.equal(reception.has("reports.export"), true, "other cells follow the stored choices");
    const owner = effectivePermissions({ role: "owner", roleOverrides: denyAll, exceptions: denyAll });
    assert.equal(owner.size, ACCESS_PERMISSIONS.length + 1, "the owner always has everything");
    assert.equal(effectivePermissions({ role: "admin", exceptions: grantAll }).has("settings.owner"), false, "only the owner changes the owner");
    assert.equal(effectivePermissions({ role: "clinician", active: false }).size, 0, "deactivated: nothing, not even clinic.view");
    assert.deepEqual(lockOf("staff", "clinical.view"), { value: false, reason: "Reception can never see clinical note content" });
    assert.equal(lockOf("clinician", "clinical.view"), null);
  });

  it("order: role default → clinic override → member exception", () => {
    const can = (o: Record<string, boolean>, e: Record<string, boolean>) => canWith(effectivePermissions({ role: "staff", roleOverrides: o, exceptions: e }));
    assert.equal(can({}, {})("billing.refund"), false);
    assert.equal(can({ "billing.refund": true }, {})("billing.refund"), true);
    assert.equal(can({ "billing.refund": true }, { "billing.refund": false })("billing.refund"), false);
    assert.equal(can({}, { "diary.override": true })("diary.override"), true);
    assert.equal(can({}, { "settings.setup": true })("settings.manage"), true, "an alias follows its permission");
    assert.equal(can({ unknown: true }, {})("clinic.view"), true, "unknown ids are ignored");
  });

  it("amending signed notes: own notes only for clinicians", () => {
    assert.equal(mayAmendNote("clinician", (p) => pmsCan("clinician", p), true), true);
    assert.equal(mayAmendNote("clinician", (p) => pmsCan("clinician", p), false), false);
    assert.equal(mayAmendNote("owner", (p) => pmsCan("owner", p), false), true);
    assert.equal(mayAmendNote("admin", (p) => pmsCan("admin", p), false), false, "admins do not amend by default");
    assert.equal(mayAmendNote("admin", () => true, false), true, "an admin given the permission may amend anyone's");
    assert.equal(mayAmendNote("staff", (p) => pmsCan("staff", p), true), false);
  });
});

describe("text rules", () => {
  it("postcodes, phones, search keys, dates and money", () => {
    assert.equal(normalisePostcode("mk39zz"), "MK3 9ZZ");
    assert.equal(normalisePostcode(" sw1a 1aa "), "SW1A 1AA");
    assert.equal(normalisePostcode("NOT A CODE"), null);
    assert.equal(phoneDigits("+44 (0) 7700 900123").startsWith("0"), true);
    assert.equal(phoneDigits("+44 7700 900123"), "07700900123");
    assert.equal(isPlausiblePhone("07700 900123"), true);
    assert.equal(isPlausiblePhone("01632 960001"), true);
    assert.equal(isPlausiblePhone("+33 1 23 45 67 89"), true);
    assert.equal(isPlausiblePhone("12345"), false);
    assert.equal(searchKey("Zoë", "O'Brien-Smith", null), "zoe o brien smith");
    assert.equal(isIsoDate("2026-02-29"), false);
    assert.equal(isIsoDate("2028-02-29"), true);
    assert.equal(yearsBetween("2000-10-25", "2026-10-24"), 25);
    assert.equal(addYears("2024-02-29", 1), "2025-02-28");
    assert.equal(formatUkDate("2026-10-24"), "24/10/2026");
    assert.equal(formatPence(123456), "£1,234.56");
    assert.equal(formatPence(-50), "-£0.50");
    assert.equal(ukToday(new Date("2026-10-24T23:30:00.000Z")), "2026-10-25", "BST: already the 25th in the UK");
    assert.equal(ukToday(new Date("2026-12-24T23:30:00.000Z")), "2026-12-24", "GMT");
    assert.ok(hasPrefix("pat_01JB3K3Z9V8W7X6Y5Z4A3B2C1D", "pat"));
    assert.ok(!hasPrefix("case_01JB3K3Z9V8W7X6Y5Z4A3B2C1D", "pat"));
  });
});

describe("input schemas", () => {
  it("normalise what people type and explain what is wrong", () => {
    const ok = patientInputSchema("2026-10-24").parse({ firstName: " Megan ", lastName: "Hart", postcode: "mk3 9zz", email: " M@Example.COM ", phoneMobile: "07700  900123", title: "" });
    assert.equal(ok.firstName, "Megan");
    assert.equal(ok.postcode, "MK3 9ZZ");
    assert.equal(ok.email, "m@example.com");
    assert.equal(ok.phoneMobile, "07700 900123");
    assert.equal(ok.title, null);
    const bad = patientInputSchema("2026-10-24").safeParse({ firstName: "", lastName: "Hart", dateOfBirth: "1899-12-31", marketingSms: true });
    assert.equal(bad.success, false);
    const errors = fieldErrors(bad.error!);
    assert.ok(errors.firstName && errors.dateOfBirth && errors.marketingConsentSource, JSON.stringify(errors));
    assert.equal(PostcodeSchema.safeParse("ZZ").success, false);
    assert.equal(CaseInputSchema.safeParse({ patientId: "pat_1", title: "Knee", openedOn: "2026-10-02", closedOn: "2026-10-01" }).success, false);
  });
});

describe("retention (review dates only – nothing is deleted automatically)", () => {
  it("adults: 8 years after the last treatment", () => {
    assert.deepEqual(retentionReviewFrom({ dateOfBirth: "1991-11-22", lastTreatmentOn: "2026-07-07" }), { kind: "review_from", date: "2034-07-07", rule: "adult" });
    assert.deepEqual(retentionReviewFrom({ dateOfBirth: "1991-11-22", lastTreatmentOn: "2026-07-07" }, { adultYears: 10, childUntilAge: 25 }), { kind: "review_from", date: "2036-07-07", rule: "adult" });
    assert.equal((retentionReviewFrom({ dateOfBirth: "1991-11-22", lastTreatmentOn: "2026-07-07" }, { adultYears: 3, childUntilAge: 10 }) as { date: string }).date, "2034-07-07", "never below 8 years");
  });
  it("children: the 25th birthday (26th if 17 at the last treatment), never less than 8 years", () => {
    assert.deepEqual(retentionReviewFrom({ dateOfBirth: "2016-05-01", lastTreatmentOn: "2026-06-01" }), { kind: "review_from", date: "2041-05-01", rule: "child" });
    assert.deepEqual(retentionReviewFrom({ dateOfBirth: "2009-03-01", lastTreatmentOn: "2026-06-01" }), { kind: "review_from", date: "2035-03-01", rule: "child" });
    assert.deepEqual(retentionReviewFrom({ dateOfBirth: "2010-03-01", lastTreatmentOn: "2026-06-01" }), { kind: "review_from", date: "2035-03-01", rule: "child" });
  });
  it("a hold, an unknown date of birth or no treatment date needs a person", () => {
    assert.deepEqual(retentionReviewFrom({ dateOfBirth: "1991-11-22", lastTreatmentOn: "2026-07-07", legalHold: true }), { kind: "needs_person", reason: "legal_hold" });
    assert.deepEqual(retentionReviewFrom({ dateOfBirth: null, lastTreatmentOn: "2026-07-07" }), { kind: "needs_person", reason: "no_date_of_birth" });
    assert.deepEqual(retentionReviewFrom({ dateOfBirth: "1991-11-22", lastTreatmentOn: null }), { kind: "needs_person", reason: "no_treatment_date" });
    assert.deepEqual(retentionReviewFrom({ dateOfBirth: "1950-01-01", lastTreatmentOn: "2020-01-01", deceasedOn: "2026-01-10" }), { kind: "review_from", date: "2034-01-10", rule: "deceased" });
  });
});

describe("authorisations", () => {
  const base = { status: "active" as const, sessionsAuthorised: 6, valueAuthorisedPence: 30000, sessionsUsed: 5, valueUsedPence: 25000, validFrom: "2026-10-01", expiresOn: "2026-11-01" };
  it("what is left, the state and the warnings", () => {
    assert.deepEqual(authorisationView(base, "2026-10-24"), { state: "active", sessionsLeft: 1, valueLeftPence: 5000, daysToExpiry: 8, warnings: ["expires_soon", "few_sessions_left"] });
    assert.equal(authorisationView(base, "2026-11-02").state, "expired");
    assert.equal(authorisationView(base, "2026-09-30").state, "not_started");
    assert.equal(authorisationView({ ...base, sessionsUsed: 6 }, "2026-10-24").state, "exhausted");
    assert.equal(authorisationView({ ...base, status: "cancelled" }, "2026-10-24").state, "cancelled");
    assert.deepEqual(authorisationView({ ...base, sessionsAuthorised: null, valueAuthorisedPence: null, expiresOn: null }, "2026-10-24"), {
      state: "active",
      sessionsLeft: null,
      valueLeftPence: null,
      daysToExpiry: null,
      warnings: [],
    });
  });
  it("whether a session at a price can still be charged to it", () => {
    assert.equal(canUseAuthorisation(base, "2026-10-24", 5000), true);
    assert.equal(canUseAuthorisation(base, "2026-10-24", 5001), false);
    assert.equal(canUseAuthorisation({ ...base, sessionsUsed: 6 }, "2026-10-24"), false);
  });
});

describe("navigation", () => {
  it("only what the role allows, main before set-up, in order", () => {
    const entries = [
      { id: "b", module: "billing" as const, label: "Billing", href: "/app/clinic/billing", order: 30, permission: "billing.view" as const, group: "main" as const },
      { id: "s", module: "reporting" as const, label: "Sites", href: "/app/clinic/setup/sites", order: 60, permission: "settings.manage" as const, group: "manage" as const },
      { id: "d", module: "diary" as const, label: "Diary", href: "/app/clinic/diary", order: 10, permission: "diary.view" as const, group: "main" as const },
    ];
    assert.deepEqual(visibleNav(entries, (p) => pmsCan("staff", p)).map((e) => e.id), ["d", "b"]);
    assert.deepEqual(visibleNav(entries, (p) => pmsCan("owner", p)).map((e) => e.id), ["d", "b", "s"]);
  });
});
