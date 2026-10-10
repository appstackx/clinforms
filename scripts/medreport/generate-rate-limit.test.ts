/**
 * Completing a form while live drafting is at its per-minute limit (429 RATE_LIMITED): the Studio's
 * generateReport() waits for a free slot and tries again instead of leaving the questions blank, and
 * gives up only after RATE_LIMIT_ATTEMPTS tries.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "@/app/api/_medreport-glue";
import { DraftsResponseSchema, type DraftsRequest } from "@/modules/medreport/api/contract";
import { handleDrafts } from "@/modules/medreport/api/handlers/drafts";
import { withAttestedConfirmation } from "@/modules/medreport/auth/attestations";
import { computeFacts } from "@/modules/medreport/core/computed-facts";
import { WORDING } from "@/modules/medreport/core/wording";
import { getSampleForm } from "@/modules/medreport/forms/samples/registry";
import { ApiError } from "@/modules/medreport/ui/api-client";
import {
  RATE_LIMIT_ATTEMPTS,
  generateReport,
  type DraftGroupProgress,
  type GenerateInput,
} from "@/modules/medreport/ui/components/new/generate";
import { getDemoBundle } from "./dev-bundles";
import { demoBearer } from "./test-actors";

const drafts = route(handleDrafts);

const rateLimited = () =>
  new ApiError({
    type: "about:blank",
    title: "Too many live drafts",
    status: 429,
    code: "RATE_LIMITED",
    detail: WORDING.server.liveRateLimited(10, "use the demo answers"),
    retryable: true,
  });

async function setup(limitedCalls: (key: string, attempt: number) => boolean) {
  const entry = getSampleForm("harrow-pike-treating-physio");
  assert.ok(entry?.loadForm);
  const form = withAttestedConfirmation((await entry.loadForm())!, "Practice manager", "2026-10-01T09:00:00.000Z");
  const bundle = getDemoBundle("megan-hart");
  const attempts = new Map<string, number>();
  const sleeps: number[] = [];
  const progress: DraftGroupProgress[][] = [];
  const client: GenerateInput["client"] = {
    async drafts(body: DraftsRequest) {
      const key = body.sectionKeys.join("+");
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      if (limitedCalls(key, n)) throw rateLimited();
      // The recorded answers stand in for the live call.
      const res = await drafts(
        new Request("http://127.0.0.1:9/api/reports/v1/drafts", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: demoBearer() },
          body: JSON.stringify({ ...body, prefer: "demo" }),
        }),
        { params: {} },
      );
      assert.equal(res.status, 200);
      return DraftsResponseSchema.parse(await res.json());
    },
    async validate() {
      throw new Error("validation is best effort here");
    },
  } as GenerateInput["client"];
  const result = await generateReport({
    client,
    data: { bundle, computedFacts: computeFacts(bundle) },
    target: { kind: "form", form },
    livePossible: true,
    now: () => new Date("2026-10-06T10:00:00Z"),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    onProgress: (g) => progress.push(g),
  });
  return { result, attempts, sleeps, progress };
}

test("a group at the live per-minute limit waits for a free slot and is then drafted", async () => {
  let first: string | undefined;
  const { result, attempts, sleeps, progress } = await setup((key, n) => {
    first ??= key;
    return key === first && n <= 2;
  });
  assert.equal(result.failedGroups, 0);
  assert.ok(result.groups.every((g) => g.status === "done" && !g.waitingForSlot));
  assert.equal(attempts.get(first!), 3);
  assert.equal(sleeps.length, 2);
  assert.ok(progress.some((gs) => gs.some((g) => g.waitingForSlot)), "the progress list shows the wait");
  assert.ok(result.report.sections.some((s) => s.paragraphs.some((p) => p.origin === "ai")));
});

test("a group still at the limit after the last attempt is left for the clinician", async () => {
  let first: string | undefined;
  const { result, attempts, sleeps } = await setup((key) => {
    first ??= key;
    return key === first;
  });
  assert.equal(result.failedGroups, 1);
  const failed = result.groups.find((g) => g.status === "failed");
  assert.equal(failed?.code, "RATE_LIMITED");
  assert.equal(attempts.get(first!), RATE_LIMIT_ATTEMPTS);
  assert.equal(sleeps.length, RATE_LIMIT_ATTEMPTS - 1);
  assert.ok(failed?.keys.every((k) => result.report.sections.find((s) => s.key === k)?.status === "needs_input"));
});
