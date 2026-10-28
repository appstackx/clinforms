"use server";
/**
 * Import from the previous system (settings.import – owners and administrators by default, never reception). Thin
 * wrappers over src/server/pms/integration/import-service.ts, which checks the permission again, reads the import from
 * the member's own clinic and validates everything; the long steps run one page per call (the page calls again).
 */
import type { CsvDelimiter } from "@/modules/pms/integration/csv";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import {
  addRowsFor,
  approveFor,
  cancelImportFor,
  checkStepFor,
  finishUploadFor,
  importIssuesFor,
  importStepFor,
  saveMappingFor,
  startImportFor,
  undoStepFor,
  type ImportIssueRow,
} from "@/server/pms/integration/import-service";
import type { StepProgress } from "@/server/pms/integration/importer";

type Answer<T> = { ok: true; value: T } | { ok: false; error: string };

function answer<T>(r: { ok: true; value: T } | { ok: false; error: string }): Answer<T> {
  return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
}

export async function startImportAction(input: { kind: string; fileName: string | null; fileSha256: string | null; delimiter: CsvDelimiter; headers: string[]; expectedRows: number }): Promise<Answer<{ id: string }>> {
  const actor = await clinicActionActor({ permission: "settings.import" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return answer(await startImportFor(actor, input));
}

export async function addRowsAction(batchId: string, part: { firstRowNo: number; rows: string[][] }): Promise<Answer<{ rowCount: number }>> {
  const actor = await clinicActionActor({ permission: "settings.import" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return answer(await addRowsFor(actor, batchId, part));
}

export async function finishUploadAction(batchId: string): Promise<Answer<{ status: string }>> {
  const actor = await clinicActionActor({ permission: "settings.import" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return answer(await finishUploadFor(actor, batchId));
}

export async function saveMappingAction(batchId: string, expectedRev: number, mapping: Record<string, number | null>): Promise<Answer<{ rev: number }>> {
  const actor = await clinicActionActor({ permission: "settings.import" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return answer(await saveMappingFor(actor, batchId, expectedRev, mapping));
}

export async function checkStepAction(batchId: string): Promise<Answer<StepProgress>> {
  const actor = await clinicActionActor({ permission: "settings.import" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return answer(await checkStepFor(actor, batchId));
}

export async function approveAction(batchId: string, expectedRev: number, confirmed: boolean): Promise<Answer<{ ok: true }>> {
  const actor = await clinicActionActor({ permission: "settings.import" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return answer(await approveFor(actor, batchId, expectedRev, confirmed));
}

export async function importStepAction(batchId: string): Promise<Answer<StepProgress>> {
  const actor = await clinicActionActor({ permission: "settings.import" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return answer(await importStepFor(actor, batchId));
}

export async function undoStepAction(batchId: string): Promise<Answer<StepProgress>> {
  const actor = await clinicActionActor({ permission: "settings.import" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return answer(await undoStepFor(actor, batchId));
}

export async function cancelImportAction(batchId: string): Promise<Answer<{ ok: true }>> {
  const actor = await clinicActionActor({ permission: "settings.import" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return answer(await cancelImportFor(actor, batchId));
}

export async function issuesAction(batchId: string, afterRowNo: number): Promise<Answer<{ rows: ImportIssueRow[]; more: boolean }>> {
  const actor = await clinicActionActor({ permission: "settings.import" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  return answer(await importIssuesFor(actor, batchId, afterRowNo));
}
