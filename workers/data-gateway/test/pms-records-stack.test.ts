/**
 * The records module's repository suite (src/server/repos/pms/records/testing/records-suite.ts) and its server layer
 * (src/server/pms/records/testing/service-suite.ts – permissions, the staff/clinical boundary, the subject-access copy)
 * on D1 through the gateway:
 *   1. in-process: the app's D1 dialect → signed HTTP → the gateway Worker's handler → a node:sqlite D1 stand-in;
 *   2. real local D1 (workerd via wrangler): wrangler applies every migration – including the 0121 lock triggers –
 *      exactly as it does for the remote databases (skipped when the Worker's dependencies are not installed).
 */
import fs from "node:fs";
import { Kysely } from "kysely";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import { defineRecordsServiceSuite } from "../../../src/server/pms/records/testing/service-suite";
import { defineRecordsRepoSuite } from "../../../src/server/repos/pms/records/testing/records-suite";
import { handleRequest } from "../src/index";
import { FakeD1 } from "./fake-d1";
import { available, gatewayDb, startLocalD1 } from "./local-d1";

const SECRET = "records-stack-secret-".padEnd(48, "r");

function inProcessD1() {
  return async () => {
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
  };
}

function localD1() {
  return async () => {
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
  };
}

const IN_PROCESS = "D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)";
const LOCAL = "D1 via the gateway (local workerd D1, wrangler-applied migrations)";

defineRecordsRepoSuite(IN_PROCESS, inProcessD1());
defineRecordsServiceSuite(IN_PROCESS, inProcessD1());

if (available) {
  defineRecordsRepoSuite(LOCAL, localD1());
  defineRecordsServiceSuite(LOCAL, localD1());
}
