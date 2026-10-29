"use client";
/**
 * Messages (design round 2c, "Messages – outbox, templates, letters, replies"): the header (quiet hours, "Send a
 * message"), the tabs in the URL (?tab=outbox|replies|templates|letters|send), the outbox with its "Today" line,
 * Retry and View, and the replies inbox with the thread and an answer box. Templates, Letters and Send a message are
 * their own components. On a phone the outbox table becomes cards and the replies list sits above the thread.
 *
 * Lists never show a message's text (it is encrypted; "View" opens one at a time): an outbox row says what the
 * message is for – "Reminder · Wed 28/10 at 11:30".
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Moon, Send, Settings } from "lucide-react";
import type { LetterRowView, MessagesHomeView, OutboxRowView, ReplyRowView, ReplyThreadView, SendFormView, TemplateRowView } from "@/modules/pms/comms/view";
import { CHANNEL_LABELS, INTENT_LABELS } from "@/modules/pms/comms/copy";
import { cn } from "@/lib/utils";
import { DataTable, EmptyState, FormField, PmsButton, PmsNotice, SideDrawer, TextArea, pmsButtonVariants, useToast, type DataTableColumn } from "@/components/pms/ui";
import { answerReplyAction, loadMessageAction, loadThreadAction, markReplyDoneAction, retryMessageAction, runDueNowAction } from "@/app/app/clinic/messages/actions";
import { MESSAGES_PATH, focusRing, whenLabel } from "./format";
import { LettersList } from "./letters-list";
import { MessageStatusPill } from "./message-status";
import { SendMessageForm } from "./send-form";
import { TemplatesEditor } from "./templates";

export type MessagesTab = "outbox" | "replies" | "templates" | "letters" | "send";
export type OutboxFilterKey = "all" | "planned" | "sent" | "failed" | "skipped";

export interface MessagesPageProps {
  tab: MessagesTab;
  home: MessagesHomeView;
  now: string;
  outbox: OutboxRowView[] | null;
  filter: OutboxFilterKey;
  replies: ReplyRowView[] | null;
  replyId: string | null;
  templates: { rows: TemplateRowView[]; canEdit: boolean; examples: Record<string, string> } | null;
  letters: LetterRowView[] | null;
  send: SendFormView | null;
  failed: string | null;
}

const FILTERS: { key: OutboxFilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "planned", label: "Planned" },
  { key: "sent", label: "Sent" },
  { key: "failed", label: "Failed" },
  { key: "skipped", label: "Not sent" },
];

function hrefFor(p: { tab?: MessagesTab; filter?: OutboxFilterKey; reply?: string | null; patient?: string | null }): string {
  const q = new URLSearchParams();
  if (p.tab && p.tab !== "outbox") q.set("tab", p.tab);
  if (p.filter && p.filter !== "all") q.set("filter", p.filter);
  if (p.reply) q.set("reply", p.reply);
  if (p.patient) q.set("patient", p.patient);
  const s = q.toString();
  return s ? `${MESSAGES_PATH}?${s}` : MESSAGES_PATH;
}

export function MessagesPage(props: MessagesPageProps) {
  const { tab, home, failed } = props;
  const tabs: { key: MessagesTab; label: string }[] = [
    { key: "outbox", label: "Outbox" },
    { key: "replies", label: home.toAction ? `Replies (${home.toAction})` : "Replies" },
    { key: "templates", label: "Templates" },
    { key: "letters", label: "Letters" },
    { key: "send", label: "Send a message" },
  ];
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold text-foreground">Messages</h1>
        {home.canManage ? (
          <Link href={`${MESSAGES_PATH}/settings`} className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#EFF4FF] px-3 text-sm font-medium text-[#1842B4]", focusRing)} data-testid="quiet-hours">
            <Moon className="h-3.5 w-3.5" aria-hidden />
            Quiet hours {home.quietStart}–{home.quietEnd}
          </Link>
        ) : (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#EFF4FF] px-3 text-sm font-medium text-[#1842B4]" data-testid="quiet-hours">
            <Moon className="h-3.5 w-3.5" aria-hidden />
            Quiet hours {home.quietStart}–{home.quietEnd}
          </span>
        )}
        <Link href={hrefFor({ tab: "send" })} className={cn(pmsButtonVariants({ variant: "primary" }), "h-9")} data-testid="send-message-button">
          <Send aria-hidden />
          Send a message
        </Link>
      </div>
      <ProviderNotice mode={home.mode} />

      <section className="flex min-w-0 flex-col rounded-xl border border-border bg-white">
        <nav aria-label="Messages sections" className="flex gap-1 overflow-x-auto border-b border-border px-3">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={hrefFor({ tab: t.key })}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium", focusRing, tab === t.key ? "border-[#0E958A] text-foreground" : "border-transparent text-[#475569] hover:text-foreground")}
              data-testid={`tab-${t.key}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {failed ? (
          <p role="alert" className="p-4 text-destructive-strong">
            {failed}
          </p>
        ) : null}
        {tab === "outbox" && props.outbox ? <Outbox rows={props.outbox} home={home} now={props.now} filter={props.filter} /> : null}
        {tab === "replies" && props.replies ? <Replies rows={props.replies} selected={props.replyId} now={props.now} /> : null}
        {tab === "templates" && props.templates ? <TemplatesEditor {...props.templates} /> : null}
        {tab === "letters" && props.letters ? <LettersList rows={props.letters} canOpen={home.canLetters} showPatient /> : null}
        {tab === "send" && props.send ? (
          <div className="p-4">
            <SendMessageForm view={props.send} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ProviderNotice({ mode }: { mode: MessagesHomeView["mode"] }) {
  if (mode.sms === "misconfigured" || mode.email === "misconfigured") {
    return (
      <PmsNotice tone="error" title="The message service is not set up correctly">
        Nothing is sent until it is fixed. Ask the clinic owner.
      </PmsNotice>
    );
  }
  if (mode.sms === "mailpit" || mode.email === "mailpit") {
    const where = (m: typeof mode.sms) => (m === "mailpit" ? "a local Mailpit inbox on this computer" : m === "test" ? "a test service" : "the outbox (not sent)");
    return (
      <PmsNotice tone="info" title="Local test inbox (Mailpit)">
        Emails go to {where(mode.email)}; texts go to {where(mode.sms)}. Nothing reaches a patient.
      </PmsNotice>
    );
  }
  if (mode.sms === "test" || mode.email === "test") {
    return (
      <PmsNotice tone="info" title="Test mode">
        Messages go to a test service and never reach a patient.
      </PmsNotice>
    );
  }
  return (
    <PmsNotice tone="warning" title="Outbox only">
      Messages are written and kept here. Nothing is sent to patients until the clinic&apos;s text and email service is switched on.
    </PmsNotice>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Outbox
 * ----------------------------------------------------------------------------------------------*/

function Outbox({ rows, home, now, filter }: { rows: OutboxRowView[]; home: MessagesHomeView; now: string; filter: OutboxFilterKey }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [view, setView] = React.useState<{ row: OutboxRowView; subject: string | null; body: string; to: string | null } | null>(null);
  const c = home.counts;

  async function retry(r: OutboxRowView) {
    if (!r.messageId) return;
    setBusy(`retry:${r.id}`);
    const res = await retryMessageAction(r.messageId);
    setBusy(null);
    if (!res.ok) toast.error(res.error);
    else toast.success(res.sent.status === "failed" ? "Tried again – it failed again." : "Sent again.");
    router.refresh();
  }
  async function open(r: OutboxRowView) {
    if (!r.messageId) return;
    setBusy(`view:${r.id}`);
    const res = await loadMessageAction(r.messageId);
    setBusy(null);
    if (!res.ok) toast.error(res.error);
    else setView({ row: r, subject: res.subject, body: res.body, to: res.to });
  }
  async function runNow() {
    setBusy("run");
    const res = await runDueNowAction();
    setBusy(null);
    if (!res.ok) toast.error(res.error);
    else toast.success(res.message);
    router.refresh();
  }

  const columns: DataTableColumn<OutboxRowView>[] = [
    { id: "when", header: "When", cell: (r) => <span className="whitespace-nowrap">{whenLabel(r.at, now)}</span> },
    {
      id: "to",
      header: "To",
      cell: (r) => (
        <span className="flex flex-col">
          {r.patientId ? (
            <Link href={`/app/clinic/patients/${r.patientId}/messages`} className={cn("font-medium text-primary-strong underline underline-offset-2", focusRing)}>
              {r.patientName ?? "Patient"}
            </Link>
          ) : (
            <span>{r.address}</span>
          )}
          {r.patientId && r.address ? <span className="text-xs text-[#475569]">{r.address}</span> : null}
        </span>
      ),
    },
    { id: "channel", header: "Channel", cell: (r) => CHANNEL_LABELS[r.channel] },
    { id: "message", header: "Message", cell: (r) => r.summary, truncateAt: 320 },
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <MessageStatusPill state={r.state} />
          {r.why ? <span className="text-xs text-[#475569]">{r.why}</span> : null}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      align: "right",
      cell: (r) => (
        <span className="flex justify-end gap-1.5">
          {r.messageId ? (
            <PmsButton size="sm" variant="ghost" loading={busy === `view:${r.id}`} onClick={() => void open(r)} aria-label={`View the message to ${r.patientName ?? r.address ?? "the recipient"}`}>
              View
            </PmsButton>
          ) : null}
          {r.canRetry ? (
            <PmsButton size="sm" variant="secondary" loading={busy === `retry:${r.id}`} onClick={() => void retry(r)} data-testid="retry-button">
              Retry
            </PmsButton>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-3 text-sm text-[#334155]" data-testid="outbox-today">
        <span>Today:</span>
        <strong className="text-foreground">{c.planned} planned</strong>
        <span aria-hidden>·</span>
        <span>{c.sent} sent</span>
        <span aria-hidden>·</span>
        <span className={c.failed ? "font-semibold text-destructive-strong" : undefined}>{c.failed} failed</span>
        <span aria-hidden>·</span>
        <span>{c.held} held for quiet hours</span>
        <span aria-hidden>·</span>
        <span>{c.optedOut} skipped (opted out)</span>
        {c.outbox ? (
          <>
            <span aria-hidden>·</span>
            <span>{c.outbox} kept in the outbox</span>
          </>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={hrefFor({ filter: f.key })}
              aria-current={filter === f.key ? "true" : undefined}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium",
                focusRing,
                filter === f.key ? "border-[#0F172A] bg-[#0F172A] text-white" : "border-border bg-white text-[#334155] hover:bg-[#F8FAFC]",
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>
        {home.canManage ? (
          <PmsButton className="ml-auto" variant="secondary" size="sm" loading={busy === "run"} onClick={() => void runNow()} data-testid="run-due-now">
            <Settings aria-hidden />
            Send due messages now
          </PmsButton>
        ) : null}
      </div>
      <DataTable
        label="Outbox"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        minWidth={960}
        renderCard={(r) => (
          <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-white p-3" data-testid="outbox-card">
            <span className="flex items-center justify-between gap-2">
              <strong className="text-sm">{r.patientName ?? r.address}</strong>
              <MessageStatusPill state={r.state} />
            </span>
            <span className="text-sm text-foreground">{r.summary}</span>
            <span className="text-xs text-[#475569]">
              {whenLabel(r.at, now)} · {CHANNEL_LABELS[r.channel]}
              {r.why ? ` · ${r.why}` : ""}
            </span>
            {r.canRetry ? (
              <PmsButton size="sm" variant="secondary" className="self-start" loading={busy === `retry:${r.id}`} onClick={() => void retry(r)}>
                Retry
              </PmsButton>
            ) : null}
          </div>
        )}
        empty={<EmptyState title="Nothing here">No messages {filter === "all" ? "in the last two days or planned for the next week" : "with this status"}.</EmptyState>}
      />
      <SideDrawer open={view !== null} onOpenChange={(o) => (o ? null : setView(null))} eyebrow={view ? `${CHANNEL_LABELS[view.row.channel]} to ${view.to ?? ""}` : ""} title={view?.row.summary ?? ""} meta={view ? <MessageStatusPill state={view.row.state} /> : null}>
        {view ? (
          <div className="flex flex-col gap-3 text-sm" data-testid="message-view">
            {view.subject ? (
              <p>
                <span className="text-[#475569]">Subject: </span>
                <strong>{view.subject}</strong>
              </p>
            ) : null}
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-[#F8FAFC] p-3 font-sans text-sm text-foreground">{view.body}</pre>
          </div>
        ) : null}
      </SideDrawer>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Replies
 * ----------------------------------------------------------------------------------------------*/

function Replies({ rows, selected, now }: { rows: ReplyRowView[]; selected: string | null; now: string }) {
  const router = useRouter();
  const toast = useToast();
  const current = selected ?? rows[0]?.id ?? null;
  const [thread, setThread] = React.useState<ReplyThreadView | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [answer, setAnswer] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const inflight = React.useRef<{ id: string; promise: ReturnType<typeof loadThreadAction> } | null>(null);

  React.useEffect(() => {
    let live = true;
    setThread(null);
    setAnswer("");
    setError(null);
    if (!current) return;
    setLoading(true);
    // One request per reply opened (React runs effects twice in development; a second server action started while
    // the first is in flight could leave the thread "Loading…").
    const pending = inflight.current?.id === current ? inflight.current.promise : loadThreadAction(current);
    inflight.current = { id: current, promise: pending };
    void pending.then((r) => {
      if (inflight.current?.promise === pending) inflight.current = null;
      if (!live) return;
      setLoading(false);
      if (r.ok) setThread(r.thread);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [current]);

  async function send() {
    if (!current) return;
    setBusy("send");
    setError(null);
    const r = await answerReplyAction(current, answer);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast.success(r.sent.label);
    setAnswer("");
    router.refresh();
    const t = await loadThreadAction(current);
    if (t.ok) setThread(t.thread);
  }
  async function done() {
    if (!current) return;
    setBusy("done");
    const r = await markReplyDoneAction(current);
    setBusy(null);
    if (!r.ok) toast.error(r.error);
    else toast.success("Marked as dealt with.");
    router.refresh();
    const t = await loadThreadAction(current);
    if (t.ok) setThread(t.thread);
  }

  if (rows.length === 0) return <EmptyState title="No replies">Replies to the clinic&apos;s texts show here.</EmptyState>;
  return (
    <div className="grid min-w-0 grid-cols-1 md:grid-cols-[320px_1fr]">
      <ul className="flex flex-col border-b border-border md:border-b-0 md:border-r" aria-label="Replies" data-testid="replies-list">
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              href={hrefFor({ tab: "replies", reply: r.id })}
              aria-current={r.id === current ? "true" : undefined}
              className={cn("flex flex-col gap-0.5 border-b border-border px-4 py-3 text-sm", focusRing, r.id === current ? "bg-[#F0FDFA]" : "bg-white hover:bg-[#F8FAFC]")}
            >
              <span className="flex items-center justify-between gap-2">
                <strong className={r.toAction ? "font-bold" : "font-medium"}>{r.patientName ?? r.from ?? "Unknown number"}</strong>
                <span className="text-xs text-[#475569]">{whenLabel(r.at, now)}</span>
              </span>
              <span className="flex items-center gap-2 text-[#475569]">
                {r.intent ? INTENT_LABELS[r.intent] : "Reply"}
                {r.toAction ? <span className="rounded-full bg-[#FEF3C7] px-2 text-xs font-semibold text-[#864E0E]">To answer</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex min-w-0 flex-col gap-3 p-4" data-testid="reply-thread">
        {loading ? <p className="text-sm text-[#475569]">Loading…</p> : null}
        {thread ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{thread.reply.patientName ?? thread.reply.from ?? "Unknown number"}</strong>
              {thread.reply.patientId ? (
                <Link href={`/app/clinic/patients/${thread.reply.patientId}`} className={cn("text-sm text-primary-strong underline underline-offset-2", focusRing)}>
                  Open record
                </Link>
              ) : null}
            </div>
            <ol className="flex flex-col gap-2">
              {thread.messages.map((m) => (
                <li key={m.id} className={cn("flex max-w-[85%] flex-col gap-1", m.direction === "inbound" ? "self-start" : "self-end items-end")}>
                  <span className={cn("whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm", m.direction === "inbound" ? "bg-[#F1F5F9] text-foreground" : "bg-[#0B7970] text-white")}>{m.text}</span>
                  <span className="text-xs text-[#475569]">
                    {m.label} · {whenLabel(m.at, now)}
                  </span>
                </li>
              ))}
            </ol>
            {thread.answerChannel ? (
              <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-end">
                <FormField id="rp" label={thread.answerChannel === "sms" ? "Reply by text" : "Reply by email (the patient has no texts)"} className="min-w-0 flex-1" error={error}>
                  <TextArea rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={918} />
                </FormField>
                <div className="flex gap-2">
                  {thread.reply.toAction ? (
                    <PmsButton variant="secondary" loading={busy === "done"} onClick={() => void done()} data-testid="reply-done">
                      Mark as dealt with
                    </PmsButton>
                  ) : null}
                  <PmsButton loading={busy === "send"} disabled={!answer.trim()} onClick={() => void send()} data-testid="reply-send">
                    Send
                  </PmsButton>
                </div>
              </div>
            ) : (
              <PmsNotice tone="info" title="The patient cannot be answered here">
                {thread.answerBlockedWhy}
              </PmsNotice>
            )}
          </>
        ) : !loading && error ? (
          <p role="alert" className="text-destructive-strong">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
