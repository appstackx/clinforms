/**
 * Browser check of ClinDesk's public website (LOCAL only, fictional data): every page on the clinic brand's host
 * (http://clinic.localhost:<port>) at 1440 and 375 px – status, title, landmarks, one h1, no sideways scrolling, 44 px
 * targets, an axe-core WCAG 2.2 AA scan (and the same checks at 320 px), full-page screenshots; the pages without JavaScript (menu, FAQs, the demo
 * form posting and answering with its errors); "Book a demo" submitted with JavaScript and seen on /app/platform with
 * the ClinDesk label; ClinForms' own pages on http://localhost:<port> untouched (and, with BASELINE set to a server of
 * the base branch, byte-for-byte the same HTML apart from build ids and asset hashes).
 *
 *   BASE=http://localhost:3190 INVITE_A_FILE=<seed output with the platform admin's invitation> \
 *     [BASELINE=http://localhost:3191] [SHOTS=<folder for the page screenshots>] [AXE=<path to axe.min.js>] \
 *     NODE_PATH=<node_modules with playwright> node scripts/e2e/clindesk-site.cjs
 *
 * The invitation's owner must be in CLINFORMS_PLATFORM_ADMINS (the platform page step). Nothing secret is printed.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:3190";
const SITE = BASE.replace("localhost", "clinic.localhost");
const BASELINE = process.env.BASELINE || "";
const OUT = process.env.E2E_OUT || path.resolve(__dirname, "../../.e2e-out/clindesk-site");
const SHOTS = process.env.SHOTS || path.join(OUT, "pages");
const AXE = process.env.AXE || require.resolve("axe-core/axe.min.js");
const INVITE = (() => {
  const file = process.env.INVITE_A_FILE;
  if (!file) return null;
  const found = (fs.readFileSync(file, "utf8").match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._-]+/) || [])[0];
  if (!found) throw new Error(`No invitation link in ${file}`);
  return found;
})();

const PAGES = [
  ["home", "/"],
  ["features", "/features"],
  ["reports", "/reports"],
  ["pricing", "/pricing"],
  ["switching", "/switching"],
  ["security", "/security"],
  ["demo", "/demo"],
  ["demo-thanks", "/demo/thanks"],
  ["privacy", "/privacy"],
  ["terms", "/terms"],
  ["cookies", "/cookies"],
  ["accessibility", "/accessibility"],
];
const CLINFORMS_PAGES = ["/", "/demo", "/request-access", "/security", "/privacy", "/cookies", "/terms", "/robots.txt", "/sitemap.xml"];

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of input.replace(/[\s=]/g, "").toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totp(key, at = Date.now()) {
  const counter = Math.floor(at / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac("sha1", key).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, "0");
}
async function freshCode(key) {
  const left = 30000 - (Date.now() % 30000);
  if (left < 3000) await new Promise((r) => setTimeout(r, left + 200));
  return totp(key);
}

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${String(err && err.message).slice(0, 1500)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Layout and accessibility checks of the page that is open. */
async function checkPage(page, label) {
  const facts = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const small = [];
    for (const el of document.querySelectorAll(".cd-site a, .cd-site button, .cd-site summary, .cd-site input, .cd-site select, .cd-site textarea")) {
      if (!vis(el) || el.closest("[aria-hidden=true]") || el.closest(".d-hp")) continue;
      const r = el.getBoundingClientRect();
      // Inline links inside a sentence are exempt (WCAG 2.5.8 "inline"); checkboxes count with their label.
      const inline = el.tagName === "A" && getComputedStyle(el).display === "inline" && el.closest("p, li, dd, td, span.t-long, span.t-short");
      const box = el.type === "checkbox" ? el.closest("label").getBoundingClientRect() : r;
      if (!inline && !el.closest(".cd-prose") && (box.height < 43.5 || box.width < 24)) small.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute("aria-label") || el.name || "").trim().slice(0, 40)}" ${Math.round(box.width)}×${Math.round(box.height)}`);
    }
    return {
      scrollX: document.scrollingElement.scrollWidth - window.innerWidth,
      h1: document.querySelectorAll("h1").length,
      header: document.querySelectorAll("header.site-header").length,
      main: document.querySelectorAll("main#main").length,
      footer: document.querySelectorAll("footer.site-footer").length,
      navs: [...document.querySelectorAll("nav")].every((n) => n.getAttribute("aria-label") || n.getAttribute("aria-labelledby")),
      imgsNoAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length,
      small,
      canonical: document.querySelector("link[rel=canonical]")?.href || null,
      robots: document.querySelector("meta[name=robots]")?.content || null,
      ogImage: document.querySelector("meta[property='og:image']")?.content || null,
      icon: document.querySelector("link[rel=icon]")?.getAttribute("href") || null,
    };
  });
  assert(facts.scrollX <= 0, `${label}: sideways scroll ${facts.scrollX}px`);
  assert(facts.h1 === 1, `${label}: ${facts.h1} h1`);
  assert(facts.header === 1 && facts.main === 1 && facts.footer === 1, `${label}: landmarks ${JSON.stringify(facts)}`);
  assert(facts.navs, `${label}: a nav without a name`);
  assert(facts.imgsNoAlt === 0, `${label}: images without alt`);
  assert(facts.small.length === 0, `${label}: targets under 44 px: ${facts.small.join("; ")}`);
  return facts;
}

async function axe(page, label) {
  await page.addScriptTag({ path: AXE });
  const res = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    // .f-giant is the footer's decorative giant word (aria-hidden, 20% opacity): pure decoration, exempt from 1.4.3.
    const r = await axe.run({ exclude: [[".f-giant"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] });
    return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  });
  assert(res.length === 0, `${label}: axe – ${res.join("; ")}`);
}

/** HTML without what changes with every build (build id, hashed asset names, nonces). */
function normalise(html) {
  return html
    .replace(/\/_next\/static\/[^"' )]+/g, "/_next/static/X")
    .replace(/"buildId":"[^"]+"/g, '"buildId":"X"')
    .replace(/\\"buildId\\":\\"[^"\\]+\\"/g, "")
    .replace(/<script>self\.__next_f\.push[\s\S]*?<\/script>/g, "<script>RSC</script>")
    .replace(/[a-f0-9]{16,}/g, "H");
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const problems = [];
  const watch = (page, label) => {
    page.on("pageerror", (e) => problems.push(`${label} pageerror: ${String(e).slice(0, 200)}`));
    page.on("console", (m) => m.type() === "error" && !/404|Not Found|Failed to fetch RSC payload/.test(m.text()) && problems.push(`${label} console: ${m.text().slice(0, 200)}`));
  };

  try {
    for (const [width, height] of [
      [1440, 900],
      [375, 812],
      [320, 640],
    ]) {
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      watch(page, `site@${width}`);
      for (const [name, p] of PAGES) {
        await step(`${width}: ${p} – renders on the clinic host, accessible, no sideways scroll`, async () => {
          const res = await page.goto(`${SITE}${p}`, { waitUntil: "networkidle" });
          assert(res.status() === 200, `status ${res.status()}`);
          assert(page.url() === `${SITE}${p}`, `at ${page.url()}`);
          assert(/ClinDesk/.test(await page.title()), `title: ${await page.title()}`);
          assert(!res.headers()["x-robots-tag"], `x-robots-tag ${res.headers()["x-robots-tag"]}`);
          // Load the lazy drawings (scroll through the page) before the full-page screenshot.
          await page.evaluate(async () => {
            for (let y = 0; y < document.body.scrollHeight; y += 400) {
              window.scrollTo(0, y);
              await new Promise((r) => setTimeout(r, 40));
            }
            window.scrollTo(0, 0);
            await Promise.race([Promise.all(Array.from(document.images).map((i) => (i.complete ? 0 : new Promise((r) => (i.onload = i.onerror = r))))), new Promise((r) => setTimeout(r, 3000))]);
            await document.fonts.ready;
          });
          const facts = await checkPage(page, `${p}@${width}`);
          const canonicalPath = p === "/" ? "https://clindesk.co.uk/" : `https://clindesk.co.uk${p}`;
          assert(facts.canonical === canonicalPath || facts.canonical === canonicalPath.replace(/\/$/, ""), `canonical ${facts.canonical}`);
          assert(facts.ogImage === "https://clindesk.co.uk/clindesk/og.png", `og:image ${facts.ogImage}`);
          assert(facts.icon === "/clindesk/favicon.svg", `icon ${facts.icon}`);
          if (p === "/demo/thanks") assert(/noindex/.test(facts.robots || ""), `thanks robots ${facts.robots}`);
          else assert(facts.robots === "index, follow", `robots ${facts.robots}`);
          if (width !== 320) await page.screenshot({ path: path.join(SHOTS, `${name}-${width}.png`), fullPage: true });
          await axe(page, `${p}@${width}`);
        });
      }
      await ctx.close();
    }

    await step("keyboard: the first Tab is the skip link, which moves focus to the main content", async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(`${SITE}/pricing`);
      await page.keyboard.press("Tab");
      assert((await page.evaluate(() => document.activeElement?.textContent?.trim())) === "Skip to main content", "skip link first");
      const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      assert(outline !== "none", "focus is visible");
      await page.keyboard.press("Enter");
      assert(page.url().endsWith("#main"), page.url());
      await page.close();
    });

    await step("the internal folder and robots/sitemap: ClinDesk's own on the clinic host, 404 for /clindesk-site on both hosts", async () => {
      const page = await browser.newPage();
      const robots = await (await page.goto(`${SITE}/robots.txt`)).text();
      assert(/Sitemap: https:\/\/clindesk\.co\.uk\/sitemap\.xml/.test(robots) && /Disallow: \/app/.test(robots), robots);
      const sitemap = await (await page.goto(`${SITE}/sitemap.xml`)).text();
      assert((sitemap.match(/<loc>/g) || []).length === 11 && !/clinforms/.test(sitemap), "ClinDesk sitemap");
      for (const host of [SITE, BASE]) {
        for (const p of ["/clindesk-site", "/clindesk-site/features", "/clindesk-site/demo/thanks"]) {
          const res = await page.goto(`${host}${p}`);
          assert(res.status() === 404, `${host}${p} → ${res.status()}`);
        }
      }
      const app = await page.goto(`${SITE}/app/clinic`);
      assert(page.url().startsWith(`${SITE}/login`), `app at ${page.url()}`);
      assert((app.headers()["x-robots-tag"] || "").includes("noindex"), "sign-in noindex");
      await page.close();
    });

    await step("without JavaScript: the pages render, the menu and FAQs open, and an invalid demo form answers with its errors", async () => {
      const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 812 } });
      const page = await ctx.newPage();
      await page.goto(`${SITE}/`);
      await page.click("details.menu > summary");
      assert(await page.locator(".menu-sheet a[href='/pricing']").isVisible(), "menu opens");
      await page.goto(`${SITE}/pricing`);
      const faq = page.locator("details").first();
      await faq.locator("summary").click();
      assert(await faq.evaluate((d) => d.open), "FAQ opens");
      await page.goto(`${SITE}/demo`);
      await page.fill("#f-name", "Nina Patel (fictional)");
      await page.fill("#f-clinic", "Pebblegate Physio (fictional)");
      // The browser's own checks pass (type=email accepts "a@b"); the server's do not (no domain suffix).
      await page.fill("#f-email", "nina@pebblegate");
      await page.selectOption("#f-sites", "2–5");
      await page.fill("#f-practitioners", "6");
      await page.click("button.d-submit");
      await page.waitForLoadState("load");
      assert(page.url() === `${SITE}/demo`, `stays on /demo: ${page.url()}`);
      await page.waitForSelector(".d-error-summary");
      assert(/valid work email/i.test(await page.locator("#f-email-error").innerText()), "email error");
      assert((await page.inputValue("#f-name")) === "Nina Patel (fictional)", "keeps what was typed");
      assert((await page.inputValue("#f-practitioners")) === "6", "keeps the number");
      assert((await page.getAttribute("#f-email", "aria-invalid")) === "true", "aria-invalid");
      assert((await page.getAttribute("#f-email", "aria-describedby")) === "f-email-error", "error described");
      await page.screenshot({ path: path.join(OUT, "demo-nojs-errors-375.png"), fullPage: true });
      await page.fill("#f-email", "nina@pebblegate.example");
      await page.click("button.d-submit");
      await page.waitForURL(`${SITE}/demo/thanks`);
      await ctx.close();
    });

    await step("with JavaScript: Book a demo → /demo/thanks", async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      watch(page, "demo");
      await page.goto(`${SITE}/demo`);
      await page.fill("#f-name", "Olly Brook (fictional)");
      await page.fill("#f-clinic", "Pebblegate Physio – Northgate (fictional)");
      await page.fill("#f-email", "olly@pebblegate.example");
      await page.fill("#f-phone", "01908 000111");
      await page.selectOption("#f-sites", "6–15");
      await page.fill("#f-practitioners", "12");
      await page.fill("#f-system", "Paper diary");
      await page.check("input[name=see][value=diary]");
      await page.check("input[name=see][value=reports]");
      await page.click("button.d-submit");
      await page.waitForURL(`${SITE}/demo/thanks`);
      await page.waitForSelector("h1");
      await page.close();
    });

    await step("cross-origin posts are refused", async () => {
      const page = await browser.newPage();
      await page.goto(`${SITE}/demo`);
      const hidden = await page.$$eval("form.d-form input[type=hidden]", (els) => els.map((e) => [e.name, e.value]));
      await page.close();
      const boundary = "----e2e" + crypto.randomBytes(8).toString("hex");
      const fields = [...hidden, ["name", "X Y"], ["clinic", "Evil (fictional)"], ["email", "x@evil.example"], ["sites", "1"]];
      const body = fields.map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join("") + `--${boundary}--\r\n`;
      const port = new URL(SITE).port;
      const res = await new Promise((resolve, reject) => {
        const req = require("http").request(
          { host: "127.0.0.1", port, path: "/demo", method: "POST", headers: { host: `clinic.localhost:${port}`, origin: "https://evil.example", "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": Buffer.byteLength(body) } },
          (r) => {
            let text = "";
            r.on("data", (c) => (text += c));
            r.on("end", () => resolve({ status: r.statusCode, location: r.headers.location || "", text }));
          },
        );
        req.on("error", reject);
        req.end(body);
      });
      assert(!res.location.includes("/demo/thanks") && res.status !== 303, `cross-origin answered ${res.status} ${res.location}`);
    });

    if (INVITE) {
      await step("the requests are on /app/platform with the ClinDesk label (platform admin)", async () => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        const password = `e2e ${crypto.randomBytes(12).toString("base64url")} password`;
        await page.goto(INVITE);
        await page.waitForSelector("text=Create your account");
        await page.fill("#f-name", "Rita Owner (fictional)");
        await page.fill("#f-password", password);
        await page.fill("#f-confirm", password);
        await page.click("button[type=submit]");
        await page.waitForURL(`${BASE}/two-factor`);
        await page.fill("#f-password", password);
        await page.click("button[type=submit]");
        await page.waitForSelector("img[alt^='Authenticator set-up code']");
        const key = base32Decode(await page.locator("code").first().innerText());
        await page.check("input[name=saved]");
        await page.fill("#f-code", await freshCode(key));
        await page.click("button[type=submit]");
        await page.waitForURL(`${BASE}/app`);
        await page.goto(`${BASE}/app/platform`);
        const item = page.locator("li", { hasText: "Pebblegate Physio – Northgate (fictional)" });
        await item.waitFor();
        assert((await item.locator("text=ClinDesk demo").count()) === 1, "ClinDesk label");
        await item.locator("summary", { hasText: "Message" }).click();
        const msg = await item.locator("details p").innerText();
        assert(msg === "Source: clindesk\nSites: 6–15\nPractitioners: 12\nCurrent system: Paper diary\nInterests: The diary, Reports add-on", `message: ${JSON.stringify(msg)}`);
        assert((await page.locator("li", { hasText: "Pebblegate Physio (fictional)" }).locator("text=ClinDesk demo").count()) >= 1, "the no-JS request too");
        await page.screenshot({ path: path.join(OUT, "platform-requests.png"), fullPage: true });
        await ctx.close();
      });
    }

    await step("ClinForms' site on localhost is untouched: no ClinDesk markup, same pages" + (BASELINE ? " and the same HTML as the base build" : ""), async () => {
      for (const p of CLINFORMS_PAGES) {
        const res = await fetch(`${BASE}${p}`);
        assert(res.status === 200, `${p} ${res.status}`);
        const html = await res.text();
        assert(!/cd-site|clindesk/i.test(html), `${p} mentions ClinDesk`);
        if (BASELINE) {
          const ref = await (await fetch(`${BASELINE}${p}`)).text();
          const [a, b] = [normalise(html), normalise(ref)];
          if (a !== b) {
            fs.writeFileSync(path.join(OUT, `diff${p.replace(/\W+/g, "_")}-new.html`), a);
            fs.writeFileSync(path.join(OUT, `diff${p.replace(/\W+/g, "_")}-base.html`), b);
          }
          assert(a === b, `${p}: HTML differs from the base build (files in ${OUT})`);
        }
      }
      // Response headers (security headers, robots) are the same as before too – incl. the public demo below /reports.
      const keep = (h) => JSON.stringify([...h.entries()].filter(([k]) => !/^(date|etag|x-nextjs-cache|link|vary|content-length|connection|keep-alive|transfer-encoding|age)$/.test(k)).sort());
      for (const p of [...CLINFORMS_PAGES, "/reports", "/reports/new"]) {
        const res = await fetch(`${BASE}${p}`);
        assert(/noindex/.test(res.headers.get("x-robots-tag") || "") === p.startsWith("/reports"), `${p}: x-robots-tag ${res.headers.get("x-robots-tag")}`);
        if (BASELINE) assert(keep(res.headers) === keep((await fetch(`${BASELINE}${p}`)).headers), `${p}: response headers differ from the base build`);
      }
      for (const p of ["/features", "/pricing", "/accessibility", "/demo/thanks"]) {
        assert((await fetch(`${BASE}${p}`)).status === 404, `${p} must not exist on ClinForms' host`);
      }
    });

    await step("no browser errors", async () => {
      assert(problems.length === 0, problems.join("\n"));
    });
  } finally {
    await browser.close();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} steps passed. Screenshots: ${SHOTS}`);
    if (failed) process.exitCode = 1;
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
