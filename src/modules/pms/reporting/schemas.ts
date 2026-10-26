/**
 * Input schemas of the reporting and set-up module (zod v4, pure – used by the forms and the repositories):
 * opening hours and closures of the sites, staff site access, report filters and the audit search.
 * Shared directory inputs (sites, rooms, practitioners, appointment types, prices, referrers) are the
 * foundation's schemas (src/modules/pms/core/schemas.ts) – the set-up screens use those unchanged.
 */
import { z } from "zod";
import { IsoDateSchema, OptionalDateSchema, PmsIdSchema, optionalText } from "../core/schemas";
import { isIsoDate } from "../core/text";
import { daysInclusive, isPeriodPreset, type PeriodPreset } from "./periods";

/* ------------------------------------------------------------------------------------------------
 * Opening hours and closures
 * ----------------------------------------------------------------------------------------------*/

/** "HH:MM", 24-hour, UK local time, in steps of 5 minutes ("08:00", "19:45"). */
export const TimeOfDaySchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time as HH:MM (24-hour)")
  .refine((v) => Number(v.slice(3)) % 5 === 0, "In steps of 5 minutes");

/** Minutes after midnight of "HH:MM". */
export function timeToMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

export function minutesToTime(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const WeekdaySchema = z.number().int().min(1).max(7);

export const OpeningSessionSchema = z
  .object({
    weekday: WeekdaySchema,
    opensAt: TimeOfDaySchema,
    closesAt: TimeOfDaySchema,
  })
  .refine((s) => timeToMinutes(s.opensAt) < timeToMinutes(s.closesAt), { message: "Closing time must be after opening time", path: ["closesAt"] });
export type OpeningSessionInput = z.input<typeof OpeningSessionSchema>;

/** At most this many opening sessions per weekday (e.g. a morning and an evening session, or three). */
export const MAX_SESSIONS_PER_DAY = 3;

/** A site's whole week. Replaces what was there; an empty list = closed every day. */
export const OpeningHoursInputSchema = z
  .object({
    siteId: PmsIdSchema,
    sessions: z.array(OpeningSessionSchema).max(7 * MAX_SESSIONS_PER_DAY, "Too many opening sessions"),
  })
  .superRefine((v, ctx) => {
    for (let day = 1; day <= 7; day++) {
      const today = v.sessions
        .map((s, index) => ({ ...s, index }))
        .filter((s) => s.weekday === day)
        .sort((a, b) => timeToMinutes(a.opensAt) - timeToMinutes(b.opensAt));
      if (today.length > MAX_SESSIONS_PER_DAY) {
        ctx.addIssue({ code: "custom", path: ["sessions", today[0].index], message: `At most ${MAX_SESSIONS_PER_DAY} opening sessions a day` });
      }
      for (let i = 1; i < today.length; i++) {
        if (timeToMinutes(today[i].opensAt) < timeToMinutes(today[i - 1].closesAt)) {
          ctx.addIssue({ code: "custom", path: ["sessions", today[i].index, "opensAt"], message: "Opening sessions on the same day overlap" });
        }
      }
    }
  });
export type OpeningHoursInput = z.input<typeof OpeningHoursInputSchema>;

/** The longest closure that can be entered at once (longer: enter it in parts). */
export const MAX_CLOSURE_DAYS = 62;

export const ClosureInputSchema = z
  .object({
    /** null = every site (a bank holiday); else one site. */
    siteId: z.union([PmsIdSchema, z.null()]).optional(),
    startsOn: IsoDateSchema,
    /** Inclusive; empty = the same day. */
    endsOn: OptionalDateSchema,
    /** Plain words shown to staff ("Bank holiday", "Staff training"). Not for patient details. */
    reason: optionalText(120),
  })
  .superRefine((v, ctx) => {
    const end = v.endsOn ?? v.startsOn;
    if (end < v.startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "The closure cannot end before it starts" });
    else if (daysInclusive(v.startsOn, end) > MAX_CLOSURE_DAYS) ctx.addIssue({ code: "custom", path: ["endsOn"], message: `At most ${MAX_CLOSURE_DAYS} days at a time` });
  });
export type ClosureInput = z.input<typeof ClosureInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * Staff site access
 * ----------------------------------------------------------------------------------------------*/

export const MAX_SITES_PER_PERSON = 60;

export const StaffAccessInputSchema = z
  .object({
    /** True = every site, now and later. */
    allSites: z.boolean(),
    siteIds: z
      .array(PmsIdSchema)
      .max(MAX_SITES_PER_PERSON)
      .transform((ids) => Array.from(new Set(ids)).sort()),
  })
  .superRefine((v, ctx) => {
    if (!v.allSites && v.siteIds.length === 0) ctx.addIssue({ code: "custom", path: ["siteIds"], message: "Choose at least one site, or every site" });
  })
  .transform((v) => ({ allSites: v.allSites, siteIds: v.allSites ? [] : v.siteIds }));
export type StaffAccessInput = z.input<typeof StaffAccessInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * Report filters (from the page's query string)
 * ----------------------------------------------------------------------------------------------*/

export type QueryValue = string | string[] | undefined | null;
export type QuerySource = Record<string, QueryValue> | URLSearchParams;

/** One value of a query parameter (the first when repeated), trimmed; "" → null. */
export function queryValue(source: QuerySource, key: string): string | null {
  const raw = source instanceof URLSearchParams ? source.get(key) : source[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, 200);
}

export interface ReportFilterParams {
  preset: PeriodPreset | null;
  from: string | null;
  to: string | null;
  siteId: string | null;
  practitionerId: string | null;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** The filter a report page was asked for (unknown or malformed values are dropped, never trusted). */
export function parseReportFilter(source: QuerySource): ReportFilterParams {
  const preset = queryValue(source, "period");
  const from = queryValue(source, "from");
  const to = queryValue(source, "to");
  const site = queryValue(source, "site");
  const practitioner = queryValue(source, "practitioner");
  const fromOk = from && isIsoDate(from) ? from : null;
  const toOk = to && isIsoDate(to) ? to : null;
  // Dates typed without choosing "Choose dates" still mean those dates.
  const chosen: PeriodPreset | null = isPeriodPreset(preset) ? preset : fromOk && toOk ? "custom" : null;
  return {
    preset: chosen,
    from: fromOk,
    to: toOk,
    siteId: site && ID.test(site) ? site : null,
    practitionerId: practitioner && ID.test(practitioner) ? practitioner : null,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Audit search
 * ----------------------------------------------------------------------------------------------*/

export interface AuditSearchParams {
  from: string | null;
  to: string | null;
  /** An area of the clinic system ("pms.patient", "pms.appointment" …) or a whole group ("clinic"). */
  area: string | null;
  action: string | null;
  userId: string | null;
  targetType: string | null;
  targetId: string | null;
  /** Older than this entry (paging). */
  before: string | null;
  /** Newer than this entry (paging back). */
  after: string | null;
}

const AUDIT_ACTION = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
const AUDIT_AREA = /^[a-z0-9][a-z0-9_.]{0,47}$/;
const TARGET_TYPE = /^[a-z][a-z0-9_]{0,63}$/;
const TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function parseAuditSearch(source: QuerySource): AuditSearchParams {
  const pick = (key: string, re: RegExp) => {
    const v = queryValue(source, key);
    return v && re.test(v) ? v : null;
  };
  const from = queryValue(source, "from");
  const to = queryValue(source, "to");
  return {
    from: from && isIsoDate(from) ? from : null,
    to: to && isIsoDate(to) ? to : null,
    area: pick("area", AUDIT_AREA),
    action: pick("action", AUDIT_ACTION),
    userId: pick("user", ID),
    targetType: pick("type", TARGET_TYPE),
    targetId: pick("record", TARGET_ID),
    before: pick("before", ULID),
    after: pick("after", ULID),
  };
}
