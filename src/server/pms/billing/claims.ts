/**
 * Insurer claims (K2-BILL-011) – the Billing → Claims screen: the issued invoices addressed to one payer account in a
 * date range (preview: how many, how much, already sent), then the claims file through the CSV e-billing channel
 * (./ebilling-channels.ts: one row per treatment, logged per invoice with its audit row in the same batch). The
 * Healthcode channel is listed as "not connected" and never sends.
 *
 * Permissions as the invoice CSV: billing.view to look, billing.view + reports.export to download. Site scope from
 * the member (invoices of other sites are left out).
 */
import "server-only";
import { z } from "zod";
import { EXPORT_CHANNEL_INFO, type ExportChannelInfo } from "../../../modules/pms/billing/ebilling";
import { PmsIdSchema } from "../../../modules/pms/core/schemas";
import { ukToday } from "../../../modules/pms/core/text";
import { listInvoicesPage } from "../../repos/pms/billing/invoices";
import { MAX_EXPORT_INVOICES } from "../../repos/pms/billing/exports";
import { attempt, fail, forbidden, ok, type BillingActor, type Result } from "./access";
import { INSURER_BILLING_CHANNELS, type ExportedFile } from "./ebilling-channels";
import { payerAccountsFor } from "./views";

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

export const ClaimsQuerySchema = z
  .object({
    payerReferrerId: PmsIdSchema,
    from: IsoDate,
    until: IsoDate,
    /** Also invoices already in an earlier claims file. */
    includeSent: z.boolean().optional(),
  })
  .refine((v) => v.from <= v.until, { message: "The start date is after the end date", path: ["until"] });
export type ClaimsQuery = z.input<typeof ClaimsQuerySchema>;

export interface ClaimRowView {
  id: string;
  number: string;
  issuedOn: string;
  totalPence: number;
  balancePence: number;
  sentAt: string | null;
}

export interface ClaimsView {
  payers: { id: string; name: string }[];
  channels: ExportChannelInfo[];
  query: { payerReferrerId: string | null; from: string; until: string; includeSent: boolean };
  payerName: string | null;
  rows: ClaimRowView[];
  totalPence: number;
  /** Invoices in the range already in a claims file (left out unless includeSent). */
  alreadySent: number;
  canDownload: boolean;
  maxPerFile: number;
}

function monthStart(today: string): string {
  return `${today.slice(0, 8)}01`;
}

async function claimInvoices(actor: BillingActor, q: z.output<typeof ClaimsQuerySchema>) {
  const ctx = actor.repo();
  const rows = [];
  for (let offset = 0; offset < 2000; offset += 200) {
    const page = await listInvoicesPage(ctx, actor.tenantId, { state: "all", billTo: "payer", payerReferrerId: q.payerReferrerId, from: q.from, until: q.until, siteIds: actor.siteIds ?? null, limit: 200, offset });
    rows.push(...page.rows);
    if (page.rows.length < 200) break;
  }
  // Issued, not voided, with a number: what an insurer can be billed for.
  return rows.filter((i) => i.status === "issued" && i.number && i.issuedOn && !i.voidedAt).sort((a, b) => (a.issuedOn as string).localeCompare(b.issuedOn as string) || (a.numberSeq ?? 0) - (b.numberSeq ?? 0));
}

/** The Claims screen: payer accounts, the channels, and the invoices of the chosen payer and dates. billing.view. */
export async function claimsFor(actor: BillingActor, input: Partial<ClaimsQuery> = {}): Promise<Result<ClaimsView>> {
  if (!actor.can("billing.view")) return forbidden();
  return attempt<ClaimsView>("billing.claims", async () => {
    const payers = await payerAccountsFor(actor);
    if (!payers.ok) return payers;
    const ctx = actor.repo();
    const today = ukToday(ctx.now ? ctx.now() : new Date());
    const base = { payers: payers.value, channels: [EXPORT_CHANNEL_INFO.csv, EXPORT_CHANNEL_INFO.healthcode], canDownload: actor.can("reports.export"), maxPerFile: MAX_EXPORT_INVOICES };
    const from = input.from || monthStart(today);
    const until = input.until || today;
    const includeSent = input.includeSent === true;
    if (!input.payerReferrerId) return ok({ ...base, query: { payerReferrerId: null, from, until, includeSent }, payerName: null, rows: [], totalPence: 0, alreadySent: 0 });
    const parsed = ClaimsQuerySchema.safeParse({ payerReferrerId: input.payerReferrerId, from, until, includeSent });
    if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the payer and the dates.");
    const payer = payers.value.find((p) => p.id === parsed.data.payerReferrerId);
    if (!payer) return fail("not_found", "That payer account is not in this clinic.");
    const all = await claimInvoices(actor, parsed.data);
    const chosen = includeSent ? all : all.filter((i) => !i.exportedAt);
    return ok({
      ...base,
      query: { payerReferrerId: payer.id, from, until, includeSent },
      payerName: payer.name,
      rows: chosen.map((i) => ({ id: i.id, number: i.number as string, issuedOn: i.issuedOn as string, totalPence: i.totalPence, balancePence: i.balancePence, sentAt: i.exportedAt })),
      totalPence: chosen.reduce((s, i) => s + i.totalPence, 0),
      alreadySent: all.filter((i) => i.exportedAt).length,
    });
  });
}

/**
 * The claims file for the chosen payer and dates (billing.view + reports.export). The invoices are read again on the
 * server – never taken from the browser – and each one is logged as sent (with the audit row) by the channel.
 */
export async function claimsFileFor(actor: BillingActor, input: unknown): Promise<Result<ExportedFile>> {
  if (!actor.can("billing.view") || !actor.can("reports.export")) return forbidden();
  const parsed = ClaimsQuerySchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message ?? "Check the payer and the dates.");
  return attempt<ExportedFile>("billing.claims_file", async () => {
    const payers = await payerAccountsFor(actor);
    if (!payers.ok) return payers;
    if (!payers.value.some((p) => p.id === parsed.data.payerReferrerId)) return fail("not_found", "That payer account is not in this clinic.");
    const all = await claimInvoices(actor, parsed.data);
    const chosen = parsed.data.includeSent ? all : all.filter((i) => !i.exportedAt);
    if (chosen.length === 0) return fail("invalid", "There are no invoices to claim for this payer and dates.");
    if (chosen.length > MAX_EXPORT_INVOICES) return fail("invalid", `That is ${chosen.length} invoices – at most ${MAX_EXPORT_INVOICES} go in one file. Choose a shorter date range.`);
    const file = await INSURER_BILLING_CHANNELS.csv.submit(actor.repo(), actor.tenantId, chosen.map((i) => i.id), actor.actor);
    return ok(file);
  });
}
