/** Result of a create / update on a revisioned record (forms, reports). */
export type SaveResult =
  | { ok: true; rev: number; updatedAt: string }
  | { ok: false; reason: "conflict"; currentRev: number }
  | { ok: false; reason: "exists"; currentRev: number }
  | { ok: false; reason: "not_found" };

/** Largest JSON payload accepted for a form map or report (a D1 row holds at most 2 MB of ciphertext). */
export const MAX_PAYLOAD_BYTES = 1_400_000;
