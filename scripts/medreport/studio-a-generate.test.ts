/**
 * Studio A: "Complete a form" generation (ui/components/new/generate.ts) against the Megan Hart demo
 * bundle and the Harrow & Pike sample form map, with a fake API client: code-filled answers, drafting
 * in groups with a concurrency cap, merge, failure handling (NO_DEMO_DRAFT) and the final validation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DraftsRequest, DraftsResponse, ValidateResponse } from "../../src/modules/medreport/api/contract";
import { MAX_FORM_FIELDS_PER_DRAFT } from "../../src/modules/medreport/config.public";
import { computeFacts } from "../../src/modules/medreport/core/computed-facts";
import { HARROW_PIKE_FORM } from "../../src/modules/medreport/forms/samples/maps/harrow-pike";
import { ApiError } from "../../src/modules/medreport/ui/api-client";
import { generateReport, instructingPartyOf } from "../../src/modules/medreport/ui/components/new/generate";
import { getDemoBundle } from "./dev-bundles";

function fakeClient(opts: { failKey?: string } = {}) {
  const calls: string[][] = [];
  const reportIds: Array<string | undefined> = [];
  let active = 0;
  let peak = 0;
  const client = {
    async drafts(body: DraftsRequest): Promise<DraftsResponse> {
      calls.push(body.sectionKeys);
      reportIds.push(body.reportId);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 3));
      active -= 1;
      assert.ok(body.form, "form reports send the form map");
      assert.equal(body.templateId, `form:${HARROW_PIKE_FORM.id}`);
      if (opts.failKey && body.sectionKeys.includes(opts.failKey)) {
        throw new ApiError({ type: "about:blank", title: "No demo draft", status: 422, code: "NO_DEMO_DRAFT", detail: "No recorded answers." });
      }
      return {
        sections: body.sectionKeys.map((key) => ({
          key,
          title: "",
          kind: "ai_narrative",
          status: "drafted",
          paragraphs: [{ id: `${key}-p1`, text: "As recorded on 18/03/2026.", sourceIds: ["N-001"], origin: "ai" }],
        })),
        gaps: [],
        flags: [],
        generation: { mode: "demo_recorded", sectionKeys: body.sectionKeys, at: "2026-10-06T09:00:00.000Z", promptVersion: "test" },
      };
    },
    async validate(): Promise<ValidateResponse> {
      return { flags: [], canSign: false, blocking: [] };
    },
  };
  return { client, calls, reportIds, peak: () => peak };
}

test("completes a referrer form: code-filled answers, grouped drafts (≤3 at once), merged and validated", async () => {
  const bundle = getDemoBundle("megan-hart");
  const computedFacts = computeFacts(bundle, { asOf: "2026-10-06" });
  const { client, calls, reportIds, peak } = fakeClient();
  const saved: string[] = [];
  const result = await generateReport({
    client,
    data: { bundle, computedFacts },
    target: { kind: "form", form: HARROW_PIKE_FORM },
    concurrency: 3,
    onReport: (r) => saved.push(r.updatedAt),
    now: () => new Date("2026-10-06T10:00:00.000Z"),
  });
  const { report } = result;
  assert.equal(report.form?.formId, HARROW_PIKE_FORM.id);
  assert.deepEqual(report.instructingParty, instructingPartyOf(bundle));
  assert.ok(calls.length > 0 && calls.every((g) => g.length >= 1 && g.length <= MAX_FORM_FIELDS_PER_DRAFT));
  assert.ok(peak() <= 3);
  // Every draft request names the report (a clinic's audit trail targets it; wave 2).
  assert.ok(reportIds.length > 0 && reportIds.every((id) => id === report.id));
  assert.equal(result.failedGroups, 0);
  assert.ok(result.groups.every((g) => g.status === "done" && g.mode === "demo_recorded"));
  // Registration answers are filled by code, never sent for drafting.
  const name = report.sections.find((s) => s.title === "Claimant name");
  assert.equal(name?.paragraphs[0]?.text, "Megan Hart");
  assert.equal(name?.paragraphs[0]?.origin, "from_records");
  const drafted = new Set(calls.flat());
  assert.ok(!drafted.has(name?.key ?? ""));
  for (const key of Array.from(drafted)) assert.equal(report.sections.find((s) => s.key === key)?.status, "drafted");
  assert.ok(saved.length >= 2, "the report is saved after creation and after merges");
});

test("a failed group leaves its questions for the clinician and is recorded", async () => {
  const bundle = getDemoBundle("megan-hart");
  const computedFacts = computeFacts(bundle, { asOf: "2026-10-06" });
  const first = fakeClient();
  const plan = await generateReport({ client: first.client, data: { bundle, computedFacts }, target: { kind: "form", form: HARROW_PIKE_FORM } });
  const failKey = plan.groups[0].keys[0];
  const { client } = fakeClient({ failKey });
  const result = await generateReport({ client, data: { bundle, computedFacts }, target: { kind: "form", form: HARROW_PIKE_FORM } });
  assert.equal(result.failedGroups, 1);
  const failed = result.groups.find((g) => g.keys.includes(failKey));
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.code, "NO_DEMO_DRAFT");
  for (const key of failed?.keys ?? []) assert.equal(result.report.sections.find((s) => s.key === key)?.status, "needs_input");
  assert.ok(result.report.activity.some((a) => a.action === "draft_failed"));
  assert.ok(result.groups.filter((g) => g !== failed).every((g) => g.status === "done"));
});

test("demo mode without a demo draft for this form: no drafting calls, questions left for the clinician", async () => {
  const bundle = getDemoBundle("megan-hart");
  const computedFacts = computeFacts(bundle, { asOf: "2026-10-06" });
  const { client, calls } = fakeClient();
  const result = await generateReport({
    client,
    data: { bundle, computedFacts, demoDrafts: { templateIds: [], formSha256s: ["f".repeat(64)] } },
    target: { kind: "form", form: HARROW_PIKE_FORM },
    livePossible: false,
  });
  assert.equal(calls.length, 0, "no /drafts calls that would return NO_DEMO_DRAFT");
  assert.ok(result.failedGroups > 0);
  assert.ok(result.groups.every((g) => g.status === "failed" && g.code === "NO_DEMO_DRAFT"));
  assert.ok(result.report.sections.filter((s) => s.kind !== "from_records" && s.kind !== "declaration").every((s) => s.status === "needs_input"));

  // With a demo draft for this exact file, or with a live passcode, drafting goes ahead.
  const covered = fakeClient();
  await generateReport({
    client: covered.client,
    data: { bundle, computedFacts, demoDrafts: { templateIds: [], formSha256s: [HARROW_PIKE_FORM.file.sha256] } },
    target: { kind: "form", form: HARROW_PIKE_FORM },
  });
  assert.ok(covered.calls.length > 0);
  const live = fakeClient();
  await generateReport({
    client: live.client,
    data: { bundle, computedFacts, demoDrafts: { templateIds: [], formSha256s: [] } },
    target: { kind: "form", form: HARROW_PIKE_FORM },
    livePossible: true,
  });
  assert.ok(live.calls.length > 0);
});
