/**
 * The diary's repository suite on D1 through the gateway (src/server/repos/pms/diary/testing/diary-suite.ts):
 *   1. in-process: the app's D1 dialect → signed HTTP → the gateway handler → the node:sqlite D1 stand-in;
 *   2. real local D1 (workerd via wrangler, migrations applied by `wrangler d1 migrations apply` – so the clash
 *      triggers' bodies go through wrangler's own statement splitting), skipped when wrangler is not installed.
 * The clash triggers' refusal reaches the app as a 409 CONSTRAINT_CHECK and the repositories answer "clash".
 */
import fs from "node:fs";
import { Kysely } from "kysely";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import { defineDiaryRepoSuite } from "../../../src/server/repos/pms/diary/testing/diary-suite";
import { handleRequest } from "../src/index";
import { FakeD1 } from "./fake-d1";
import { available, gatewayDb, startLocalD1 } from "./local-d1";

const SECRET = "diary-stack-secret-".padEnd(48, "d");

defineDiaryRepoSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", async () => {
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
  defineDiaryRepoSuite("D1 via the gateway (local workerd D1, wrangler-applied migrations)", async () => {
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
