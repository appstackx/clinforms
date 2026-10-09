/** Analytics allow-lists: nothing identifying can leave the browser. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterOutgoingEvent, sanitizePath, sanitizeProps, sanitizeUrl, shouldCapturePageview } from "./events";

const ORIGIN = "https://clinforms.co.uk";

test("record ids in paths are replaced by :id", () => {
  assert.equal(sanitizePath("/"), "/");
  assert.equal(sanitizePath(""), "/");
  assert.equal(sanitizePath("/privacy"), "/privacy");
  assert.equal(sanitizePath("/reports"), "/reports");
  assert.equal(sanitizePath("/reports/rep_9f3a2b"), "/reports/:id");
  assert.equal(sanitizePath("/reports/forms/form-harrow-pike"), "/reports/forms/:id");
  assert.equal(sanitizePath("/reports/new?lt=secret-token"), "/reports/new");
  assert.equal(sanitizePath("/pms-sandbox/patients/sim-pat-001"), "/pms-sandbox/patients/:id");
  assert.equal(sanitizePath("/app/reports/abc/x#frag"), "/app/reports/:id/:id");
  assert.equal(sanitizePath("/accept-invite/inv_123"), "/accept-invite/:id");
  // the clinic's own Studio (wave 2)
  assert.equal(sanitizePath("/app/studio"), "/app/studio");
  assert.equal(sanitizePath("/app/studio/rpt_9f3a2b"), "/app/studio/:id");
  assert.equal(sanitizePath("/app/studio/forms/form_1"), "/app/studio/forms/:id");
  assert.equal(sanitizePath("/megan-hart"), "/:id");
});

test("URLs keep only the origin and a sanitised path; UTM tags only on public pages", () => {
  assert.equal(sanitizeUrl("https://clinforms.co.uk/?utm_source=newsletter&email=a%40b.com", ORIGIN), "https://clinforms.co.uk/?utm_source=newsletter");
  assert.equal(sanitizeUrl("https://clinforms.co.uk/reports/rep_1?utm_source=x", ORIGIN), "https://clinforms.co.uk/reports/:id");
  assert.equal(sanitizeUrl("https://clinforms.co.uk/reset-password?token=abc", ORIGIN), "https://clinforms.co.uk/reset-password");
  assert.equal(sanitizeUrl("https://www.google.com/search?q=megan+hart", ORIGIN), "https://www.google.com/");
  assert.equal(sanitizeUrl("$direct", ORIGIN), "$direct");
  assert.equal(sanitizeUrl("javascript:alert(1)", ORIGIN), null);
  assert.equal(sanitizeUrl(42, ORIGIN), null);
  assert.equal(sanitizeUrl("https://clinforms.co.uk/?utm_source=<script>", ORIGIN), "https://clinforms.co.uk/");
});

test("only allow-listed properties with allowed values survive", () => {
  assert.deepEqual(
    sanitizeProps({
      area: "app",
      form_kind: "docx",
      gap_count: 2,
      batch: true,
      sites: "2-5",
      // dropped:
      patient_name: "Megan Hart",
      email: "a@b.com",
      source: "Megan",
      mode: "LIVE",
      question_count: -1,
      answer_count: 1.5,
      duration_s: "12",
      first_time: "yes",
    }),
    { area: "app", form_kind: "docx", gap_count: 2, batch: true, sites: "2-5" },
  );
  assert.deepEqual(sanitizeProps(null), {});
  assert.deepEqual(sanitizeProps(["area"]), {});
});

test("page views are sent for the public pages only", () => {
  for (const p of ["/", "/privacy", "/cookies", "/terms", "/security", "/request-access"]) assert.equal(shouldCapturePageview(p), true, p);
  for (const p of ["/reports", "/reports/rep_1", "/pms-sandbox", "/app", "/app/settings/clinic", "/login", "/api/access-requests", "/nope"]) {
    assert.equal(shouldCapturePageview(p), false, p);
  }
});

test("the outgoing filter drops unknown events and app page views, and scrubs URLs and properties", () => {
  const base = { $current_url: "https://clinforms.co.uk/reports/rep_1?x=1", $pathname: "/reports/rep_1", $referrer: "https://clinforms.co.uk/pms-sandbox/patients/sim-pat-001", $browser: "Chrome", token: "phc_x", distinct_id: "anon" };
  assert.equal(filterOutgoingEvent({ event: "$autocapture", properties: base }, ORIGIN), null);
  assert.equal(filterOutgoingEvent({ event: "custom_event", properties: base }, ORIGIN), null);
  assert.equal(filterOutgoingEvent({ event: "$pageview", properties: base }, ORIGIN), null);
  assert.equal(filterOutgoingEvent(null, ORIGIN), null);

  const out = filterOutgoingEvent(
    {
      event: "report_approved",
      properties: { ...base, form_kind: "pdf_fillable", patient: "Megan Hart", title: "Megan Hart – review" },
      $set_once: { $initial_current_url: "https://clinforms.co.uk/reports/rep_1", $initial_pathname: "/reports/rep_1" },
    },
    ORIGIN,
  );
  assert.ok(out);
  assert.equal(out.properties.$current_url, "https://clinforms.co.uk/reports/:id");
  assert.equal(out.properties.$pathname, "/reports/:id");
  assert.equal(out.properties.$referrer, "https://clinforms.co.uk/pms-sandbox/patients/:id");
  assert.equal(out.properties.$browser, "Chrome");
  assert.equal(out.properties.form_kind, "pdf_fillable");
  assert.equal("patient" in out.properties, false);
  assert.equal("title" in out.properties, false);
  assert.equal(out.$set_once?.$initial_current_url, "https://clinforms.co.uk/reports/:id");
  assert.equal(out.$set_once?.$initial_pathname, "/reports/:id");

  const pageview = filterOutgoingEvent(
    { event: "$pageview", properties: { $current_url: "https://clinforms.co.uk/?utm_campaign=autumn&ref=x", $pathname: "/", title: "ClinForms" } },
    ORIGIN,
  );
  assert.ok(pageview);
  assert.equal(pageview.properties.$current_url, "https://clinforms.co.uk/?utm_campaign=autumn");
  assert.equal("title" in pageview.properties, false);
});
