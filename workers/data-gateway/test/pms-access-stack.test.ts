/**
 * Configurable access (migration 0103: role overrides, member exceptions and sites, history) and the shared access
 * read, run through the gateway on D1 (src/server/repos/pms/testing/access-suite.ts):
 *   1. in-process: the app's D1 dialect → signed HTTP → the gateway Worker's handler → a node:sqlite D1 stand-in;
 *   2. real local D1 (workerd via wrangler): wrangler applies every migration exactly as for the remote databases
 *      (skipped when the Worker's dependencies are not installed).
 */
import fs from "node:fs";
import { Kysely } from "kysely";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import { defineAccessSuite } from "../../../src/server/repos/pms/testing/access-suite";
import { handleRequest } from "../src/index";
import { FakeD1 } from "./fake-d1";
import { available, gatewayDb, startLocalD1 } from "./local-d1";

const SECRET = "access-stack-secret-".padEnd(48, "a");

defineAccessSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", async () => {
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
});

if (available) {
  defineAccessSuite("D1 via the gateway (local workerd D1, wrangler-applied migrations)", async () => {
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
  });
}
