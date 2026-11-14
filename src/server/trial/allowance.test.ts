/**
 * The Report API's refusal once a self-serve free trial's reports are used (src/modules/medreport/auth/clinic-access.ts
 * assertTrialReportsLeft, called by POST /drafts before a LIVE call): 403 TRIAL_REPORTS_USED with "buy the Reports
 * add-on" (ClinDesk) or "choose a plan" (ClinForms); a report that already counted may be drafted again; the public
 * demo and clinics without the cap are never affected; an unreadable count refuses (drafting costs money).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertTrialReportsLeft } from "../../modules/medreport/auth/clinic-access";
import type { ClinicProfile, MedreportDeps } from "../../modules/medreport/api/deps";

const member = { via: "session", tenantId: "larkfield" } as never;
function deps(trialReports: ClinicProfile["trialReports"], counted: (id: string) => boolean | Promise<boolean> = () => false): MedreportDeps {
  return {
    clinicProfile: async () => ({ tenantId: "larkfield", displayName: "L", addressLines: [], retentionDays: 30, draftingEnabled: true, ...(trialReports ? { trialReports } : {}) }),
    usage: { record: async () => undefined, reportCounted: async (_t: string, id: string) => counted(id) },
  } as never;
}
const refused = (err: unknown) => (err as { status?: number; init?: { code?: string } }).status === 403 && (err as { init?: { code?: string } }).init?.code === "TRIAL_REPORTS_USED";

describe("free trial – 10 reports, then 'buy the Reports add-on'", () => {
  it("under the allowance: allowed; at it: a new report refused, a counted one allowed", async () => {
    await assertTrialReportsLeft(member, deps({ included: 10, used: 9, addon: true }), { reportId: "rpt_new" });
    await assert.rejects(assertTrialReportsLeft(member, deps({ included: 10, used: 10, addon: true }), { reportId: "rpt_new" }), refused);
    await assertTrialReportsLeft(member, deps({ included: 10, used: 10, addon: true }, (id) => id === "rpt_old"), { reportId: "rpt_old" });
    await assert.rejects(assertTrialReportsLeft(member, deps({ included: 10, used: 10, addon: true }), {}), refused, "no report id: refused");
  });
  it("the words: the add-on for ClinDesk, a plan for ClinForms", async () => {
    const detail = async (addon: boolean) => {
      try {
        await assertTrialReportsLeft(member, deps({ included: 10, used: 12, addon }), { reportId: "rpt_x" });
      } catch (err) {
        return String((err as { init?: { detail?: string } }).init?.detail ?? "");
      }
      return "";
    };
    assert.match(await detail(true), /Buy the Reports add-on under Plan and billing/);
    assert.match(await detail(false), /Choose a plan under Plan and billing/);
  });
  it("never for the public demo, a clinic without the cap, or a count of 0 included … and fails closed", async () => {
    await assertTrialReportsLeft({ via: "demo", tenantId: "demo" } as never, deps({ included: 0, used: 5, addon: true }), {});
    await assertTrialReportsLeft(member, deps(undefined), { reportId: "rpt_new" });
    await assert.rejects(assertTrialReportsLeft(member, deps({ included: 0, used: 0, addon: true }), { reportId: "rpt_new" }), refused, "a repeat trial has no free reports");
    await assert.rejects(
      assertTrialReportsLeft(member, deps({ included: 10, used: 10, addon: true }, () => Promise.reject(new Error("db down"))), { reportId: "rpt_old" }),
      refused,
    );
  });
});
