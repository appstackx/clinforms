// Probe: does each candidate model accept this app's exact request shape?
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
const Out = z.object({ answer: z.string(), sourceIds: z.array(z.string()) });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), maxRetries: 0, timeout: 50_000 });
const models = (process.argv[2] ?? "claude-sonnet-5-5,claude-opus-5-5,claude-opus-5,claude-sonnet-5,claude-haiku-5-5,claude-opus-4-8,claude-fable-5-1").split(",");
async function probe(model: string, effort: "low" | "medium" | "high") {
  const t = Date.now();
  try {
    const r = await client.beta.messages.parse({
      model, max_tokens: 2000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      system: [{ type: "text", text: "You answer from the record only, citing note ids.", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "text", text: "<episode>N-001 (18/03/2026): Neck pain 7/10 after a car accident.</episode>" , cache_control: { type: "ephemeral" } }, { type: "text", text: "What pain score was recorded? Cite the note." }] }],
      output_config: { effort, format: betaZodOutputFormat(Out) },
    } as any);
    return `${model.padEnd(18)} ${effort.padEnd(6)} OK served=${r.model} stop=${r.stop_reason} ${Date.now() - t}ms in=${r.usage.input_tokens} out=${r.usage.output_tokens} parsed=${JSON.stringify(r.parsed_output)}`;
  } catch (e: any) {
    return `${model.padEnd(18)} ${effort.padEnd(6)} FAIL ${e?.status ?? ""} ${String(e?.message ?? e).slice(0, 200)}`;
  }
}
async function main() {
  const out = await Promise.all(models.flatMap((m) => (["low", "high"] as const).map((e) => probe(m, e))));
  console.log(out.join("\n"));
}
main();
