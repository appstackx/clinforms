/**
 * The text credit ledger's repository suite on D1, through the gateway: in-process (the app's D1 dialect → signed
 * HTTP → the Worker's handler → a node:sqlite stand-in) and on REAL local D1 (workerd via wrangler, every migration
 * applied by wrangler's own runner). What matters here: each balance change, its ledger entry and its audit row are
 * ONE batch (D1 has no interactive transactions), the ledger's append-only trigger, and the unique indexes that make
 * a payment credit once.
 */
import fs from "node:fs";
import { Kysely } from "kysely";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import { defineCreditsRepoSuite } from "../../../src/server/repos/pms/comms/testing/credits-suite";
import { handleRequest } from "../src/index";
import { FakeD1 } from "./fake-d1";
import { available, gatewayDb, startLocalD1 } from "./local-d1";

const SECRET = "credits-stack-secret".padEnd(48, "z");

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

defineCreditsRepoSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", standIn);

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

if (available) defineCreditsRepoSuite("D1 via the gateway (local workerd D1, wrangler-applied migrations)", localD1);
