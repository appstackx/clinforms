/**
 * Packages and usage counters (migration 0007, 25/10/2026) on node:sqlite and PGlite – the D1 runs (in-process gateway
 * Worker and real local D1) are in workers/data-gateway/test/admin-stack.test.ts. Plus the pure parts: UK months,
 * prices and estimated cost, money formatting. Run by `npm run test:db`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { BANNED_TERM_PATTERNS } from "../../modules/medreport/core/wording";
import { createMigratedPgliteDb } from "../db/testing/pglite";
import { createSqliteTestDb } from "../db/testing/databases";
import { PACKAGE_PRESETS, PLAN_COPY, effectiveMonthlyPence, extraReports, formatPence, formatPenceExact, parsePounds, periodLabel } from "../../lib/packages";
import { foundingEnd } from "../repos/clinic-package";
import { recentPeriods, shiftPeriod, ukDateOf, ukPeriodOf } from "../repos/usage-period";
import { estimateCostMicroUsd, microUsdToPence, modelPrice, parseUsdGbpRate, usdGbpRate } from "./pricing";
import { defineUsageSuite } from "./testing/usage-suite";

defineUsageSuite("node:sqlite", async () => {
  const t = createSqliteTestDb();
  return {
    db: t.db,
    close: t.close,
    dropUsageTables: async () => {
      for (const table of ["usage_event", "usage_report", "clinic_usage", "clinic_package"]) t.sqlite.exec(`DROP TABLE ${table}`);
    },
  };
});

defineUsageSuite(
  "PGlite (Postgres)",
  async () => {
    const { db, pglite } = await createMigratedPgliteDb();
    return {
      db,
      close: () => db.destroy(),
      dropUsageTables: async () => {
        await pglite.exec("DROP TABLE public.usage_event; DROP TABLE public.usage_report; DROP TABLE public.clinic_usage; DROP TABLE public.clinic_package;");
      },
    };
  },
  { concurrency: false },
);

describe("usage: months, prices and money (pure)", () => {
  it("a usage month is the UK calendar month", () => {
    assert.equal(ukPeriodOf(new Date("2026-09-30T23:30:00.000Z")), "2026-10", "00:30 BST on 1 October");
    assert.equal(ukPeriodOf(new Date("2026-10-31T23:30:00.000Z")), "2026-10", "23:30 GMT on 31 October");
    assert.equal(ukPeriodOf(new Date("2026-12-31T23:59:59.000Z")), "2026-12");
    assert.equal(ukDateOf(new Date("2026-03-28T23:30:00.000Z")), "2026-03-28", "GMT until 29 March 2026");
    assert.equal(ukDateOf(new Date("2026-06-30T23:30:00.000Z")), "2026-07-01", "BST");
    assert.deepEqual(recentPeriods("2026-02", 4), ["2026-02", "2026-01", "2025-12", "2025-11"]);
    assert.equal(shiftPeriod("2026-12", 1), "2027-01");
    assert.equal(periodLabel("2026-10"), "October 2026");
  });

  it("the price list presets match the agreed packages (ex VAT)", () => {
    assert.deepEqual(
      Object.values(PACKAGE_PRESETS).map((p) => [p.id, p.monthlyPricePence, p.reportsIncluded, p.extraReportPence]),
      [
        ["starter", 9900, 25, 150],
        ["practice", 19900, 100, 150],
        ["group", 34900, 250, 125],
        ["group_plus", 54900, 500, 150],
        ["custom", null, null, null],
        ["trial", 0, 25, 0],
      ],
    );
  });

  it("founding price applies to every month that starts on or before its last day; 12 months less a day by default", () => {
    const pkg = { monthlyPricePence: 19900, foundingPricePence: 14900, foundingUntil: "2027-10-24" };
    assert.equal(effectiveMonthlyPence(pkg, "2026-10"), 14900);
    assert.equal(effectiveMonthlyPence(pkg, "2027-10"), 14900);
    assert.equal(effectiveMonthlyPence(pkg, "2027-11"), 19900);
    assert.equal(effectiveMonthlyPence({ ...pkg, foundingPricePence: null }, "2026-10"), 19900);
    assert.equal(foundingEnd("2026-10-25"), "2027-10-24");
    assert.equal(foundingEnd("2026-01-31"), "2027-01-30");
    assert.equal(foundingEnd("2024-02-29"), "2025-02-27");
    assert.equal(extraReports(512, 500), 12);
    assert.equal(extraReports(3, 500), 0);
    assert.equal(extraReports(3, null), 0);
  });

  it("money: pounds typed → pence, pence → £", () => {
    assert.equal(parsePounds("199"), 19900);
    assert.equal(parsePounds("£1,234.5"), 123450);
    assert.equal(parsePounds("1.25"), 125);
    assert.equal(parsePounds(""), null);
    assert.ok(Number.isNaN(parsePounds("-1")));
    assert.ok(Number.isNaN(parsePounds("1.234")));
    assert.ok(Number.isNaN(parsePounds("abc")));
    assert.equal(formatPence(19900), "£199");
    assert.equal(formatPence(150), "£1.50");
    assert.equal(formatPence(123456), "£1,234.56");
    assert.equal(formatPenceExact(750), "£7.50");
    assert.equal(formatPenceExact(0), "£0.00");
  });

  it("estimated cost: per-model list prices, cache writes at 1.25 × input, unlisted models priced high", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadInputTokens: 1_000_000, cacheCreationInputTokens: 1_000_000 };
    assert.equal(estimateCostMicroUsd("claude-sonnet-5-5", usage), 2_000_000 + 10_000_000 + 200_000 + 2_500_000);
    assert.equal(estimateCostMicroUsd("claude-opus-5-5", { inputTokens: 1_000_000, outputTokens: 0 }), 4_000_000);
    assert.equal(estimateCostMicroUsd("claude-sonnet-5", { inputTokens: 0, outputTokens: 1_000 }), 10_000);
    assert.equal(modelPrice("something-new").listed, false);
    assert.equal(estimateCostMicroUsd("something-new", { inputTokens: 1_000_000, outputTokens: 0 }), 5_000_000);
    assert.equal(estimateCostMicroUsd("claude-sonnet-5-5", { inputTokens: -5, outputTokens: Number.NaN }), 0);
    assert.equal(microUsdToPence(1_000_000, 0.79), 79);
    assert.equal(usdGbpRate({}), 0.79);
    assert.equal(usdGbpRate({ CLINFORMS_USD_GBP_RATE: "0.8" }), 0.8);
    assert.equal(usdGbpRate({ CLINFORMS_USD_GBP_RATE: "lots" }), 0.79);
    assert.equal(parseUsdGbpRate("10"), null);
  });
});

describe("usage pages: guards, scoping and wording (source checks)", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("the platform usage page and its CSV are for platform administrators only; the package action re-checks the administrator", () => {
    const page = read("src/app/app/platform/usage/page.tsx");
    assert.match(page, /const admin = await requirePlatformAdmin\(\);/);
    const route = read("src/app/app/platform/usage/export/route.ts");
    assert.match(route, /const admin = await platformActionAdmin\(\);\n\s+if \(!admin\) return new Response\("Not found", \{ status: 404/);
    assert.match(route, /appendPlatformAudit\(\{ db \}, admin, \{\s+action: "platform\.usage_export"/);
    const actions = read("src/app/app/platform/actions.ts");
    const at = actions.indexOf("export async function packageAction");
    assert.ok(at >= 0);
    assert.match(actions.slice(at, at + 300), /const admin = await platformActionAdmin\(\);\n\s+if \(!admin\) return/);
    assert.match(actions, /setPackage\(getDb\(\), actor, tenantId,/);
    assert.match(actions, /removePackage\(getDb\(\), actor, tenantId\)/);
    assert.match(read("src/app/app/platform/page.tsx"), /href="\/app\/platform\/usage"/);
  });

  it("the clinic's page reads only the signed-in member's own clinic and role; every role finds it in Settings", () => {
    const page = read("src/app/app/(clinic)/settings/plan/page.tsx");
    assert.match(page, /const \{ membership \} = await requireAppContext\(\);/);
    assert.match(page, /clinicPlanUsage\(getDb\(\), \{ tenantId: membership\.tenantId, role: membership\.role \}\)/);
    assert.doesNotMatch(page, /searchParams|params\./, "no clinic id from the URL");
    assert.doesNotMatch(
      page,
      /costMicroUsd|costPence|inputTokens|outputTokens|cacheReadTokens|marginPence|platformUsage/,
      "no tokens or costs on a clinic's page",
    );
    const layout = read("src/app/app/(clinic)/layout.tsx");
    assert.match(layout, /\{ href: "\/app\/settings\/plan", label: "Plan & usage" \},\n\s+\.\.\.\(manager/);
  });

  it("customer-facing wording is neutral and says how a report counts", () => {
    const texts = [
      PLAN_COPY.rule,
      PLAN_COPY.again,
      PLAN_COPY.chargingLater,
      PLAN_COPY.exVat,
      PLAN_COPY.noPackage,
      PLAN_COPY.managersOnly,
      PLAN_COPY.inProgress,
      PLAN_COPY.shortLine(3, 25),
      PLAN_COPY.shortLine(1, null),
      PLAN_COPY.wouldBeCharged(2, "£1.50", "£3.00"),
    ];
    for (const text of texts) for (const re of BANNED_TERM_PATTERNS) assert.doesNotMatch(text, re, text);
    assert.equal(PLAN_COPY.rule, "A report counts when its answers are first drafted, or when it is approved if nothing needed drafting.");
    assert.equal(PLAN_COPY.shortLine(12, 500), "This month: 12 of 500 reports.");
    assert.equal(PLAN_COPY.chargingLater, "Charging for extra reports starts once billing is set up.");
  });
});
