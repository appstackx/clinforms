/**
 * M10 H2: a ClinForms report drafted from the clinic system's own record (connector "native") with clinical content is
 * readable only by a member with the clinic system's clinical.view – through every store handler that returns or
 * changes a stored report (GET, PUT, DELETE, reuse) and /render. Every other report behaves exactly as before: the
 * same status and body with the host's rule wired in as without it. Run by test:pms.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

process.env.MEDREPORT_AI_MODE = "demo";

import type { AuthContext, MedreportDeps } from "../../modules/medreport/api/deps";
import { createMemoryTenantStore, type MemoryTenantStore } from "../../modules/medreport/api/store-memory";
import { storeApiPaths } from "../../modules/medreport/api/store-contract";
import type { Report } from "../../modules/medreport/core/types";
import { HARROW_PIKE_FORM } from "../../modules/medreport/forms/samples/maps/harrow-pike";
import { completedSampleReport } from "../../../scripts/medreport/form-sample-answers";
import { member, storeDeps, storeFetch } from "../../../scripts/medreport/store-harness";
import { mayReadNativeReport, nativeReportIsClinical } from "./native-report-access";
import { handleLaunchVerify } from "../../modules/medreport/api/handlers/launch-verify";
import { bindHandler } from "../../modules/medreport/api/http";
import { createLaunchToken } from "../../modules/medreport/auth/launch-token";

const A = "riverside-a";

function sample(id: string, connectorId: Report["episodeRef"]["connectorId"], opts: { clinical?: boolean; status?: Report["status"] } = {}): Report {
  const base = completedSampleReport("megan-hart", { ...HARROW_PIKE_FORM, tenantId: A }, { id });
  const snap = base.bundleSnapshot;
  return {
    ...base,
    tenantId: A,
    status: opts.status ?? "draft",
    episodeRef: { ...base.episodeRef, connectorId },
    bundleSnapshot: {
      ...snap,
      tenantId: A,
      source: { ...snap.source, connectorId },
      notes: opts.clinical === false ? [] : snap.notes,
      outcomeMeasures: opts.clinical === false ? [] : snap.outcomeMeasures,
    },
  };
}

describe("M10 H2: native reports with clinical content need clinical.view", () => {
  const actors: Record<string, AuthContext> = {
    clin: member(A, { userId: "user-clin", role: "clinician" }),
    rec: member(A, { userId: "user-rec", role: "staff" }),
  };
  /** The host's answer per member (resolveMemberAccess in the app). */
  const clinical = new Set(["user-clin"]);
  const reads: string[] = [];
  let store: MemoryTenantStore;
  let withRule: MedreportDeps;
  let without: MedreportDeps;
  const native = sample("rpt_native", "native");
  const nativeAdmin = sample("rpt_native_admin", "native", { clinical: false });
  const other = sample("rpt_tm3", "tm3-sim");

  before(async () => {
    store = createMemoryTenantStore();
    for (const r of [native, nativeAdmin, other]) assert.equal((await store.createReport(A, { id: r.id, status: r.status, templateId: r.templateId, formId: null, payload: r })).ok, true);
    without = storeDeps(store, actors);
    withRule = {
      ...without,
      mayReadReport: (actor, report) =>
        mayReadNativeReport(actor, report, async (_t, userId) => {
          reads.push(userId);
          return clinical.has(userId);
        }),
      restrictsReports: async () => true,
    };
  });

  const get = (deps: MedreportDeps, who: string, id: string) => storeFetch(deps, { member: who })(storeApiPaths.report(id));

  it("the rule: only native reports with notes, outcome scores or an approval", () => {
    assert.equal(nativeReportIsClinical(native), true);
    assert.equal(nativeReportIsClinical(nativeAdmin), false, "reception's form (no clinical prefill)");
    assert.equal(nativeReportIsClinical({ ...nativeAdmin, status: "signed" }), true, "an approved form holds the clinician's answers");
    assert.equal(nativeReportIsClinical(other), false, "every other connector is untouched");
  });

  it("GET: reception gets 404 for a clinical native report; the clinician reads it; reception's own form stays readable", async () => {
    assert.equal((await get(withRule, "rec", native.id)).status, 404);
    const body = await (await get(withRule, "rec", native.id)).json();
    assert.equal(body.code, "NOT_FOUND", "answered exactly like a report the clinic does not hold");
    assert.equal((await get(withRule, "clin", native.id)).status, 200);
    assert.equal((await get(withRule, "rec", nativeAdmin.id)).status, 200);
  });

  it("PUT, DELETE and reuse of a clinical native report are refused for reception (404, nothing changed or returned)", async () => {
    const rec = storeFetch(withRule, { member: "rec" });
    const put = await rec(storeApiPaths.report(native.id), { method: "PUT", headers: { "content-type": "application/json", "if-match": '"1"' }, body: JSON.stringify({ report: { ...native, patientLabel: "Changed" } }) });
    assert.equal(put.status, 404);
    assert.doesNotMatch(await put.text(), /Megan|bundleSnapshot/);
    // A create over it (no If-Match) would answer 409 with the stored copy – refused first.
    const create = await rec(storeApiPaths.report(native.id), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ report: { ...nativeAdmin, id: native.id } }) });
    assert.equal(create.status, 404);
    assert.doesNotMatch(await create.text(), /bundleSnapshot/);
    const del = await rec(storeApiPaths.report(native.id), { method: "DELETE" });
    assert.equal(del.status, 404);
    assert.ok(await store.getReport(A, native.id), "still held");
    const reuse = await rec(storeApiPaths.reportReuse(native.id), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(reuse.status, 404);
  });

  it("render: a clinical native report is not rendered for reception", async () => {
    const rec = storeFetch(withRule, { member: "rec" });
    const res = await rec("/api/reports/v1/render?format=pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report: native }) });
    assert.equal(res.status, 404);
  });

  it("every other report: the same answers with the rule wired in as without it, and no access read", async () => {
    reads.length = 0;
    for (const who of ["rec", "clin"]) {
      const a = await get(withRule, who, other.id);
      const b = await get(without, who, other.id);
      assert.equal(a.status, 200);
      assert.equal(a.status, b.status);
      assert.equal(await a.text(), await b.text());
      const ra = await storeFetch(withRule, { member: who })("/api/reports/v1/render?format=pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report: other }) });
      const rb = await storeFetch(without, { member: who })("/api/reports/v1/render?format=pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report: other }) });
      assert.equal(ra.status, rb.status, "render answers the same");
    }
    assert.deepEqual(reads, [], "the clinic-system access is only read for native reports");
  });
});

describe("M10 L7: a launch issued for one member opens only for that member", () => {
  it("another member of the same clinic is refused; the member it names gets the session; partner launches unchanged", async () => {
    const used = new Set<string>();
    const actors: Record<string, AuthContext> = { a: member(A, { userId: "user-a" }), b: member(A, { userId: "user-b" }) };
    const deps: MedreportDeps = {
      ...storeDeps(createMemoryTenantStore(), actors),
      sharedState: {
        hit: async () => ({ count: 1, resetAt: new Date(Date.now() + 60_000).toISOString() }),
        peek: async () => ({ count: 0, resetAt: new Date(Date.now() + 60_000).toISOString() }),
        reset: async () => undefined,
        claimOnce: async (id: string) => (used.has(id) ? false : (used.add(id), true)),
      } as unknown as MedreportDeps["sharedState"],
    };
    const verify = (who: string, token: string) =>
      bindHandler(handleLaunchVerify, () => deps)(new Request("http://localhost/api/reports/v1/launch/verify", { method: "POST", headers: { "content-type": "application/json", cookie: `member=${who}`, origin: "http://localhost" }, body: JSON.stringify({ token }) }), { params: {} });
    const base = { tenantId: A, connectorId: "native" as const, patientId: "pat_1", episodeId: "case_1", clinician: { name: "Sarah Reid (fictional)", hcpc: "PH-DEMO-01" } };
    const forA = createLaunchToken({ ...base, forUserId: "user-a" }).token;
    assert.equal((await verify("b", forA)).status, 403, "another member");
    assert.equal((await verify("a", forA)).status, 200, "the member it was issued for (not used up by the refusal)");
    const partner = createLaunchToken(base).token;
    assert.equal((await verify("b", partner)).status, 200, "a launch naming no member: as before");
  });
});
