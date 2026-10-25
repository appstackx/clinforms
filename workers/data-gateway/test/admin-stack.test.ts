/**
 * The activity page and the platform page's data layer (src/server/admin/testing/admin-suite.ts) on the production
 * database path: the app's Kysely D1 dialect → signed HTTP → the gateway Worker's handler → D1. Twice: a node:sqlite
 * D1 stand-in (always), and real local D1 in workerd with wrangler-applied migrations – including 0004's lone
 * ADD COLUMN and 0005's index (needs `npm ci` in workers/data-gateway).
 */
import fs from "node:fs";
import { Kysely } from "kysely";
import { defineAdminSuite } from "../../../src/server/admin/testing/admin-suite";
import { defineBefore0006Suite } from "../../../src/server/admin/testing/before-0006-suite";
import { defineClinicPlanSuite } from "../../../src/server/admin/testing/clinic-plan-suite";
import { defineLoadFormsSuite } from "../../../src/server/admin/testing/load-forms-suite";
import { defineUsageSuite } from "../../../src/server/usage/testing/usage-suite";
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

// Trials and drafting limits per clinic (10/2026): migration 0006 through the same two D1 paths.
defineClinicPlanSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", async () => {
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

defineClinicPlanSuite(
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

// admin:load-forms (10/2026): encrypted form files and proposed maps through the D1 gateway (stand-in and real local D1).
defineLoadFormsSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", async () => {
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

defineLoadFormsSuite(
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

// Security fix 24/10/2026 (ops M1): the release on a D1 database BEFORE migration 0006 (production until it is applied).
defineBefore0006Suite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", async () => {
  const d1 = new FakeD1();
  d1.sqlite.exec("DROP TABLE clinic_plan");
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

defineBefore0006Suite(
  "real local D1 (workerd via wrangler, wrangler-applied migrations, clinic_plan dropped)",
  async () => {
    const { proxy, dir } = await startLocalD1();
    await proxy.env.DB.prepare("DROP TABLE clinic_plan").all();
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

// Packages and usage counters (25/10/2026): migration 0007's tables and the atomic, retry-safe counter batches through
// the production path (Kysely D1 dialect → signed HTTP → gateway Worker → D1), twice.
const USAGE_TABLES = ["usage_event", "usage_report", "clinic_usage", "clinic_package"];

defineUsageSuite("D1 via the gateway (in-process Worker, node:sqlite D1 stand-in)", async () => {
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
    dropUsageTables: async () => {
      for (const table of USAGE_TABLES) d1.sqlite.exec(`DROP TABLE ${table}`);
    },
  };
});

defineUsageSuite(
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
      dropUsageTables: async () => {
        for (const table of USAGE_TABLES) await proxy.env.DB.prepare(`DROP TABLE ${table}`).all();
      },
    };
  },
  { skip: !available && "wrangler not installed in workers/data-gateway" },
);
