/**
 * The module demonstration data in `npm run pms:seed-demo` order (contract §9), after seedDemoClinic (seed-lib.ts):
 * set-up, the diary, clinical records for the seeded cases, billing, messages, the portal and integration. Each step
 * adds only what is missing, so running this again finishes a run that stopped part-way (`--resume`). Shared by
 * scripts/pms/seed-demo.ts and the full-seed test on D1 (workers/data-gateway/test/pms-demo-seed-stack.test.ts).
 */
import type { RepoContext } from "../../src/server/repos/context";
import { seedBilling, type SeedBillingSummary } from "./seed-billing";
import { seedComms, type SeedCommsSummary } from "./seed-comms";
import { seedDiary, type SeedDiarySummary } from "./seed-diary";
import { seedIntegration } from "./seed-integration";
import { seedPortal } from "./seed-portal";
import { seedRecords, type SeedRecordsSummary } from "./seed-records";
import { seedSetup } from "./seed-setup";

export interface SeedModulesSummary {
  setup: { sites: number; closures: number };
  diary: SeedDiarySummary;
  records: SeedRecordsSummary;
  billing: SeedBillingSummary;
  comms: SeedCommsSummary;
  portal: { existed: boolean };
  integration: { forms: number; patient: boolean };
}

export async function seedDemoModules(
  ctx: RepoContext,
  tenantId: string,
  options: { now?: Date; log?: (line: string) => void } = {},
): Promise<SeedModulesSummary> {
  const { now, log } = options;
  const setup = await seedSetup(ctx, tenantId, { log });
  const diary = await seedDiary(ctx, tenantId, { now, log });
  const records = await seedRecords(ctx, tenantId, { now, log });
  const billing = await seedBilling(ctx, tenantId, { now, log });
  const comms = await seedComms(ctx, tenantId, { now, log });
  const portal = await seedPortal(ctx, tenantId, { log });
  const integration = await seedIntegration(ctx, tenantId, { log });
  return { setup, diary, records, billing, comms, portal, integration };
}
