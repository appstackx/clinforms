/**
 * PK06 – the expiry sweep for courses and gift cards (docs/clinic-system/courses-giftcards-products.md §9), run every
 * night from the daily cron (GET /api/cron/retention → src/server/cron/expiry.ts).
 *
 * - A course still "active" whose expiry date is before today (UK) becomes "expired" (rev + 1, audited
 *   pms.course.expire). Used-up and cancelled courses are left as they are.
 * - A gift card past its expiry that is active, used up, or expired with something left on it (a spend put back
 *   after it expired) becomes "expired" with a balance of 0: what was left goes in an "expire" move (append-only, the
 *   balance after it 0) and the audit row pms.gift_card.expire (ids and amounts only, never the code).
 * - The expiry day itself still counts: only `expires_on < today` is swept.
 *
 * The screens and every write already treat a past-expiry card as expired from the date (no spend, no credit), and a
 * course by the VISIT's date (a visit dated on or before the expiry is still used from it, also after this sweep) – the
 * sweep only makes the stored status and the card's balance say so. Safe to run any number of times: each
 * statement is conditional on the row as it was read (status, balance, expiry still past), so a second run – or two
 * at once – changes nothing more; a card or course changed meanwhile is simply left for the next run. Tenant-scoped:
 * every statement names the clinic; batches stay well inside the gateway's 100 statements.
 */
import { sql } from "kysely";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import { RepoInputError, assertTenantId, nowIso, num, pmsId, type DbContext } from "../context";
import { readOrEmpty } from "./healthcode";
import { CARDS, GIFT_CARD_MOVE_PREFIX, MOVES } from "./gift-cards";
import { COURSES } from "./courses";
import { affected, billingAuditWhen, billingBatch, todayOf } from "./shared";

/** Who the sweep's audit rows name: the system (no member, no session). */
export const EXPIRY_SWEEP_ACTOR: PmsActor = { userId: null, sessionId: null };

/** Rows per batch: 3 statements per gift card (update, move, audit) → at most 75 statements. */
export const EXPIRY_BATCH_ROWS = 25;
/** Rows read per pass; the sweep goes on until nothing is left or MAX_ROWS_PER_RUN is reached (the rest the next night). */
const PAGE = 200;
export const EXPIRY_MAX_ROWS_PER_RUN = 2000;

export interface ExpirySweepResult {
  courses: number;
  giftCards: number;
  /** What the expired cards still held, in pence (taken to 0). */
  giftCardPence: number;
}

function inGroups<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Marks one clinic's courses and gift cards past their expiry as expired. `stop` (the nightly run's deadline) is asked
 * before each batch: once it says true no new batch starts – the rest waits for the next night.
 */
export async function sweepExpiredForTenant(ctx: DbContext, tenantId: string, actor: PmsActor = EXPIRY_SWEEP_ACTOR, options: { stop?: () => boolean } = {}): Promise<ExpirySweepResult> {
  const stop = options.stop ?? (() => false);
  assertTenantId(tenantId);
  const today = todayOf(ctx);
  const out: ExpirySweepResult = { courses: 0, giftCards: 0, giftCardPence: 0 };
  const seen = new Set<string>();

  // Courses.
  for (let pass = 0; out.courses < EXPIRY_MAX_ROWS_PER_RUN && pass < EXPIRY_MAX_ROWS_PER_RUN / PAGE + 1; pass++) {
    const due = (
      await readOrEmpty(COURSES, [] as { id: string; rev: unknown; expires_on: string | null }[], () =>
        ctx.db
          .selectFrom(COURSES)
          .select(["id", "rev", "expires_on"])
          .where("tenant_id", "=", tenantId)
          .where("status", "=", "active")
          .where("expires_on", "is not", null)
          .where("expires_on", "<", today)
          .orderBy("expires_on")
          .orderBy("id")
          .limit(PAGE)
          .execute(),
      )
    ).filter((c) => !seen.has(c.id));
    if (due.length === 0 || stop()) break;
    for (const group of inGroups(due, EXPIRY_BATCH_ROWS)) {
      if (stop()) return out;
      const at = nowIso(ctx);
      const queries: BatchQuery[] = [];
      for (const c of group) {
        seen.add(c.id);
        queries.push(
          ctx.db
            .updateTable(COURSES)
            .set((eb) => ({
              status: "expired",
              rev: eb("rev", "+", 1),
              updated_at: at,
            }))
            .where("tenant_id", "=", tenantId)
            .where("id", "=", c.id)
            .where("status", "=", "active")
            .where("rev", "=", num(c.rev))
            .where("expires_on", "<", today),
          billingAuditWhen(
            ctx,
            tenantId,
            actor,
            {
              action: "pms.course.expire",
              targetType: "pms_patient_course",
              targetId: c.id,
              detail: { expiresOn: c.expires_on ?? "none" },
            },
            ctx.db
              .selectFrom(COURSES)
              .select("id")
              .where("tenant_id", "=", tenantId)
              .where("id", "=", c.id)
              .where("status", "=", "expired")
              .where("rev", "=", num(c.rev) + 1)
              .where("updated_at", "=", at),
          ),
        );
      }
      const results = await billingBatch(ctx, queries);
      for (let i = 0; i < results.length; i += 2) out.courses += affected(results[i]) > 0 ? 1 : 0;
    }
    if (due.length < PAGE) break;
  }

  // Gift cards.
  for (let pass = 0; out.giftCards < EXPIRY_MAX_ROWS_PER_RUN && pass < EXPIRY_MAX_ROWS_PER_RUN / PAGE + 1; pass++) {
    const due = (
      await readOrEmpty(CARDS, [] as DueCard[], () =>
        ctx.db
          .selectFrom(CARDS)
          .select(["id", "status", "balance_pence", "expires_on"])
          .where("tenant_id", "=", tenantId)
          .where("expires_on", "is not", null)
          .where("expires_on", "<", today)
          .where((eb) => eb.or([eb("status", "in", ["active", "used"]), eb.and([eb("status", "=", "expired"), eb("balance_pence", ">", 0)])]))
          .orderBy("expires_on")
          .orderBy("id")
          .limit(PAGE)
          .execute(),
      )
    ).filter((c) => !seen.has(c.id));
    if (due.length === 0 || stop()) break;
    for (const group of inGroups(due, EXPIRY_BATCH_ROWS)) {
      if (stop()) return out;
      const r = await runCardGroup(ctx, tenantId, group, today, actor);
      out.giftCards += r.cards;
      out.giftCardPence += r.pence;
      for (const c of group) seen.add(c.id);
    }
    if (due.length < PAGE) break;
  }
  return out;
}

type DueCard = {
  id: string;
  status: string;
  balance_pence: unknown;
  expires_on: string | null;
};

/**
 * One batch for a group of cards. A card changed between the read and the batch (a spend, a credit) makes its move's
 * card id NULL and the database refuses the whole batch: the cards are then tried one by one, and the changed one is
 * left for the next night.
 */
async function runCardGroup(ctx: DbContext, tenantId: string, group: DueCard[], today: string, actor: PmsActor): Promise<{ cards: number; pence: number }> {
  try {
    return await cardBatch(ctx, tenantId, group, today, actor);
  } catch (err) {
    if (!(err instanceof RepoInputError) || group.length === 1) {
      if (err instanceof RepoInputError) return { cards: 0, pence: 0 };
      throw err;
    }
    const total = { cards: 0, pence: 0 };
    for (const c of group) {
      const r = await runCardGroup(ctx, tenantId, [c], today, actor);
      total.cards += r.cards;
      total.pence += r.pence;
    }
    return total;
  }
}

async function cardBatch(ctx: DbContext, tenantId: string, group: DueCard[], today: string, actor: PmsActor): Promise<{ cards: number; pence: number }> {
  const at = nowIso(ctx);
  const queries: BatchQuery[] = [];
  const counted: { index: number; balance: number }[] = [];
  for (const c of group) {
    const balance = num(c.balance_pence);
    const expiredNow = ctx.db
      .selectFrom(CARDS)
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("id", "=", c.id)
      .where("status", "=", "expired")
      .where("balance_pence", "=", 0)
      .where("updated_at", "=", at);
    counted.push({ index: queries.length, balance });
    queries.push(
      ctx.db
        .updateTable(CARDS)
        .set((eb) => ({
          status: "expired",
          balance_pence: 0,
          rev: eb("rev", "+", 1),
          updated_at: at,
        }))
        .where("tenant_id", "=", tenantId)
        .where("id", "=", c.id)
        .where("status", "=", c.status)
        .where("balance_pence", "=", balance)
        .where("expires_on", "<", today),
    );
    if (balance > 0) {
      queries.push(
        ctx.db.insertInto(MOVES).values({
          tenant_id: tenantId,
          id: pmsId(GIFT_CARD_MOVE_PREFIX, ctx),
          // NULL (the batch refused) unless THIS run expired the card – see runGroup for what happens then.
          gift_card_id: sql<string>`(select id from pms_gift_cards where tenant_id = ${tenantId} and id = ${c.id} and status = 'expired' and balance_pence = 0 and updated_at = ${at})`,
          kind: "expire",
          amount_pence: -balance,
          payment_id: null,
          balance_after: 0,
          created_by: actor.userId,
          created_at: at,
        }),
      );
    }
    queries.push(
      billingAuditWhen(
        ctx,
        tenantId,
        actor,
        {
          action: "pms.gift_card.expire",
          targetType: "pms_gift_card",
          targetId: c.id,
          detail: { expiresOn: c.expires_on ?? "none", amountPence: balance },
        },
        expiredNow,
      ),
    );
  }
  const results = await billingBatch(ctx, queries);
  const done = { cards: 0, pence: 0 };
  for (const x of counted) {
    if (affected(results[x.index]) > 0) {
      done.cards += 1;
      done.pence += x.balance;
    }
  }
  return done;
}

/**
 * The clinics that have something to sweep today – a CROSS-CLINIC read (ids only), for the nightly job alone. Every
 * write that follows is per clinic (sweepExpiredForTenant). [] before the tables exist.
 */
export async function clinicsWithExpiredItems(ctx: DbContext): Promise<string[]> {
  const today = todayOf(ctx);
  const [courses, cards] = await Promise.all([
    readOrEmpty(COURSES, [] as { tenant_id: string }[], () =>
      ctx.db.selectFrom(COURSES).select("tenant_id").distinct().where("status", "=", "active").where("expires_on", "is not", null).where("expires_on", "<", today).limit(1000).execute(),
    ),
    readOrEmpty(CARDS, [] as { tenant_id: string }[], () =>
      ctx.db
        .selectFrom(CARDS)
        .select("tenant_id")
        .distinct()
        .where("expires_on", "is not", null)
        .where("expires_on", "<", today)
        .where((eb) => eb.or([eb("status", "in", ["active", "used"]), eb.and([eb("status", "=", "expired"), eb("balance_pence", ">", 0)])]))
        .limit(1000)
        .execute(),
    ),
  ]);
  return Array.from(new Set([...courses, ...cards].map((r) => r.tenant_id))).sort();
}

export interface ExpiryRunResult extends ExpirySweepResult {
  clinics: number;
  errors: number;
  /** The deadline came before everything was swept: no new clinic or batch was started; the rest waits for the next night. */
  stoppedEarly: boolean;
}

/** How long the nightly run starts new work (the cron route has 60 s in all, the retention pass and billing first). */
export const EXPIRY_RUN_BUDGET_MS = 20_000;

/**
 * The nightly run: every clinic with something past its expiry, one at a time; one clinic's failure does not stop the
 * rest. After `budgetMs` (real time, `nowMs`) no new clinic or batch is started – a batch already running finishes –
 * and `stoppedEarly` says so; the next night carries on (every statement is conditional, nothing is done twice).
 */
export async function runExpirySweep(
  ctx: DbContext,
  options: { onError?: (tenantId: string, err: unknown) => void; budgetMs?: number; nowMs?: () => number } = {},
): Promise<ExpiryRunResult> {
  const nowMs = options.nowMs ?? Date.now;
  const deadline = nowMs() + (options.budgetMs ?? EXPIRY_RUN_BUDGET_MS);
  const out: ExpiryRunResult = {
    clinics: 0,
    courses: 0,
    giftCards: 0,
    giftCardPence: 0,
    errors: 0,
    stoppedEarly: false,
  };
  const stop = () => {
    if (nowMs() >= deadline) out.stoppedEarly = true;
    return out.stoppedEarly;
  };
  for (const tenantId of await clinicsWithExpiredItems(ctx)) {
    if (stop()) break;
    out.clinics += 1;
    try {
      const r = await sweepExpiredForTenant(ctx, tenantId, EXPIRY_SWEEP_ACTOR, { stop });
      out.courses += r.courses;
      out.giftCards += r.giftCards;
      out.giftCardPence += r.giftCardPence;
    } catch (err) {
      out.errors += 1;
      options.onError?.(tenantId, err);
    }
  }
  return out;
}
