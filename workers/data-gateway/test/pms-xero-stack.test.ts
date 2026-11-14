/**
 * The Xero sync suite (0172, xe06) on D1, through the gateway: in-process (the app's D1 dialect → signed
 * HTTP → the Worker's handler → a node:sqlite stand-in for D1) and on REAL local D1 (workerd via wrangler, every
 * migration applied by wrangler's own runner). What matters here: the send list's batched inserts (ON CONFLICT DO
 * NOTHING, ≤ 100 bound values a statement), the conditional claims (refresh lock, item lease, OAuth state used once)
 * and offboarding by cascade from pms_billing_settings.
 */
import fs from "node:fs";
import { Kysely } from "kysely";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import { defineXeroSuite } from "../../../src/server/pms/integration/xero/testing/xero-suite";
import { handleRequest } from "../src/index";
import { FakeD1 } from "./fake-d1";
import { available, gatewayDb, startLocalD1 } from "./local-d1";

const SECRET = "xero-stack-secret-".padEnd(48, "z");

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

defineXeroSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", standIn);

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

if (available) defineXeroSuite("D1 via the gateway (local workerd D1, wrangler-applied migrations)", localD1);
