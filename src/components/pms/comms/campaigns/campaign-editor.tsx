"use client";
/**
 * Bulk email – write, check and send one email (a draft), or see what happened to it (scheduled, sending, sent,
 * cancelled). The draft: name, kind (marketing / service announcement – with the reason), subject, the message in
 * plain text with merge fields, who it goes to (site, last seen, upcoming appointment, age) with a live count,
 * a preview made by the same code that sends (the patient sees it with their own unsubscribe link), a test copy to
 * the member's own address, Send now / Schedule, and Cancel before it goes.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  CAMPAIGN_COPY,
  CAMPAIGN_FIELDS,
  CAMPAIGN_PURPOSE_LABELS,
  CAMPAIGN_STATUS_LABELS,
  UPCOMING_LABELS,
  UPCOMING_CHOICES,
  renderCampaign,
  type CampaignPurpose,
  type UpcomingChoice,
} from "@/modules/pms/comms/campaigns";
import { CAMPAIGN_SKIP_LABELS, type CampaignEditorView, type CampaignReport } from "@/modules/pms/comms/campaign-view";
import { formatUkDateTime, londonParts, londonToUtcIso } from "@/modules/pms/comms/schedule";
import { cn } from "@/lib/utils";
import { ConfirmDialog, FormField, PmsButton, PmsNotice, Radio, SelectInput, TextArea, TextInput, useToast } from "@/components/pms/ui";
import { cancelCampaignAction, continueSendingAction, countAudienceAction, saveCampaignAction, scheduleAction, testSendAction } from "@/app/app/clinic/messages/campaigns/actions";
import { focusRing } from "../format";
import { CAMPAIGNS_PATH } from "./campaigns-home";

interface Draft {
  name: string;
  purpose: CampaignPurpose;
  serviceReason: string;
  subject: string;
  body: string;
  siteId: string;
  lastSeenMonths: string;
  upcoming: UpcomingChoice;
  minAge: string;
  maxAge: string;
}

const int = (v: string): number | null => (v.trim() === "" ? null : Number(v));

function audienceOf(d: Draft) {
  return {
    siteId: d.siteId || null,
    lastSeenMonths: int(d.lastSeenMonths),
    upcoming: d.upcoming,
    minAge: int(d.minAge),
    maxAge: int(d.maxAge),
  };
}

function inputOf(d: Draft) {
  return {
    name: d.name,
    purpose: d.purpose,
    serviceReason: d.purpose === "service" ? d.serviceReason : null,
    subject: d.subject,
    body: d.body,
    audience: audienceOf(d),
  };
}

function Report({ report }: { report: CampaignReport }) {
  const rows: [string, number][] = [
    ["Recipients", report.recipients],
    ["Sent", report.sent],
    ["Delivered (when the email service reports it)", report.delivered],
    ["Kept in the outbox (not sent)", report.outbox],
    ["Failed", report.failed],
    ["Not sent", report.skipped],
    ["Waiting to send", report.pending],
    ["Unsubscribed from this email", report.unsubscribed],
  ];
  return (
    <section aria-labelledby="cmp-report" className="flex flex-col gap-2 rounded-xl border border-border bg-white p-4" data-testid="campaign-report">
      <h2 id="cmp-report" className="text-base font-semibold">
        What happened
      </h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-border py-1">
            <dt className="text-[#475569]">{k}</dt>
            <dd className="font-medium tabular-nums" data-testid={`report-${k.split(" ")[0].toLowerCase()}`}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {Object.keys(report.skipReasons).length ? (
        <ul className="text-sm text-[#475569]">
          {Object.entries(report.skipReasons).map(([k, n]) => (
            <li key={k}>
              {CAMPAIGN_SKIP_LABELS[k] ?? "Other"}: {n}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function CampaignEditor({ view }: { view: CampaignEditorView }) {
  const router = useRouter();
  const toast = useToast();
  const c = view.campaign;
  const editable = !c || c.status === "draft";
  const [d, setD] = React.useState<Draft>({
    name: c?.name ?? "",
    purpose: c?.purpose ?? "marketing",
    serviceReason: c?.serviceReason ?? "",
    subject: c?.subject ?? "",
    body: c?.body ?? "Hello {first_name},\n\n\n\nBest wishes,\n{clinic_name}",
    siteId: c?.audience.siteId ?? (view.siteLocked && view.sites[0] ? view.sites[0].id : ""),
    lastSeenMonths: c?.audience.lastSeenMonths != null ? String(c.audience.lastSeenMonths) : "",
    upcoming: c?.audience.upcoming ?? "any",
    minAge: c?.audience.minAge != null ? String(c.audience.minAge) : "",
    maxAge: c?.audience.maxAge != null ? String(c.audience.maxAge) : "",
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [count, setCount] = React.useState<{
    patients: number;
    addresses: number;
  } | null>(null);
  const [countError, setCountError] = React.useState<string | null>(null);
  const [confirmSend, setConfirmSend] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const today = londonParts(view.now).date;
  const [when, setWhen] = React.useState({ date: today, time: "10:00" });
  const dirty = React.useRef(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    dirty.current = true;
    setD((x) => ({ ...x, [k]: v }));
  };

  // The live count (debounced; the same query the send uses).
  const audienceKey = JSON.stringify([d.purpose, audienceOf(d)]);
  React.useEffect(() => {
    if (!editable) return;
    let live = true;
    const t = setTimeout(async () => {
      const [purpose, audience] = JSON.parse(audienceKey) as [string, unknown];
      const r = await countAudienceAction(purpose, audience);
      if (!live) return;
      if (r.ok) {
        setCount({ patients: r.patients, addresses: r.addresses });
        setCountError(null);
      } else setCountError(r.error);
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [audienceKey, editable]);

  const preview = renderCampaign({
    subject: d.subject || "(no subject yet)",
    body: d.body,
    values: {
      first_name: "Megan",
      clinic_name: view.sender.name,
      clinic_address: view.sender.postalAddress,
      clinic_phone: view.sender.phone,
    },
    clinicName: view.sender.name,
    postalAddress: view.sender.postalAddress ?? "[the clinic's postal address is missing]",
    phone: view.sender.phone,
    purpose: d.purpose,
    stopUrl: "https://… (each patient's own unsubscribe link)",
  });

  async function save(): Promise<{ id: string; rev: number } | null> {
    setBusy("save");
    setError(null);
    setErrors({});
    const r = await saveCampaignAction(c?.id ?? null, c?.rev ?? null, inputOf(d));
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      setErrors(r.fieldErrors ?? {});
      return null;
    }
    dirty.current = false;
    toast.success("Draft saved.");
    if (!c) router.push(`${CAMPAIGNS_PATH}/${r.id}`);
    else router.refresh();
    return { id: r.id, rev: r.rev };
  }

  async function testSend() {
    if (!c) return;
    if (dirty.current && !(await save())) return;
    setBusy("test");
    const r = await testSendAction(c.id);
    setBusy(null);
    if (!r.ok) toast.error(r.error);
    else if (r.status === "outbox") toast.success("No email service is set up: the test copy was kept, not sent. The preview shows what it looks like.");
    else toast.success(`Test copy sent to ${r.to}.`);
  }

  async function schedule(now: boolean) {
    if (!c) return;
    // Unsaved changes are saved first, so what goes is what the screen shows.
    let rev = c.rev;
    if (dirty.current) {
      const saved = await save();
      if (!saved) {
        setConfirmSend(false);
        return;
      }
      rev = saved.rev;
    }
    setBusy(now ? "send" : "schedule");
    setError(null);
    const sendAt = now ? "now" : londonToUtcIso(when.date, when.time);
    const r = await scheduleAction(c.id, rev, sendAt);
    setBusy(null);
    setConfirmSend(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast.success(now ? `Sending started (${r.written} written so far).` : "Scheduled.");
    router.refresh();
  }

  async function cancel() {
    if (!c) return;
    setBusy("cancel");
    const r = await cancelCampaignAction(c.id);
    setBusy(null);
    setConfirmCancel(false);
    if (!r.ok) toast.error(r.error);
    else toast.success("Cancelled. Nothing was sent.");
    router.refresh();
  }

  async function sendMore() {
    if (!c) return;
    setBusy("more");
    const r = await continueSendingAction(c.id);
    setBusy(null);
    if (!r.ok) toast.error(r.error);
    else toast.success(r.capReached ? CAMPAIGN_COPY.dailyCapReached : `${r.written} more written.`);
    router.refresh();
  }

  const status = c ? CAMPAIGN_STATUS_LABELS[c.status] : "New";
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1100px] flex-col gap-4" data-testid="campaign-editor" data-status={c?.status ?? "new"}>
      <nav aria-label="Breadcrumb" className="text-sm text-[#475569]">
        <Link href={CAMPAIGNS_PATH} className={cn("text-primary-strong underline underline-offset-2", focusRing)}>
          Bulk email
        </Link>
        <span aria-hidden> / </span>
        <span>{c?.name ?? "New bulk email"}</span>
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold text-foreground">{c?.name ?? "New bulk email"}</h1>
        <span className="rounded-full bg-[#F1F5F9] px-3 py-1 text-sm font-medium text-[#334155]" data-testid="campaign-status">
          {status}
          {c?.status === "scheduled" && c.scheduledFor ? ` – ${formatUkDateTime(c.scheduledFor)}` : ""}
        </span>
      </div>
      {view.emailMode === "outbox" ? (
        <PmsNotice tone="info" title="No email service is set up yet">
          Emails are kept in the outbox and are not sent to anyone.
        </PmsNotice>
      ) : null}
      {!view.sender.postalAddress ? <PmsNotice tone="warning" title={CAMPAIGN_COPY.noAddress} /> : null}
      {view.report ? <Report report={view.report} /> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-labelledby="cmp-write" className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-white p-4">
          <h2 id="cmp-write" className="text-base font-semibold">
            The email
          </h2>
          <FormField id="cmp-name" label="Name (only staff see it)" error={errors.name}>
            <TextInput value={d.name} onChange={(e) => set("name", e.target.value)} maxLength={120} disabled={!editable} />
          </FormField>
          <fieldset className="flex flex-col gap-1.5" disabled={!editable}>
            <legend className="mb-1 text-sm font-medium">Kind of email</legend>
            {(["marketing", "service"] as const).map((p) => (
              <Radio key={p} name="cmp-purpose" value={p} label={CAMPAIGN_PURPOSE_LABELS[p]} checked={d.purpose === p} onChange={() => set("purpose", p)} data-testid={`purpose-${p}`} />
            ))}
            <p className="text-xs text-[#475569]">{d.purpose === "marketing" ? CAMPAIGN_COPY.marketingRule : CAMPAIGN_COPY.serviceRule}</p>
          </fieldset>
          {d.purpose === "service" ? (
            <FormField id="cmp-reason" label="Why this is a service announcement, not marketing" error={errors.serviceReason} hint="Kept with the email (e.g. “The Wolverton site closes on 24/12”).">
              <TextInput value={d.serviceReason} onChange={(e) => set("serviceReason", e.target.value)} maxLength={300} disabled={!editable} />
            </FormField>
          ) : null}
          <FormField id="cmp-subject" label="Subject" error={errors.subject}>
            <TextInput value={d.subject} onChange={(e) => set("subject", e.target.value)} maxLength={150} disabled={!editable} />
          </FormField>
          <FormField
            id="cmp-body"
            label="Message"
            error={errors.body}
            hint={`Plain text: a blank line starts a paragraph, lines starting "- " make a list, https links work. Merge fields: ${CAMPAIGN_FIELDS.map((f) => `{${f.key}}`).join(", ")}. The footer (clinic name, postal address, unsubscribe link) is added for you.`}
          >
            <TextArea rows={12} value={d.body} onChange={(e) => set("body", e.target.value)} maxLength={10000} disabled={!editable} />
          </FormField>
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby="cmp-who" className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-white p-4">
            <h2 id="cmp-who" className="text-base font-semibold">
              Who it goes to
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField id="cmp-site" label="Site" error={errors["audience.siteId"]} hint="Patients with an appointment at this site.">
                <SelectInput value={d.siteId} onChange={(e) => set("siteId", e.target.value)} disabled={!editable}>
                  {view.siteLocked ? null : <option value="">Every site</option>}
                  {view.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
              <FormField id="cmp-seen" label="Last seen within (months)" error={errors["audience.lastSeenMonths"]} hint="Empty = any time.">
                <TextInput inputMode="numeric" value={d.lastSeenMonths} onChange={(e) => set("lastSeenMonths", e.target.value.replace(/\D/g, "").slice(0, 3))} disabled={!editable} />
              </FormField>
              <FormField id="cmp-upcoming" label="Upcoming appointment">
                <SelectInput value={d.upcoming} onChange={(e) => set("upcoming", e.target.value as UpcomingChoice)} disabled={!editable}>
                  {UPCOMING_CHOICES.map((u) => (
                    <option key={u} value={u}>
                      {UPCOMING_LABELS[u]}
                    </option>
                  ))}
                </SelectInput>
              </FormField>
              <div className="grid grid-cols-2 gap-2">
                <FormField id="cmp-min-age" label="Age from" error={errors["audience.minAge"]}>
                  <TextInput inputMode="numeric" value={d.minAge} onChange={(e) => set("minAge", e.target.value.replace(/\D/g, "").slice(0, 3))} disabled={!editable} />
                </FormField>
                <FormField id="cmp-max-age" label="Age to" error={errors["audience.maxAge"]}>
                  <TextInput inputMode="numeric" value={d.maxAge} onChange={(e) => set("maxAge", e.target.value.replace(/\D/g, "").slice(0, 3))} disabled={!editable} />
                </FormField>
              </div>
            </div>
            {editable ? (
              <p className="text-sm" role="status" aria-live="polite" data-testid="audience-count">
                {countError ? (
                  <span className="text-destructive-strong">{countError}</span>
                ) : count ? (
                  <>
                    <strong>{count.addresses.toLocaleString("en-GB")}</strong> email{count.addresses === 1 ? "" : "s"} would go now
                    {count.patients !== count.addresses ? ` (${count.patients.toLocaleString("en-GB")} patients – one email per address)` : ""}.
                  </>
                ) : (
                  "Counting…"
                )}
              </p>
            ) : null}
          </section>

          <section aria-labelledby="cmp-preview" className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-white p-4">
            <h2 id="cmp-preview" className="text-base font-semibold">
              Preview
            </h2>
            <p className="text-sm">
              <span className="text-[#475569]">Subject:</span> <strong data-testid="preview-subject">{preview.subject}</strong>
            </p>
            <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-80 w-full rounded-lg border border-border bg-white" data-testid="preview-frame" />
            <p className="text-xs text-[#475569]">As Megan (fictional) would see it. Each patient gets their own first name and unsubscribe link.</p>
          </section>
        </div>
      </div>

      {error ? <PmsNotice tone="error" title={error} /> : null}

      {editable ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4">
          <div className="flex flex-wrap gap-2">
            <PmsButton loading={busy === "save"} onClick={() => void save()} data-testid="campaign-save">
              Save draft
            </PmsButton>
            {c ? (
              <>
                <PmsButton variant="secondary" loading={busy === "test"} onClick={() => void testSend()} data-testid="campaign-test">
                  Send a test to {view.memberEmail}
                </PmsButton>
                <PmsButton variant="secondary" onClick={() => setConfirmCancel(true)} data-testid="campaign-cancel">
                  Cancel this email
                </PmsButton>
              </>
            ) : null}
          </div>
          {c ? (
            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <PmsButton onClick={() => setConfirmSend(true)} disabled={!view.sender.postalAddress} data-testid="campaign-send-now">
                Send now
              </PmsButton>
              <span className="px-1 text-sm text-[#475569]">or</span>
              <FormField id="cmp-date" label="Date">
                <TextInput type="date" value={when.date} min={today} onChange={(e) => setWhen({ ...when, date: e.target.value })} />
              </FormField>
              <FormField id="cmp-time" label="Time (UK)">
                <TextInput type="time" value={when.time} onChange={(e) => setWhen({ ...when, time: e.target.value })} />
              </FormField>
              <PmsButton variant="secondary" loading={busy === "schedule"} onClick={() => void schedule(false)} disabled={!view.sender.postalAddress} data-testid="campaign-schedule">
                Schedule
              </PmsButton>
            </div>
          ) : (
            <p className="text-sm text-[#475569]">Save the draft to send a test copy, send it or schedule it.</p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {c?.status === "scheduled" ? (
            <PmsButton variant="secondary" onClick={() => setConfirmCancel(true)} data-testid="campaign-cancel">
              Cancel before it goes
            </PmsButton>
          ) : null}
          {c?.status === "sending" ? (
            <PmsButton variant="secondary" loading={busy === "more"} onClick={() => void sendMore()} data-testid="campaign-send-more">
              Send more now
            </PmsButton>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={confirmSend}
        onOpenChange={setConfirmSend}
        title="Send this email now?"
        description={`${count ? `${count.addresses.toLocaleString("en-GB")} email${count.addresses === 1 ? "" : "s"}` : "The email"} will go to the patients who match when it starts. This cannot be undone.`}
        confirmLabel="Send now"
        pending={busy === "send"}
        onConfirm={() => void schedule(true)}
      />
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this email?"
        description="Nothing will be sent. A cancelled email cannot be sent later – write a new one instead."
        confirmLabel="Cancel the email"
        cancelLabel="Keep it"
        destructive
        pending={busy === "cancel"}
        onConfirm={() => void cancel()}
      />
    </div>
  );
}
