/**
 * The portal module's suite (src/server/repos/pms/portal/testing/portal-suite.ts) on D1 through the gateway:
 *   1. in-process Worker + node:sqlite D1 stand-in (always);
 *   2. real local D1 in workerd with every migration applied by wrangler (when the Worker's dependencies are
 *      installed) – the triggers that refuse double bookings and seal signed forms, as wrangler applies them.
 */
import fs from "node:fs";
import { Kysely } from "kysely";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import { definePortalSuite } from "../../../src/server/repos/pms/portal/testing/portal-suite";
import { handleRequest } from "../src/index";
import { FakeD1 } from "./fake-d1";
import { available, gatewayDb, startLocalD1 } from "./local-d1";

const SECRET = "portal-stack-secret-".padEnd(48, "p");

definePortalSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", async () => {
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
  definePortalSuite("D1 via the gateway (local workerd D1, wrangler-applied migrations)", async () => {
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
