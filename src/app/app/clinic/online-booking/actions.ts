"use server";
/** Set-up → Online booking (settings.setup – the service checks again) and checking an online booking (diary.book). */
import { revalidatePath } from "next/cache";
import { BookingSettingsInputSchema, BookingSiteInputSchema } from "@/modules/pms/portal/schemas";
import { STAFF_PORTAL_PATHS } from "@/modules/pms/portal/paths";
import { fieldErrors } from "@/modules/pms/core/schemas";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { reviewOnlineBookingFor, saveBookingSettingsFor, saveBookingSiteFor, setOnlineBookableFor } from "@/server/pms/portal/staff";

export type SetupAnswer = { ok: true; message?: string; rev?: number } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function saveBookingSettingsAction(expectedRev: number, input: unknown): Promise<SetupAnswer> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const parsed = BookingSettingsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please check the settings marked below.", fieldErrors: fieldErrors(parsed.error) };
  const r = await saveBookingSettingsFor(actor, Number(expectedRev), parsed.data);
  if (r.ok) revalidatePath(STAFF_PORTAL_PATHS.onlineBooking);
  return r.ok ? { ok: true, message: r.message, rev: r.value.rev } : r;
}

export async function saveBookingSiteAction(expectedRev: number, input: unknown): Promise<SetupAnswer> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const parsed = BookingSiteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please check the site's details.", fieldErrors: fieldErrors(parsed.error) };
  const r = await saveBookingSiteFor(actor, Number(expectedRev), parsed.data);
  if (r.ok) revalidatePath(STAFF_PORTAL_PATHS.onlineBooking);
  return r.ok ? { ok: true, message: r.message, rev: r.value.rev } : r;
}

export async function setOnlineBookableAction(kind: "service" | "practitioner", id: string, on: boolean): Promise<SetupAnswer> {
  const actor = await clinicActionActor({ permission: "settings.setup" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (kind !== "service" && kind !== "practitioner") return { ok: false, error: "Unknown choice." };
  const r = await setOnlineBookableFor(actor, kind, String(id), Boolean(on));
  if (r.ok) revalidatePath(STAFF_PORTAL_PATHS.onlineBooking);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function reviewOnlineBookingAction(appointmentId: string): Promise<SetupAnswer> {
  const actor = await clinicActionActor({ permission: "diary.book" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const r = await reviewOnlineBookingFor(actor, String(appointmentId));
  if (r.ok) revalidatePath(STAFF_PORTAL_PATHS.onlineBooking);
  return r.ok ? { ok: true, message: r.message } : r;
}
