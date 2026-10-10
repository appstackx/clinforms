import "server-only";

/**
 * Shared by the file-import handlers (bundle, read, confirm): the BundleResponse for an imported bundle – stamped
 * with the actor's clinic and, for a clinic, its own details from its profile – the "notes.imported" audit row
 * (wave 3: counts, format and layout only – never names, notes or file names), and (fix wave 3) the per-minute
 * limits on reading uploads: per sign-in or demo session and per network address, on the shared counters.
 *
 * Owner: integration agent.
 */
import { createHash } from "node:crypto";
import { demoDraftAvailability } from "../../ai/draft-demo";
import { AUDIT_ACTIONS, auditActor, clinicProfileOf, type Actor } from "../../auth/actor";
import { clientKey } from "../../auth/passcode";
import { countHit, subjectKey } from "../../auth/shared-limits";
import { clinicDetailsFromProfile } from "../../core/clinic";
import { computeFacts } from "../../core/computed-facts";
import type { EpisodeBundle, TraceEntry } from "../../core/types";
import { runDataChecks } from "../../core/validation/data-checks";
import { WORDING } from "../../core/wording";
import type { BundleResponse } from "../contract";
import type { MedreportDeps } from "../deps";
import { HttpError, logEvent } from "../http";

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

/* ------------------------------------------------------------------------------------------------
 * Fix wave 3: per-minute limits on reading notes uploads (any actor – the public demo included)
 * ----------------------------------------------------------------------------------------------*/

/** Uploads read, checked or confirmed per minute by one sign-in or demo session. */
export const FILE_IMPORT_PER_ACTOR_PER_MINUTE = 30;
/** The same, per network address (several sessions from one place). */
export const FILE_IMPORT_PER_CLIENT_PER_MINUTE = 90;
const MINUTE_MS = 60_000;

/** A counter subject that never holds a raw id or address (keyed hash; a plain hash when no key is configured). */
function limitSubject(subject: string): string {
  try {
    return subjectKey(subject);
  } catch {
    return createHash("sha256").update(`clinforms:import-limit:${subject}`, "utf8").digest("base64url").slice(0, 22);
  }
}

/**
 * One request of the actor's and the client's per-minute allowance for /connectors/file-import/* (shared
 * rate_limits counters, in memory without a shared store). Over either → 429 RATE_LIMITED with Retry-After.
 */
export async function takeFileImportSlot(req: Request, deps: MedreportDeps, actor: Actor): Promise<void> {
  const now = Date.now();
  const who = actor.userId ? `user:${actor.tenantId}:${actor.userId}` : `session:${actor.via}:${actor.sid}`;
  const [mine, client] = await Promise.all([
    countHit(deps, `import:actor:${limitSubject(who)}`, MINUTE_MS, now),
    countHit(deps, `import:client:${limitSubject(clientKey(req))}`, MINUTE_MS, now),
  ]);
  const over = [mine.count > FILE_IMPORT_PER_ACTOR_PER_MINUTE ? mine : null, client.count > FILE_IMPORT_PER_CLIENT_PER_MINUTE ? client : null].filter(
    (w): w is NonNullable<typeof w> => w !== null,
  );
  if (!over.length) return;
  const seconds = Math.max(1, Math.ceil((Math.max(...over.map((w) => w.resetAtMs)) - now) / 1000));
  logEvent("file_import_limited", { scope: mine.count > FILE_IMPORT_PER_ACTOR_PER_MINUTE ? "actor" : "client" });
  throw new HttpError(429, WORDING.server.access.importLimitTitle, {
    code: "RATE_LIMITED",
    detail: WORDING.server.access.importLimitDetail(seconds),
    retryable: true,
    headers: { "retry-after": String(seconds) },
  });
}
