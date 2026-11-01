/**
 * Browser check of the advertising measurement (src/components/ads/google-ads.ts) on both public sites, fictional data
 * only. For each site (ClinForms' and ClinDesk's):
 *   1. before any choice: the banner shows, nothing is requested from Google, no gtag / dataLayer, no _gcl_* cookie;
 *      the first Tab lands in the banner; Reject → still nothing, also after a reload;
 *   2. after Accept: the tag loads (gtag/js?id=AW-18548610866), the dataLayer starts with the denied defaults, then the
 *      granted update, then config AW-18548610866 with the linker;
 *   3. the demo form: a failed submit (server-side validation error) sends NO conversion; a successful submit sends the
 *      "Demo request" conversion exactly once (one dataLayer event; the network hits carry the conversion label and no
 *      form value); reloading the success page sends nothing more;
 *   4. app, demo, sign-in and patient routes with consent given: no Google request, no tag; a client-side navigation
 *      from a public page into the sign-in page reloads the page without the tag;
 *   5. withdrawing consent removes the _gcl_* cookies.
 * Google's measurement endpoints are answered locally (HTTP 204) after being recorded, so nothing reaches the Google
 * Ads account; only the tag script itself is fetched from Google.
 *
 *   CLINFORMS=http://localhost:3311 CLINDESK=http://clinic.localhost:3311 [MOCK_SUBMIT=1] \
 *     NODE_PATH=<node_modules with playwright> node scripts/e2e/google-ads.cjs
 *
 * MOCK_SUBMIT=1 (use it on a Vercel preview, whose forms would store real rows and may send a notification email):
 * ClinForms' POST /api/access-requests is answered in the browser (422, then 201 {ok:true}) and never reaches the
 * server; ClinDesk's form is then skipped unless CLINDESK is a local server (its server action cannot be answered in
 * the browser). Prints a JSON summary; exits 1 on any failed check.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const CLINFORMS = process.env.CLINFORMS || "http://localhost:3311";
const CLINDESK = process.env.CLINDESK || "";
const MOCK = process.env.MOCK_SUBMIT === "1";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/google-ads");
const TAG = "AW-18548610866";
const LABEL = "p4GXCKPR1K8dELKu1YxF";
const GOOGLE = /(^|\.)(google\.com|google\.co\.uk|googletagmanager\.com|googleadservices\.com|doubleclick\.net|google-analytics\.com|googlesyndication\.com)$/;
const FICTIONAL = { name: "Sam Fictional", clinic: "Testbed Physio (fictional)", email: "sam.fictional@example.com", phone: "01234 567890" };

const results = [];
let failed = 0;
async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ step: name, ok: true, ...(detail ? { detail } : {}) });
    console.log(`ok   ${name}${detail ? ` – ${JSON.stringify(detail)}` : ""}`);
  } catch (error) {
    failed++;
    results.push({ step: name, ok: false, error: String(error && error.message ? error.message : error) });
    console.log(`FAIL ${name}: ${error && error.stack ? error.stack : error}`);
  }
}

/** A browser context that records every Google request and answers the measurement endpoints locally. */
async function newContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const google = [];
  const csp = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!GOOGLE.test(url.hostname)) return route.continue();
    google.push({ url: url.toString(), host: url.hostname, path: url.pathname, page: route.request().frame()?.url?.() || "", at: Date.now() });
    if (url.hostname === "www.googletagmanager.com" && url.pathname === "/gtag/js") return route.continue();
    return route.fulfill({ status: 204, body: "" });
  });
  context.on("console", (msg) => {
    const text = msg.text();
    if (/Content Security Policy|Content-Security-Policy/i.test(text)) csp.push(text.slice(0, 300));
  });
  return { context, google, csp };
}

async function settle(page, ms = 1500) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

const gcl = async (context) => (await context.cookies()).map((c) => c.name).filter((n) => /^_gcl_|^_gac_/.test(n));
const dataLayer = (page) =>
  page.evaluate(() => (window.dataLayer || []).map((a) => JSON.parse(JSON.stringify(Array.from(a), (k, v) => (v instanceof Date ? "<date>" : v)))));
const conversionEvents = (dl) => dl.filter((c) => c[0] === "event" && c[1] === "conversion");
const conversionHits = (google) => google.filter((r) => r.url.includes(LABEL));

async function banner(page) {
  return page.getByRole("region", { name: "Cookie choices" });
}

/** Checks 1 and 2 on one site. Returns the context with consent accepted, at `formPath`. */
async function consentChecks(browser, site, origin, formPath) {
  // 1. Before any choice, then Reject.
  await step(`${site}: before consent – banner, no Google request, no tag`, async () => {
    const { context, google } = await newContext(browser);
    const page = await context.newPage();
    await page.goto(origin + formPath);
    await settle(page);
    assert.equal(await (await banner(page)).count(), 1, "banner shown");
    assert.deepEqual(google, [], "no Google request before consent");
    assert.equal(await page.evaluate(() => typeof window.gtag), "undefined");
    assert.equal(await page.evaluate(() => typeof window.dataLayer), "undefined");
    assert.deepEqual(await gcl(context), []);
    // Keyboard: the first Tab lands in the banner.
    await page.keyboard.press("Tab");
    const inBanner = await page.evaluate(() => Boolean(document.activeElement && document.activeElement.closest('[aria-label="Cookie choices"]')));
    assert.ok(inBanner, "first Tab is in the banner");
    const buttons = await (await banner(page)).getByRole("button").allInnerTexts();
    await (await banner(page)).getByRole("button", { name: "Reject", exact: true }).click();
    await settle(page);
    await page.reload();
    await settle(page);
    assert.equal(await (await banner(page)).count(), 0, "no banner after a choice");
    assert.deepEqual(google, [], "nothing after Reject");
    const consentCookie = (await context.cookies()).find((c) => c.name === "clinforms_consent");
    await context.close();
    return { buttons, consentCookie: consentCookie && { value: consentCookie.value, expiresInDays: Math.round((consentCookie.expires * 1000 - Date.now()) / 86400000), httpOnly: consentCookie.httpOnly, sameSite: consentCookie.sameSite } };
  });

  // 2. Accept → tag set up in order and loaded.
  const ctx = await newContext(browser);
  const page = await ctx.context.newPage();
  await step(`${site}: after Accept – tag ${TAG} loads, consent defaults denied first`, async () => {
    await page.goto(origin + formPath);
    await settle(page);
    assert.deepEqual(ctx.google, [], "nothing before Accept");
    await (await banner(page)).getByRole("button", { name: "Accept", exact: true }).click();
    await settle(page, 2500);
    const script = ctx.google.find((r) => r.path === "/gtag/js");
    assert.ok(script && script.url.includes(`id=${TAG}`), "gtag.js requested with the tag id");
    const dl = await dataLayer(page);
    assert.deepEqual(dl[0].slice(0, 2), ["consent", "default"]);
    assert.deepEqual(dl[0][2], { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied", wait_for_update: 500 });
    assert.deepEqual(dl[1], ["consent", "update", { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted", analytics_storage: "granted" }]);
    assert.equal(dl[2][0], "js");
    assert.deepEqual(dl[3], ["config", TAG, { linker: { domains: ["clindesk.co.uk", "clinforms.co.uk"] }, allow_enhanced_conversions: false }]);
    assert.equal(conversionEvents(dl).length, 0, "no conversion just for accepting");
    assert.equal(conversionHits(ctx.google).length, 0, "no conversion hit just for accepting");
    const firstParty = await gcl(ctx.context);
    const all = (await ctx.context.cookies()).map((c) => ({ name: c.name, domain: c.domain, days: c.expires > 0 ? Math.round((c.expires * 1000 - Date.now()) / 86400000) : "session" }));
    return { googleRequests: ctx.google.map((r) => `${r.host}${r.path}`), firstPartyGoogleCookies: firstParty, cookies: all };
  });
  return { ...ctx, page };
}

async function fillClinforms(page) {
  await page.getByLabel("Clinic name").fill(FICTIONAL.clinic);
  await page.getByLabel("Your name").fill(FICTIONAL.name);
  await page.getByLabel("Work email").fill(FICTIONAL.email);
  await page.getByLabel(/^Phone/).fill(FICTIONAL.phone);
  await page.getByLabel("Number of sites").selectOption("2-5");
}

async function fillClindesk(page) {
  await page.getByLabel(/^Your name/).fill(FICTIONAL.name);
  await page.getByLabel(/^Clinic or group name/).fill(FICTIONAL.clinic);
  await page.getByLabel(/^Work email/).fill(FICTIONAL.email);
  await page.getByLabel(/^Phone/).fill(FICTIONAL.phone);
  await page.getByLabel(/^Number of sites/).selectOption({ index: 1 });
}

function noFormValues(google) {
  for (const r of google) {
    const u = decodeURIComponent(r.url).toLowerCase();
    for (const v of Object.values(FICTIONAL)) assert.ok(!u.includes(v.toLowerCase()), `a Google request carries "${v}": ${r.url.slice(0, 200)}`);
    assert.ok(!/sam\.fictional|example\.com/.test(u), "no email in any Google request");
  }
}

async function clinformsForm(browser) {
  const ctx = await consentChecks(browser, "clinforms", CLINFORMS, "/request-access");
  const { page, google, context } = ctx;
  await step("clinforms: failed submits (browser check, then server 422) send no conversion", async () => {
    await page.getByRole("button", { name: "Request access" }).click(); // empty → the form's own checks
    await settle(page, 800);
    await fillClinforms(page);
    if (MOCK) {
      await page.route("**/api/access-requests", (route) =>
        route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Please check the highlighted fields.", fieldErrors: { email: "Enter a valid work email address." } }) }),
      );
    } else {
      // A real server-side rejection: an address the browser accepts and the server does not.
      await page.getByLabel("Work email").fill("sam.fictional@example");
    }
    await page.getByRole("button", { name: "Request access" }).click();
    await settle(page, 1500);
    assert.equal(await page.getByRole("status").count(), 0, "no thank-you state");
    assert.equal(conversionEvents(await dataLayer(page)).length, 0);
    assert.equal(conversionHits(google).length, 0);
    if (MOCK) await page.unroute("**/api/access-requests");
    await page.getByLabel("Work email").fill(FICTIONAL.email);
  });
  await step(`clinforms: a successful submit sends the conversion exactly once${MOCK ? " (submit answered in the browser)" : ""}`, async () => {
    if (MOCK) await page.route("**/api/access-requests", (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
    const before = google.length;
    await page.getByRole("button", { name: "Request access" }).click();
    await page.getByText("Thank you – we have your request").waitFor({ timeout: 15000 });
    await settle(page, 3000);
    const events = conversionEvents(await dataLayer(page));
    assert.equal(events.length, 1, "one conversion event");
    assert.deepEqual(events[0], ["event", "conversion", { send_to: `${TAG}/${LABEL}`, value: 1, currency: "GBP" }]);
    const hits = conversionHits(google.slice(before));
    assert.ok(hits.length >= 1, "a conversion request was sent");
    noFormValues(google);
    return { conversionRequests: hits.map((h) => `${h.host}${h.path}`) };
  });
  await step("clinforms: app, demo and sign-in routes – no tag, no Google request (consent given)", async () => {
    const visited = [];
    for (const p of ["/app", "/login", "/reports", "/pms-sandbox", "/accept-invite", "/two-factor", "/reset-password"]) {
      const before = google.length;
      await page.goto(CLINFORMS + p);
      await settle(page, 1200);
      visited.push(`${p} → ${new URL(page.url()).pathname}`);
      assert.equal(await page.evaluate(() => typeof window.gtag), "undefined", p);
      assert.equal(google.length, before, `${p}: Google request ${JSON.stringify(google.slice(before))}`);
    }
    return { visited };
  });
  await step("clinforms: a client-side link from a public page into sign-in reloads without the tag", async () => {
    await page.goto(CLINFORMS + "/");
    await settle(page, 2000);
    assert.equal(await page.evaluate(() => typeof window.gtag), "function", "tag on the home page");
    const before = google.length;
    await page.locator('footer a[href="/login"]').first().click();
    await page.waitForURL(/\/login/);
    await settle(page, 2000);
    assert.equal(await page.evaluate(() => typeof window.gtag), "undefined", "tag gone after the guard's reload");
    const after = google.slice(before).filter((r) => !/\/gtag\/js/.test(r.path));
    assert.deepEqual(after.filter((r) => r.page.includes("/login")), [], "no hit from /login");
    return { requestsDuringNavigation: after.map((r) => `${r.host}${r.path}`) };
  });
  await step("clinforms: withdrawing consent removes the _gcl_* cookies", async () => {
    await page.goto(CLINFORMS + "/cookies");
    await settle(page, 1500);
    const had = await gcl(context);
    await page.locator("footer").getByRole("button", { name: "Cookie settings" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reject all" }).click();
    await settle(page, 800);
    const left = await gcl(context);
    assert.deepEqual(left, [], `left: ${left}`);
    return { removed: had };
  });
  ctx.csp.length && results.push({ step: "clinforms: CSP report-only messages", ok: true, detail: ctx.csp.slice(0, 10) });
  await context.close();
}

async function clindeskForm(browser) {
  const ctx = await consentChecks(browser, "clindesk", CLINDESK, "/demo");
  const { page, google, context } = ctx;
  const local = /localhost/.test(CLINDESK);
  if (local || !MOCK) {
    await step("clindesk: a server-side validation error sends no conversion (and leaves no note)", async () => {
      await fillClindesk(page);
      await page.evaluate(() => {
        document.querySelector("form.d-form").noValidate = true;
      });
      await page.getByLabel(/^Work email/).fill("not-an-email");
      await page.getByRole("button", { name: /Book my demo/ }).click();
      await page.locator(".d-error-summary").waitFor({ timeout: 15000 });
      await settle(page, 1500);
      assert.match(await page.locator(".d-error-summary").innerText(), /Please check the answers/, "a validation answer from the server");
      assert.equal(await page.evaluate(() => sessionStorage.getItem("clindesk_demo_sent")), null, "note forgotten");
      assert.equal(conversionEvents(await dataLayer(page)).length, 0);
      assert.equal(conversionHits(google).length, 0);
    });
    await step("clindesk: a successful submit → /demo/thanks sends the conversion exactly once; a reload sends nothing", async () => {
      await page.getByLabel(/^Work email/).fill(FICTIONAL.email);
      const before = google.length;
      await page.getByRole("button", { name: /Book my demo/ }).click();
      await page.waitForURL(/\/demo\/thanks$/, { timeout: 15000 }).catch(async (error) => {
        const summary = await page.locator(".d-error-summary").innerText().catch(() => "(no error summary)");
        throw new Error(`no thank-you page: ${summary.replace(/\s+/g, " ").slice(0, 300)}`);
      });
      await settle(page, 3000);
      // Local `next start` only: Next renders a server action's redirect target by fetching it from its own
      // http://localhost:<port> origin, where the clinic brand's pages do not exist, so the soft navigation shows the
      // 404 page. On Vercel the fetch goes to the request's own host (clindesk.co.uk). Load the page as the server
      // would have rendered it; the note left by the form is still in this tab.
      let softNavigation = "rendered";
      if (/Page not found/.test(await page.locator("h1").first().innerText())) {
        softNavigation = "404 locally (next start) – reloaded";
        assert.equal(conversionEvents(await dataLayer(page)).length, 0, "nothing on the 404 page");
        await page.reload();
        await settle(page, 3000);
      }
      assert.match(await page.locator("h1").first().innerText(), /Thanks/);
      const events = conversionEvents(await dataLayer(page));
      assert.equal(events.length, 1, "one conversion event");
      assert.deepEqual(events[0], ["event", "conversion", { send_to: `${TAG}/${LABEL}`, value: 1, currency: "GBP" }]);
      const hits = conversionHits(google.slice(before));
      assert.ok(hits.length >= 1, "a conversion request was sent");
      noFormValues(google);
      const afterFirst = conversionHits(google).length;
      await page.reload();
      await settle(page, 2500);
      assert.equal(conversionEvents(await dataLayer(page)).length, 0, "reload: no event");
      assert.equal(conversionHits(google).length, afterFirst, "reload: no hit");
      await page.goto(CLINDESK + "/demo/thanks");
      await settle(page, 2000);
      assert.equal(conversionHits(google).length, afterFirst, "direct visit: no hit");
      return { softNavigation, conversionRequests: hits.map((h) => `${h.host}${h.path}`) };
    });
  }
  await step("clindesk: app, sign-in and patient routes – no tag, no Google request (consent given)", async () => {
    const visited = [];
    for (const p of ["/app", "/app/clinic", "/login", "/accept-invite", "/clinics/demo/booking", "/reports/x"]) {
      const before = google.length;
      await page.goto(CLINDESK + p);
      await settle(page, 1200);
      visited.push(`${p} → ${new URL(page.url()).pathname}`);
      assert.equal(await page.evaluate(() => typeof window.gtag), "undefined", p);
      assert.equal(google.length, before, `${p}: Google request ${JSON.stringify(google.slice(before))}`);
    }
    return { visited };
  });
  ctx.csp.length && results.push({ step: "clindesk: CSP report-only messages", ok: true, detail: ctx.csp.slice(0, 10) });
  await context.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    await clinformsForm(browser);
    if (CLINDESK) await clindeskForm(browser);
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ CLINFORMS, CLINDESK, MOCK, at: new Date().toISOString(), results }, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length} ok, ${failed} failed – ${path.join(OUT, "summary.json")}`);
  process.exit(failed ? 1 : 0);
})();
