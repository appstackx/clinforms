"use server";
/**
 * Set-up → Referrers and payers. Every role that may add referrers (directory.edit: owners, administrators,
 * practitioners, reception). Notes are encrypted by the repository; edits name the revision they were made on.
 */
import { revalidatePath } from "next/cache";
import { ReferrerInputSchema, ReferrerPatchSchema } from "@/modules/pms/core/schemas";
import { SETUP_PATH } from "@/modules/pms/reporting/catalogue";
import { checkbox, lines, text, type FormResult } from "@/modules/pms/reporting/forms";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { CONFLICT, NOT_FOUND, failed, invalid } from "@/server/pms/reporting/action-results";
import { createReferrer, updateReferrer } from "@/server/repos/pms/referrers";

const PATH = `${SETUP_PATH}/referrers`;

function fields(form: FormData) {
  return {
    kind: text(form, "kind"),
    name: text(form, "name"),
    contactName: text(form, "contactName"),
    email: text(form, "email"),
    phone: text(form, "phone"),
    address: lines(form, "address"),
    postcode: text(form, "postcode"),
    notes: text(form, "notes"),
  };
}

export async function createReferrerAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "directory.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const input = fields(form);
  const parsed = ReferrerInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const r = await createReferrer(actor.repo(), actor.tenantId, input as never, actor.actor);
    revalidatePath(PATH);
    return { ok: true, message: `${r.name} added.`, id: r.id };
  } catch (err) {
    return failed(err, "referrer.create");
  }
}

export async function updateReferrerAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "directory.edit" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const patch = { ...fields(form), active: checkbox(form, "active") };
  const parsed = ReferrerPatchSchema.safeParse(patch);
  if (!parsed.success) return invalid(parsed.error);
  const id = text(form, "referrerId") ?? "";
  const rev = Number(text(form, "rev"));
  if (!Number.isInteger(rev) || rev < 1) return NOT_FOUND;
  try {
    const saved = await updateReferrer(actor.repo(), actor.tenantId, id, rev, patch as never, actor.actor);
    if (!saved.ok) return saved.reason === "conflict" ? CONFLICT : NOT_FOUND;
    revalidatePath(PATH, "layout");
    return { ok: true, message: "Saved." };
  } catch (err) {
    return failed(err, "referrer.update");
  }
}
