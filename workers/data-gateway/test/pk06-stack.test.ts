/**
 * PK06 on D1 through the gateway: the course / gift-card liability and products reports, and the expiry sweep (its
 * batches must stay inside the gateway's 100 statements and 100 parameters) – in-process (the Worker's handler on a
 * node:sqlite D1 stand-in) and, when the Worker's dependencies are installed, on real local D1 (workerd) with every
 * migration applied by wrangler. Suites: src/server/pms/billing/testing/pk06-*-suite.ts. Run by `npm run test:gateway`.
 */
import fs from "node:fs";
import { Kysely } from "kysely";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import { definePk06ExpirySuite } from "../../../src/server/pms/billing/testing/pk06-expiry-suite";
import { definePk06ReportsSuite } from "../../../src/server/pms/billing/testing/pk06-reports-suite";
import { handleRequest } from "../src/index";
import { FakeD1 } from "./fake-d1";
import { available, gatewayDb, startLocalD1 } from "./local-d1";

const SECRET = "pk06-stack-secret-".padEnd(48, "p");

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

definePk06ReportsSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", standIn);
definePk06ExpirySuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", standIn);

if (available) {
  definePk06ReportsSuite("D1 via the gateway (local workerd D1, wrangler-applied migrations)", localD1);
  definePk06ExpirySuite("D1 via the gateway (local workerd D1, wrangler-applied migrations)", localD1);
}
