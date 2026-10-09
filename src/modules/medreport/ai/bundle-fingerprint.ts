import "server-only";

/**
 * Which record a recorded demo draft belongs to. A recorded draft answers questions about ONE episode's
 * notes; it is only ever replayed for a bundle from the simulated TM3 whose notes are exactly the ones
 * it was recorded from. Matching on the patient ID alone would hand Megan's or Daniel's answers to any
 * upload that happens to use "sim-pat-001".
 *
 * Fingerprint = SHA-256 of canonical JSON of {connector, patient, episode, notes (every field)}.
 *
 * Owner: ai agent.
 */
import { createHash } from "node:crypto";
import { canonicalize } from "../core/fingerprint";
import type { EpisodeBundle } from "../core/types";

/** The connector whose bundles recorded drafts were made from. */
export const RECORDED_DRAFT_CONNECTOR = "tm3-sim";

export function bundleNotesFingerprint(bundle: Pick<EpisodeBundle, "source" | "notes">): string {
  const notes = bundle.notes
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const payload = {
    v: 1,
    connectorId: bundle.source.connectorId,
    patientId: bundle.source.externalPatientId,
    episodeId: bundle.source.externalEpisodeId,
    notes,
  };
  return createHash("sha256").update(canonicalize(payload), "utf8").digest("hex");
}
