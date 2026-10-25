/**
 * Usage counters (migration 0007, 25/10/2026): `clinic_usage` (one row per clinic and UK calendar month),
 * `usage_report` (one row per report, so each report counts once) and `usage_event` (the events already applied).
 *
 * What counts towards a clinic's allowance (Khuram, 25/10/2026: drafting costs money whether or not the report is
 * completed): a report counts ONCE –
 *   - at its first live drafting call that cost money: a successful one (its answers were first drafted), or a failed
 *     one that still used tokens (refused, cut off, unreadable – the service answered), or
 *   - at its first approval, when nothing was ever drafted for it (records-only or prefilled forms).
 * Re-drafting, regenerating or approving the same report again never counts again (the extra calls and tokens are
 * still counted as calls and cost). An amended version of an approved report (report.amends naming a report this
 * clinic approved, for the same patient, episode and form) is the same report: root_report_id points at the first
 * version and it never counts. A live call without a report id (the Studio always sends one) counts as a report of its
 * own – it cost money and cannot be linked. A failed call that used no tokens (time-out, unreachable) counts no report.
 * The public demo never reaches this code (the module skips it).
 *
 * Which report (fix 25/10/2026): the report id and "amends" come from the browser, so each report event also carries
 * the module's server-side fingerprint of what it is about (`episode_fp`: clinic, episode, template or form, patient –
 * a keyed hash, src/modules/medreport/api/usage.ts usageEpisodeFp). A report's row is keyed by (tenant_id, report_id,
 * episode_fp): the same report id used for another patient or another form is another row and counts on its own, and
 * an amendment is accepted only when the amended report was approved with the SAME fingerprint. Events without one
 * (older callers, tests) use "".
 *
 * Every event is ONE atomic batch (D1: env.DB.batch(); Postgres / SQLite: a transaction), with no reads in between:
 *   1. the report's row is made if missing, then its first transitions are set by conditional UPDATEs that name the
 *      event (… WHERE first_drafted_at IS NULL → drafted_event = <event id>) – of two events at once only one wins;
 *   2. the month's row is made if missing (with the package that applies to the month);
 *   3. the counters are increased – the report-level ones by "(SELECT count(*) … WHERE billable_event = <event id>)",
 *      i.e. only if THIS event made the transition – guarded by "the event has not been applied yet";
 *   4. the event is recorded as applied (last).
 * So a retry of the same event (same id) never counts twice, and concurrent events of the same report count it once.
 *
 * Ids, counts, prices, token totals and keyed fingerprints only – never patient data. Tenant id in every WHERE clause
 * and key.
 */
import { createHash } from "node:crypto";
import { sql, type RawBuilder } from "kysely";
import type { UsageEvent } from "../../modules/medreport/api/deps";
import { runBatch, type BatchQuery } from "../db/batch";
import { cleanUsage, estimateCostMicroUsd } from "../usage/pricing";
import { assertIso, assertTenantId, nowIso, toInt, ulid, type DbContext } from "./context";
import { isMissingUsageTable, noteMissingUsageTables, ukPeriodOf } from "./usage-period";

/** Report ids as the Studio makes them (and the store accepts): printable, no spaces, ≤ 128 characters. */
const REPORT_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** The module's fingerprint (base64url, 22 characters); anything else reads as "" (no binding). */
const EPISODE_FP = /^[A-Za-z0-9_-]{16,64}$/;

export function newUsageEventId(): string {
  return `ue_${ulid()}`;
}

/**
 * The key a report id is counted under: as it is when it looks like a store id, else a stable hash of it (the module
 * already keys ids that are not the Studio's – api/usage.ts usageReportKey; this covers any other caller), so an odd id
 * still counts once – at its approval too – and is never stored as sent.
 */
function validReportId(id: string | undefined): string | null {
  if (typeof id !== "string" || id === "") return null;
  return REPORT_ID.test(id) ? id : `x_${createHash("sha256").update(id, "utf8").digest("hex").slice(0, 32)}`;
}

function validEpisodeFp(fp: string | undefined): string {
  return typeof fp === "string" && EPISODE_FP.test(fp) ? fp : "";
}

/** True when a call used tokens (the drafting service answered): it cost money. */
function usedTokens(usage: Parameters<typeof cleanUsage>[0]): boolean {
  const t = cleanUsage(usage);
  return t.input + t.output + t.cacheRead + t.cacheWrite > 0;
}

const notApplied = (eventId: string) => sql<boolean>`not exists (select 1 from usage_event where id = ${eventId})`;
/** 1 if this event made the report's transition named by `column`, else 0. */
const madeBy = (
  tenantId: string,
  reportId: string,
  fp: string,
  column: "started_event" | "drafted_event" | "approved_event" | "billable_event",
  eventId: string,
  extra?: "first" | "amendment",
) =>
  sql<number>`(select count(*) from usage_report where tenant_id = ${tenantId} and report_id = ${reportId} and episode_fp = ${fp} and ${sql.ref(column)} = ${eventId}${
    extra === "first" ? sql` and root_report_id = report_id` : extra === "amendment" ? sql` and root_report_id <> report_id` : sql``
  })`;
const plus = (column: string, value: RawBuilder<number> | number) => sql<number>`${sql.ref(column)} + ${value}`;

export interface RecordOptions {
  /** The event's id (a retry passes the same id). Default: a new one. */
  eventId?: string;
}

export interface RecordResult {
  eventId: string;
  period: string;
  /** The report the event counted for (drafting / approval / start), when there is one. */
  reportId: string | null;
}

/** Applies one usage event of `tenantId` (see the header). Throws on a database error (the caller logs it). */
export async function recordUsageEvent(ctx: DbContext, tenantId: string, event: UsageEvent, opts: RecordOptions = {}): Promise<RecordResult> {
  assertTenantId(tenantId);
  const eventId = opts.eventId ?? newUsageEventId();
  if (!EVENT_ID.test(eventId)) throw new Error("usage: invalid event id.");
  const at = nowIso(ctx);
  const period = ukPeriodOf(new Date(at));
  const db = ctx.db;
  const queries: BatchQuery[] = [];

  // The report this event is about, and the report it amends (an approved one of this clinic with the same
  // fingerprint, checked in SQL).
  let reportId: string | null = null;
  let amends: string | null = null;
  let fp = "";
  // A drafting call counts its report when it cost money: it succeeded, or it failed after using tokens.
  const callCounts = event.kind === "drafting_call" && (event.succeeded || usedTokens(event.usage));
  if (event.kind === "report_started" || event.kind === "report_approved" || event.kind === "drafting_call") {
    reportId = validReportId(event.reportId);
    amends = validReportId(event.amendsReportId);
    fp = validEpisodeFp(event.episodeFp);
    if (event.kind === "drafting_call" && !callCounts)
      reportId = null; // a failed call that used no tokens counts no report
    else if (!reportId && event.kind === "drafting_call") reportId = `unlinked-${eventId}`;
    if (amends === reportId) amends = null;
  }
  if (reportId) {
    const approvedRoot = amends
      ? sql<string>`(select root_report_id from usage_report where tenant_id = ${tenantId} and report_id = ${amends} and episode_fp = ${fp} and first_approved_at is not null)`
      : null;
    queries.push(
      db
        .insertInto("usage_report")
        .values({
          tenant_id: tenantId,
          report_id: reportId,
          episode_fp: fp,
          root_report_id: approvedRoot ? sql<string>`coalesce(${approvedRoot}, ${reportId})` : reportId,
          created_at: at,
          updated_at: at,
        })
        .onConflict((oc) => oc.columns(["tenant_id", "report_id", "episode_fp"]).doNothing()),
    );
    if (approvedRoot) {
      // A row made before the amendment was known (an older Studio): it becomes the amendment it is, while uncounted.
      queries.push(
        db
          .updateTable("usage_report")
          .set({ root_report_id: sql<string>`coalesce(${approvedRoot}, root_report_id)`, updated_at: at })
          .where("tenant_id", "=", tenantId)
          .where("report_id", "=", reportId)
          .where("episode_fp", "=", fp)
          .where("billable_period", "is", null),
      );
    }
  }
  const transition = (set: Record<string, unknown>, column: "started_at" | "first_drafted_at" | "first_approved_at") =>
    db
      .updateTable("usage_report")
      .set({ ...set, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("report_id", "=", reportId as string)
      .where("episode_fp", "=", fp)
      .where(column, "is", null);
  const billable = (via: "drafted" | "approved") =>
    db
      .updateTable("usage_report")
      .set({ billable_period: period, billable_at: at, billable_via: via, billable_event: eventId, updated_at: at })
      .where("tenant_id", "=", tenantId)
      .where("report_id", "=", reportId as string)
      .where("episode_fp", "=", fp)
      .where("billable_period", "is", null)
      .where(sql<boolean>`root_report_id = report_id`);

  // The month's counters to add (column → amount or "made by this event" count).
  const add: Record<string, RawBuilder<number> | number> = {};
  const tokens = (usage: Parameters<typeof cleanUsage>[0], model: string | undefined) => {
    const t = cleanUsage(usage);
    if (t.input) add.input_tokens = t.input;
    if (t.output) add.output_tokens = t.output;
    if (t.cacheRead) add.cache_read_tokens = t.cacheRead;
    if (t.cacheWrite) add.cache_write_tokens = t.cacheWrite;
    const cost = estimateCostMicroUsd(model, usage);
    if (cost) add.cost_micro_usd = cost;
  };

  switch (event.kind) {
    case "report_started": {
      if (!reportId) return { eventId, period, reportId: null };
      queries.push(transition({ started_at: at, started_event: eventId }, "started_at"));
      add.reports_started = madeBy(tenantId, reportId, fp, "started_event", eventId, "first");
      break;
    }
    case "drafting_call": {
      if (callCounts) {
        const id = reportId as string;
        if (event.succeeded) queries.push(transition({ first_drafted_at: at, drafted_event: eventId }, "first_drafted_at"));
        queries.push(billable("drafted"));
        if (event.succeeded) {
          queries.push(
            db
              .updateTable("usage_report")
              .set({ drafting_calls: sql<number>`drafting_calls + 1`, updated_at: at })
              .where("tenant_id", "=", tenantId)
              .where("report_id", "=", id)
              .where("episode_fp", "=", fp)
              .where(notApplied(eventId)),
          );
        }
        if (event.succeeded) add.reports_drafted = madeBy(tenantId, id, fp, "drafted_event", eventId, "first");
        add.billable_reports = madeBy(tenantId, id, fp, "billable_event", eventId);
      }
      if (event.succeeded) add.drafting_calls = 1;
      else add.failed_calls = 1;
      tokens(event.usage, event.model);
      break;
    }
    case "report_approved": {
      if (!reportId) return { eventId, period, reportId: null };
      queries.push(transition({ first_approved_at: at, approved_event: eventId }, "first_approved_at"));
      queries.push(billable("approved"));
      add.reports_approved = madeBy(tenantId, reportId, fp, "approved_event", eventId, "first");
      add.amendments_approved = madeBy(tenantId, reportId, fp, "approved_event", eventId, "amendment");
      add.billable_reports = madeBy(tenantId, reportId, fp, "billable_event", eventId);
      add.billable_on_approval = madeBy(tenantId, reportId, fp, "billable_event", eventId);
      break;
    }
    case "form_read": {
      if (event.read) add.forms_read = 1;
      if (event.liveCalls > 0) add.reading_calls = Math.floor(event.liveCalls);
      if (event.failedCalls > 0) add.failed_calls = Math.floor(event.failedCalls);
      tokens(event.usage, event.model);
      break;
    }
    case "question_set_created": {
      add.question_sets = 1;
      break;
    }
  }

  queries.push(
    db
      .insertInto("clinic_usage")
      .values({
        tenant_id: tenantId,
        period,
        package: sql<string | null>`(select package from clinic_package where tenant_id = ${tenantId})`,
        plan_price_pence: sql<
          number | null
        >`(select case when founding_price_pence is not null and founding_until >= ${`${period}-01`} then founding_price_pence else monthly_price_pence end from clinic_package where tenant_id = ${tenantId})`,
        plan_reports_included: sql<number | null>`(select reports_included from clinic_package where tenant_id = ${tenantId})`,
        plan_extra_report_pence: sql<number | null>`(select extra_report_pence from clinic_package where tenant_id = ${tenantId})`,
        created_at: at,
        updated_at: at,
      })
      .onConflict((oc) => oc.columns(["tenant_id", "period"]).doNothing()),
  );
  const set: Record<string, unknown> = { updated_at: at };
  for (const [column, value] of Object.entries(add)) set[column] = plus(column, value);
  queries.push(db.updateTable("clinic_usage").set(set).where("tenant_id", "=", tenantId).where("period", "=", period).where(notApplied(eventId)));
  queries.push(
    db
      .insertInto("usage_event")
      .values({ id: eventId, tenant_id: tenantId, kind: event.kind, period, created_at: at })
      .onConflict((oc) => oc.column("id").doNothing()),
  );
  await runBatch(db, queries);
  return { eventId, period, reportId };
}

/* ------------------------------------------------------------------------------------------------
 * Reads
 * ----------------------------------------------------------------------------------------------*/

export interface UsageMonth {
  tenantId: string;
  period: string;
  /** The package as it applied to the month (null = none). */
  package: string | null;
  planPricePence: number | null;
  planReportsIncluded: number | null;
  planExtraReportPence: number | null;
  reportsStarted: number;
  reportsDrafted: number;
  reportsApproved: number;
  amendmentsApproved: number;
  billableReports: number;
  billableOnApproval: number;
  formsRead: number;
  questionSets: number;
  draftingCalls: number;
  failedCalls: number;
  readingCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicroUsd: number;
}

type UsageRow = {
  tenant_id: string;
  period: string;
  package: string | null;
  plan_price_pence: number | null;
  plan_reports_included: number | null;
  plan_extra_report_pence: number | null;
  reports_started: number;
  reports_drafted: number;
  reports_approved: number;
  amendments_approved: number;
  billable_reports: number;
  billable_on_approval: number;
  forms_read: number;
  question_sets: number;
  drafting_calls: number;
  failed_calls: number;
  reading_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_micro_usd: number;
};

const nullableInt = (v: number | null) => (v === null || v === undefined ? null : toInt(v));

function toMonth(r: UsageRow): UsageMonth {
  return {
    tenantId: r.tenant_id,
    period: r.period,
    package: r.package,
    planPricePence: nullableInt(r.plan_price_pence),
    planReportsIncluded: nullableInt(r.plan_reports_included),
    planExtraReportPence: nullableInt(r.plan_extra_report_pence),
    reportsStarted: toInt(r.reports_started),
    reportsDrafted: toInt(r.reports_drafted),
    reportsApproved: toInt(r.reports_approved),
    amendmentsApproved: toInt(r.amendments_approved),
    billableReports: toInt(r.billable_reports),
    billableOnApproval: toInt(r.billable_on_approval),
    formsRead: toInt(r.forms_read),
    questionSets: toInt(r.question_sets),
    draftingCalls: toInt(r.drafting_calls),
    failedCalls: toInt(r.failed_calls),
    readingCalls: toInt(r.reading_calls),
    inputTokens: toInt(r.input_tokens),
    outputTokens: toInt(r.output_tokens),
    cacheReadTokens: toInt(r.cache_read_tokens),
    cacheWriteTokens: toInt(r.cache_write_tokens),
    costMicroUsd: toInt(r.cost_micro_usd),
  };
}

/** An empty month (no events yet). */
export function emptyUsageMonth(tenantId: string, period: string): UsageMonth {
  return toMonth({
    tenant_id: tenantId,
    period,
    package: null,
    plan_price_pence: null,
    plan_reports_included: null,
    plan_extra_report_pence: null,
    reports_started: 0,
    reports_drafted: 0,
    reports_approved: 0,
    amendments_approved: 0,
    billable_reports: 0,
    billable_on_approval: 0,
    forms_read: 0,
    question_sets: 0,
    drafting_calls: 0,
    failed_calls: 0,
    reading_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_micro_usd: 0,
  });
}

/** The clinic's months among `periods` that have a row (others had no usage). */
export async function getUsageMonths(ctx: DbContext, tenantId: string, periods: string[]): Promise<UsageMonth[]> {
  assertTenantId(tenantId);
  if (periods.length === 0) return [];
  const rows = await ctx.db.selectFrom("clinic_usage").selectAll().where("tenant_id", "=", tenantId).where("period", "in", periods.slice(0, 60)).execute();
  return rows.map((r) => toMonth(r as UsageRow));
}

/** Every clinic's row for one month (the platform usage page). */
export async function listUsageForPeriod(ctx: DbContext, period: string): Promise<UsageMonth[]> {
  const rows = await ctx.db.selectFrom("clinic_usage").selectAll().where("period", "=", period).orderBy("tenant_id").execute();
  return rows.map((r) => toMonth(r as UsageRow));
}

/** Reports of the clinic that counted in `period` and are not approved (yet) – "drafted but not approved". */
export async function countCountedNotApproved(ctx: DbContext, tenantId: string, period: string): Promise<number> {
  assertTenantId(tenantId);
  const row = await ctx.db
    .selectFrom("usage_report")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("tenant_id", "=", tenantId)
    .where("billable_period", "=", period)
    .where("first_approved_at", "is", null)
    .executeTakeFirst();
  return row ? toInt(row.n) : 0;
}

/** Per clinic: reports that counted in `period` and are not approved (yet). */
export async function countCountedNotApprovedByTenant(ctx: DbContext, period: string): Promise<Map<string, number>> {
  const rows = await ctx.db
    .selectFrom("usage_report")
    .select(["tenant_id", (eb) => eb.fn.countAll<number>().as("n")])
    .where("billable_period", "=", period)
    .where("first_approved_at", "is", null)
    .groupBy("tenant_id")
    .execute();
  return new Map(rows.map((r) => [r.tenant_id, toInt(r.n)] as const));
}

/** The report's usage row (tests, support): the first one made, or the one with this fingerprint. */
export async function getUsageReport(ctx: DbContext, tenantId: string, reportId: string, episodeFp?: string) {
  assertTenantId(tenantId);
  let q = ctx.db.selectFrom("usage_report").selectAll().where("tenant_id", "=", tenantId).where("report_id", "=", reportId);
  if (episodeFp !== undefined) q = q.where("episode_fp", "=", episodeFp);
  return (await q.orderBy("created_at").orderBy("episode_fp").executeTakeFirst()) ?? null;
}

/** Every usage row of the report id (one per fingerprint – tests, support). */
export async function listUsageReportRows(ctx: DbContext, tenantId: string, reportId: string) {
  assertTenantId(tenantId);
  return ctx.db.selectFrom("usage_report").selectAll().where("tenant_id", "=", tenantId).where("report_id", "=", reportId).orderBy("created_at").orderBy("episode_fp").execute();
}

/** getUsageMonths for the app's pages: a database before migration 0007 reads as "no usage". */
export async function readUsageMonths(ctx: DbContext, tenantId: string, periods: string[]): Promise<UsageMonth[]> {
  try {
    return await getUsageMonths(ctx, tenantId, periods);
  } catch (err) {
    if (!isMissingUsageTable(err)) throw err;
    noteMissingUsageTables();
    return [];
  }
}

export async function readCountedNotApproved(ctx: DbContext, tenantId: string, period: string): Promise<number> {
  try {
    return await countCountedNotApproved(ctx, tenantId, period);
  } catch (err) {
    if (!isMissingUsageTable(err)) throw err;
    noteMissingUsageTables();
    return 0;
  }
}

/** The usage events ledger is only needed for retries: the retention job keeps a week. Returns the number removed. */
export async function purgeUsageEvents(ctx: DbContext, before: string): Promise<number> {
  try {
    const result = await ctx.db.deleteFrom("usage_event").where("created_at", "<", assertIso(before, "before")).executeTakeFirst();
    return Number(result.numDeletedRows);
  } catch (err) {
    if (!isMissingUsageTable(err)) throw err;
    noteMissingUsageTables();
    return 0;
  }
}
