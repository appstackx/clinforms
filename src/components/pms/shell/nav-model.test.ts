/** The clinic shell's navigation: filtered by permission, grouped, one current entry; the site cookie's fallback. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PmsNavEntry } from "@/modules/pms/core/nav";
import { pmsCan, type PmsRole } from "@/modules/pms/core/permissions";
import { PMS_NAV } from "@/modules/pms/nav";
import { clinicRoleLabel, currentNavId, currentSection, shellNav, sitesSummary } from "./nav-model";
import { resolveSiteChoice } from "./site-cookie";

const B = "/app/clinic";
// The design's full navigation (a small registry for the rules; the real one is checked below).
const DESIGN_NAV: PmsNavEntry[] = [
  { id: "foundation.overview", module: "foundation", label: "Dashboard", href: B, order: 0, permission: "clinic.view", group: "main" },
  { id: "diary.diary", module: "diary", label: "Diary", href: `${B}/diary`, order: 10, permission: "diary.view", group: "main" },
  { id: "diary.rotas", module: "diary", label: "Practitioner rotas", href: `${B}/diary/rotas`, order: 12, permission: "diary.rota", group: "manage" },
  { id: "records.patients", module: "records", label: "Patients", href: `${B}/patients`, order: 20, permission: "patients.view", group: "main" },
  { id: "billing.billing", module: "billing", label: "Billing", href: `${B}/billing`, order: 30, permission: "billing.view", group: "main" },
  { id: "comms.messages", module: "comms", label: "Messages", href: `${B}/messages`, order: 40, permission: "messages.send", group: "main" },
  { id: "reporting.reports", module: "reporting", label: "Reports", href: `${B}/reports`, order: 60, permission: ["reports.own", "reports.all"], group: "main" },
  { id: "reporting.sites", module: "reporting", label: "Sites and hours", href: `${B}/setup/sites`, order: 61, permission: "settings.setup", group: "manage" },
];

const as = (role: PmsRole) => (p: Parameters<typeof pmsCan>[1]) => pmsCan(role, p);
const labels = (role: PmsRole) => {
  const n = shellNav(DESIGN_NAV, as(role));
  return { main: n.main.map((i) => i.label), manage: n.manage.map((i) => i.label) };
};

describe("shell navigation by permission", () => {
  it("owners and administrators: the day-to-day list, Reports and one Set-up entry; the set-up pages in the Set-up section (sites first)", () => {
    for (const role of ["owner", "admin"] as const) {
      assert.deepEqual(labels(role), {
        main: ["Dashboard", "Diary", "Patients", "Billing", "Messages", "Reports", "Set-up"],
        manage: ["Sites and hours", "Practitioner rotas"],
      });
      const n = shellNav(DESIGN_NAV, as(role));
      assert.deepEqual(n.sections.map((x) => x.id), ["setup"]);
    }
  });

  it("reception: no Reports and no Set-up area – its rotas stay in the main list", () => {
    assert.deepEqual(labels("staff"), { main: ["Dashboard", "Diary", "Patients", "Billing", "Messages", "Practitioner rotas"], manage: [] });
    assert.deepEqual(shellNav(DESIGN_NAV, as("staff")).sections, []);
  });

  it("clinicians: Reports (their own caseload), no Set-up", () => {
    assert.deepEqual(labels("clinician"), { main: ["Dashboard", "Diary", "Patients", "Billing", "Messages", "Reports"], manage: [] });
  });

  it("gives each entry its icon (set-up pages their own)", () => {
    const n = shellNav(DESIGN_NAV, as("owner"));
    const icon = (id: string) => [...n.main, ...n.manage].find((i) => i.id === id)?.icon;
    assert.equal(icon("diary.diary"), "diary");
    assert.equal(icon("records.patients"), "patients");
    assert.equal(icon("billing.billing"), "billing");
    assert.equal(icon("diary.rotas"), "clock");
    assert.equal(icon("reporting.sites"), "site");
    assert.equal(icon("shell.setup"), "setup");
    assert.equal(icon("reporting.reports"), "reports");
    assert.equal(icon("foundation.overview"), "overview");
  });

  it("works on the real registry: reception and clinicians see no Set-up; owners see every set-up page in the design's order", () => {
    assert.deepEqual(shellNav(PMS_NAV, as("staff")).main.map((i) => i.label), ["Dashboard", "Diary", "Patients", "Billing", "Messages", "Practitioner rotas"]);
    assert.deepEqual(shellNav(PMS_NAV, as("staff")).manage, []);
    assert.deepEqual(
      shellNav(PMS_NAV, as("owner")).manage.map((i) => i.label),
      [
        "Sites and hours",
        "Rooms",
        "Services",
        "Price lists",
        "Referrers and insurers",
        "Practitioners",
        "Practitioner rotas",
        "Record templates",
        "Staff access",
        "Roles and permissions",
        "Online booking",
        "Intake forms",
        "Billing settings",
        "Message settings",
        "Report targets",
        "Audit trail",
        "Import data",
      ],
    );
    assert.deepEqual(shellNav(PMS_NAV, as("clinician")).main.map((i) => i.label), ["Dashboard", "Diary", "Patients", "Unsigned notes", "Billing", "Messages", "Reports"]);
    assert.deepEqual(shellNav(PMS_NAV, as("clinician")).manage, []);
  });

  it("a badge on an entry (Messages: replies waiting) only when the count is above 0", () => {
    const withBadge = shellNav(PMS_NAV, as("staff"), { "comms.messages": { count: 3, label: "replies to answer" } }).main.find((i) => i.id === "comms.messages");
    assert.deepEqual([withBadge?.badge, withBadge?.badgeLabel], [3, "replies to answer"]);
    const none = shellNav(PMS_NAV, as("staff"), { "comms.messages": { count: 0, label: "replies to answer" } }).main.find((i) => i.id === "comms.messages");
    assert.equal(none?.badge, undefined);
  });
});

describe("sections", () => {
  const n = shellNav(PMS_NAV, as("owner"));
  it("a set-up page – also another module's (Staff access, Online booking) – and /setup itself open the Set-up section", () => {
    assert.equal(currentSection("/app/clinic/setup/sites", n)?.id, "setup");
    assert.equal(currentSection("/app/clinic/access", n)?.id, "setup");
    assert.equal(currentSection("/app/clinic/online-booking", n)?.id, "setup");
    assert.equal(currentSection("/app/clinic/setup", n)?.id, "setup");
    assert.equal(currentSection("/app/clinic/diary", n), null);
    assert.equal(currentSection("/app/clinic", n), null);
  });
});

describe("current page", () => {
  const n = shellNav(DESIGN_NAV, as("owner"));
  const all = [...n.main, ...n.manage];
  it("the dashboard is current only on its own address", () => {
    assert.equal(currentNavId("/app/clinic", all), "foundation.overview");
    assert.equal(currentNavId("/app/clinic/", all), "foundation.overview");
    assert.equal(currentNavId("/app/clinic/design-system", all), null);
  });
  it("the longest matching address wins, so only one entry is current", () => {
    assert.equal(currentNavId("/app/clinic/diary", all), "diary.diary");
    assert.equal(currentNavId("/app/clinic/diary/waiting-list", all), "diary.diary");
    assert.equal(currentNavId("/app/clinic/diary/rotas", all), "diary.rotas");
    assert.equal(currentNavId("/app/clinic/patients/pat_1/notes", all), "records.patients");
    assert.equal(currentNavId("/app/clinic/patientsx", all), null);
  });
});

describe("role names", () => {
  it("calls staff Reception in the clinic system", () => {
    assert.equal(clinicRoleLabel("staff", "Staff"), "Reception");
    assert.equal(clinicRoleLabel("owner", "Owner"), "Owner");
    assert.equal(clinicRoleLabel("superuser", "Superuser"), "Superuser");
  });
});

describe("sites", () => {
  it("summarises the member's access", () => {
    assert.equal(sitesSummary(3, 3), "all 3 sites");
    assert.equal(sitesSummary(2, 11), "2 sites");
    assert.equal(sitesSummary(1, 1), "1 site");
    assert.equal(sitesSummary(0, 0), "no sites yet");
  });
  it("keeps a valid choice and falls back to the first site", () => {
    assert.equal(resolveSiteChoice("b", ["a", "b"], "all"), "b");
    assert.equal(resolveSiteChoice("zzz", ["a", "b"], "all"), "a");
    assert.equal(resolveSiteChoice(undefined, ["a"], "all"), "a");
    assert.equal(resolveSiteChoice("all", ["a", "b"], "all"), "all");
    assert.equal(resolveSiteChoice("all", ["a"], "all"), "a");
    assert.equal(resolveSiteChoice("a", [], "all"), null);
  });
});
