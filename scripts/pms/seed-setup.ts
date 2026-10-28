/**
 * Demonstration set-up for the demo clinic (fictional data only): every site's opening hours (Monday–Friday
 * 08:00–20:00, Saturday 09:00–13:00, Sunday closed – the ONE opening-hours source the diary and online booking
 * follow) and two all-sites closures (Christmas 25–28/12/2026, New Year's Day 01/01/2027). Called from
 * scripts/pms/seed-demo.ts before the diary. Idempotent: a site that has opening hours is left as it is; a closure
 * with the same dates and reason is not added twice.
 */
import { RepoInputError, type RepoContext } from "../../src/server/repos/context";
import { listSites } from "../../src/server/repos/pms/directory";
import { addClosure, listClosures, listOpeningHours, setOpeningHours } from "../../src/server/repos/pms/reporting/opening-hours";
import { getPmsSettings } from "../../src/server/repos/pms/settings";
import { DEFAULT_SITE_HOURS } from "../../src/modules/pms/reporting/opening";
import { SEED_ACTOR } from "./seed-lib";

export const DEMO_CLOSURES = [
  { startsOn: "2026-12-25", endsOn: "2026-12-28", reason: "Christmas" },
  { startsOn: "2027-01-01", endsOn: "2027-01-01", reason: "New Year's Day (bank holiday)" },
] as const;

export async function seedSetup(ctx: RepoContext, tenantId: string, options: { log?: (line: string) => void } = {}): Promise<{ sites: number; closures: number }> {
  const log = options.log ?? (() => undefined);
  if (!(await getPmsSettings(ctx, tenantId)).isDemo) throw new RepoInputError("Set-up demo data is only for a clinic flagged as a demonstration clinic.");
  const sites = await listSites(ctx, tenantId);
  const existing = new Set((await listOpeningHours(ctx, tenantId)).map((h) => h.siteId));
  let siteCount = 0;
  for (const s of sites) {
    if (existing.has(s.id)) continue;
    await setOpeningHours(ctx, tenantId, { siteId: s.id, sessions: [...DEFAULT_SITE_HOURS] }, SEED_ACTOR);
    siteCount += 1;
  }
  const have = await listClosures(ctx, tenantId, { from: "2026-12-01", to: "2027-01-31" });
  let closures = 0;
  for (const c of DEMO_CLOSURES) {
    if (have.some((h) => h.siteId === null && h.startsOn === c.startsOn && h.endsOn === c.endsOn && h.reason === c.reason)) continue;
    await addClosure(ctx, tenantId, { siteId: null, ...c }, SEED_ACTOR);
    closures += 1;
  }
  log(`Set-up: opening hours for ${siteCount} sites, ${closures} closures (all sites).`);
  return { sites: siteCount, closures };
}
