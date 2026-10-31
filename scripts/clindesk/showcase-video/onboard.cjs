// Off camera: the owner (Sam), the physio (Sophie Marsh) and reception (Jess) join the local fictional clinic.
// Passwords are generated here and kept only in local/creds.json (chmod 600). No link or secret is printed.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const L = require("./lib.cjs");

const TENANT = "pebblegate-demo";

async function onboard(page, invite, name, email, who) {
  const password = `pg ${crypto.randomBytes(12).toString("base64url")} local`;
  await page.goto(invite);
  await page.waitForSelector("text=Create your account");
  await page.fill("#f-name", name);
  await page.fill("#f-password", password);
  await page.fill("#f-confirm", password);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/two-factor/);
  await page.fill("#f-password", password);
  await page.click("button[type=submit]");
  await page.waitForSelector("img[alt^='Authenticator set-up code']");
  const key = (await page.locator("code").first().innerText()).trim();
  await page.check("input[name=saved]");
  await page.fill("#f-code", await L.freshCode(key));
  await page.click("button[type=submit]");
  await page.waitForURL(/\/app/);
  const creds = L.loadCreds();
  creds[who] = { name, email, password, key };
  L.saveCreds(creds);
}

async function invite(owner, email, role) {
  await owner.goto(`${L.APP}/app/settings/members`);
  await owner.fill("input[name=email]", email);
  await owner.selectOption("form:has(input[name=email]) select[name=role]", role);
  await owner.click("button[type=submit]:has-text('Invite')");
  await owner.waitForTimeout(2500);
  const q = await (await fetch(`http://localhost:8026/api/v1/search?query=${encodeURIComponent("to:" + email)}`)).json();
  const id = q.messages[0].ID;
  const msg = await (await fetch(`http://localhost:8026/api/v1/message/${id}`)).json();
  const m = (msg.Text || msg.HTML).match(/https?:\/\/[^\s"<>]+\/accept-invite\?token=[A-Za-z0-9._%-]+/);
  return m[0];
}

(async () => {
  const seed = fs.readFileSync(path.join(L.LOCAL, "seed.out"), "utf8");
  const ownerInvite = (seed.match(/https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9._%-]+/) || [])[0];
  if (!ownerInvite) throw new Error("no owner invitation in seed.out");
  const browser = await L.launch();
  const mk = async (who) => { const ctx = await L.context(browser, who, { scale: 1 }); return [ctx, await ctx.newPage()]; };
  const [oc, owner] = await mk("sam");
  if (!L.loadCreds().sam) { await onboard(owner, ownerInvite, "Sam Whitley", "sam@pebblegate-demo.example.com", "sam"); await L.saveState(oc); }
  console.log("owner joined");
  const people = [
    ["sophie", "Sophie Marsh", "sophie.marsh@pebblegate-demo.example.com", "clinician"],
    ["jess", "Jess Taylor", "jess.taylor@pebblegate-demo.example.com", "staff"],
  ];
  for (const [who, name, email, role] of people) {
    if (L.loadCreds()[who]) continue;
    const link = await invite(owner, email, role).catch(async () => null) || (await invite(owner, email, role));
    const [ctx, page] = await mk(who);
    await onboard(page, link, name, email, who);
    await L.saveState(ctx);
    console.log(`${who} joined`);
  }
  // Sophie's signing details (made-up PH-DEMO number, may sign).
  await owner.goto(`${L.APP}/app/settings/members`);
  const row = owner.locator("li", { has: owner.locator(`p:text-is("sophie.marsh@pebblegate-demo.example.com")`) }).first();
  await row.locator("summary:has-text('Manage')").click();
  await row.locator("input[name=jobTitle]").fill("Physiotherapist");
  await row.locator("input[name=hcpcNumber]").fill("PH-DEMO-01");
  await row.locator("input[name=canSign]").check();
  await row.locator("button:has-text('Save signing details')").click();
  await row.locator("text=Saved.").waitFor({ timeout: 20000 });
  await browser.close();
  // Link Sophie's account to the seeded practitioner Sophie Marsh.
  const db = new DatabaseSync(path.join(L.LOCAL, "db.sqlite"));
  const user = db.prepare('select id from "user" where email = ?').get("sophie.marsh@pebblegate-demo.example.com");
  const r = db.prepare("update pms_practitioners set user_id = ? where tenant_id = ? and display_name = 'Sophie Marsh'").run(user.id, TENANT);
  console.log("linked practitioner rows:", r.changes);
  db.close();
})().catch((e) => { console.error(String(e).replace(/token=[^\s"]+/g, "token=[hidden]")); process.exit(1); });
