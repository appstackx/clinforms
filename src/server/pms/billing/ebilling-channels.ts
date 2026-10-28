/**
 * Insurer e-billing channels (the export interface). Each channel takes issued insurer invoices and either
 * produces what the clinic sends (the claims file) or says plainly it is not connected (Healthcode): it never
 * pretends to send. A real Healthcode connection needs this system's own Healthcode registration and agreement –
 * a commercial step outside this code (docs/clinic-system/billing.md).
 */
import "server-only";
import { EXPORT_CHANNEL_INFO, claimsCsv, type ExportChannelInfo } from "../../../modules/pms/billing/ebilling";
import type { ExportChannel } from "../../../modules/pms/billing/types";
import type { PmsActor } from "../../../modules/pms/core/types";
import { RepoInputError, type RepoContext } from "../../repos/context";
import { claimLines, recordInvoiceExports } from "../../repos/pms/billing/exports";

export interface ExportedFile {
  name: string;
  contentType: string;
  body: string;
  invoices: number;
  skipped: string[];
  batchRef: string;
}

export interface InsurerBillingChannel {
  readonly info: ExportChannelInfo;
  submit(ctx: RepoContext, tenantId: string, invoiceIds: string[], actor: PmsActor): Promise<ExportedFile>;
}

const CSV_CHANNEL: InsurerBillingChannel = {
  info: EXPORT_CHANNEL_INFO.csv,
  async submit(ctx, tenantId, invoiceIds, actor) {
    const { lines, skipped } = await claimLines(ctx, tenantId, invoiceIds);
    const included = invoiceIds.filter((id) => !skipped.includes(id));
    if (included.length === 0) throw new RepoInputError("None of the chosen invoices is an issued insurer invoice.");
    const { batchRef } = await recordInvoiceExports(ctx, tenantId, included, "csv", actor);
    return { name: `claims-${batchRef}.csv`, contentType: "text/csv; charset=utf-8", body: claimsCsv(lines), invoices: included.length, skipped, batchRef };
  },
};

const HEALTHCODE_CHANNEL: InsurerBillingChannel = {
  info: EXPORT_CHANNEL_INFO.healthcode,
  async submit() {
    throw new RepoInputError("Healthcode e-billing is not connected yet. Nothing was sent.");
  },
};

export const INSURER_BILLING_CHANNELS: Readonly<Record<ExportChannel, InsurerBillingChannel>> = {
  csv: CSV_CHANNEL,
  healthcode: HEALTHCODE_CHANNEL,
};
