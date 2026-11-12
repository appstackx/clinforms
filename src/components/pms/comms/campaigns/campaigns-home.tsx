"use client";
/**
 * Bulk email – the list page: the clinic's setting (owners and administrators: on/off, the daily cap), the rules in
 * plain words, and every bulk email with what happened to it (sent, delivered, failed, kept in the outbox,
 * unsubscribed). Lists never show an email's text.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Plus } from "lucide-react";
import { CAMPAIGN_COPY, CAMPAIGN_STATUS_LABELS, MAX_DAILY_CAP } from "@/modules/pms/comms/campaigns";
import { formatUkDateTime } from "@/modules/pms/comms/schedule";
import { cn } from "@/lib/utils";
import { Checkbox, DataTable, EmptyState, FormField, PmsButton, PmsNotice, TextInput, pmsButtonVariants, useToast, type DataTableColumn } from "@/components/pms/ui";
import { saveBulkSettingsAction } from "@/app/app/clinic/messages/campaigns/actions";
import type { CampaignRow, CampaignsHomeView } from "@/modules/pms/comms/campaign-view";
import { MESSAGES_PATH, focusRing } from "../format";

export const CAMPAIGNS_PATH = `${MESSAGES_PATH}/campaigns`;

function counts(r: CampaignRow): string {
  if (r.status === "draft") return "Not sent yet";
  if (r.status === "scheduled") return `Goes ${formatUkDateTime(r.scheduledFor)}`;
  if (r.status === "cancelled") return "Cancelled – nothing sent";
  const x = r.report;
  if (!x) return "";
  const parts = [`${x.sent} sent`];
  if (x.delivered) parts.push(`${x.delivered} delivered`);
  if (x.outbox) parts.push(`${x.outbox} in the outbox`);
  if (x.failed) parts.push(`${x.failed} failed`);
  if (x.skipped) parts.push(`${x.skipped} not sent`);
  if (x.pending) parts.push(`${x.pending} waiting`);
  parts.push(`${x.unsubscribed} unsubscribed`);
  return parts.join(" · ");
}

function SettingsPanel({ view }: { view: CampaignsHomeView }) {
  const router = useRouter();
  const toast = useToast();
  const [enabled, setEnabled] = React.useState(view.settings.enabled);
  const [cap, setCap] = React.useState(String(view.settings.dailyCap));
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    const r = await saveBulkSettingsAction(view.settings.rev, {
      enabled,
      dailyCap: Number(cap),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.fieldErrors?.dailyCap ?? r.error);
      return;
    }
    toast.success(enabled ? "Bulk email switched on." : "Bulk email switched off.");
    router.refresh();
  }
  return (
    <section aria-labelledby="bulk-settings" className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4" data-testid="bulk-settings">
      <h2 id="bulk-settings" className="text-base font-semibold">
        Settings
      </h2>
      <Checkbox label="Use bulk email in this clinic" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid="bulk-enabled" />
      <FormField id="bulk-cap" label="Most bulk emails a day" hint={`1 to ${MAX_DAILY_CAP.toLocaleString("en-GB")}. Anything over goes the next day.`} error={error ?? undefined}>
        <TextInput className="w-32" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, "").slice(0, 4))} />
      </FormField>
      <div>
        <PmsButton loading={busy} onClick={() => void save()} data-testid="bulk-settings-save">
          Save settings
        </PmsButton>
      </div>
    </section>
  );
}

export function CampaignsHome({ view }: { view: CampaignsHomeView }) {
  const columns: DataTableColumn<CampaignRow>[] = [
    {
      id: "name",
      header: "Email",
      cell: (r) => (
        <Link href={`${CAMPAIGNS_PATH}/${r.id}`} className={cn("font-medium text-primary-strong underline underline-offset-2", focusRing)}>
          {r.name}
        </Link>
      ),
    },
    {
      id: "kind",
      header: "Kind",
      cell: (r) => (r.purpose === "marketing" ? "Marketing" : "Service announcement"),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => CAMPAIGN_STATUS_LABELS[r.status],
    },
    {
      id: "what",
      header: "What happened",
      cell: (r) => <span data-testid="campaign-counts">{counts(r)}</span>,
    },
  ];
  return (
    <div className="flex flex-col gap-4" data-testid="campaigns-home">
      {view.emailMode === "outbox" ? (
        <PmsNotice tone="info" title="No email service is set up yet">
          Bulk emails are kept in the outbox and are not sent to anyone.
        </PmsNotice>
      ) : null}
      <PmsNotice tone="info" title="Who gets what">
        {CAMPAIGN_COPY.marketingRule} {CAMPAIGN_COPY.serviceRule} Every email has an unsubscribe link and the clinic&apos;s postal address.
      </PmsNotice>
      {view.canManage ? <SettingsPanel view={view} /> : null}
      {!view.settings.enabled ? (
        <PmsNotice tone="warning" title={CAMPAIGN_COPY.off}>
          {view.canManage ? "Switch it on above to write a bulk email." : "Ask the clinic owner or an administrator to switch it on."}
        </PmsNotice>
      ) : (
        <div className="flex justify-end">
          <Link href={`${CAMPAIGNS_PATH}/new`} className={cn(pmsButtonVariants({ variant: "primary" }), "h-9")} data-testid="new-campaign">
            <Plus aria-hidden />
            New bulk email
          </Link>
        </div>
      )}
      <DataTable
        label="Bulk emails"
        columns={columns}
        rows={view.campaigns}
        rowKey={(r) => r.id}
        minWidth={720}
        renderCard={(r) => (
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-white p-3 text-sm">
            <Link href={`${CAMPAIGNS_PATH}/${r.id}`} className={cn("font-medium text-primary-strong underline underline-offset-2", focusRing)}>
              {r.name}
            </Link>
            <span className="text-xs text-[#475569]">
              {r.purpose === "marketing" ? "Marketing" : "Service announcement"} · {CAMPAIGN_STATUS_LABELS[r.status]}
            </span>
            <span className="text-xs text-[#334155]">{counts(r)}</span>
          </div>
        )}
        empty={<EmptyState title="No bulk emails yet" />}
      />
    </div>
  );
}
