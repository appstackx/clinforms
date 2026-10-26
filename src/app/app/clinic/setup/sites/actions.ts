"use server";
/**
 * Set-up → Sites and rooms: sites, rooms, opening hours and closures. Owners and administrators
 * (settings.manage). A new site or a closure of every site needs the whole clinic; a site's own details, rooms,
 * hours and closures need that site in the member's site access. Every write is audited by the repositories.
 */
import { revalidatePath } from "next/cache";
import { RoomInputSchema, RoomPatchSchema, SiteInputSchema, SitePatchSchema } from "@/modules/pms/core/schemas";
import { SETUP_PATH } from "@/modules/pms/reporting/catalogue";
import { WEEKDAY_NAMES } from "@/modules/pms/reporting/copy";
import { checkbox, integer, lines, text, textOrNull, type FormResult } from "@/modules/pms/reporting/forms";
import { ClosureInputSchema, MAX_SESSIONS_PER_DAY, OpeningHoursInputSchema, type OpeningSessionInput } from "@/modules/pms/reporting/schemas";
import { actorErrorMessage, clinicActionActor } from "@/server/pms/actor";
import { NOT_FOUND, NOT_WHOLE_CLINIC, failed, invalid } from "@/server/pms/reporting/action-results";
import { coversWholeClinic, mayManageSite, siteScopeOf } from "@/server/pms/reporting/scope";
import { createRoom, createSite, getRoom, getSite, updateRoom, updateSite } from "@/server/repos/pms/directory";
import { addClosure, getClosure, removeClosure, setOpeningHours } from "@/server/repos/pms/reporting/opening-hours";

const PATH = `${SETUP_PATH}/sites`;

function siteFields(form: FormData) {
  return {
    name: text(form, "name"),
    code: textOrNull(form, "code"),
    address: lines(form, "address"),
    postcode: text(form, "postcode"),
    phone: text(form, "phone"),
    email: text(form, "email"),
    sortOrder: integer(form, "sortOrder"),
  };
}

export async function createSiteAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  if (!coversWholeClinic(await siteScopeOf(actor))) return NOT_WHOLE_CLINIC;
  const input = siteFields(form);
  const parsed = SiteInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const site = await createSite(actor.repo(), actor.tenantId, input as never, actor.actor);
    revalidatePath(PATH);
    return { ok: true, message: `${site.name} added.`, id: site.id };
  } catch (err) {
    return failed(err, "site.create");
  }
}

export async function updateSiteAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const siteId = text(form, "siteId") ?? "";
  if (!mayManageSite(await siteScopeOf(actor), siteId)) return NOT_WHOLE_CLINIC;
  const patch = { ...siteFields(form), active: checkbox(form, "active") };
  const parsed = SitePatchSchema.safeParse(patch);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const site = await updateSite(actor.repo(), actor.tenantId, siteId, patch as never, actor.actor);
    if (!site) return NOT_FOUND;
    revalidatePath(PATH, "layout");
    return { ok: true, message: "Site saved." };
  } catch (err) {
    return failed(err, "site.update");
  }
}

export async function createRoomAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const siteId = text(form, "siteId") ?? "";
  if (!mayManageSite(await siteScopeOf(actor), siteId)) return NOT_WHOLE_CLINIC;
  const input = { siteId, name: text(form, "name"), sortOrder: integer(form, "sortOrder") };
  const parsed = RoomInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const room = await createRoom(actor.repo(), actor.tenantId, input as never, actor.actor);
    revalidatePath(`${PATH}/${siteId}`);
    return { ok: true, message: `${room.name} added.` };
  } catch (err) {
    return failed(err, "room.create");
  }
}

export async function updateRoomAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const room = await getRoom(actor.repo(), actor.tenantId, text(form, "roomId") ?? "");
  if (!room) return NOT_FOUND;
  if (!mayManageSite(await siteScopeOf(actor), room.siteId)) return NOT_WHOLE_CLINIC;
  const patch = { name: text(form, "name"), active: checkbox(form, "active"), sortOrder: integer(form, "sortOrder") };
  const parsed = RoomPatchSchema.safeParse(patch);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await updateRoom(actor.repo(), actor.tenantId, room.id, patch as never, actor.actor);
    revalidatePath(`${PATH}/${room.siteId}`);
    return { ok: true, message: "Room saved." };
  } catch (err) {
    return failed(err, "room.update");
  }
}

/** Fields d<weekday>_<n>_opens / _closes (n = 1…MAX_SESSIONS_PER_DAY); both empty = no session. */
function sessionsFrom(form: FormData): { sessions: OpeningSessionInput[]; half: string | null } {
  const sessions: OpeningSessionInput[] = [];
  for (let day = 1; day <= 7; day++) {
    for (let n = 1; n <= MAX_SESSIONS_PER_DAY; n++) {
      const opensAt = text(form, `d${day}_${n}_opens`) ?? "";
      const closesAt = text(form, `d${day}_${n}_closes`) ?? "";
      if (!opensAt && !closesAt) continue;
      if (!opensAt || !closesAt) return { sessions, half: `d${day}_${n}` };
      sessions.push({ weekday: day, opensAt, closesAt });
    }
  }
  return { sessions, half: null };
}

export async function setOpeningHoursAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const siteId = text(form, "siteId") ?? "";
  if (!mayManageSite(await siteScopeOf(actor), siteId)) return NOT_WHOLE_CLINIC;
  const { sessions, half } = sessionsFrom(form);
  if (half) return { ok: false, error: `${WEEKDAY_NAMES[Number(half.slice(1, 2))]}: enter both an opening and a closing time, or neither.` };
  const parsed = OpeningHoursInputSchema.safeParse({ siteId, sessions });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const index = typeof issue?.path[1] === "number" ? issue.path[1] : -1;
    const s = sessions[index];
    return s ? { ok: false, error: `${WEEKDAY_NAMES[s.weekday]}: ${issue.message.toLowerCase()}.` } : invalid(parsed.error);
  }
  try {
    await setOpeningHours(actor.repo(), actor.tenantId, { siteId, sessions }, actor.actor);
    revalidatePath(`${PATH}/${siteId}`);
    return { ok: true, message: "Opening hours saved." };
  } catch (err) {
    return failed(err, "opening_hours.set");
  }
}

export async function addClosureAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const siteId = textOrNull(form, "siteId") ?? null;
  if (!mayManageSite(await siteScopeOf(actor), siteId)) return NOT_WHOLE_CLINIC;
  const input = { siteId, startsOn: text(form, "startsOn") ?? "", endsOn: text(form, "endsOn"), reason: text(form, "reason") };
  const parsed = ClosureInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    if (siteId && !(await getSite(actor.repo(), actor.tenantId, siteId))) return NOT_FOUND;
    await addClosure(actor.repo(), actor.tenantId, input, actor.actor);
    revalidatePath(PATH, "layout");
    return { ok: true, message: "Closure added." };
  } catch (err) {
    return failed(err, "closure.create");
  }
}

export async function removeClosureAction(_prev: FormResult | null, form: FormData): Promise<FormResult> {
  const actor = await clinicActionActor({ permission: "settings.manage" });
  if ("error" in actor) return { ok: false, error: actorErrorMessage(actor.error) };
  const closure = await getClosure(actor.repo(), actor.tenantId, text(form, "closureId") ?? "");
  if (!closure) return NOT_FOUND;
  if (!mayManageSite(await siteScopeOf(actor), closure.siteId)) return NOT_WHOLE_CLINIC;
  try {
    await removeClosure(actor.repo(), actor.tenantId, closure.id, actor.actor);
    revalidatePath(PATH, "layout");
    return { ok: true, message: "Closure removed." };
  } catch (err) {
    return failed(err, "closure.remove");
  }
}
