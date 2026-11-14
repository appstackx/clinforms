/**
 * Review items 3 and 4 (13/11/2026): after a self-serve trial ends (or for its product the paid plan leaves out) EVERY
 * write path of the clinic system is refused and every read stays open. The rule lives in clinicActionActor
 * (src/server/pms/actor.ts): an action is a WRITE unless it says `readOnly: true` – whatever its permission – so an
 * action behind a "view" permission that sends or writes (emailing an invoice, reviewing a form response, starting a
 * referrer form) is refused too. Route handlers: GET / HEAD read (downloads – letters, CSVs, role history), anything
 * else writes. These source checks keep the list of read-only actions to the audited ones; the behaviour itself
 * (cron, clinic API, Report API, public pages) is tested on every database in ./testing/trial-suite.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const walk = (dir: string): string[] =>
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));

/** The audited read-only actions (they change nothing and send nothing). */
const READ_ONLY_ACTIONS = new Set([
  "src/app/app/clinic/messages/actions.ts searchPatientsAction",
  "src/app/app/clinic/messages/actions.ts loadSendFormAction",
  "src/app/app/clinic/messages/actions.ts loadThreadAction",
  "src/app/app/clinic/messages/actions.ts loadMessageAction",
  "src/app/app/clinic/messages/campaigns/actions.ts countAudienceAction",
  "src/app/app/clinic/billing/actions.ts loadTakePaymentAction",
  "src/app/app/clinic/billing/actions.ts remittanceInvoicesAction",
  "src/app/app/clinic/billing/actions.ts lookUpGiftCardAction",
  "src/app/app/clinic/setup/import/actions.ts issuesAction",
  "src/server/pms/native-connector.ts sessionCaller",
]);

describe("trial read-only – every clinic-system write path", () => {
  it("only the audited actions are marked readOnly; actions that send or write behind a view permission are not", () => {
    const marked: string[] = [];
    for (const f of [...walk("src/app"), ...walk("src/server")]) {
      const src = read(f);
      for (const fnStart of Array.from(src.matchAll(/(?:export )?(?:async )?function ([A-Za-z0-9_]+)\(/g))) {
        const body = src.slice(fnStart.index ?? 0, src.indexOf("\n}\n", fnStart.index ?? 0) + 3);
        if (/clinicActionActor\(\{[^}]*readOnly: true/.test(body)) marked.push(`${f} ${fnStart[1]}`);
      }
    }
    assert.deepEqual(marked.sort(), Array.from(READ_ONLY_ACTIONS).sort());
    for (const [file, fn] of [
      ["src/app/app/clinic/messages/actions.ts", "emailInvoiceAction"],
      ["src/app/app/clinic/messages/actions.ts", "emailStatementAction"],
      ["src/app/app/clinic/messages/actions.ts", "emailReceiptAction"],
      ["src/app/app/clinic/patients/[patientId]/(record)/forms/actions.ts", "reviewResponseAction"],
      ["src/app/app/clinic/patients/[patientId]/(record)/cases/[caseId]/actions.ts", "startReferrerFormAction"],
    ]) {
      const src = read(file);
      const start = src.indexOf(`function ${fn}(`);
      assert.ok(start > 0, `${fn} exists`);
      const body = src.slice(start, src.indexOf("\n}\n", start));
      assert.match(body, /clinicActionActor\(/, `${fn} uses the clinic actor`);
      assert.doesNotMatch(body, /readOnly: true/, `${fn} writes or sends: never readOnly`);
    }
  });
  it("the actor refuses writes by default; route handlers read on GET / HEAD only (downloads stay open)", () => {
    const actor = read("src/server/pms/actor.ts");
    assert.match(actor, /if \(!options\.readOnly && !options\.allowAfterTrial\) \{\s*const block = await trialWriteBlock\(getDb\(\), actor\.tenantId, "clinic"\);/);
    assert.match(read("src/server/pms/http.ts"), /clinicActionActor\(\{ permission: options\.permission, readOnly: req\.method === "GET" \|\| req\.method === "HEAD" \}\)/);
  });
  it("the clinic API refuses writes, the messages cron skips the clinic, public pages close", () => {
    assert.match(read("src/server/pms/integration/api/http.ts"), /if \(req\.method !== "GET"\) \{\s*const block = await trialWriteBlock\(ctx\.db, key\.tenantId, "clinic", now\);\s*if \(block\) return apiErrorResponse\("READ_ONLY", block\.message\);/);
    assert.match(read("src/server/pms/comms/cron.ts"), /trialWriteBlock\(ctx\.db, tenantId, "clinic", now\)/);
    assert.match(read("src/server/pms/portal/public-clinic.ts"), /selfTrialEnded\(ctx\.db, slug/);
  });
});
