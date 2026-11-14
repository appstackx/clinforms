/**
 * ClinDesk's website and the self-serve free trial (src/lib/clindesk/trial-cta.ts): with self sign-up OFF for the clinic
 * brand (the default) nothing changes – no "Start free trial", the trial sentence is the content file's exactly; ON, the
 * header, home hero and pricing page offer it next to "Book a demo" and the sentence reads "14-day free trial, no card
 * needed". Rendered with react-dom/server. Run by npm run test:site.
 */
import * as React from "react";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { clindeskTrialOffered, clindeskTrialSummary } from "@/lib/clindesk/trial-cta";
import { contentText } from "@/lib/clindesk/content";
import { SiteHeader } from "./site-header";
import { StartTrialButton, TrialSummary } from "./trial-cta";

(globalThis as unknown as { React: typeof React }).React = React;

const saved = { s: process.env.CLINFORMS_SELF_SIGNUP, d: process.env.CLINFORMS_TRIAL_DAYS };
afterEach(() => {
  if (saved.s === undefined) delete process.env.CLINFORMS_SELF_SIGNUP;
  else process.env.CLINFORMS_SELF_SIGNUP = saved.s;
  if (saved.d === undefined) delete process.env.CLINFORMS_TRIAL_DAYS;
  else process.env.CLINFORMS_TRIAL_DAYS = saved.d;
});

describe("ClinDesk website – free trial calls to action", () => {
  it("OFF (default, or only ClinForms' host): no trial link anywhere, the sentence exactly as the content file says", () => {
    for (const v of [undefined, "", "forms", "on"]) {
      if (v === undefined) delete process.env.CLINFORMS_SELF_SIGNUP;
      else process.env.CLINFORMS_SELF_SIGNUP = v;
      assert.equal(clindeskTrialOffered(), false, String(v));
      const header = renderToStaticMarkup(createElement(SiteHeader, { current: "/" }));
      assert.doesNotMatch(header, /start-trial|Start free trial/);
      assert.equal(renderToStaticMarkup(createElement(StartTrialButton, {})), "");
      assert.equal(renderToStaticMarkup(createElement(TrialSummary)), contentText("pricing.trialSummary").text);
      assert.equal(clindeskTrialSummary().text, "Free trial available after your demo");
    }
  });
  it("ON for the clinic brand: header (desktop and menu), buttons and the sentence; Book a demo stays", () => {
    process.env.CLINFORMS_SELF_SIGNUP = "clinic";
    const header = renderToStaticMarkup(createElement(SiteHeader, { current: "/" }));
    assert.equal((header.match(/href="\/start-trial"/g) ?? []).length, 2, "desktop actions and the menu sheet");
    assert.match(header, /Book a demo/);
    assert.match(renderToStaticMarkup(createElement(StartTrialButton, {})), /<a class="btn btn-outline" href="\/start-trial" data-cta="start_trial">Start free trial/);
    assert.equal(renderToStaticMarkup(createElement(TrialSummary)), "14-day free trial, no card needed");
    process.env.CLINFORMS_TRIAL_DAYS = "30";
    assert.equal(clindeskTrialSummary().text, "30-day free trial, no card needed");
  });
});
