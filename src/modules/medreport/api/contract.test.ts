import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { REPORT_API_ENDPOINTS, TM3_SIM_ENDPOINTS, reportApiPaths } from "./contract";

const root = process.cwd();
const routeFile = (pattern: string) => path.join(root, "src/app", pattern, "route.ts");

test("every Report API endpoint has a thin route and a handler file", () => {
  for (const ep of REPORT_API_ENDPOINTS) {
    const route = fs.readFileSync(routeFile(ep.path), "utf8");
    assert.match(route, new RegExp(`export const ${ep.method} = route\\(`), ep.path);
    assert.match(route, /export const runtime = "nodejs"/, ep.path);
    assert.match(route, /export const dynamic = "force-dynamic"/, ep.path);
    assert.ok(fs.existsSync(path.join(root, "src/modules/medreport/api/handlers", ep.handler)), ep.handler);
  }
  for (const slow of ["/api/reports/v1/drafts", "/api/reports/v1/forms/analyse", "/api/reports/v1/forms/fill-preview", "/api/reports/v1/render"]) {
    assert.match(fs.readFileSync(routeFile(slow), "utf8"), /export const maxDuration = 60/, slow);
  }
});

test("every simulated TM3 endpoint has a route delegating to the sandbox handler", () => {
  for (const ep of TM3_SIM_ENDPOINTS) {
    const route = fs.readFileSync(routeFile(ep.path), "utf8");
    assert.match(route, new RegExp(`export const ${ep.method} = ${ep.handler};`), ep.path);
  }
});

test("path builders encode parameters", () => {
  assert.equal(reportApiPaths.bundle("tm3-sim", "a/b", "e 1"), "/api/reports/v1/connectors/tm3-sim/patients/a%2Fb/episodes/e%201/bundle");
  assert.equal(reportApiPaths.render("pdf"), "/api/reports/v1/render?format=pdf");
  assert.equal(reportApiPaths.render("original"), "/api/reports/v1/render?format=original");
  assert.equal(reportApiPaths.formSampleFile("a b"), "/api/reports/v1/forms/samples/a%20b/file");
});
