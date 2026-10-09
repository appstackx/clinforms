# Dev tools (ad hoc, used during the build)

Run with `npx tsx <file>`. None of these is part of `npm test`.

| Script | Purpose |
|---|---|
| `probe-models.ts` | Probes which Claude models and effort levels the API key can use, and their cost/latency, for picking the cheapest suitable model |
| `credit-poll.ts` | Polls the Anthropic API until credit is available again (used when the credit ran out mid-recording) |
| `diff-recorded.ts` | Diffs recorded form analyses against an older backup folder: `npx tsx scripts/dev-tools/diff-recorded.ts <backup-dir>` |
| `flagcheck.ts` | Runs the validators over the demo bundles and prints the flags each one raises |
| `outline.ts` | Prints a form's outline, i.e. the blocks and fields the engine sees |
