/**
 * Insurer e-billing: the claims a clinic sends for its insurer invoices, and the log of what was exported
 * (`pms_invoice_exports`). Only the claims file (CSV) is connected; Healthcode is refused here as well as on screen
 * (src/modules/pms/billing/ebilling.ts) – nothing pretends to send to it.
 */
import { EXPORT_CHANNEL_INFO, type ClaimLine } from "../../../../modules/pms/billing/ebilling";
import { BILLING_ID_PREFIXES as P } from "../../../../modules/pms/billing/ids";
import { ExportChannelSchema } from "../../../../modules/pms/billing/schemas";
import type { InvoiceExport } from "../../../../modules/pms/billing/types";
import type { PmsActor } from "../../../../modules/pms/core/types";
import type { BatchQuery } from "../../../db/batch";
import { ulid } from "../../context";
import { RepoInputError, assertId, assertTenantId, nowIso, parseInput, pmsAuditQuery, pmsId, writeWithAudit, type RepoContext } from "../context";
import { getInvoice } from "./invoices";
import { chunks } from "./shared";

export const MAX_EXPORT_INVOICES = 200;

/** One row per line of each insurer invoice (issued, addressed to a payer), in the order given. */
export async function claimLines(ctx: RepoContext, tenantId: string, invoiceIds: string[]): Promise<{ lines: ClaimLine[]; skipped: string[] }> {
  assertTenantId(tenantId);
  if (invoiceIds.length > MAX_EXPORT_INVOICES) throw new RepoInputError(`At most ${MAX_EXPORT_INVOICES} invoices in one file.`);
  const lines: ClaimLine[] = [];
  const skipped: string[] = [];
  const pracCache = new Map<string, { name: string; reg: string | null } | null>();
  for (const id of invoiceIds) {
    assertId(id, "invoice id");
    const inv = await getInvoice(ctx, tenantId, id);
    if (!inv || inv.status !== "issued" || inv.billTo !== "payer" || !inv.number || !inv.issuedOn) {
      skipped.push(id);
      continue;
    }
    const [patient, payer, theCase, auth] = await Promise.all([
      ctx.db.selectFrom("pms_patients").select(["first_name", "last_name", "date_of_birth", "patient_number"]).where("tenant_id", "=", tenantId).where("id", "=", inv.patientId).executeTakeFirstOrThrow(),
      inv.payerReferrerId ? ctx.db.selectFrom("pms_referrers").select("name").where("tenant_id", "=", tenantId).where("id", "=", inv.payerReferrerId).executeTakeFirst() : Promise.resolve(undefined),
      inv.caseId ? ctx.db.selectFrom("pms_cases").select(["membership_number", "claim_reference"]).where("tenant_id", "=", tenantId).where("id", "=", inv.caseId).executeTakeFirst() : Promise.resolve(undefined),
      inv.authorisationId ? ctx.db.selectFrom("pms_authorisations").select("code").where("tenant_id", "=", tenantId).where("id", "=", inv.authorisationId).executeTakeFirst() : Promise.resolve(undefined),
    ]);
    for (const l of inv.lines) {
      let prac: { name: string; reg: string | null } | null = null;
      if (l.practitionerId) {
        if (!pracCache.has(l.practitionerId)) {
          const p = await ctx.db.selectFrom("pms_practitioners").select(["display_name", "registration_number"]).where("tenant_id", "=", tenantId).where("id", "=", l.practitionerId).executeTakeFirst();
          pracCache.set(l.practitionerId, p ? { name: p.display_name, reg: p.registration_number } : null);
        }
        prac = pracCache.get(l.practitionerId) ?? null;
      }
      lines.push({
        invoiceNumber: inv.number,
        invoiceDate: inv.issuedOn,
        dueDate: inv.dueOn,
        payerName: payer?.name ?? "",
        patientLastName: patient.last_name,
        patientFirstName: patient.first_name,
        patientDateOfBirth: patient.date_of_birth,
        patientNumber: Number(patient.patient_number),
        membershipNumber: theCase?.membership_number ?? null,
        authorisationCode: auth?.code ?? null,
        claimReference: theCase?.claim_reference ?? null,
        serviceDate: l.serviceOn,
        billingCode: l.billingCode,
        description: l.description ?? "",
        practitionerName: prac?.name ?? null,
        practitionerRegistration: prac?.reg ?? null,
        quantity: l.quantity,
        netPence: l.netPence,
        vatPence: l.vatPence,
        totalPence: l.totalPence,
        diagnosisCode: inv.diagnosisCode,
      });
    }
  }
  return { lines, skipped };
}

/** Logs an export of these invoices through a channel (only "csv" is connected). Returns the batch reference. */
export async function recordInvoiceExports(ctx: RepoContext, tenantId: string, invoiceIds: string[], channel: string, actor: PmsActor): Promise<{ batchRef: string; count: number }> {
  assertTenantId(tenantId);
  const ch = parseInput(ExportChannelSchema, channel, "Channel");
  if (!EXPORT_CHANNEL_INFO[ch].connected) throw new RepoInputError(`${EXPORT_CHANNEL_INFO[ch].label} is not connected yet. Nothing was sent.`);
  const unique = Array.from(new Set(invoiceIds));
  if (unique.length === 0) throw new RepoInputError("Choose at least one invoice.");
  if (unique.length > MAX_EXPORT_INVOICES) throw new RepoInputError(`At most ${MAX_EXPORT_INVOICES} invoices in one file.`);
  unique.forEach((id) => assertId(id, "invoice id"));
  const at = nowIso(ctx);
  const batchRef = `ebx-${ulid((ctx.now ? ctx.now() : new Date()).getTime()).slice(0, 16).toLowerCase()}`;
  for (const group of chunks(unique, 40)) {
    const queries: BatchQuery[] = group.map((invoiceId) =>
      ctx.db.insertInto("pms_invoice_exports").values({ tenant_id: tenantId, id: pmsId(P.export, ctx), invoice_id: invoiceId, channel: ch, batch_ref: batchRef, created_by: actor.userId, created_at: at }),
    );
    queries.push(
      ctx.db.updateTable("pms_invoices").set({ exported_at: at }).where("tenant_id", "=", tenantId).where("id", "in", group),
      pmsAuditQuery(ctx, tenantId, actor, { action: "pms.invoice.export", targetType: "pms_invoice", targetId: group[0], detail: { channel: ch, batchRef, count: group.length } }),
    );
    await writeWithAudit(ctx, queries, { foreignKey: "One of the invoices does not exist in this clinic." });
  }
  return { batchRef, count: unique.length };
}

/** When an invoice was exported for e-billing, newest first. */
export async function listExportsForInvoice(ctx: RepoContext, tenantId: string, invoiceId: string): Promise<InvoiceExport[]> {
  assertTenantId(tenantId);
  const rows = await ctx.db.selectFrom("pms_invoice_exports").selectAll().where("tenant_id", "=", tenantId).where("invoice_id", "=", invoiceId).orderBy("created_at", "desc").limit(50).execute();
  return rows.map((r) => ({ id: r.id, invoiceId: r.invoice_id, channel: r.channel as InvoiceExport["channel"], batchRef: r.batch_ref, createdAt: r.created_at, createdBy: r.created_by }));
}
