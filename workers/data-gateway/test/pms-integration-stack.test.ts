/**
 * The integration module's suite (src/server/repos/pms/integration/testing/integration-suite.ts) on D1 through the
 * gateway, and a 2,000-row patients import (testing/scale.ts) on the D1 stand-in – D1's 100 parameters per statement
 * and the gateway's statements per batch, at the size of a real import's pages:
 *   1. in-process Worker + node:sqlite D1 stand-in (always);
 *   2. real local D1 in workerd with every migration applied by wrangler (when the Worker's dependencies are
 *      installed).
 */
import fs from "node:fs";
import { describe, it } from "node:test";
import { Kysely } from "kysely";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import { defineIntegrationSuite } from "../../../src/server/repos/pms/integration/testing/integration-suite";
import { runPatientsAtScale } from "../../../src/server/repos/pms/integration/testing/scale";
import { handleRequest } from "../src/index";
import { FakeD1 } from "./fake-d1";
import { available, gatewayDb, startLocalD1 } from "./local-d1";

const SECRET = "integration-stack-secret-".padEnd(48, "i");

function standIn(): { db: Kysely<Database>; close: () => Promise<void> } {
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

defineIntegrationSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", async () => standIn());

describe("data import at D1 scale (2,000 patients through the gateway stand-in)", () => {
  it("upload, check, import, re-run without duplicates, undo", { timeout: 600_000 }, async () => {
    const s = standIn();
    try {
      await runPatientsAtScale(s.db, Number(process.env.IMPORT_D1_ROWS ?? 2000), (l) => console.log(`  D1 stand-in: ${l}`));
    } finally {
      await s.close();
    }
  });
});

if (available) {
  defineIntegrationSuite("D1 via the gateway (local workerd D1, wrangler-applied migrations)", async () => {
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
