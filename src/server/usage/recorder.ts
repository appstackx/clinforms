/**
 * The host's usage counters for the Report API (MedreportDeps.usage, wired in src/app/api/_medreport-glue.ts):
 * each event is one atomic batch (src/server/repos/usage.ts recordUsageEvent). A failed write is retried once with
 * the SAME event id – applied at most once, whatever happened to the first attempt. A database without the 0007
 * tables (deployed before the migration) counts nothing and says so once in the log. Errors after the retry are
 * thrown to the module's recordUsage(), which logs them and never fails the request.
 */
import type { Kysely } from "kysely";
import type { UsageRecorder } from "../../modules/medreport/api/deps";
import type { Database } from "../db/schema";
import { newUsageEventId, recordUsageEvent } from "../repos/usage";
import { isMissingUsageTable, noteMissingUsageTables } from "../repos/usage-period";

export interface UsageRecorderOptions {
  /** Pause before the retry (ms). */
  retryDelayMs?: number;
  now?: () => Date;
}

export function dbUsageRecorder(db: () => Kysely<Database>, opts: UsageRecorderOptions = {}): UsageRecorder {
  return {
    async record(tenantId, event) {
      const eventId = newUsageEventId();
      const ctx = () => ({ db: db(), ...(opts.now ? { now: opts.now } : {}) });
      try {
        await recordUsageEvent(ctx(), tenantId, event, { eventId });
      } catch (err) {
        if (isMissingUsageTable(err)) {
          noteMissingUsageTables();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, opts.retryDelayMs ?? 200));
        await recordUsageEvent(ctx(), tenantId, event, { eventId });
      }
    },
  };
}
