/**
 * Set-up → Xero (/app/clinic/setup/xero): what the page and its server actions call. Rules:
 *   1. the platform switch CLINFORMS_XERO=on – else the page is the 404 page and every action refuses;
 *   2. the clinic's OWNER or an ADMIN with "settings.setup" (two-step verification is required for every member);
 *   3. everything is read and written with the member's own clinic id; ids from the form are never trusted alone.
 */
import "server-only";
import { PAYMENT_METHODS } from "../../../../modules/pms/billing/schemas";
import { PAYMENT_METHOD_LABELS, VAT_CODE_LABELS } from "../../../../modules/pms/billing/copy";
import { VAT_CODES } from "../../../../modules/pms/billing/vat";
import { XERO_DEFAULT_TAX_TYPES, XERO_SINGLE_KEY, XERO_TYPE_LABELS, type XeroMapKind } from "../../../../modules/pms/integration/xero";
import type { XeroMaps } from "../../../../modules/pms/integration/xero-mappers";
import { listServices, listSites } from "../../../repos/pms/directory";
import { getXeroConnection, getXeroMaps, listSyncItems, openConnection, syncCounts } from "../../../repos/pms/integration/xero";
import type { RepoContext } from "../../../repos/pms/context";
import type { ClinicActor } from "../../actor";
import type { XeroLists, XeroOption, XeroScreenView } from "../../../../modules/pms/integration/xero-view";
import type { XeroClient } from "./client";
import { redirectHost, xeroAppConfig, xeroAvailable } from "./config";
import { TokenSession } from "./sync";

export { xeroAvailable };

/** Owners and admins (with the set-up permission) connect Xero and choose the mappings. */
export function mayManageXero(actor: Pick<ClinicActor, "role" | "can">): boolean {
  return (actor.role === "owner" || actor.role === "admin") && actor.can("settings.setup");
}

export type { XeroLists, XeroOption, XeroScreenView };

/** The organisation's live set-up lists (accounts, tax rates, tracking options): active ones only. */
export async function loadXeroLists(ctx: RepoContext, tenantId: string, client: XeroClient): Promise<XeroLists | null> {
  const conn = await openConnection(ctx, tenantId);
  if (!conn) return null;
  const session = new TokenSession(ctx, tenantId, client, conn);
  return session.withApi(async (api) => {
    const [accounts, taxes, tracking] = await Promise.all([api.accounts(), api.taxRates(), api.trackingCategories()]);
    const active = accounts.filter((a) => a.status === "ACTIVE" && a.code);
    return {
      revenueAccounts: active.filter((a) => ["REVENUE", "SALES", "OTHERINCOME", "EXPENSE", "OVERHEADS", "DIRECTCOSTS"].includes(a.type)).map((a) => ({ value: a.code, label: `${a.code} – ${a.name}` })),
      paymentAccounts: active.filter((a) => a.enablePayments).map((a) => ({ value: a.code, label: `${a.code} – ${a.name}` })),
      taxRates: taxes.filter((t) => t.status === "ACTIVE" && t.canApplyToRevenue && t.taxType).map((t) => ({ value: t.taxType, label: t.name })),
      tracking: tracking
        .filter((c) => c.status === "ACTIVE")
        .flatMap((c) => c.options.filter((o) => o.status === "ACTIVE").map((o) => ({ value: `${c.id}|${o.id}`, label: `${c.name}: ${o.name}` }))),
    };
  });
}

/** The label of a value in the live list for its kind, or null when the value is not offered by the organisation. */
export function labelInLists(lists: XeroLists, kind: XeroMapKind, value: string): string | null {
  const pool = kind === "tax_type" ? lists.taxRates : kind === "tracking" ? lists.tracking : kind === "payment_account" ? lists.paymentAccounts : lists.revenueAccounts;
  return pool.find((o) => o.value === value)?.label ?? null;
}

/** What must be chosen before anything goes (the payment methods and VAT codes this clinic actually uses). */
export function missingMaps(maps: XeroMaps, used: { methods: string[]; vatCodes: string[]; vatRegistered: boolean; writeOffs: boolean }): string[] {
  const out: string[] = [];
  if (!maps.default_account?.[XERO_SINGLE_KEY]) out.push("the default sales account");
  if (used.writeOffs && !maps.write_off_account?.[XERO_SINGLE_KEY]) out.push("the write-off account");
  for (const m of used.methods) if (!maps.payment_account?.[m]) out.push(`the account for ${PAYMENT_METHOD_LABELS[m as keyof typeof PAYMENT_METHOD_LABELS] ?? m} payments`);
  if (used.vatRegistered) for (const v of used.vatCodes) if (v !== "none" && !maps.tax_type?.[v]) out.push(`the tax rate for ${VAT_CODE_LABELS[v as keyof typeof VAT_CODE_LABELS] ?? v}`);
  return out;
}

export async function xeroScreenFor(actor: ClinicActor, client: XeroClient | null, requestHost: string | null): Promise<XeroScreenView> {
  const ctx = actor.repo();
  const t = actor.tenantId;
  const config = xeroAppConfig();
  const [connection, maps, services, sites, counts, problems, recent, settings, usedMethods, usedVat, writeOffs] = await Promise.all([
    getXeroConnection(ctx, t),
    getXeroMaps(ctx, t),
    listServices(ctx, t),
    listSites(ctx, t),
    syncCounts(ctx, t),
    listSyncItems(ctx, t, { statuses: ["failed", "blocked"], limit: 50 }),
    listSyncItems(ctx, t, { limit: 15 }),
    ctx.db.selectFrom("pms_billing_settings").select("vat_registered").where("tenant_id", "=", t).executeTakeFirst(),
    ctx.db.selectFrom("pms_payments").select("method").distinct().where("tenant_id", "=", t).where("kind", "=", "payment").limit(20).execute(),
    ctx.db.selectFrom("pms_invoice_lines").select("vat_code").distinct().where("tenant_id", "=", t).limit(20).execute(),
    ctx.db.selectFrom("pms_credit_notes").select("id").where("tenant_id", "=", t).where("kind", "=", "write_off").limit(1).execute(),
  ]);
  let lists: XeroLists | null = null;
  let listsError: string | null = null;
  if (client && connection.status === "connected" && connection.enabled) {
    try {
      lists = await loadXeroLists(ctx, t, client);
    } catch {
      listsError = "Xero's lists could not be loaded just now. Refresh the page to try again.";
    }
  }
  const vatRegistered = Number(settings?.vat_registered ?? 0) === 1;
  const flat: XeroScreenView["maps"] = [];
  for (const [kind, byKey] of Object.entries(maps)) for (const [key, m] of Object.entries(byKey ?? {})) flat.push({ kind: kind as XeroMapKind, key, value: m.value, label: m.label });
  const what = (type: string, op: string) => XERO_TYPE_LABELS[`${type}:${op}`] ?? "Record";
  const host = config ? redirectHost(config) : null;
  return {
    configured: Boolean(config && client),
    wrongHost: host && requestHost && requestHost.toLowerCase() !== host.toLowerCase() ? host : null,
    connection,
    lists,
    listsError,
    maps: flat,
    services: services.map((s) => ({ id: s.id, name: s.name })),
    sites: sites.map((s) => ({ id: s.id, name: s.name })),
    methods: PAYMENT_METHODS.map((m) => ({ id: m, name: PAYMENT_METHOD_LABELS[m] })),
    vatCodes: VAT_CODES.filter((v) => v !== "none").map((v) => ({ id: v, name: VAT_CODE_LABELS[v], suggested: lists?.taxRates.some((r) => r.value === XERO_DEFAULT_TAX_TYPES[v]) ? XERO_DEFAULT_TAX_TYPES[v] : null })),
    missing: missingMaps(maps, { methods: usedMethods.map((m) => m.method), vatCodes: usedVat.map((v) => v.vat_code), vatRegistered, writeOffs: writeOffs.length > 0 }),
    counts,
    problems: problems.map((i) => ({ id: i.id, what: what(i.localType, i.op), status: i.status, message: i.errorMessage, attempts: i.attempts, updatedAt: i.updatedAt })),
    recent: recent.map((i) => ({ id: i.id, what: what(i.localType, i.op), status: i.status, updatedAt: i.updatedAt })),
  };
}
