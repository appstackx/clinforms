/** The clinic shell's navigation: filtered by permission, grouped, one current entry; the site cookie's fallback. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PmsNavEntry } from "@/modules/pms/core/nav";
import { pmsCan, type PmsRole } from "@/modules/pms/core/permissions";
import { PMS_NAV } from "@/modules/pms/nav";
import { clinicRoleLabel, currentNavId, shellNav, sitesSummary } from "./nav-model";
import { resolveSiteChoice } from "./site-cookie";

const B = "/app/clinic";
// The design's full navigation, as the modules will register it (the registry on this branch has fewer entries).
const DESIGN_NAV: PmsNavEntry[] = [
  { id: "foundation.overview", module: "foundation", label: "Overview", href: B, order: 0, permission: "clinic.view", group: "main" },
  { id: "diary.diary", module: "diary", label: "Diary", href: `${B}/diary`, order: 10, permission: "diary.view", group: "main" },
  { id: "diary.rotas", module: "diary", label: "Rotas", href: `${B}/diary/rotas`, order: 12, permission: "diary.manage", group: "manage" },
  { id: "records.patients", module: "records", label: "Patients", href: `${B}/patients`, order: 20, permission: "patients.view", group: "main" },
  { id: "billing.billing", module: "billing", label: "Billing", href: `${B}/billing`, order: 30, permission: "billing.view", group: "main" },
  { id: "comms.messages", module: "comms", label: "Messages", href: `${B}/messages`, order: 40, permission: "messages.view", group: "main" },
  { id: "portal.booking", module: "portal", label: "Online booking", href: `${B}/online-booking`, order: 50, permission: "booking.manage", group: "main" },
  { id: "reporting.reports", module: "reporting", label: "Reports", href: `${B}/reports`, order: 60, permission: "reports.view", group: "main" },
  { id: "reporting.setup", module: "reporting", label: "Set-up", href: `${B}/setup`, order: 65, permission: "settings.manage", group: "manage" },
];

const as = (role: PmsRole) => (p: Parameters<typeof pmsCan>[1]) => pmsCan(role, p);
const labels = (role: PmsRole) => {
  const n = shellNav(DESIGN_NAV, as(role));
  return { main: n.main.map((i) => i.label), manage: n.manage.map((i) => i.label) };
};

describe("shell navigation by permission", () => {
  it("owners and administrators see everything, Reports in the list and Set-up below", () => {
    for (const role of ["owner", "admin"] as const) {
      assert.deepEqual(labels(role), {
        main: ["Overview", "Diary", "Patients", "Billing", "Messages", "Online booking", "Reports"],
        manage: ["Rotas", "Set-up"],
      });
    }
  });

  it("reception (staff) sees no Reports, no online-booking settings; of Set-up only Rotas", () => {
    // Roles design round 2: "Edit rotas and the waiting list" is a reception permission by default.
    assert.deepEqual(labels("staff"), { main: ["Overview", "Diary", "Patients", "Billing", "Messages"], manage: ["Rotas"] });
  });

  it("clinicians see the same day-to-day areas", () => {
    assert.deepEqual(labels("clinician"), { main: ["Overview", "Diary", "Patients", "Billing", "Messages"], manage: [] });
  });

  it("gives each entry its icon (Set-up entries share the sliders)", () => {
    const n = shellNav(DESIGN_NAV, as("owner"));
    const icon = (id: string) => [...n.main, ...n.manage].find((i) => i.id === id)?.icon;
    assert.equal(icon("diary.diary"), "diary");
    assert.equal(icon("records.patients"), "patients");
    assert.equal(icon("billing.billing"), "billing");
    assert.equal(icon("diary.rotas"), "setup");
    assert.equal(icon("reporting.setup"), "setup");
    assert.equal(icon("reporting.reports"), "reports");
    assert.equal(icon("foundation.overview"), "overview");
  });

  it("works on this branch's registry: Overview, Diary and Patients; Rotas (diary.rota) under Set-up for reception and owners", () => {
    assert.deepEqual(
      shellNav(PMS_NAV, as("staff")).main.map((i) => i.label),
      ["Overview", "Diary", "Patients"],
    );
    assert.deepEqual(
      shellNav(PMS_NAV, as("staff")).manage.map((i) => i.label),
      ["Rotas"],
    );
    assert.deepEqual(
      shellNav(PMS_NAV, as("owner")).manage.map((i) => i.label),
      ["Staff access", "Roles and permissions", "Rotas", "Note templates"],
    );
    assert.deepEqual(
      shellNav(PMS_NAV, as("clinician")).main.map((i) => i.label),
      ["Overview", "Diary", "Patients", "Unsigned notes"],
    );
    assert.deepEqual(shellNav(PMS_NAV, as("clinician")).manage, []);
  });
});

describe("current page", () => {
  const n = shellNav(DESIGN_NAV, as("owner"));
  const all = [...n.main, ...n.manage];
  it("the overview is current only on its own address", () => {
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
