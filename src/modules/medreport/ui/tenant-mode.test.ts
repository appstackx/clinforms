/**
 * Render tests (react-dom/server) of the Studio in its two modes:
 * - demo (default, /reports): everything the public demo had – drafting-mode badge, demo tools, Simulated TM3
 *   tiles and source tab, sandbox links, PH-DEMO hints, "In this demo" table – and /reports links;
 * - tenant (/app/studio): none of that, the notes upload as the source, the clinic and member in the header,
 *   /app/studio links, legal links in the footer, and no banned technology or vendor terms.
 */
import * as React from "react";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { BANNED_TERM_PATTERNS } from "../core/wording";
import { HostHooksProvider, type HostHooks } from "./host-hooks";
import { StudioShell } from "./components/shared/studio-shell";
import { SourceStep } from "./components/new/source-step";
import { DraftProgress } from "./components/new/draft-progress";
import { ActivityPanel } from "./components/review/activity-panel";
import { HomeScreen } from "./screens/home/home-screen";
import { BatchScreen } from "./screens/batch/batch-screen";
import { SecurityScreen } from "./screens/security/security-screen";
import { NewReportScreen } from "./screens/new/new-report-screen";
import { TENANT_COPY, tenantCopyStrings } from "./studio-copy";

// The test runner compiles JSX with the classic runtime (React.createElement).
(globalThis as unknown as { React: typeof React }).React = React;

const TENANT: HostHooks = {
  basePath: "/app/studio",
  mode: "tenant",
  storage: "server",
  clinic: { tenantId: "riverside-physio", name: "Riverside Physiotherapy", draftingEnabled: true },
  member: { name: "Alex Morgan", email: "alex@riverside.example", roleLabel: "Clinician", hcpc: "PH123456", canSign: true },
  accountHref: "/app",
  onSignOut: () => undefined,
  track: () => undefined,
};

const noopRouter = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
};

function render(element: ReactElement, hooks: HostHooks = {}, pathname = "/reports"): string {
  const tree = createElement(
    AppRouterContext.Provider,
    { value: noopRouter as never },
    createElement(PathnameContext.Provider, { value: pathname }, createElement(HostHooksProvider, { hooks } as { hooks: HostHooks; children: ReactNode }, element)),
  );
  return renderToStaticMarkup(tree);
}

/** Visible text: tags removed, entities decoded enough for matching. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function hrefs(html: string): string[] {
  return Array.from(html.matchAll(/href="([^"]*)"/g), (m) => m[1].replace(/&amp;/g, "&"));
}

/** Demo-only wording a clinic's Studio must never show. */
const DEMO_ONLY = /\bdemo\b|demonstration|fictional|simulated|sandbox|PH-DEMO|Sarah Reid|Priya Nair|In this demo|passcode|\bTM3\b/i;

function assertTenantClean(html: string): void {
  const visible = text(html);
  const hit = visible.match(DEMO_ONLY);
  assert.equal(hit, null, `demo wording in tenant mode: "${hit?.[0]}" in …${visible.slice(Math.max(0, (hit?.index ?? 0) - 60), (hit?.index ?? 0) + 60)}…`);
  for (const re of BANNED_TERM_PATTERNS) assert.ok(!re.test(visible), `banned term ${re} in tenant mode`);
  for (const href of hrefs(html)) {
    assert.ok(!href.startsWith("/reports"), `tenant link to the demo: ${href}`);
    assert.ok(!href.startsWith("/pms-sandbox"), `tenant link to the sandbox: ${href}`);
  }
}

const shell = (hooks: HostHooks, pathname: string) => render(createElement(StudioShell, null, createElement("p", null, "Body")), hooks, pathname);

describe("StudioShell", () => {
  it("demo (default): /reports navigation, drafting-mode badge, fictional-data footer, sandbox link, legal links", () => {
    const html = shell({}, "/reports/forms");
    const links = hrefs(html);
    for (const h of ["/reports", "/reports/new", "/reports/forms", "/reports/batch", "/reports/templates", "/reports/security", "/pms-sandbox"]) {
      assert.ok(links.includes(h), `demo link ${h}`);
    }
    for (const h of ["/privacy", "/cookies", "/terms", "/security"]) assert.ok(links.includes(h), `legal link ${h}`);
    const visible = text(html);
    assert.match(visible, /Fictional data only/);
    assert.match(visible, /Simulated TM3 sandbox – demo data, not affiliated with TM3/);
    assert.match(html, /aria-label="Drafting mode/i, "the drafting-mode badge");
    assert.match(html, /data-brand-mark/, "the site's mark");
    // "Referrer forms" is the current section
    assert.match(html, /aria-current="page"[^>]*>Referrer forms</);
  });

  it("tenant: /app/studio navigation, the clinic and the member, legal links, no demo chrome", () => {
    const html = shell(TENANT, "/app/studio/rpt_123");
    const links = hrefs(html);
    for (const h of ["/app/studio", "/app/studio/new", "/app/studio/forms", "/app/studio/templates", "/security", "/app"]) {
      assert.ok(links.includes(h), `tenant link ${h}`);
    }
    assert.ok(!links.includes("/app/studio/batch"), "no batch in a clinic's navigation (no connected clinic system)");
    for (const h of ["/privacy", "/cookies", "/terms", "/security"]) assert.ok(links.includes(h), `legal link ${h}`);
    const visible = text(html);
    assert.match(visible, /Riverside Physiotherapy/);
    assert.match(visible, /Alex Morgan/);
    assert.match(visible, /Sign out/);
    assert.match(visible, /Clinic settings/);
    assert.doesNotMatch(html, /aria-label="Drafting mode/i, "no drafting-mode badge");
    assert.match(html, /data-brand-mark/);
    // a report's review page highlights "Reports"
    assert.match(html, /aria-current="page"[^>]*>Reports</);
    assertTenantClean(html);
  });
});

describe("HomeScreen", () => {
  it("demo keeps its demo tools, Simulated TM3 tile and its hero", () => {
    const html = render(createElement(HomeScreen), {});
    const visible = text(html);
    assert.match(visible, /Demo tools/);
    assert.match(visible, /Import case JSON/);
    assert.match(visible, /Reset demo/);
    assert.match(visible, /Simulated TM3 connected/);
    assert.match(visible, /For physiotherapy clinics/);
    assert.match(visible, /Complete insurer & medico-legal report forms from your clinic notes/);
    assert.ok(hrefs(html).includes("/pms-sandbox"));
    assert.ok(hrefs(html).includes("/reports/new"));
  });

  it("tenant is a work queue: no hero, tiles or demo tools – the clinic, its forms and the two actions", () => {
    const html = render(createElement(HomeScreen), TENANT, "/app/studio");
    const visible = text(html);
    assert.doesNotMatch(visible, /Demo tools|Import case JSON|Reset demo/);
    assert.doesNotMatch(html, /data-demo-tools/);
    // Fix wave 2: no marketing hero, badges or connection tiles above the clinic's forms.
    assert.doesNotMatch(visible, /Complete MLC|Complete insurer|Connections and forms|Available now|UK GDPR|Clinician reviews/);
    assert.match(visible, /Riverside Physiotherapy/);
    assert.match(visible, /Completed and in-progress forms/);
    assert.ok(hrefs(html).includes("/app/studio/new"));
    assert.ok(hrefs(html).includes("/app/studio/forms"));
    assertTenantClean(html);
  });

  it("tenant, a new clinic: the first run starts with the referrer form, then the notes", async () => {
    const { TenantHome } = await import("./screens/home/home-screen");
    const home = (confirmedForms: number) =>
      render(createElement(TenantHome, { reports: [], ready: true, confirmedForms, formsReady: true, prefillFor: new Map() }), TENANT, "/app/studio");
    const empty = home(0);
    assert.match(text(empty), new RegExp(`${TENANT_COPY.home.firstFormTitle} – to do`));
    assert.match(empty, /href="\/app\/studio\/forms"[^>]*>Referrer forms</, "the next step is the referrer form");
    assertTenantClean(empty);
    const oneForm = home(1);
    assert.match(text(oneForm), new RegExp(`${TENANT_COPY.home.firstFormTitle} – done`));
    assert.match(text(oneForm), new RegExp(`${TENANT_COPY.home.firstReportTitle} – to do`));
    assertTenantClean(oneForm);
  });

  it("tenant with forms: in progress first, counts, version, next step and who approved", async () => {
    const { TenantHome } = await import("./screens/home/home-screen");
    const base = {
      instructingParty: { name: "Harbour Claims", type: "insurer" },
      form: { formId: "frm_1", title: "Progress report", referrer: { name: "Northfield Rehab", type: "insurer" }, fileSha256: "a".repeat(64), kind: "docx" },
      bundleSnapshot: { source: { simulated: false, label: "Notes upload" } },
      episodeRef: { connectorId: "file-import", patientId: "p", episodeId: "e" },
      flags: [],
      gaps: [],
      updatedAt: "2026-10-09T10:00:00.000Z",
    };
    const reports = [
      { ...base, id: "r1", patientLabel: "Alex Brown", status: "draft", version: 2 },
      { ...base, id: "r2", patientLabel: "Casey Doe", status: "signed", version: 2, receipt: { signer: { name: "Sam Patel", hcpc: "PH123456" } } },
    ] as unknown as import("../core/types").Report[];
    const html = render(createElement(TenantHome, { reports, ready: true, confirmedForms: 1, formsReady: true, prefillFor: new Map() }), TENANT, "/app/studio");
    const visible = text(html);
    assert.match(html, /aria-pressed="true"[^>]*>In progress <span[^>]*>1</);
    assert.match(visible, /Approved 1/);
    assert.match(visible, /All 2/);
    assert.match(visible, /Alex Brown/);
    assert.match(visible, /Amended – v2/, "an amended version is told apart from the original");
    assert.doesNotMatch(visible, /Casey Doe/, "approved forms are one click away, not in the way");
    assert.match(visible, /Next step/);
    assert.match(visible, /Approved by/);
    assert.match(visible, new RegExp(TENANT_COPY.home.readyForApproval));
    assert.match(html, /aria-label="Search by patient, referrer, form or approver"/);
    assertTenantClean(html);
  });
});

describe("SourceStep (Complete a form, step 1)", () => {
  it("demo offers the Simulated TM3 picker, the sandbox launch and the fictional samples", () => {
    const html = render(createElement(SourceStep, { onLoaded: () => undefined }));
    const visible = text(html);
    assert.match(visible, /Simulated TM3/);
    assert.match(visible, /Launch from the patient record/);
    assert.ok(hrefs(html).includes("/pms-sandbox"));
  });

  it("tenant offers the notes upload only – no picker, no sandbox, no samples to try, no PH-DEMO placeholder", () => {
    const html = render(createElement(SourceStep, { onLoaded: () => undefined }), TENANT, "/app/studio/new");
    const visible = text(html);
    assert.match(visible, /Drop the patient's notes here/);
    assert.match(visible, /Or paste notes/);
    assert.doesNotMatch(visible, /Find a patient|Launch from the patient record|Try the/);
    assert.doesNotMatch(html, /PH-DEMO|Sarah Reid/, "no demo placeholder in attributes either");
    assertTenantClean(html);
  });
});

describe("NewReportScreen", () => {
  it("tenant: production description, upload as the source", () => {
    const html = render(createElement(NewReportScreen, {}), TENANT, "/app/studio/new");
    assert.match(text(html), /from the patient's registration details and physiotherapy notes/);
    assertTenantClean(html);
  });
  it("demo keeps the TM3 description", () => {
    assert.match(text(render(createElement(NewReportScreen, {}))), /from the TM3 registration details/);
  });
});

describe("BatchScreen", () => {
  it("demo lists the Simulated TM3 episodes", () => {
    assert.match(text(render(createElement(BatchScreen))), /Episodes in Simulated TM3/);
  });
  it("tenant explains that batch needs a connected clinic system", () => {
    const html = render(createElement(BatchScreen), TENANT, "/app/studio/batch");
    assert.match(text(html), new RegExp(TENANT_COPY.batch.unavailableTitle));
    assert.ok(hrefs(html).includes("/app/studio/new"));
    assertTenantClean(html);
  });
});

describe("SecurityScreen", () => {
  it("demo shows the 'In this demo' table", () => {
    assert.match(text(render(createElement(SecurityScreen))), /In this demo/);
  });
  it("tenant never shows the demo table or demo sentences", () => {
    const html = render(createElement(SecurityScreen), TENANT, "/app/studio/security");
    const visible = text(html);
    assert.doesNotMatch(visible, /In this demo|This demo runs on|fictional/i);
  });
});

describe("Review pieces", () => {
  const noDemoGroup = [{ keys: ["F-01"], labels: ["Diagnosis"], status: "failed" as const, code: "NO_DEMO_DRAFT", error: "x" }];
  it("DraftProgress: a question left blank says so without demo wording in tenant mode", () => {
    const demo = text(render(createElement(DraftProgress, { groups: noDemoGroup as never, expectLive: false })));
    assert.match(demo, /no prepared demo answers/);
    const html = render(createElement(DraftProgress, { groups: noDemoGroup as never, expectLive: true }), TENANT);
    assert.match(text(html), new RegExp(TENANT_COPY.progress.leftBlank));
    assertTenantClean(html);
  });
  it("ActivityPanel: the trail's note is production wording in tenant mode", () => {
    const entries = [{ at: "2026-10-09T10:00:00.000Z", actor: "Alex Morgan", action: "drafted", detail: "Drafted F-01 from the notes." }];
    assert.match(text(render(createElement(ActivityPanel, { activity: entries as never }))), /Demo-grade audit trail/);
    const html = render(createElement(ActivityPanel, { activity: entries as never }), TENANT);
    assert.match(text(html), /recorded with the report/);
    assertTenantClean(html);
  });
});

describe("TENANT_COPY", () => {
  it("is production copy: no demo wording, no technology or vendor terms", () => {
    const strings = tenantCopyStrings();
    assert.ok(strings.length >= 20);
    for (const s of strings) {
      assert.doesNotMatch(s, DEMO_ONLY, s);
      for (const re of BANNED_TERM_PATTERNS) assert.ok(!re.test(s), `${re} in "${s}"`);
    }
  });
});

describe("fix wave 2: a clinic's Studio names no practice system it is not linked to", () => {
  it("field editor and source chips: 'From the patient record' / 'Record value' in tenant mode, TM3 in the demo", async () => {
    const { FieldEditor } = await import("./components/forms/field-editor");
    const { FillSourceChip } = await import("./components/shared/ui-bits");
    const { HARROW_PIKE_FORM } = await import("../forms/samples/maps/harrow-pike");
    const field = HARROW_PIKE_FORM.fields.find((f) => f.fillSource.kind === "registration");
    assert.ok(field);
    const editor = () =>
      createElement("div", null, [
        createElement(FieldEditor, { key: "e", field, formKind: HARROW_PIKE_FORM.kind, onChange: () => {}, onRemove: () => {}, picking: false, onTogglePick: () => {} }),
        createElement(FillSourceChip, { key: "c", kind: "registration" }),
      ]);
    const tenant = render(editor(), TENANT, "/app/studio/forms/frm_1");
    assertTenantClean(tenant);
    assert.match(text(tenant), /From the patient record/);
    assert.match(text(tenant), /Record value/);
    const demo = text(render(editor(), {}, "/reports/forms/frm_1"));
    assert.match(demo, /From TM3 registration/);
    assert.match(demo, /TM3 value/);
  });

  it("the home page shows no practice-system tile in tenant mode", () => {
    assertTenantClean(render(createElement(HomeScreen), TENANT, "/app/studio"));
  });
});

describe("fix wave 2: the voice of a clinic's drafts", () => {
  it("tenantAuthor: the member who can sign, else nobody (third-person drafts)", async () => {
    const { tenantAuthor } = await import("./screens/new/new-report-screen");
    assert.deepEqual(tenantAuthor({ name: "Sam Patel", hcpc: "PH123456", canSign: true, role: "clinician", jobTitle: "Physiotherapist" }), {
      name: "Sam Patel",
      hcpc: "PH123456",
      role: "Physiotherapist",
    });
    assert.equal(tenantAuthor({ name: "Jo Reception", role: "staff", canSign: false }), null);
    assert.equal(tenantAuthor({ name: "Olivia Owner", role: "owner", canSign: true }), null, "no HCPC number");
    assert.equal(tenantAuthor({ name: "Nia Lane", role: "clinician", hcpc: "PH9", canSign: false }), null, "may not sign");
    assert.equal(tenantAuthor(undefined), null);
  });

  it("generateReport: author null drafts with no author (third person), the clinician still fills clinician fields", async () => {
    const { createTargetReport } = await import("./components/new/generate");
    const { HARROW_PIKE_FORM } = await import("../forms/samples/maps/harrow-pike");
    const { getDemoBundle } = await import("../../../../scripts/medreport/dev-bundles");
    const bundle = getDemoBundle("megan-hart");
    const data = { bundle, computedFacts: [] };
    const none = createTargetReport({ data, target: { kind: "form", form: HARROW_PIKE_FORM }, author: null });
    assert.equal(none.author, undefined);
    const sam = { name: "Sam Patel", hcpc: "PH123456" };
    assert.deepEqual(createTargetReport({ data, target: { kind: "form", form: HARROW_PIKE_FORM }, author: sam }).author, sam);
    // Default (the demo): the treating clinician is the author, as before.
    assert.equal(createTargetReport({ data, target: { kind: "form", form: HARROW_PIKE_FORM } }).author?.name, "Sarah Reid");
  });
});
