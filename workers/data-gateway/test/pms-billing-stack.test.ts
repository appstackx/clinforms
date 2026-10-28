/**
 * The billing repository suite on D1, through the gateway: once in-process (the app's D1 dialect → signed HTTP →
 * the Worker's handler → a node:sqlite stand-in for D1) and once on REAL local D1 (workerd via wrangler, with every
 * migration applied by wrangler's own runner). The suite's atomic-refusal checks matter most here: D1 has no
 * interactive transactions, so every billing write is one batch whose later statements fail safely.
 */
import fs from "node:fs";
import { Kysely } from "kysely";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import { defineBillingServiceSuite } from "../../../src/server/pms/billing/testing/service-suite";
import { defineBillingRepoSuite } from "../../../src/server/repos/pms/billing/testing/billing-suite";
import { handleRequest } from "../src/index";
import { FakeD1 } from "./fake-d1";
import { available, gatewayDb, startLocalD1 } from "./local-d1";

const SECRET = "billing-stack-secret-".padEnd(48, "z");

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

defineBillingRepoSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", standIn);
defineBillingServiceSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", standIn);

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

if (available) {
  defineBillingRepoSuite("D1 via the gateway (local workerd D1, wrangler-applied migrations)", localD1);
  defineBillingServiceSuite("D1 via the gateway (local workerd D1, wrangler-applied migrations)", localD1);
}
