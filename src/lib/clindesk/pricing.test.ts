/**
 * ClinDesk website prices (01/11/2026): the words the site shows come from the billing plan table checkout uses
 * (one source – no amount typed on a page), the Pricing page shows the real offer, every plan button books a demo,
 * and no page still shows a price placeholder.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CLINDESK_BANDS, REPORTS_ADDONS, YEARLY_MONTHS } from "@/lib/billing/plans";
import { SMS_PACKS } from "@/modules/pms/comms/credits";
import { BANNED_TERM_PATTERNS } from "@/modules/medreport/core/wording";
import {
  EXTRA_REPORT_PRICE,
  FREE_MONTHS_TEXT,
  FROM_PRICE,
  LARGEST_BAND_MAX,
  PLAN_CARDS,
  REPORTS_ALLOWANCES,
  REPORTS_FROM,
  REPORTS_TIERS,
  TEXT_PACKS,
} from "./pricing";

const ROOT = path.resolve(__dirname, "../../..");

// The pages are compiled with the classic JSX runtime under node:test; they import their stylesheets (Next bundles them); under node:test a .css file is nothing.
(globalThis as unknown as { React: typeof React }).React = React;
(require as unknown as { extensions: Record<string, () => void> }).extensions[".css"] = () => undefined;

async function render(page: string): Promise<{ html: string; text: string }> {
  const Page = (await import(`@/app/clindesk-site/${page}page`)).default as () => React.ReactElement;
  const html = renderToStaticMarkup(createElement(Page));
  const main = html.slice(html.indexOf('<main id="main">'), html.indexOf("</main>"));
  assert.ok(main.length > 500, `${page || "home"}: <main> found`);
  const text = main.replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;|’/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  return { html: main, text };
}

describe("ClinDesk website prices come from the billing plan table", () => {
  it("the plans, in words: Solo … Multi-site by practitioner band, yearly = 10 × monthly", () => {
    // Band names come from the plan table (one of them is a word the naming contract keeps out of code).
    assert.deepEqual(PLAN_CARDS.map((c) => c.name), CLINDESK_BANDS.map((b) => b.label));
    assert.deepEqual(
      PLAN_CARDS.map((c) => [c.practitioners, c.price.month, c.price.year]),
      [
        ["1 practitioner", "£25", "£250"],
        ["2–5 practitioners", "£50", "£500"],
        ["6–10 practitioners", "£85", "£850"],
        ["11–25 practitioners", "£149", "£1,490"],
        ["26–200 practitioners", "£249", "£2,490"],
      ],
    );
    assert.equal(PLAN_CARDS.length, CLINDESK_BANDS.length);
    assert.equal(YEARLY_MONTHS, 10);
    assert.equal(FREE_MONTHS_TEXT, "2 months free");
    assert.equal(LARGEST_BAND_MAX, 200);
    assert.equal(FROM_PRICE, "£25 a month");
  });
  it("the Reports add-on and extra reports", () => {
    assert.deepEqual(
      REPORTS_TIERS.map((t) => [t.reports, t.price.month, t.price.year]),
      [
        ["25", "£79", "£790"],
        ["100", "£159", "£1,590"],
        ["250", "£279", "£2,790"],
        ["500", "£439", "£4,390"],
      ],
    );
    assert.equal(REPORTS_TIERS.length, REPORTS_ADDONS.length);
    assert.equal(REPORTS_FROM, "From £79 a month for up to 25 reports");
    assert.equal(REPORTS_ALLOWANCES, "25, 100, 250 or 500");
    assert.equal(EXTRA_REPORT_PRICE, "£1.50");
  });
  it("the text message packs", () => {
    assert.deepEqual(
      TEXT_PACKS.map((p) => [p.credits, p.price, p.perText]),
      [
        ["500", "£40", "8p a text"],
        ["1,000", "£75", "7.5p a text"],
        ["5,000", "£325", "6.5p a text"],
      ],
    );
    assert.equal(TEXT_PACKS.length, SMS_PACKS.length);
  });
  it("no amount is typed on the Pricing page or the closing call to action (one source of truth)", () => {
    for (const f of ["src/app/clindesk-site/pricing/page.tsx", "src/components/clindesk/cta-band.tsx", "src/lib/clindesk/pricing.ts"]) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      // Comments may quote an example; code may not hold an amount.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      assert.ok(!/£\s?\d/.test(code), `${f} types a price`);
    }
    const json = fs.readFileSync(path.join(ROOT, "content/clindesk-site.json"), "utf8");
    for (const gone of ["pricing.fromPrice", "pricing.essentialsPrice", "pricing.completePrice", "pricing.groupPlan", "pricing.trialTerms", "reports.price", "reports.aboveAllowance"]) {
      assert.ok(!json.includes(`"${gone}"`), `${gone} is no longer a fill-in`);
    }
  });
});

describe("/pricing shows the real offer", () => {
  it("every plan with its monthly and yearly price, a Talk to us card above 200 practitioners, all features on every plan", async () => {
    const { html, text } = await render("pricing/");
    for (const c of PLAN_CARDS) {
      assert.ok(text.includes(`${c.name} ${c.practitioners} ${c.price.month} a month ${c.price.year} a year · 2 months free`), c.name);
    }
    assert.match(text, /Larger groups Over 200 practitioners Talk to us a plan built around your sites Talk to us/);
    assert.match(text, /Unlimited reception staff, sites and patients/);
    assert.match(text, /Every plan has every feature, with unlimited reception staff, sites and patients/);
    assert.match(text, /from £25 a month/);
    for (const old of ["Essentials", "Complete", "per practitioner a month", "[£X]"]) assert.ok(!text.includes(old), old);
    // The monthly / yearly switch: two radios in one group, monthly chosen – it works without JavaScript.
    assert.match(html, /<fieldset class="bill-switch"><legend class="bill-legend">Show prices<\/legend>/);
    assert.match(html, /<input type="radio" name="billing" id="bill-month" checked="" value="month"\/>/);
    assert.match(html, /<input type="radio" name="billing" id="bill-year" value="year"\/>/);
    assert.equal((html.match(/class="when-month"/g) ?? []).length, PLAN_CARDS.length + REPORTS_TIERS.length);
    assert.equal((html.match(/class="when-year"/g) ?? []).length, PLAN_CARDS.length + REPORTS_TIERS.length);
  });
  it("the Reports add-on, text packs, ClinForms on its own, no VAT and the trial after the demo", async () => {
    const { html, text } = await render("pricing/");
    for (const t of REPORTS_TIERS) assert.ok(text.includes(`Up to ${t.reports} ${t.price.month} a month ${t.price.year} a year`), t.reports);
    assert.match(text, /Extra reports £1\.50 each/);
    assert.match(text, /Reports is an add-on to any plan, for up to 25, 100, 250 or 500 reports a month\. From £79 a month for up to 25 reports\. Each report above your allowance is £1\.50\./);
    for (const p of TEXT_PACKS) assert.ok(text.includes(`${p.credits} credits ${p.price} ${p.perText}`), p.credits);
    assert.match(text, /Credits don't expire while your account is open/);
    assert.match(text, /not refundable/);
    assert.match(html, /On another clinic system\? ClinForms works on its own: <a class="link" href="https:\/\/clinforms\.co\.uk">clinforms\.co\.uk<\/a>/);
    assert.match(text, /No VAT is charged · Free trial available after your demo/);
    assert.match(text, /Is there a free trial\? Yes\. Free trial available after your demo – book a demo to get started\./);
    assert.match(text, /Do prices include VAT\? No VAT is charged\./);
    for (const k of ["pricing.trialSummary", "pricing.vat", "pricing.fromPrice", "reports.price", "reports.aboveAllowance", "pricing.trialTerms"]) {
      assert.ok(!html.includes(`data-to-confirm="${k}"`), k);
    }
  });
  it("every plan button books a demo; no checkout, sign-up or app link; no vendor names; neutral wording", async () => {
    const { html, text } = await render("pricing/");
    const planButtons = Array.from(html.matchAll(/<a class="btn [^"]*plan-btn" href="([^"]+)">([\s\S]*?)<\/a>/g));
    assert.equal(planButtons.length, PLAN_CARDS.length + 1);
    for (const [, href, label] of planButtons) {
      assert.equal(href, "/demo");
      assert.match(label, /^(Book a demo<span class="vh"> for the [A-Za-z-]+ plan<\/span>|Talk to us) /);
    }
    for (const [, href] of Array.from(html.matchAll(/href="([^"]+)"/g))) {
      assert.ok(!/checkout|billing|\/app\b|sign-?up|trial/i.test(href), `link ${href}`);
    }
    for (const vendor of [/stripe/i, /\bAI\b/, /anthropic/i, /claude/i, /sms works/i, /vercel/i, /cloudflare/i, /supabase/i]) {
      assert.ok(!vendor.test(text), `names ${vendor}`);
    }
    for (const re of BANNED_TERM_PATTERNS) assert.ok(!re.test(text), String(re));
  });
});

describe("other pages show the real prices", () => {
  const FROM_LINE = ["", "features/", "tour/"];
  const REPORTS_LINE = ["", "features/", "reports/"];
  for (const page of Array.from(new Set([...FROM_LINE, ...REPORTS_LINE]))) {
    it(`/${page}: ${[FROM_LINE.includes(page) && `"From ${FROM_PRICE}"`, REPORTS_LINE.includes(page) && `"${REPORTS_FROM}"`].filter(Boolean).join(" and ")}, no price placeholder`, async () => {
      const { html, text } = await render(page);
      if (FROM_LINE.includes(page)) assert.ok(text.includes(`From ${FROM_PRICE} · Reports is an add-on · See pricing`), "from-price line");
      if (REPORTS_LINE.includes(page)) assert.ok(text.includes(REPORTS_FROM), "Reports add-on price");
      for (const k of ["pricing.fromPrice", "reports.price"]) assert.ok(!html.includes(`data-to-confirm="${k}"`), k);
      assert.ok(!/\[£X/.test(text), "no [£X] placeholder");
    });
  }
});
