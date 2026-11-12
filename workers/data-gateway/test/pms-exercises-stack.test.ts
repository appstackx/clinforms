/**
 * The home exercise programmes suite (0126–0128, ex03–ex06) on D1, through the gateway: in-process (the app's D1
 * dialect → signed HTTP → the Worker's handler → a node:sqlite stand-in for D1) and on REAL local D1 (workerd via
 * wrangler, every migration applied by wrangler's own runner). What matters here: the parent rows inserted with
 * ON CONFLICT DO NOTHING in the library's batch, the share batch (conditional update + conditional audit rows + the
 * replaced version ended only when the new one is shared), the check-in insert-or-change, and the ON DELETE CASCADE
 * chains (records settings → switch → library; patient → programme → check-ins) on offboarding.
 */
import fs from "node:fs";
import { Kysely } from "kysely";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import { defineExerciseSuite } from "../../../src/server/pms/records/testing/exercises-suite";
import { handleRequest } from "../src/index";
import { FakeD1 } from "./fake-d1";
import { available, gatewayDb, startLocalD1 } from "./local-d1";

const SECRET = "exercise-stack-secret-".padEnd(48, "z");

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

defineExerciseSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", standIn);

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

if (available) defineExerciseSuite("D1 via the gateway (local workerd D1, wrangler-applied migrations)", localD1);
