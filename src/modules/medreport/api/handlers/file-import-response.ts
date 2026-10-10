import "server-only";

/**
 * Shared by the file-import handlers (bundle, read, confirm): the BundleResponse for an imported bundle – stamped
 * with the actor's clinic and, for a clinic, its own details from its profile – and the "notes.imported" audit row
 * (wave 3: counts, format and layout only – never names, notes or file names).
 *
 * Owner: integration agent.
 */
import { demoDraftAvailability } from "../../ai/draft-demo";
import { AUDIT_ACTIONS, auditActor, clinicProfileOf, type Actor } from "../../auth/actor";
import { clinicDetailsFromProfile } from "../../core/clinic";
import { computeFacts } from "../../core/computed-facts";
import type { EpisodeBundle, TraceEntry } from "../../core/types";
import { runDataChecks } from "../../core/validation/data-checks";
import type { BundleResponse } from "../contract";
import type { MedreportDeps } from "../deps";

export async function bundleResponseFor(deps: MedreportDeps, actor: Actor, imported: EpisodeBundle, trace: TraceEntry[]): Promise<BundleResponse> {
  // A clinic's bundle names the clinic from its own profile (never the fictional demo clinic).
  const profile = await clinicProfileOf(deps, actor);
  const bundle = profile ? { ...imported, tenantId: actor.tenantId, clinic: clinicDetailsFromProfile(profile) } : { ...imported, tenantId: actor.tenantId };
  return {
    bundle,
    computedFacts: computeFacts(bundle),
    dataChecks: runDataChecks(bundle),
    trace,
    demoDrafts: demoDraftAvailability(bundle),
  };
}

export interface NotesImportedDetail {
  /** The upload's format: json | csv | text | pdf | docx. */
  format: string;
  /** "documented" = our import format; "general" = ordinary clinic notes checked by staff. */
  layout: "documented" | "general";
  /** Extra counts (entries left out, details found / filled). */
  extra?: Record<string, number>;
}

/** Appends "notes.imported" for a clinic's member (no-op in the public demo). Counts only. */
export async function auditNotesImported(deps: MedreportDeps, actor: Actor, bundle: EpisodeBundle, detail: NotesImportedDetail): Promise<void> {
  await auditActor(deps, actor, {
    action: AUDIT_ACTIONS.notesImported,
    targetType: null,
    targetId: null,
    detail: {
      format: detail.format,
      layout: detail.layout,
      notes: bundle.notes.length,
      appointments: bundle.appointments.length,
      outcomeScores: bundle.outcomeMeasures.reduce((n, m) => n + m.points.length, 0),
      clinicians: bundle.clinicians.length,
      ...(detail.extra ?? {}),
    },
  });
}
