// Polls until the API accepts a tiny request again (a refused request costs nothing). Prints one line per try.
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), maxRetries: 0 });
const deadline = Date.now() + Number(process.argv[2] ?? 40) * 60_000;
async function main() {
  while (Date.now() < deadline) {
    try {
      await client.messages.create({ model: "claude-sonnet-5-5", max_tokens: 16, output_config: { effort: "low" }, messages: [{ role: "user", content: "Reply OK." }] } as any);
      console.log(`${new Date().toISOString()} CREDIT OK`);
      return;
    } catch (e: any) {
      console.log(`${new Date().toISOString()} ${e?.status ?? ""} ${/credit balance/i.test(String(e?.message)) ? "credit too low" : String(e?.message).slice(0, 80)}`);
    }
    await new Promise((r) => setTimeout(r, 60_000));
  }
  console.log("gave up");
}
main();
