"use server";
/**
 * Exercise programmes on the patient's record (ex03–ex04): start a draft, save it (the builder sends its exercises as
 * JSON), share it with the patient (optionally emailing a portal link), end it, make a new version. clinical.write;
 * the records service (src/server/pms/records/exercises-service.ts) checks the permission, both switches, the
 * patient (clinic and sites) and the programme again.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { RecordsActionState } from "@/modules/pms/records/types";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";
import { emailPortalLink } from "@/server/pms/portal/staff";
import { actionState } from "@/server/pms/records/action-state";
import { createProgrammeFor, endProgrammeFor, newVersionFor, saveProgrammeFor, shareProgrammeFor } from "@/server/pms/records/exercises-service";
import { checked, intField, optional, text } from "@/server/pms/records/forms";
import { patientPath } from "@/server/pms/records/record";

const MAX_ITEMS_JSON = 200_000;

function itemsFrom(form: FormData): unknown[] | null {
  const raw = text(form, "items");
  if (!raw) return [];
  if (raw.length > MAX_ITEMS_JSON) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export async function startProgramme(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.write" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const result = await createProgrammeFor(actor, patientId, { title: text(form, "title"), caseId: optional(form, "caseId"), items: [] });
  if (!result.ok) return actionState(result, () => ({ ok: true }));
  redirect(patientPath(patientId, `exercises/${result.value.id}`));
}

export async function saveProgramme(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.write" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const programmeId = text(form, "programmeId");
  const items = itemsFrom(form);
  if (items === null) return { ok: false, error: "The exercises could not be read. Reload the page and try again." };
  const result = await saveProgrammeFor(actor, patientId, programmeId, intField(form, "rev"), { title: text(form, "title"), notes: optional(form, "notes"), caseId: optional(form, "caseId"), items: items as never });
  if (result.ok) revalidatePath(patientPath(patientId, `exercises/${programmeId}`));
  return actionState(result, (v) => ({ ok: true, rev: v.rev, message: "Draft saved." }));
}

export async function shareProgramme(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.write" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const programmeId = text(form, "programmeId");
  const result = await shareProgrammeFor(actor, patientId, programmeId, intField(form, "rev"));
  if (!result.ok) return actionState(result, () => ({ ok: true }));
  revalidatePath(patientPath(patientId, "exercises"));
  revalidatePath(patientPath(patientId, `exercises/${programmeId}`));
  if (!result.value.portal) return { ok: true, message: "Shared. The patient portal is switched off, so print the PDF for the patient." };
  if (!checked(form, "notify")) return { ok: true, message: "Shared. The patient sees it in their portal under “Your exercises”." };
  // The email never names the programme: a one-time sign-in link that opens it.
  const mailed = await emailPortalLink(actor, patientId, `${clinicPublicPaths(actor.tenantId).portal}/exercises/${encodeURIComponent(programmeId)}`);
  return mailed.ok ? { ok: true, message: "Shared. The patient gets an email with a link to their portal." } : { ok: true, message: `Shared in the portal, but no email was sent: ${mailed.error}` };
}

export async function endProgramme(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.write" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const programmeId = text(form, "programmeId");
  const result = await endProgrammeFor(actor, patientId, programmeId, intField(form, "rev"));
  if (result.ok) {
    revalidatePath(patientPath(patientId, "exercises"));
    revalidatePath(patientPath(patientId, `exercises/${programmeId}`));
  }
  return actionState(result, () => ({ ok: true, message: "Ended. It is kept on the record and no longer shows in the portal." }));
}

export async function newVersion(_prev: RecordsActionState, form: FormData): Promise<RecordsActionState> {
  const actor = await clinicActionActor({ permission: "clinical.write" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patientId = text(form, "patientId");
  const result = await newVersionFor(actor, patientId, text(form, "programmeId"));
  if (!result.ok) return actionState(result, () => ({ ok: true }));
  redirect(patientPath(patientId, `exercises/${result.value.id}`));
}
