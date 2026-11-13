"use server";
/**
 * Set-up → Card payments (the clinic's OWN payment account – docs/clinic-system/card-payments.md): the owner only
 * (two-step verification is required for every member; "settings.owner" is never granted to another role). Behind
 * the platform switch CLINFORMS_CARD_PAYMENTS=on. Every change is audited by the repositories.
 */
import { revalidatePath } from "next/cache";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { addReaderFor, createPlanFor, refreshAccountFor, removeReaderFor, setCardPaymentsEnabledFor, setNoShowPolicyFor, setPlanActiveFor } from "@/server/pms/billing/connect/service";
import { cardPaymentsAvailable } from "@/server/pms/billing/connect/screen";

const PATH = "/app/clinic/setup/card-payments";
type Answer<T> = { ok: true; value: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

async function owner() {
  const actor = await clinicActionActor({ permission: "settings.owner" });
  if ("error" in actor) return { error: actorErrorMessage(actor.error) } as const;
  if (!cardPaymentsAvailable()) return { error: "Card payments are not switched on for this system." } as const;
  return { actor } as const;
}

function done<T>(r: { ok: true; value: T } | { ok: false; error: string; fieldErrors?: Record<string, string> }): Answer<T> {
  if (r.ok) revalidatePath(PATH);
  return r.ok ? r : { ok: false, error: r.error, fieldErrors: r.fieldErrors };
}

export async function refreshCardAccountAction(): Promise<Answer<{ status: string }>> {
  const a = await owner();
  if ("error" in a) return { ok: false, error: a.error as string };
  return done(await refreshAccountFor(a.actor));
}

export async function setCardPaymentsEnabledAction(enabled: boolean): Promise<Answer<{ enabled: boolean }>> {
  const a = await owner();
  if ("error" in a) return { ok: false, error: a.error as string };
  return done(await setCardPaymentsEnabledFor(a.actor, enabled === true));
}

export async function setNoShowPolicyAction(input: { enabled: boolean; policy: string }): Promise<Answer<{ enabled: boolean }>> {
  const a = await owner();
  if ("error" in a) return { ok: false, error: a.error as string };
  return done(await setNoShowPolicyFor(a.actor, { enabled: input?.enabled === true, policy: String(input?.policy ?? "") }));
}

export async function addReaderAction(input: { siteId: string; label: string; registrationCode: string; line1: string; city: string; postcode: string }): Promise<Answer<{ id: string }>> {
  const a = await owner();
  if ("error" in a) return { ok: false, error: a.error as string };
  const s = (v: unknown) => String(v ?? "").slice(0, 120);
  return done(await addReaderFor(a.actor, { siteId: s(input?.siteId), label: s(input?.label), registrationCode: s(input?.registrationCode), line1: s(input?.line1), city: s(input?.city), postcode: s(input?.postcode) }));
}

export async function removeReaderAction(id: string): Promise<Answer<{ removed: boolean }>> {
  const a = await owner();
  if ("error" in a) return { ok: false, error: a.error as string };
  return done(await removeReaderFor(a.actor, String(id ?? "")));
}

export async function createPlanAction(input: { name: string; pricePence: number }): Promise<Answer<{ id: string }>> {
  const a = await owner();
  if ("error" in a) return { ok: false, error: a.error as string };
  return done(await createPlanFor(a.actor, { name: String(input?.name ?? ""), pricePence: Number(input?.pricePence) }));
}

export async function setPlanActiveAction(id: string, active: boolean): Promise<Answer<{ changed: boolean }>> {
  const a = await owner();
  if ("error" in a) return { ok: false, error: a.error as string };
  return done(await setPlanActiveFor(a.actor, String(id ?? ""), active === true));
}
