"use server";
/** Set-up → Prices: price lists and their prices. Owners and administrators who cover the whole clinic. */
import { revalidatePath } from "next/cache";
import { PriceListInputSchema, PriceListItemInputSchema, PriceListPatchSchema } from "@/modules/pms/core/schemas";
import { SETUP_PATH } from "@/modules/pms/reporting/catalogue";
import { checkbox, poundsToPence, text, textOrNull, type FormResult } from "@/modules/pms/reporting/forms";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { NOT_FOUND, NOT_WHOLE_CLINIC, failed, invalid } from "@/server/pms/reporting/action-results";
import { coversWholeClinic, siteScopeOf } from "@/server/pms/reporting/scope";
import { createPriceList, removePriceListItem, setPriceListItem, updatePriceList } from "@/server/repos/pms/price-lists";

const PATH = `${SETUP_PATH}/prices`;

function listFields(form: FormData) {
  return {
    name: text(form, "name"),
    payerType: textOrNull(form, "payerType") ?? null,
    referrerId: textOrNull(form, "referrerId") ?? null,
    isDefault: checkbox(form, "isDefault"),
    validFrom: text(form, "validFrom"),
    validTo: text(form, "validTo"),
  };
}

export async function createPriceListAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!coversWholeClinic(await siteScopeOf(actor))) return NOT_WHOLE_CLINIC;
  const input = listFields(form);
  const parsed = PriceListInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const list = await createPriceList(actor.repo(), actor.tenantId, input as never, actor.actor);
    revalidatePath(PATH);
    return { ok: true, message: `${list.name} added.`, id: list.id };
  } catch (err) {
    return failed(err, "price_list.create");
  }
}

export async function updatePriceListAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!coversWholeClinic(await siteScopeOf(actor))) return NOT_WHOLE_CLINIC;
  const patch = { ...listFields(form), active: checkbox(form, "active") };
  const parsed = PriceListPatchSchema.safeParse(patch);
  if (!parsed.success) return invalid(parsed.error);
  if (parsed.data.validFrom && parsed.data.validTo && parsed.data.validFrom > parsed.data.validTo) return { ok: false, error: "The end date is before the start date.", fieldErrors: { validTo: "The end date is before the start date" } };
  try {
    const list = await updatePriceList(actor.repo(), actor.tenantId, text(form, "priceListId") ?? "", patch as never, actor.actor);
    if (!list) return NOT_FOUND;
    revalidatePath(PATH, "layout");
    return { ok: true, message: "Price list saved." };
  } catch (err) {
    return failed(err, "price_list.update");
  }
}

export async function setPriceAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!coversWholeClinic(await siteScopeOf(actor))) return NOT_WHOLE_CLINIC;
  const price = poundsToPence(text(form, "price"));
  const input = { priceListId: text(form, "priceListId") ?? "", serviceId: text(form, "serviceId") ?? "", pricePence: price === null ? undefined : price, billingCode: textOrNull(form, "billingCode") ?? null };
  const parsed = PriceListItemInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await setPriceListItem(actor.repo(), actor.tenantId, input as never, actor.actor);
    revalidatePath(`${PATH}/${input.priceListId}`);
    return { ok: true, message: "Price saved." };
  } catch (err) {
    return failed(err, "price_list_item.set");
  }
}

export async function removePriceAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!coversWholeClinic(await siteScopeOf(actor))) return NOT_WHOLE_CLINIC;
  const priceListId = text(form, "priceListId") ?? "";
  try {
    const removed = await removePriceListItem(actor.repo(), actor.tenantId, priceListId, text(form, "serviceId") ?? "", actor.actor);
    if (!removed) return NOT_FOUND;
    revalidatePath(`${PATH}/${priceListId}`);
    return { ok: true, message: "Price removed." };
  } catch (err) {
    return failed(err, "price_list_item.remove");
  }
}
