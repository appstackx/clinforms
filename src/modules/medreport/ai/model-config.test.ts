/**
 * Which Claude model the live calls use (config.server.ts): MEDREPORT_MODEL, checked against the
 * allow-list, else the default "claude-sonnet-5-5"; read at call time; never shown to the clinic.
 *
 * Owner: ai agent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { handleHealth } from "../api/handlers/health";
import { bindHandler } from "../api/http";
import type { MedreportDeps } from "../api/deps";
import { AI_MODEL_ALLOW_LIST, DEFAULT_AI_MODEL, aiModel, resolveAiModel } from "../config.server";
import { NEUTRAL_ENGINE, hasBannedTerm } from "../core/wording";
import { callClaudeStructured, type ClaudeClient } from "./claude";

/** Run `fn` with MEDREPORT_MODEL set to `value` (undefined = unset), restoring it afterwards. */
async function withModelEnv<T>(value: string | undefined, fn: () => T | Promise<T>): Promise<T> {
  const before = process.env.MEDREPORT_MODEL;
  if (value === undefined) delete process.env.MEDREPORT_MODEL;
  else process.env.MEDREPORT_MODEL = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.MEDREPORT_MODEL;
    else process.env.MEDREPORT_MODEL = before;
  }
}

/** Captures warnings printed while `fn` runs. */
async function captureWarnings(fn: () => unknown): Promise<string[]> {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return lines;
}

test("the default model is Claude Sonnet 5.5, and it is on the allow-list", () => {
  assert.equal(DEFAULT_AI_MODEL, "claude-sonnet-5-5");
  assert.ok((AI_MODEL_ALLOW_LIST as readonly string[]).includes(DEFAULT_AI_MODEL));
  assert.deepEqual(resolveAiModel(undefined), { model: "claude-sonnet-5-5" });
  assert.deepEqual(resolveAiModel(""), { model: "claude-sonnet-5-5" });
  assert.deepEqual(resolveAiModel("   "), { model: "claude-sonnet-5-5" });
});

test("MEDREPORT_MODEL picks any allow-listed model (case and spaces ignored)", () => {
  for (const id of AI_MODEL_ALLOW_LIST) assert.deepEqual(resolveAiModel(id), { model: id });
  assert.deepEqual(resolveAiModel("  Claude-Opus-5-5 "), { model: "claude-opus-5-5" });
});

test("an unknown or misspelt MEDREPORT_MODEL is never sent: the default is used and the value is reported", () => {
  for (const raw of ["claude-sonnet-5.5", "claude-opus-5-5-20260401", "gpt-5", "claude-fable-5-1", "sonnet", "claude-sonnet-5-5; rm -rf /"]) {
    const r = resolveAiModel(raw);
    assert.equal(r.model, DEFAULT_AI_MODEL, raw);
    assert.equal(r.rejected, raw.trim(), raw);
  }
  assert.equal(resolveAiModel("x".repeat(500)).rejected?.length, 80, "the reported value is capped");
});

test("aiModel() reads MEDREPORT_MODEL at call time and warns once per rejected value", async () => {
  await withModelEnv(undefined, () => assert.equal(aiModel(), "claude-sonnet-5-5"));
  await withModelEnv("claude-opus-5-5", () => assert.equal(aiModel(), "claude-opus-5-5"));
  const warnings = await captureWarnings(() =>
    withModelEnv("claude-sonnet-9-9", () => {
      assert.equal(aiModel(), "claude-sonnet-5-5");
      assert.equal(aiModel(), "claude-sonnet-5-5");
    }),
  );
  assert.equal(warnings.length, 1);
  const event = JSON.parse(warnings[0]) as Record<string, unknown>;
  assert.equal(event.event, "config.model_rejected");
  assert.equal(event.value, "claude-sonnet-9-9");
  assert.equal(event.using, "claude-sonnet-5-5");
});

function fakeClient(calls: Array<Record<string, unknown>>): ClaudeClient {
  const parse = (async (body: Record<string, unknown>) => {
    calls.push(body);
    const format = (body.output_config as { format: { parse(s: string): unknown } }).format;
    const text = JSON.stringify({ ok: true });
    return {
      id: "msg_model",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
      parsed_output: format.parse(text),
    };
  }) as unknown as ClaudeClient["beta"]["messages"]["parse"];
  return { beta: { messages: { parse } } };
}

test("every live call sends the configured model with an explicit effort and no thinking or sampling parameters", async () => {
  const schema = z.object({ ok: z.boolean() });
  const call = (client: ClaudeClient) =>
    callClaudeStructured({ system: "s", content: [{ type: "text", text: "c" }], schema, effort: "low", wording: { noun: "draft", alternative: "retry" }, client });

  const calls: Array<Record<string, unknown>> = [];
  const byDefault = await withModelEnv(undefined, () => call(fakeClient(calls)));
  const overridden = await withModelEnv("claude-opus-5-5", () => call(fakeClient(calls)));
  assert.deepEqual(
    calls.map((b) => b.model),
    ["claude-sonnet-5-5", "claude-opus-5-5"],
  );
  assert.equal(byDefault.model, "claude-sonnet-5-5", "the serving model is recorded");
  assert.equal(overridden.model, "claude-opus-5-5");
  for (const body of calls) {
    assert.deepEqual(body.output_config && { effort: (body.output_config as { effort: string }).effort }, { effort: "low" });
    for (const key of ["thinking", "temperature", "top_p", "top_k", "tool_choice"]) assert.equal(key in body, false, `no ${key}`);
    assert.equal(body.fallbacks, "default");
    assert.deepEqual(body.betas, ["server-side-fallback-2026-07-01"]);
  }
});

test("GET /health names the engine neutrally whatever MEDREPORT_MODEL says", async () => {
  const health = bindHandler(handleHealth, () => ({}) as MedreportDeps);
  for (const value of [undefined, "claude-opus-5-5", "claude-haiku-5-5"]) {
    const body = (await withModelEnv(value, async () => (await health(new Request("http://127.0.0.1:9/api/reports/v1/health"), { params: {} })).json())) as { model: string };
    assert.equal(body.model, NEUTRAL_ENGINE);
    assert.ok(!hasBannedTerm(body.model) && !/sonnet|opus|haiku/i.test(body.model));
  }
});
