/**
 * The whole D1 path in-process: the app's Kysely D1 dialect (src/server/db/dialects/d1-http.ts) → signed
 * HTTP → the gateway Worker's handler → a node:sqlite stand-in for D1. The repository suite runs unchanged.
 */
import { Kysely } from "kysely";
import { D1HttpDialect } from "../../../src/server/db/dialects/d1-http";
import type { Database } from "../../../src/server/db/schema";
import { defineRepoSuite } from "../../../src/server/repos/testing/repo-suite";
import { handleRequest } from "../src/index";
import { FakeD1 } from "./fake-d1";

const SECRET = "stack-test-secret-".padEnd(48, "z");

defineRepoSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", async () => {
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
