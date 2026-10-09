/**
 * The activity page and the platform page's data layer (src/server/admin/testing/admin-suite.ts) on the production
 * database path: the app's Kysely D1 dialect → signed HTTP → the gateway Worker's handler → D1. Twice: a node:sqlite
 * D1 stand-in (always), and real local D1 in workerd with wrangler-applied migrations – including 0004's lone
 * ADD COLUMN and 0005's index (needs `npm ci` in workers/data-gateway).
 */
import fs from "node:fs";
import { Kysely } from "kysely";
import { defineAdminSuite } from "../../../src/server/admin/testing/admin-suite";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import { handleRequest } from "../src/index";
import { FakeD1 } from "./fake-d1";
import { available, gatewayDb, startLocalD1 } from "./local-d1";

const SECRET = "admin-stack-secret-".padEnd(48, "m");

defineAdminSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", async () => {
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

defineAdminSuite(
  "real local D1 (workerd via wrangler, wrangler-applied migrations)",
  async () => {
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
  },
  { skip: !available && "wrangler not installed in workers/data-gateway" },
);
