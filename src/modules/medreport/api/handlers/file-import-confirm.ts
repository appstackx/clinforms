import "server-only";

/**
 * POST /api/reports/v1/connectors/file-import/confirm (production wave 3)
 *
 * An actor, as for /connectors/file-import/read. Body {review: NotesReview} – the review the read returned,
 * as staff checked and corrected it in the Studio (dates, clinicians, registration details; entries left out).
 * Everything is checked again here; the bundle is then built exactly as for any import
 * (connectors/file-import/review-bundle.ts) → BundleResponse, with one PARSE trace entry (counts only). For a
 * clinic, a "notes.imported" row records the format and counts (never names, notes or file names).
 *
 * Errors: 401, 403, 429 RATE_LIMITED (fix wave 3: per-minute limits per sign-in or session and per address),
 * 413, 422 VALIDATION_FAILED (body shape), 422 IMPORT_INVALID with plain-English `issues`
 * (a required detail missing, an included entry without a date or clinician).
 *
 * Owner: integration agent.
 */
import { assertActorConnector, requireActor } from "../../auth/actor";
import { MAX_IMPORT_CHARS } from "../../connectors/file-import/format";
import { ImportError } from "../../connectors/file-import/parser";
import { bundleFromReview } from "../../connectors/file-import/review-bundle";
import { requireConnector, toConnectorHttpError } from "../../connectors/handler-support";
import type { TraceEntry } from "../../core/types";
import { FileImportConfirmRequestSchema } from "../contract";
import { json, logEvent, parseBody, type MedreportHandler } from "../http";
import { auditNotesImported, bundleResponseFor, takeFileImportSlot } from "./file-import-response";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const handleFileImportConfirm: MedreportHandler = async (req, _ctx, deps) => {
  const actor = await requireActor(req, deps);
  const connector = requireConnector(deps, "file-import", { tenantId: actor.tenantId });
  assertActorConnector(actor, connector.id);
  await takeFileImportSlot(req, deps, actor);
  // The review carries the notes' text back (JSON escaping can double it).
  const parsed = await parseBody(req, FileImportConfirmRequestSchema, { maxBytes: MAX_IMPORT_CHARS * 2 + 200_000 });
  if (!parsed.ok) return parsed.response;

  const started = Date.now();
  const { review } = parsed.data;
  const built = bundleFromReview(review, { tenantId: actor.tenantId });
  if (!built.ok) throw toConnectorHttpError(new ImportError(built.issues), connector.id);
  const { counts } = built;
  const trace: TraceEntry[] = [
    {
      method: "PARSE",
      url: "file-import/review",
      status: 200,
      ms: Date.now() - started,
      transport: "in-process",
      note: [
        "checked and confirmed by staff",
        plural(counts.notes, "note"),
        plural(counts.appointments, "appointment"),
        plural(counts.scores, "outcome score"),
        ...(counts.leftOut ? [`${plural(counts.leftOut, "entry", "entries")} left out`] : []),
      ].join(" · "),
    },
  ];
  const data = await bundleResponseFor(deps, actor, built.bundle, trace);
  await auditNotesImported(deps, actor, data.bundle, {
    format: review.format,
    layout: "general",
    extra: { entriesLeftOut: counts.leftOut, detailsFound: counts.detectedFields, detailsFilled: counts.filledFields },
  });
  logEvent("notes_confirmed", {
    format: review.format,
    notes: counts.notes,
    appointments: counts.appointments,
    scores: counts.scores,
    leftOut: counts.leftOut,
    ms: Date.now() - started,
  });
  return json(data);
};
