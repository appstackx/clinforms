"use server";
/**
 * The letter screens' server actions (messages.letters – never reception). The member, the clinic's package and the
 * permission first; then src/server/pms/comms/writes.ts checks again, validates and writes with the audit row.
 */
import { revalidatePath } from "next/cache";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { startDischargeLetterFor } from "@/server/pms/comms/letter-files";
import { saveLetterFor, signLetterFor, startLetterFor, voidLetterFor, type SentAnswer } from "@/server/pms/comms/writes";

export type LetterActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string; fieldErrors?: Record<string, string> };

const LETTERS = `${CLINIC_BASE_PATH}/letters`;

function refresh(id?: string, patientId?: string) {
  if (id) revalidatePath(`${LETTERS}/${id}`);
  if (patientId) revalidatePath(`${CLINIC_BASE_PATH}/patients/${patientId}/messages`);
  revalidatePath(`${CLINIC_BASE_PATH}/messages`);
}

export async function startLetterAction(input: { patientId: string; templateId: string; caseId?: string | null; recipient?: string }): Promise<LetterActionResult<{ id: string }>> {
  const actor = await clinicActionActor({ permission: "messages.letters" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await startLetterFor(actor, input);
  if (!r.ok) return { ok: false, error: r.error };
  refresh(undefined, input.patientId);
  return { ok: true, id: r.value.id };
}

export async function saveLetterAction(input: { id: string; rev: number; subject?: string; body?: string; recipientName?: string | null; recipientAddress?: string[] | null; recipientPostcode?: string | null; recipientEmail?: string | null }): Promise<LetterActionResult<{ rev: number }>> {
  const actor = await clinicActionActor({ permission: "messages.letters" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await saveLetterFor(actor, input);
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  refresh(input.id);
  return { ok: true, rev: r.value.rev };
}

export async function signLetterAction(input: { id: string; rev: number; send?: "email" | "post" | "hand" | null }): Promise<LetterActionResult<{ sent: SentAnswer | null }>> {
  const actor = await clinicActionActor({ permission: "messages.letters" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await signLetterFor(actor, input);
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  refresh(input.id);
  return { ok: true, sent: r.value.sent };
}

export async function voidLetterAction(id: string): Promise<LetterActionResult> {
  const actor = await clinicActionActor({ permission: "messages.letters" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await voidLetterFor(actor, id);
  if (!r.ok) return { ok: false, error: r.error };
  refresh(id);
  return { ok: true };
}

/** "Write discharge letter" on a signed discharge note: the letter to the GP, filled from the note (opens the editor). */
export async function startDischargeLetterAction(input: { patientId: string; noteId: string }): Promise<LetterActionResult<{ id: string }>> {
  const actor = await clinicActionActor({ permission: "messages.letters" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await startDischargeLetterFor(actor, input);
  if (!r.ok) return { ok: false, error: r.error };
  refresh(undefined, input.patientId);
  return { ok: true, id: r.value.id };
}
