/**
 * Completing a form when the demo's live passcode is refused (rotated on the server while the tab was open): the
 * Studio's generateReport() re-confirms live drafting once before the first /drafts call (confirmLive), and when a
 * group is refused anyway (401 PASSCODE_INVALID mid-run) no group asks for live drafting again – the refused ones
 * and the rest ask for the demo answers (prefer "demo", where no passcode is checked) or, where this deployment
 * holds none for the form, fail without another request. Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "@/app/api/_medreport-glue";
import { DraftsResponseSchema, type BundleResponse, type DraftsRequest } from "@/modules/medreport/api/contract";
import { handleDrafts } from "@/modules/medreport/api/handlers/drafts";
import { withAttestedConfirmation } from "@/modules/medreport/auth/attestations";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import type { FormDefinition } from "@/modules/medreport/core/types";
import { getSampleForm } from "@/modules/medreport/forms/samples/registry";
import { ApiError } from "@/modules/medreport/ui/api-client";
import { NO_DEMO_DRAFT_CODE, generateReport, type GenerateInput } from "@/modules/medreport/ui/components/new/generate";
import { getDemoBundle } from "./dev-bundles";
import { demoBearer } from "./test-actors";

const drafts = route(handleDrafts);

const passcodeRefused = () =>
  new ApiError({
    type: "about:blank",
    title: "Passcode not recognised",
    status: 401,
    code: "PASSCODE_INVALID",
    detail: "Check the live drafting passcode and try again.",
  });

async function harrowPike(): Promise<FormDefinition> {
  const entry = getSampleForm("harrow-pike-treating-physio");
  assert.ok(entry?.loadForm);
  return withAttestedConfirmation((await entry.loadForm())!, "Practice manager", "2026-10-01T09:00:00.000Z");
}

/**
 * A client whose "live" calls (prefer auto) are refused – the passcode it would send was rotated – and whose
 * prefer "demo" calls get the deployment's recorded demo answers from the real handler.
 */
function rotatedClient(onCall?: () => void) {
  const calls: { prefer: DraftsRequest["prefer"]; keys: string }[] = [];
  const client = {
    async drafts(body: DraftsRequest) {
      onCall?.();
      calls.push({ prefer: body.prefer, keys: body.sectionKeys.join("+") });
      if (body.prefer !== "demo") throw passcodeRefused();
      const res = await drafts(
        new Request("http://127.0.0.1:9/api/reports/v1/drafts", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: demoBearer() },
          body: JSON.stringify(body),
        }),
        { params: {} },
      );
      assert.equal(res.status, 200);
      return DraftsResponseSchema.parse(await res.json());
    },
    async validate() {
      throw new Error("validation is best effort here");
    },
  } as unknown as GenerateInput["client"];
  return { client, calls };
}

function dataFor(form: FormDefinition, demoCovers: boolean | undefined): Pick<BundleResponse, "bundle" | "computedFacts" | "demoDrafts"> {
  const bundle = getDemoBundle("megan-hart");
  return {
    bundle,
    computedFacts: computeFacts(bundle),
    ...(demoCovers === undefined ? {} : { demoDrafts: { templateIds: [], formSha256s: demoCovers ? [form.file.sha256] : [] } }),
  };
}

test("refused mid-run, one group at a time: one live request in all; every group gets the demo answers", async () => {
  const form = await harrowPike();
  const { client, calls } = rotatedClient();
  const result = await generateReport({
    client,
    data: dataFor(form, true),
    target: { kind: "form", form },
    livePossible: true,
    concurrency: 1,
    now: () => new Date("2026-10-06T10:00:00Z"),
  });
  assert.ok(result.groups.length >= 2, `groups: ${result.groups.length}`);
  assert.equal(result.failedGroups, 0);
  assert.ok(result.groups.every((g) => g.status === "done" && g.mode?.startsWith("demo_")));
  assert.equal(calls.filter((c) => c.prefer !== "demo").length, 1, "one refused live request (one wrong guess)");
  assert.equal(calls.length, result.groups.length + 1, "the refused group once more, the rest once");
});

test("refused mid-run, three groups at once: only the groups already sent are refused; all end with the demo answers", async () => {
  const form = await harrowPike();
  const { client, calls } = rotatedClient();
  const result = await generateReport({ client, data: dataFor(form, undefined), target: { kind: "form", form }, livePossible: true, concurrency: 3 });
  assert.equal(result.failedGroups, 0);
  assert.ok(result.groups.every((g) => g.status === "done" && g.mode?.startsWith("demo_")));
  assert.ok(calls.filter((c) => c.prefer !== "demo").length <= Math.min(3, result.groups.length), JSON.stringify(calls));
});

test("refused mid-run where the deployment holds no demo answers for the form: the rest fail without a request", async () => {
  const form = await harrowPike();
  const { client, calls } = rotatedClient();
  const result = await generateReport({ client, data: dataFor(form, false), target: { kind: "form", form }, livePossible: true, concurrency: 1 });
  assert.equal(calls.length, 1, "only the first group was sent");
  assert.equal(result.failedGroups, result.groups.length);
  assert.ok(result.groups.every((g) => g.status === "failed" && g.code === "PASSCODE_INVALID"));
  assert.ok(result.report.sections.every((s) => s.status !== "pending"), "left for the clinician");
});

test("confirmLive: asked once before the first /drafts call, only when live drafting is expected", async () => {
  const form = await harrowPike();
  const order: string[] = [];

  // Refused at the re-confirmation: no live request at all; the run goes as demo mode.
  const refused = rotatedClient(() => order.push("drafts"));
  const demoClient = {
    ...refused.client,
    drafts: (body: DraftsRequest, opts?: { signal?: AbortSignal }) => refused.client.drafts({ ...body, prefer: "demo" }, opts),
  } as GenerateInput["client"];
  let confirms = 0;
  const result = await generateReport({
    client: demoClient,
    data: dataFor(form, true),
    target: { kind: "form", form },
    livePossible: true,
    confirmLive: async () => {
      confirms += 1;
      order.push("confirm");
      return false;
    },
    concurrency: 3,
  });
  assert.equal(confirms, 1);
  assert.equal(order[0], "confirm", "before any drafting request");
  assert.equal(result.failedGroups, 0);

  // Refused at the re-confirmation and no demo answers for the form: nothing is sent.
  const none = rotatedClient();
  const skipped = await generateReport({ client: none.client, data: dataFor(form, false), target: { kind: "form", form }, livePossible: true, confirmLive: async () => false });
  assert.deepEqual(none.calls, []);
  assert.ok(skipped.groups.every((g) => g.code === NO_DEMO_DRAFT_CODE));

  // Demo mode already: never asked.
  let asked = false;
  const demo = rotatedClient();
  const demoClient2 = { ...demo.client, drafts: (body: DraftsRequest) => demo.client.drafts({ ...body, prefer: "demo" }) } as GenerateInput["client"];
  await generateReport({
    client: demoClient2,
    data: dataFor(form, true),
    target: { kind: "form", form },
    livePossible: false,
    confirmLive: async () => {
      asked = true;
      return true;
    },
  });
  assert.equal(asked, false);

  // A failing re-confirmation never blocks the run: the live calls decide.
  const failing = rotatedClient();
  const res = await generateReport({
    client: failing.client,
    data: dataFor(form, true),
    target: { kind: "form", form },
    livePossible: true,
    confirmLive: () => Promise.reject(new Error("network")),
    concurrency: 1,
  });
  assert.equal(failing.calls[0]?.prefer, "auto");
  assert.equal(res.failedGroups, 0);
});
