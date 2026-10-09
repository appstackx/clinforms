/**
 * Demo EpisodeBundles for tests and dev scripts: the sandbox's fictional fixtures run through the real
 * tm3-sim mapper, with no HTTP. scripts/ may import both the sandbox and the module.
 *
 *   import { getDemoBundle, listDemoPatients } from "./dev-bundles"; // from another scripts/medreport file
 *   const bundle = getDemoBundle("megan-hart");            // or "sim-pat-001" / "sim-ep-1001"
 *
 * Bundles are deterministic: tenant "demo", fetchedAt DEMO_FETCHED_AT. Each call returns a fresh copy.
 * Server-only modules are imported, so run under node:test with scripts/medreport/test-setup.mjs (as
 * `npm run test:medreport` does) or another loader that maps "server-only" to its empty module.
 */
import { DEMO_TENANT_ID } from "@/modules/medreport/config.public";
import { mapSimEpisodeToBundle, type SimEpisodeData } from "@/modules/medreport/connectors/tm3-sim/mapper";
import type { EpisodeBundle } from "@/modules/medreport/core/types";
import { SIM_DEMO_CASES, SIM_PATIENTS, simEpisodeData, type SimDemoCaseSlug } from "@/sandbox/tm3-sim/fixtures";

/** Fixed "fetched" timestamp so bundles (and fingerprints) are stable across runs. */
export const DEMO_FETCHED_AT = "2026-10-06T09:00:00.000Z";

export type DemoCaseSlug = SimDemoCaseSlug;
export const DEMO_CASE_SLUGS = Object.keys(SIM_DEMO_CASES) as DemoCaseSlug[];

export interface DemoPatientInfo {
  /** Wire patient ID in the simulated TM3, e.g. "sim-pat-001". */
  patientId: string;
  displayName: string;
  dob: string;
  /** Slug for getDemoBundle(), or null for registration-only patients. */
  slug: DemoCaseSlug | null;
  /** Wire episode IDs (empty for registration-only patients). */
  episodeIds: string[];
  registrationOnly: boolean;
}

export function listDemoPatients(): DemoPatientInfo[] {
  return SIM_PATIENTS.map((p) => {
    const entry = DEMO_CASE_SLUGS.find((s) => SIM_DEMO_CASES[s].patientId === p.id) ?? null;
    const episodeIds = entry ? [SIM_DEMO_CASES[entry].episodeId] : [];
    return {
      patientId: p.id,
      displayName: `${p.first_name} ${p.last_name}`,
      dob: p.date_of_birth,
      slug: entry,
      episodeIds,
      registrationOnly: episodeIds.length === 0,
    };
  });
}

/** Resolve a slug, wire patient ID or wire episode ID to the demo case's wire episode ID. */
function resolveEpisodeId(idOrSlug: string): string {
  if (idOrSlug in SIM_DEMO_CASES) return SIM_DEMO_CASES[idOrSlug as DemoCaseSlug].episodeId;
  for (const slug of DEMO_CASE_SLUGS) {
    const c = SIM_DEMO_CASES[slug];
    if (c.patientId === idOrSlug || c.episodeId === idOrSlug) return c.episodeId;
  }
  throw new Error(
    `Unknown demo case "${idOrSlug}". Use one of: ${DEMO_CASE_SLUGS.join(", ")} (or their sim-pat-/sim-ep- IDs).`,
  );
}

/** Raw wire data for a demo case (what the simulated TM3 API serves), deep-copied. */
export function getDemoEpisodeData(idOrSlug: DemoCaseSlug | string): SimEpisodeData {
  const data = simEpisodeData(resolveEpisodeId(idOrSlug));
  if (!data) throw new Error(`Demo fixtures are missing episode data for "${idOrSlug}".`);
  // No cast: tsc checks here that the sandbox wire types still match the module's wire schemas.
  const copy: SimEpisodeData = structuredClone(data);
  return copy;
}

/** The mapped EpisodeBundle for a demo case. */
export function getDemoBundle(idOrSlug: DemoCaseSlug | string): EpisodeBundle {
  return mapSimEpisodeToBundle(getDemoEpisodeData(idOrSlug), {
    tenantId: DEMO_TENANT_ID,
    fetchedAt: DEMO_FETCHED_AT,
  });
}
