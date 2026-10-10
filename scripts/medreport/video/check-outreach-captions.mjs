// Self-check of the outreach captions/narration against the hard rules.
// Usage: node selfcheck.mjs <captions.json> [extra files to scan for banned terms...]
import fs from "node:fs";

const [, , capPath, ...extra] = process.argv;
const CAP = JSON.parse(fs.readFileSync(capPath, "utf8"));
const problems = [];
const warn = [];

// Same patterns as record-demo.mjs (uppercase AI word; vendor / technology terms, case-insensitive).
const BANNED_AI = /(?:^|[^A-Za-z])(?:AI|A\.I\.)(?![A-Za-z])/g;
const BANNED_CI = /artificial intelligence|claude|anthropic|\bLLMs?\b|language models?|\bGPT|machine learning|\bneural|\bprompts?\b|\bbots?\b|\bmodels?\b|\bopus\b|\bsonnet\b|\bhaiku\b|opus-\d|sonnet-\d/gi;
// Extra checks for this video (customer-facing strings only).
const VENDORS = /elevenlabs|eleven labs|openai|google|microsoft|vercel|cloudflare|supabase|posthog|mailersend|cliniko|semble|writeupp|pabau|jane app/gi;
const INSURERS = /\bbupa\b|\baxa\b|\baviva\b|\bvitality\b|\bwpa\b|\ballianz\b|freedom health|simplyhealth|\bcigna\b|\bhealix\b|\bexeter\b|\bpremier\b/gi;
const PEOPLE = /\bdell\b|blue heart|\bRED\b|red physio|vatamanu|rebecca lane/g;
const CLAIMS = /\blive\b|real[- ]time|instant|seconds? to|minutes? to|save[sd]? (?:you )?(?:time|hours)|certif|accredit|iso ?27001|cyber essentials|integrat|partner|£|\bprice|\bpricing|\bcost/gi;
const TM3 = /TM3/g;

function scan(label, text, { customer }) {
  const hit = (re, kind) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) problems.push(`${kind} in ${label}: …${text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, " ")}…`);
  };
  hit(BANNED_AI, "BANNED 'AI'");
  hit(BANNED_CI, "BANNED term");
  if (customer) {
    hit(VENDORS, "VENDOR name");
    hit(INSURERS, "REAL insurer");
    hit(PEOPLE, "PROSPECT/real person");
    hit(CLAIMS, "CLAIM word");
    hit(TM3, "TM3 mention");
  }
}

// 1. Customer-facing strings in the JSON: captions, srt, vo, cards, teaser captions.
const customer = [];
for (const l of CAP.lines) {
  customer.push([`${l.id}.caption`, l.caption.join("\n")], [`${l.id}.srt`, l.srt], [`${l.id}.vo`, l.vo]);
  if (l.caption.length > 2) problems.push(`${l.id}: caption has ${l.caption.length} lines (max 2)`);
  for (const c of l.caption) if (c.length > 42) problems.push(`${l.id}: caption line over 42 chars (${c.length}): ${c}`);
}
for (const [k, c] of Object.entries(CAP.cards)) {
  const { start, end, vo, ...rest } = c;
  customer.push([`cards.${k}`, JSON.stringify(rest)]);
}
for (const t of CAP.teaser.shots) {
  customer.push([`teaser.${t.id}`, t.caption.join("\n")]);
  for (const c of t.caption) if (c.length > 34) warn.push(`teaser ${t.id}: line ${c.length} chars – check it fits big at 800 px: ${c}`);
}
for (const [label, text] of customer) scan(label, text, { customer: true });

// 2. Whole JSON except "about": the recorder's own guard.
{
  const { about, ...rest } = CAP;
  void about;
  scan("outreach-captions.json (all but about)", JSON.stringify(rest), { customer: false });
}

// 3. Narration: word count and slot fit (2.5 words/s relaxed; max 1.2x speed-up).
const words = (t) => t.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
let total = 0;
const rows = [];
for (const l of CAP.lines) {
  const w = words(l.vo);
  total += w;
  const slot = +(l.end - l.start).toFixed(2);
  const need = +(w / 2.5).toFixed(2);
  const speed = +(need / slot).toFixed(2);
  rows.push(`${l.id} @${l.start.toFixed(1).padStart(5)}s slot ${slot.toFixed(1)}s  ${String(w).padStart(2)}w  need≈${need.toFixed(1)}s  x${speed.toFixed(2)}`);
  if (speed > 1.2) problems.push(`${l.id}: needs ${need}s at 2.5 w/s in a ${slot}s slot (x${speed} > 1.2)`);
  else if (speed > 1.05) warn.push(`${l.id}: tight (x${speed})`);
}
if (total < 180 || total > 210) problems.push(`narration is ${total} words (target 180–210)`);

// 4. Timeline continuity.
let prevEnd = 0;
for (const s of CAP.shots) {
  if (Math.abs(s.start - prevEnd) > 0.01) problems.push(`shot ${s.id} starts at ${s.start}, previous ended at ${prevEnd}`);
  prevEnd = s.end;
}
if (prevEnd !== CAP.video.seconds) problems.push(`shots end at ${prevEnd}, video.seconds is ${CAP.video.seconds}`);
for (let i = 1; i < CAP.lines.length; i++) if (CAP.lines[i].start !== CAP.lines[i - 1].end) problems.push(`line ${CAP.lines[i].id} start ≠ previous end`);
const tsum = CAP.teaser.shots.reduce((s, t) => s + (t.seconds ?? t.out - t.in), 0);
if (Math.abs(tsum - CAP.teaser.seconds) > 0.05) problems.push(`teaser shots sum to ${tsum.toFixed(2)} s, teaser.seconds ${CAP.teaser.seconds}`);
if (tsum < 15 || tsum > 20.05) problems.push(`teaser ${tsum.toFixed(2)} s outside 15–20 s`);

// 5. Extra files (storyboard, narration script): banned terms everywhere; customer checks on quoted narration only.
for (const f of extra) {
  const text = fs.readFileSync(f, "utf8");
  scan(f, text, { customer: false });
  scan(f + " (vendor/insurer/person)", text.replace(/Simulated TM3[^\n|]*/g, ""), { customer: false });
  for (const re of [VENDORS, INSURERS, /\bdell\b|blue heart|vatamanu/gi]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) problems.push(`name in ${f}: …${text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, " ")}…`);
  }
}

console.log(rows.join("\n"));
console.log(`\nnarration: ${total} words; video ${CAP.video.seconds} s; teaser ${tsum.toFixed(1)} s`);
if (warn.length) console.log("\nwarnings:\n- " + warn.join("\n- "));
console.log(problems.length ? "\nPROBLEMS:\n- " + problems.join("\n- ") : "\nself-check: no problems");
process.exitCode = problems.length ? 1 : 0;
