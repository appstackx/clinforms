"use server";
/**
 * Set-up's server actions. Each: the member, the clinic's package and the permission first (contract §6), then
 * src/server/pms/reporting/setup.ts, which checks the permission and the member's sites again, validates and
 * writes with the audit row. Answers { ok: true, … } or { ok: false, error, fieldErrors } in plain words.
 */
import { revalidatePath } from "next/cache";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import {
  addClosureFor,
  createSiteFor,
  removeClosureFor,
  saveBillingSettingsFor,
  saveOpeningHoursFor,
  savePractitionerFor,
  savePriceListFor,
  saveReferrerFor,
  saveRetentionFor,
  saveRoomFor,
  saveServiceFor,
  saveTargetsFor,
  setPayerModeFor,
  setPriceFor,
  updateSiteFor,
  type BillingFields,
  type ClosureFields,
  type DayHours,
  type PractitionerFields,
  type PriceListFields,
  type ReferrerFields,
  type ServiceFields,
  type SetupResult,
  type SiteFields,
} from "@/server/pms/reporting/setup";

export type SetupActionResult = { ok: true; id?: string; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const SETUP = "/app/clinic/setup";

type Actor = Exclude<Awaited<ReturnType<typeof clinicActionActor>>, { error: unknown }>;

/** After the actor (checked first in every action): the server layer's result as the form's answer + revalidate. */
async function done<T>(actor: Actor, path: string, work: (actor: Actor) => Promise<SetupResult<T>>, id?: (v: T) => string | undefined): Promise<SetupActionResult> {
  const r = await work(actor);
  if (!r.ok) return { ok: false, error: r.error, fieldErrors: r.fieldErrors };
  revalidatePath(`${SETUP}/${path}`);
  return { ok: true, id: id ? id(r.value) : undefined };
}

export async function createSiteAction(fields: SiteFields) {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) } as SetupActionResult;
  return done(actor, "sites", (a) => createSiteFor(a, fields), (v) => v.id);
}
export async function updateSiteAction(siteId: string, fields: SiteFields) {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) } as SetupActionResult;
  return done(actor, "sites", (a) => updateSiteFor(a, String(siteId), fields), (v) => v.id);
}
export async function saveOpeningHoursAction(siteId: string, days: DayHours[]) {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) } as SetupActionResult;
  return done(actor, "sites", (a) => saveOpeningHoursFor(a, String(siteId), days));
}
export async function addClosureAction(fields: ClosureFields) {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) } as SetupActionResult;
  return done(actor, "sites", (a) => addClosureFor(a, fields), (v) => v.id);
}
export async function removeClosureAction(closureId: string) {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) } as SetupActionResult;
  return done(actor, "sites", (a) => removeClosureFor(a, String(closureId)));
}
export async function saveRoomAction(input: { roomId?: string | null; siteId: string; name: string; active?: boolean }) {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) } as SetupActionResult;
  return done(actor, "rooms", (a) => saveRoomFor(a, input), (v) => v.id);
}
export async function saveServiceAction(fields: ServiceFields) {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) } as SetupActionResult;
  return done(actor, "services", (a) => saveServiceFor(a, fields), (v) => v.id);
}
export async function savePriceListAction(fields: PriceListFields) {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) } as SetupActionResult;
  return done(actor, "prices", (a) => savePriceListFor(a, fields), (v) => v.id);
}
export async function setPriceAction(fields: { listId: string; serviceId: string; price: string; billingCode?: string }) {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) } as SetupActionResult;
  return done(actor, "prices", (a) => setPriceFor(a, fields));
}
export async function saveReferrerAction(fields: ReferrerFields) {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) } as SetupActionResult;
  return done(actor, "referrers", (a) => saveReferrerFor(a, fields), (v) => v.id);
}
export async function setPayerModeAction(referrerId: string, mode: string) {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) } as SetupActionResult;
  const r = await done(actor, "referrers", (a) => setPayerModeFor(a, String(referrerId), mode));
  if (r.ok) revalidatePath("/app/clinic/billing/payers");
  return r;
}
export async function savePractitionerAction(fields: PractitionerFields) {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) } as SetupActionResult;
  const r = await done(actor, "practitioners", (a) => savePractitionerFor(a, fields), (v) => v.id);
  if (r.ok) revalidatePath("/app/clinic/diary");
  return r;
}
export async function saveRetentionAction(input: { retentionAdultYears: number; retentionChildUntilAge: number }) {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) } as SetupActionResult;
  return done(actor, "records", (a) => saveRetentionFor(a, input));
}
export async function saveBillingSettingsAction(fields: BillingFields) {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) } as SetupActionResult;
  return done(actor, "billing", (a) => saveBillingSettingsFor(a, fields));
}
export async function saveTargetsAction(fields: { rev: number; utilisationTarget: string; dnaTarget: string }) {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) } as SetupActionResult;
  return done(actor, "targets", (a) => saveTargetsFor(a, fields));
}
