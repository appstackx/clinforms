/**
 * The reporting and set-up module on D1 through the gateway – its repository suite (opening hours, closures, audit
 * search, figures from the record) and the reports' server layer with the diary's and billing's real sources (the
 * figures must equal the hand-worked fact checks; site limits; own caseload; CSV) – in-process (the Worker's handler
 * on a node:sqlite D1 stand-in) and, when the Worker's dependencies are installed, on real local D1 (workerd) with
 * every migration applied by wrangler. Run by `npm run test:gateway`.
 */
import fs from "node:fs";
import { Kysely } from "kysely";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import { defineReportsServiceSuite } from "../../../src/server/pms/reporting/testing/reports-suite";
import { defineReportingRepoSuite } from "../../../src/server/repos/pms/reporting/testing/reporting-suite";
import { handleRequest } from "../src/index";
import { FakeD1 } from "./fake-d1";
import { available, gatewayDb, startLocalD1 } from "./local-d1";

const SECRET = "reporting-stack-secret-".padEnd(48, "r");

async function standIn() {
  const d1 = new FakeD1();
  const db = new Kysely<Database>({
    dialect: new D1HttpDialect({
      url: "https://gateway.test",
      secret: SECRET,
      fetch: (url, init) => handleRequest(new Request(url, init), { DB: d1, GATEWAY_SECRET: SECRET }),
    }),
  });
  return {
    db,
    close: async () => {
      await db.destroy();
      d1.close();
    },
  };
}

async function localD1() {
  const { proxy, dir } = await startLocalD1();
  const db = gatewayDb(proxy.env.DB);
  return {
    db,
    close: async () => {
      await db.destroy();
      await proxy.dispose();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

defineReportingRepoSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", standIn);
defineReportsServiceSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", standIn);

if (available) {
  defineReportingRepoSuite("D1 via the gateway (local workerd D1, wrangler-applied migrations)", localD1);
  defineReportsServiceSuite("D1 via the gateway (local workerd D1, wrangler-applied migrations)", localD1);
}
