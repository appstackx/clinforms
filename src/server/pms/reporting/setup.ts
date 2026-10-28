/**
 * Set-up's server layer (/app/clinic/setup/**): what the pages load and what their actions write. Same rules as
 * the other modules' server layers:
 *
 *   1. the member's permission FIRST (settings.setup; the audit trail settings.members, its CSV reports.export;
 *      import settings.import);
 *   2. site-specific changes (a site's details, rooms, opening hours, closures) need that site in the member's
 *      site access (actor.siteIds); clinic-wide ones (a new site, all-sites closures, appointment types, prices,
 *      payers, practitioners, templates, billing settings, targets) need every site;
 *   3. ids from the request are read back from the member's own clinic ("no such item" otherwise);
 *   4. inputs validated with the schemas (the repositories validate again and write the audit row in the same
 *      batch);
 *   5. a plain result – never a database message.
 */
import "server-only";
import { z } from "zod";
import { BillingSettingsInputSchema, type BillingSettingsInput } from "../../../modules/pms/billing/schemas";
import type { BankDetails, BillingSettings } from "../../../modules/pms/billing/types";
import { DEFAULT_CONTRIBUTION_MODE, isContributionMode, type ContributionMode } from "../../../modules/pms/billing/excess";
import {
  PractitionerInputSchema,
  PriceListInputSchema,
  PriceListItemInputSchema,
  ReferrerInputSchema,
  RoomInputSchema,
  ServiceInputSchema,
  SiteInputSchema,
  fieldErrors,
} from "../../../modules/pms/core/schemas";
import type { PmsSettings, Practitioner, PriceList, PriceListItem, Referrer, Room, Service, Site } from "../../../modules/pms/core/types";
import type { NoteTemplate } from "../../../modules/pms/records/templates";
import { DEFAULT_SITE_HOURS } from "../../../modules/pms/reporting/opening";
import { ClosureInputSchema, OpeningHoursInputSchema, timeToMinutes } from "../../../modules/pms/reporting/schemas";
import { scopeAllows, sitesInScope } from "../../../modules/pms/reporting/site-scope";
import { logAuthEvent } from "../../email/log";
import { RepoInputError } from "../../repos/context";
import { getBillingSettings, updateBillingSettings } from "../../repos/pms/billing/settings";
import { payerContributionModes, setPayerContributionMode } from "../../repos/pms/billing/contribution-terms";
import { createPractitioner, createRoom, createService, createSite, getPractitioner, getRoom, getService, getSite, listPractitioners, listRooms, listServices, listSites, updatePractitioner, updateRoom, updateService, updateSite } from "../../repos/pms/directory";
import { createPriceList, getPriceList, listPriceListItems, listPriceLists, removePriceListItem, setPriceListItem, updatePriceList } from "../../repos/pms/price-lists";
import { createReferrer, getReferrer, listReferrers, updateReferrer } from "../../repos/pms/referrers";
import { listNoteTemplates } from "../../repos/pms/records/templates";
import { addClosure, getClosure, listClosures, listOpeningHours, removeClosure, setOpeningHours, type OpeningSession, type SiteClosure } from "../../repos/pms/reporting/opening-hours";
import { getReportingSettings, updateReportingSettings, type ReportingSettings } from "../../repos/pms/reporting/settings";
import { getPmsSettings, updatePmsSettings } from "../../repos/pms/settings";
import { listClinicMembers, type ClinicMember } from "../access-screens";
import type { ClinicActor } from "../actor";
import type { DayHours, PractitionersScreen, PricesScreen, ReferrersScreen, SitesScreen } from "../../../modules/pms/reporting/setup-view";

export type { DayHours, PractitionersScreen, PricesScreen, ReferrersScreen, SitesScreen };
import { ukToday } from "../../../modules/pms/core/text";

export type SetupActor = Pick<ClinicActor, "tenantId" | "organizationId" | "userId" | "role" | "can" | "siteIds" | "actor" | "repo">;

export type SetupResult<T> = { ok: true; value: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const SETUP_MESSAGES = {
  forbidden: "You do not have permission to do that.",
  wholeClinic: "Only an owner, or an administrator who works at every site, can change this.",
  notFound: "This item does not exist in this clinic.",
  conflict: "Someone else changed this in the meantime. Reload the page and try again.",
  generic: "Something went wrong. Please try again.",
  check: "Check the fields marked below.",
} as const;

/** The kinds of referrer that are payer accounts (they bill: insurers, medico-legal companies, solicitors…). */
export const PAYER_ACCOUNT_KINDS: readonly string[] = ["insurer", "mlc", "solicitor", "employer", "case_manager", "other"];

export { DEFAULT_SITE_HOURS };

const ok = <T>(value: T): SetupResult<T> => ({ ok: true, value });
const fail = (error: string, fe?: Record<string, string>): SetupResult<never> => ({ ok: false, error, ...(fe ? { fieldErrors: fe } : {}) });
const FORBIDDEN = fail(SETUP_MESSAGES.forbidden);
const WHOLE = fail(SETUP_MESSAGES.wholeClinic);
const NOT_FOUND = fail(SETUP_MESSAGES.notFound);

function wholeClinic(actor: SetupActor): boolean {
  return actor.siteIds === null;
}

function siteAllowed(actor: SetupActor, siteId: string | null): boolean {
  if (siteId === null) return wholeClinic(actor);
  return actor.siteIds === null || actor.siteIds.has(siteId);
}

function scope(actor: SetupActor) {
  return actor.siteIds === null ? ({ all: true } as const) : ({ all: false, siteIds: Array.from(actor.siteIds) } as const);
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const plausible = (id: unknown): id is string => typeof id === "string" && ID.test(id);

async function attempt<T>(where: string, work: () => Promise<SetupResult<T>>): Promise<SetupResult<T>> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof RepoInputError) return fail(err.message);
    logAuthEvent("pms.setup_failed", { where, error: err instanceof Error ? err.name : "error" });
    return fail(SETUP_MESSAGES.generic);
  }
}

function invalid(error: z.ZodError): SetupResult<never> {
  return fail(SETUP_MESSAGES.check, fieldErrors(error));
}

/** "65", "£65.50", "1,250" → pence; "" → null; anything else NaN (the schema refuses it). */
export function poundsToPence(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const v = String(value).trim().replace(/^£/, "").replace(/,/g, "");
  if (v === "") return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(v)) return Number.NaN;
  const [pounds, pence = ""] = v.split(".");
  return Number(pounds) * 100 + Number(pence.padEnd(2, "0"));
}

const blankToNull = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const lines = (v: unknown): string[] | null => {
  if (typeof v !== "string") return null;
  const out = v
    .split(/\r?\n|,\s*/)
    .map((l) => l.trim())
    .filter(Boolean);
  return out.length ? out : null;
};

/* ------------------------------------------------------------------------------------------------
 * Sites, opening hours, closures
 * ----------------------------------------------------------------------------------------------*/



export function daysFromSessions(sessions: readonly OpeningSession[]): DayHours[] {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
    const today = sessions.filter((s) => s.weekday === weekday).sort((a, b) => timeToMinutes(a.opensAt) - timeToMinutes(b.opensAt));
    if (today.length === 0) return { weekday, open: false, from: "09:00", to: "17:00" };
    return { weekday, open: true, from: today[0].opensAt, to: today[today.length - 1].closesAt };
  });
}

export async function sitesScreenFor(actor: SetupActor, siteId: string | null): Promise<SetupResult<SitesScreen>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  return attempt("setup.sites", async () => {
    const ctx = actor.repo();
    const [all, rooms] = await Promise.all([listSites(ctx, actor.tenantId, { includeInactive: true }), listRooms(ctx, actor.tenantId)]);
    const sites = sitesInScope(scope(actor), all).map((s) => ({ ...s, rooms: rooms.filter((r) => r.siteId === s.id).length }));
    const chosen = sites.find((s) => s.id === siteId) ?? sites[0] ?? null;
    let selected: SitesScreen["selected"] = null;
    if (chosen) {
      const today = ukToday();
      const [sessions, closures] = await Promise.all([
        listOpeningHours(ctx, actor.tenantId, { siteIds: [chosen.id] }),
        listClosures(ctx, actor.tenantId, { from: today, siteIds: [chosen.id] }),
      ]);
      selected = { site: chosen, days: daysFromSessions(sessions), hoursSet: sessions.length > 0, closures, canEdit: siteAllowed(actor, chosen.id) };
    }
    return ok({ sites, selected, canAddSite: wholeClinic(actor) });
  });
}

export interface SiteFields {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  postcode?: string;
  code?: string;
  active?: boolean;
}

function siteInput(f: SiteFields) {
  return {
    name: f.name,
    phone: blankToNull(f.phone),
    email: blankToNull(f.email),
    address: lines(f.address),
    postcode: blankToNull(f.postcode),
    code: blankToNull(f.code),
    ...(f.active === undefined ? {} : { active: Boolean(f.active) }),
  };
}

/** A new site with the default opening hours (clinic-wide). */
export async function createSiteFor(actor: SetupActor, fields: SiteFields): Promise<SetupResult<{ id: string }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (!wholeClinic(actor)) return WHOLE;
  const input = siteInput(fields);
  const parsed = SiteInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return attempt("setup.site_create", async () => {
    const site = await createSite(actor.repo(), actor.tenantId, input, actor.actor);
    await setOpeningHours(actor.repo(), actor.tenantId, { siteId: site.id, sessions: [...DEFAULT_SITE_HOURS] }, actor.actor);
    return ok({ id: site.id });
  });
}

export async function updateSiteFor(actor: SetupActor, siteId: string, fields: SiteFields): Promise<SetupResult<{ id: string }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (!plausible(siteId)) return NOT_FOUND;
  if (!siteAllowed(actor, siteId)) return WHOLE;
  const input = siteInput(fields);
  const parsed = SiteInputSchema.partial().safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return attempt("setup.site_update", async () => {
    const site = await updateSite(actor.repo(), actor.tenantId, siteId, input, actor.actor);
    return site ? ok({ id: site.id }) : NOT_FOUND;
  });
}

/** A site's week from the form: one session per open day. */
export async function saveOpeningHoursFor(actor: SetupActor, siteId: string, days: readonly DayHours[]): Promise<SetupResult<{ days: DayHours[] }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (!plausible(siteId)) return NOT_FOUND;
  if (!siteAllowed(actor, siteId)) return WHOLE;
  const list = Array.isArray(days) ? days.slice(0, 7) : [];
  const sessions = list.filter((d) => d && d.open).map((d) => ({ weekday: Number(d.weekday), opensAt: String(d.from ?? ""), closesAt: String(d.to ?? "") }));
  const parsed = OpeningHoursInputSchema.safeParse({ siteId, sessions });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const i = typeof issue.path[1] === "number" ? issue.path[1] : null;
      const key = i !== null && sessions[i] ? `hours-${sessions[i].weekday}` : "hours";
      if (!fe[key]) fe[key] = issue.message;
    }
    return fail(parsed.error.issues[0]?.message ?? SETUP_MESSAGES.check, fe);
  }
  return attempt("setup.opening_hours", async () => {
    if (!(await getSite(actor.repo(), actor.tenantId, siteId))) return NOT_FOUND;
    const saved = await setOpeningHours(actor.repo(), actor.tenantId, parsed.data, actor.actor);
    return ok({ days: daysFromSessions(saved) });
  });
}

export interface ClosureFields {
  /** null = every site. */
  siteId: string | null;
  startsOn: string;
  endsOn?: string;
  reason?: string;
}

export async function addClosureFor(actor: SetupActor, fields: ClosureFields): Promise<SetupResult<{ id: string }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  const siteId = fields.siteId ? String(fields.siteId) : null;
  if (siteId !== null && !plausible(siteId)) return NOT_FOUND;
  if (!siteAllowed(actor, siteId)) return WHOLE;
  const input = { siteId, startsOn: String(fields.startsOn ?? ""), endsOn: blankToNull(fields.endsOn), reason: blankToNull(fields.reason) };
  const parsed = ClosureInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return attempt("setup.closure_add", async () => {
    const c = await addClosure(actor.repo(), actor.tenantId, input, actor.actor);
    return ok({ id: c.id });
  });
}

export async function removeClosureFor(actor: SetupActor, closureId: string): Promise<SetupResult<{ removed: true }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (!plausible(closureId)) return NOT_FOUND;
  return attempt("setup.closure_remove", async () => {
    const c = await getClosure(actor.repo(), actor.tenantId, closureId);
    if (!c) return NOT_FOUND;
    if (!siteAllowed(actor, c.siteId)) return WHOLE;
    await removeClosure(actor.repo(), actor.tenantId, closureId, actor.actor);
    return ok({ removed: true as const });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Rooms
 * ----------------------------------------------------------------------------------------------*/

export async function roomsScreenFor(actor: SetupActor): Promise<SetupResult<{ sites: Site[]; rooms: Room[] }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  return attempt("setup.rooms", async () => {
    const ctx = actor.repo();
    const [sites, rooms] = await Promise.all([listSites(ctx, actor.tenantId, { includeInactive: true }), listRooms(ctx, actor.tenantId, { includeInactive: true })]);
    const mine = sitesInScope(scope(actor), sites);
    return ok({ sites: mine, rooms: rooms.filter((r) => scopeAllows(scope(actor), r.siteId)) });
  });
}

export async function saveRoomFor(actor: SetupActor, input: { roomId?: string | null; siteId: string; name: string; active?: boolean }): Promise<SetupResult<{ id: string }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  return attempt("setup.room_save", async () => {
    const ctx = actor.repo();
    if (input.roomId) {
      if (!plausible(input.roomId)) return NOT_FOUND;
      const room = await getRoom(ctx, actor.tenantId, input.roomId);
      if (!room) return NOT_FOUND;
      if (!siteAllowed(actor, room.siteId)) return WHOLE;
      const patch = { name: String(input.name ?? ""), ...(input.active === undefined ? {} : { active: Boolean(input.active) }) };
      const parsed = RoomInputSchema.omit({ siteId: true }).partial().safeParse(patch);
      if (!parsed.success) return invalid(parsed.error);
      const saved = await updateRoom(ctx, actor.tenantId, room.id, patch, actor.actor);
      return saved ? ok({ id: saved.id }) : NOT_FOUND;
    }
    if (!plausible(input.siteId) || !(await getSite(ctx, actor.tenantId, input.siteId))) return fail("Choose a site.", { siteId: "Choose a site" });
    if (!siteAllowed(actor, input.siteId)) return WHOLE;
    const data = { siteId: input.siteId, name: String(input.name ?? "") };
    const parsed = RoomInputSchema.safeParse(data);
    if (!parsed.success) return invalid(parsed.error);
    const room = await createRoom(ctx, actor.tenantId, data, actor.actor);
    return ok({ id: room.id });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Services (appointment types)
 * ----------------------------------------------------------------------------------------------*/

export async function servicesScreenFor(actor: SetupActor): Promise<SetupResult<{ services: Service[] }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  return attempt("setup.services", async () => ok({ services: await listServices(actor.repo(), actor.tenantId, { includeInactive: true }) }));
}

export interface ServiceFields {
  serviceId?: string | null;
  name: string;
  durationMinutes: number | string;
  bufferMinutes?: number | string;
  price?: string;
  category?: string;
  colour?: string;
  onlineBookable?: boolean;
  active?: boolean;
}

export async function saveServiceFor(actor: SetupActor, f: ServiceFields): Promise<SetupResult<{ id: string }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (!wholeClinic(actor)) return WHOLE;
  const input = {
    name: String(f.name ?? ""),
    durationMinutes: Number(f.durationMinutes),
    bufferMinutes: f.bufferMinutes === undefined || f.bufferMinutes === "" ? 0 : Number(f.bufferMinutes),
    defaultPricePence: poundsToPence(f.price),
    ...(f.category ? { category: f.category } : {}),
    colour: blankToNull(f.colour),
    onlineBookable: Boolean(f.onlineBookable),
    ...(f.active === undefined ? {} : { active: Boolean(f.active) }),
  };
  const parsed = ServiceInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return attempt("setup.service_save", async () => {
    const ctx = actor.repo();
    if (f.serviceId) {
      if (!plausible(f.serviceId) || !(await getService(ctx, actor.tenantId, f.serviceId))) return NOT_FOUND;
      const saved = await updateService(ctx, actor.tenantId, f.serviceId, input as never, actor.actor);
      return saved ? ok({ id: saved.id }) : NOT_FOUND;
    }
    const s = await createService(ctx, actor.tenantId, input as never, actor.actor);
    return ok({ id: s.id });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Price lists
 * ----------------------------------------------------------------------------------------------*/


export async function pricesScreenFor(actor: SetupActor, listId: string | null): Promise<SetupResult<PricesScreen>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  return attempt("setup.prices", async () => {
    const ctx = actor.repo();
    const [lists, services, referrers] = await Promise.all([listPriceLists(ctx, actor.tenantId, { includeInactive: true }), listServices(ctx, actor.tenantId), listReferrers(ctx, actor.tenantId, { limit: 500 })]);
    const chosen = lists.find((l) => l.id === listId) ?? lists[0] ?? null;
    const selected = chosen ? { list: chosen, items: await listPriceListItems(ctx, actor.tenantId, chosen.id) } : null;
    return ok({ lists, selected, services, payers: referrers.filter((r) => PAYER_ACCOUNT_KINDS.includes(r.kind)) });
  });
}

export interface PriceListFields {
  listId?: string | null;
  name: string;
  payerType?: string | null;
  referrerId?: string | null;
  isDefault?: boolean;
  validFrom?: string;
  validTo?: string;
  active?: boolean;
}

export async function savePriceListFor(actor: SetupActor, f: PriceListFields): Promise<SetupResult<{ id: string }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (!wholeClinic(actor)) return WHOLE;
  const input = {
    name: String(f.name ?? ""),
    payerType: blankToNull(f.payerType),
    referrerId: blankToNull(f.referrerId),
    isDefault: Boolean(f.isDefault),
    validFrom: blankToNull(f.validFrom),
    validTo: blankToNull(f.validTo),
    ...(f.active === undefined ? {} : { active: Boolean(f.active) }),
  };
  const parsed = PriceListInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return attempt("setup.price_list_save", async () => {
    const ctx = actor.repo();
    if (input.referrerId && !(await getReferrer(ctx, actor.tenantId, input.referrerId))) return fail("Choose a payer of this clinic.", { referrerId: "Choose a payer" });
    if (f.listId) {
      if (!plausible(f.listId) || !(await getPriceList(ctx, actor.tenantId, f.listId))) return NOT_FOUND;
      const saved = await updatePriceList(ctx, actor.tenantId, f.listId, input as never, actor.actor);
      return saved ? ok({ id: saved.id }) : NOT_FOUND;
    }
    const list = await createPriceList(ctx, actor.tenantId, input as never, actor.actor);
    return ok({ id: list.id });
  });
}

export async function setPriceFor(actor: SetupActor, f: { listId: string; serviceId: string; price: string; billingCode?: string }): Promise<SetupResult<{ removed: boolean }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (!wholeClinic(actor)) return WHOLE;
  if (!plausible(f.listId) || !plausible(f.serviceId)) return NOT_FOUND;
  return attempt("setup.price_set", async () => {
    const ctx = actor.repo();
    if (!(await getPriceList(ctx, actor.tenantId, f.listId)) || !(await getService(ctx, actor.tenantId, f.serviceId))) return NOT_FOUND;
    const pence = poundsToPence(f.price);
    if (pence === null) {
      await removePriceListItem(ctx, actor.tenantId, f.listId, f.serviceId, actor.actor);
      return ok({ removed: true as boolean });
    }
    const input = { priceListId: f.listId, serviceId: f.serviceId, pricePence: pence, billingCode: blankToNull(f.billingCode) };
    const parsed = PriceListItemInputSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? SETUP_MESSAGES.check, { [`price-${f.serviceId}`]: parsed.error.issues[0]?.message ?? "" });
    await setPriceListItem(ctx, actor.tenantId, input, actor.actor);
    return ok({ removed: false as boolean });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Referrers and insurers (+ payer accounts)
 * ----------------------------------------------------------------------------------------------*/


export async function referrersScreenFor(actor: SetupActor, referrerId: string | null, kind: string | null): Promise<SetupResult<ReferrersScreen>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  return attempt("setup.referrers", async () => {
    const ctx = actor.repo();
    const [all, lists] = await Promise.all([listReferrers(ctx, actor.tenantId, { includeInactive: true, limit: 500 }), listPriceLists(ctx, actor.tenantId, { includeInactive: true })]);
    const referrers = kind ? all.filter((r) => r.kind === kind) : all;
    const chosenId = referrerId && plausible(referrerId) ? referrerId : (referrers[0]?.id ?? null);
    let selected: ReferrersScreen["selected"] = null;
    if (chosenId) {
      const r = await getReferrer(ctx, actor.tenantId, chosenId);
      if (r) {
        let payer = null;
        if (PAYER_ACCOUNT_KINDS.includes(r.kind)) {
          const [modes, billing] = await Promise.all([payerContributionModes(ctx, actor.tenantId, [r.id]), getBillingSettings(ctx, actor.tenantId)]);
          payer = { mode: modes.get(r.id) ?? DEFAULT_CONTRIBUTION_MODE, priceLists: lists.filter((l) => l.referrerId === r.id), accountTermsDays: billing.accountTermsDays };
        }
        selected = { referrer: r, payer };
      }
    }
    return ok({ referrers, selected, priceLists: lists });
  });
}

export interface ReferrerFields {
  referrerId?: string | null;
  rev?: number;
  kind: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  postcode?: string;
  active?: boolean;
}

export async function saveReferrerFor(actor: SetupActor, f: ReferrerFields): Promise<SetupResult<{ id: string }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (!wholeClinic(actor)) return WHOLE;
  const input = {
    kind: String(f.kind ?? ""),
    name: String(f.name ?? ""),
    contactName: blankToNull(f.contactName),
    email: blankToNull(f.email),
    phone: blankToNull(f.phone),
    address: lines(f.address),
    postcode: blankToNull(f.postcode),
    ...(f.active === undefined ? {} : { active: Boolean(f.active) }),
  };
  const parsed = ReferrerInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return attempt("setup.referrer_save", async () => {
    const ctx = actor.repo();
    if (f.referrerId) {
      if (!plausible(f.referrerId)) return NOT_FOUND;
      const current = await getReferrer(ctx, actor.tenantId, f.referrerId);
      if (!current) return NOT_FOUND;
      const r = await updateReferrer(ctx, actor.tenantId, current.id, Number(f.rev ?? current.rev), input as never, actor.actor);
      if (!r.ok) return fail(SETUP_MESSAGES.conflict);
      return ok({ id: current.id });
    }
    const created = await createReferrer(ctx, actor.tenantId, input as never, actor.actor);
    return ok({ id: created.id });
  });
}

export async function setPayerModeFor(actor: SetupActor, referrerId: string, mode: unknown): Promise<SetupResult<{ mode: ContributionMode }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (!wholeClinic(actor)) return WHOLE;
  if (!plausible(referrerId)) return NOT_FOUND;
  if (!isContributionMode(mode)) return fail("Choose how the patient's part is billed.");
  return attempt("setup.payer_mode", async () => {
    const r = await getReferrer(actor.repo(), actor.tenantId, referrerId);
    if (!r || !PAYER_ACCOUNT_KINDS.includes(r.kind)) return NOT_FOUND;
    await setPayerContributionMode(actor.repo(), actor.tenantId, r.id, mode, actor.actor);
    return ok({ mode });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Practitioners (and linking a member)
 * ----------------------------------------------------------------------------------------------*/


export async function practitionersScreenFor(actor: SetupActor, practitionerId: string | null): Promise<SetupResult<PractitionersScreen>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  return attempt("setup.practitioners", async () => {
    const ctx = actor.repo();
    const [practitioners, members, sites] = await Promise.all([listPractitioners(ctx, actor.tenantId, { includeInactive: true }), listClinicMembers(actor), listSites(ctx, actor.tenantId)]);
    const linked = new Map(practitioners.filter((p) => p.userId).map((p) => [p.userId as string, p.id]));
    const selected = practitioners.find((p) => p.id === practitionerId) ?? practitioners[0] ?? null;
    return ok({
      practitioners,
      selected,
      members: members.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role, linkedTo: linked.get(m.userId) ?? null })),
      sites,
    });
  });
}

export interface PractitionerFields {
  practitionerId?: string | null;
  displayName: string;
  profession?: string;
  registrationNumber?: string;
  email?: string;
  phone?: string;
  colour?: string;
  defaultSiteId?: string | null;
  bookable?: boolean;
  onlineBookable?: boolean;
  active?: boolean;
  /** The member to link ("" / null = none). */
  userId?: string | null;
}

export async function savePractitionerFor(actor: SetupActor, f: PractitionerFields): Promise<SetupResult<{ id: string }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (!wholeClinic(actor)) return WHOLE;
  const userId = blankToNull(f.userId);
  const input = {
    displayName: String(f.displayName ?? ""),
    ...(f.profession ? { profession: f.profession } : {}),
    registrationNumber: blankToNull(f.registrationNumber),
    email: blankToNull(f.email),
    phone: blankToNull(f.phone),
    colour: blankToNull(f.colour),
    defaultSiteId: blankToNull(f.defaultSiteId),
    bookable: Boolean(f.bookable),
    onlineBookable: Boolean(f.onlineBookable),
    ...(f.active === undefined ? {} : { active: Boolean(f.active) }),
    userId,
  };
  const parsed = PractitionerInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return attempt("setup.practitioner_save", async () => {
    const ctx = actor.repo();
    if (userId) {
      const members = await listClinicMembers(actor);
      if (!members.some((m) => m.userId === userId)) return fail("Choose a member of this clinic.", { userId: "Choose a member of this clinic" });
      const others = await listPractitioners(ctx, actor.tenantId, { includeInactive: true });
      const taken = others.find((p) => p.userId === userId && p.id !== f.practitionerId);
      if (taken) return fail(`That member is already linked to ${taken.displayName}.`, { userId: "Already linked to another practitioner" });
    }
    if (input.defaultSiteId && !(await getSite(ctx, actor.tenantId, input.defaultSiteId))) return fail("Choose a site of this clinic.", { defaultSiteId: "Choose a site" });
    if (f.practitionerId) {
      if (!plausible(f.practitionerId) || !(await getPractitioner(ctx, actor.tenantId, f.practitionerId))) return NOT_FOUND;
      const saved = await updatePractitioner(ctx, actor.tenantId, f.practitionerId, input as never, actor.actor);
      return saved ? ok({ id: saved.id }) : NOT_FOUND;
    }
    const p = await createPractitioner(ctx, actor.tenantId, input as never, actor.actor);
    return ok({ id: p.id });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Record templates and record keeping
 * ----------------------------------------------------------------------------------------------*/

export async function recordsScreenFor(actor: SetupActor): Promise<SetupResult<{ templates: NoteTemplate[]; settings: PmsSettings }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  return attempt("setup.records", async () => {
    const ctx = actor.repo();
    const [templates, settings] = await Promise.all([listNoteTemplates(ctx, actor.tenantId, { includeInactive: true }), getPmsSettings(ctx, actor.tenantId)]);
    return ok({ templates, settings });
  });
}

/** Retention can only go UP (records must be kept at least as long as the clinic said before). */
export async function saveRetentionFor(actor: SetupActor, input: { retentionAdultYears: number; retentionChildUntilAge: number }): Promise<SetupResult<{ saved: true }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (!wholeClinic(actor)) return WHOLE;
  const schema = z.object({
    retentionAdultYears: z.number({ error: "Enter a number of years" }).int("Whole years").min(8, "At least 8 years").max(100, "At most 100 years"),
    retentionChildUntilAge: z.number({ error: "Enter an age" }).int("A whole age").min(25, "At least 25").max(40, "At most 40"),
  });
  const parsed = schema.safeParse({ retentionAdultYears: Number(input.retentionAdultYears), retentionChildUntilAge: Number(input.retentionChildUntilAge) });
  if (!parsed.success) return invalid(parsed.error);
  return attempt("setup.retention", async () => {
    const current = await getPmsSettings(actor.repo(), actor.tenantId);
    const fe: Record<string, string> = {};
    if (parsed.data.retentionAdultYears < current.retentionAdultYears) fe.retentionAdultYears = `Can only go up (now ${current.retentionAdultYears} years)`;
    if (parsed.data.retentionChildUntilAge < current.retentionChildUntilAge) fe.retentionChildUntilAge = `Can only go up (now until age ${current.retentionChildUntilAge})`;
    if (Object.keys(fe).length) return fail("Retention can only be made longer.", fe);
    await updatePmsSettings(actor.repo(), actor.tenantId, parsed.data, actor.actor);
    return ok({ saved: true as const });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Billing settings
 * ----------------------------------------------------------------------------------------------*/

export async function billingSettingsFor(actor: SetupActor): Promise<SetupResult<BillingSettings>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  return attempt("setup.billing", async () => ok(await getBillingSettings(actor.repo(), actor.tenantId)));
}

export interface BillingFields {
  rev: number;
  invoicePrefix: string;
  creditNotePrefix: string;
  firstInvoiceNumber: number | string;
  firstCreditNoteNumber: number | string;
  selfPayTermsDays: number | string;
  accountTermsDays: number | string;
  vatRegistered: boolean;
  vatNumber?: string;
  pricesIncludeVat: boolean;
  dnaChargePercent: number | string;
  lateCancelChargePercent: number | string;
  paymentInstructions?: string;
  bankAccountName?: string;
  bankSortCode?: string;
  bankAccountNumber?: string;
}

export async function saveBillingSettingsFor(actor: SetupActor, f: BillingFields): Promise<SetupResult<{ rev: number }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (!wholeClinic(actor)) return WHOLE;
  const anyBank = [f.bankAccountName, f.bankSortCode, f.bankAccountNumber].some((v) => blankToNull(v) !== null);
  const bankDetails: BankDetails | null = anyBank ? { accountName: String(f.bankAccountName ?? ""), sortCode: String(f.bankSortCode ?? ""), accountNumber: String(f.bankAccountNumber ?? "") } : null;
  const input: BillingSettingsInput = {
    invoicePrefix: String(f.invoicePrefix ?? "").trim().toUpperCase(),
    creditNotePrefix: String(f.creditNotePrefix ?? "").trim().toUpperCase(),
    firstInvoiceNumber: Number(f.firstInvoiceNumber),
    firstCreditNoteNumber: Number(f.firstCreditNoteNumber),
    selfPayTermsDays: Number(f.selfPayTermsDays),
    accountTermsDays: Number(f.accountTermsDays),
    vatRegistered: Boolean(f.vatRegistered),
    vatNumber: blankToNull(f.vatNumber),
    pricesIncludeVat: Boolean(f.pricesIncludeVat),
    dnaChargePercent: Number(f.dnaChargePercent),
    lateCancelChargePercent: Number(f.lateCancelChargePercent),
    paymentInstructions: blankToNull(f.paymentInstructions),
    bankDetails,
  };
  const parsed = BillingSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    const fe = fieldErrors(parsed.error);
    const mapped: Record<string, string> = {};
    for (const [k, v] of Object.entries(fe)) mapped[k.replace(/^bankDetails\.(accountName|sortCode|accountNumber)$/, (_m, x: string) => `bank${x.charAt(0).toUpperCase()}${x.slice(1)}`)] = v;
    return fail(SETUP_MESSAGES.check, mapped);
  }
  if (parsed.data.vatRegistered && !parsed.data.vatNumber) return fail(SETUP_MESSAGES.check, { vatNumber: "Enter the clinic's VAT number" });
  return attempt("setup.billing_save", async () => {
    const r = await updateBillingSettings(actor.repo(), actor.tenantId, Number(f.rev) || 0, input, actor.actor);
    if (!r.ok) return fail(SETUP_MESSAGES.conflict);
    return ok({ rev: r.rev });
  });
}

/* ------------------------------------------------------------------------------------------------
 * Report targets
 * ----------------------------------------------------------------------------------------------*/

export async function targetsFor(actor: SetupActor): Promise<SetupResult<ReportingSettings>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  return attempt("setup.targets", async () => ok(await getReportingSettings(actor.repo(), actor.tenantId)));
}

/** `dnaTarget` as typed in percent ("4", "3.5"). */
export async function saveTargetsFor(actor: SetupActor, f: { rev: number; utilisationTarget: string | number; dnaTarget: string | number }): Promise<SetupResult<{ rev: number }>> {
  if (!actor.can("settings.setup")) return FORBIDDEN;
  if (!wholeClinic(actor)) return WHOLE;
  const util = Number(f.utilisationTarget);
  const dnaText = String(f.dnaTarget ?? "").trim();
  const fe: Record<string, string> = {};
  if (!Number.isInteger(util) || util < 1 || util > 100) fe.utilisationTarget = "A whole percent from 1 to 100";
  if (!/^\d{1,2}(\.\d)?$/.test(dnaText) || Number(dnaText) > 50) fe.dnaTarget = "A percent from 0 to 50, one decimal place at most";
  if (Object.keys(fe).length) return fail(SETUP_MESSAGES.check, fe);
  return attempt("setup.targets_save", async () => {
    const r = await updateReportingSettings(actor.repo(), actor.tenantId, Number(f.rev) || 0, { utilisationTargetPercent: util, dnaTargetTenths: Math.round(Number(dnaText) * 10) }, actor.actor);
    if (!r.ok) return fail(SETUP_MESSAGES.conflict);
    return ok({ rev: r.rev });
  });
}

/** The first Set-up page this member may open (SETUP_ORDER filtered by permission), for /app/clinic/setup. */
export function canOpenSetup(actor: Pick<ClinicActor, "can">): boolean {
  return actor.can("settings.setup") || actor.can("settings.members") || actor.can("settings.import") || actor.can("messages.templates");
}
