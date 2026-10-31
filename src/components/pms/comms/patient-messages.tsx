"use client";
/**
 * A patient's record → Messages (comms' tab): how the patient can be reached (texts, emails, marketing – with the
 * reason when not), "Send a message" (the record's button opens it: ?send=1), every message to and from them and the
 * planned ones, letters (titles; opening needs messages.letters), and how their preferences changed (PECR evidence).
 */
import Link from "next/link";
import * as React from "react";
import { Send } from "lucide-react";
import type { PatientMessagesView, SendFormView } from "@/modules/pms/comms/view";
import { CHANNEL_LABELS } from "@/modules/pms/comms/copy";
import { cn } from "@/lib/utils";
import { DataTable, EmptyState, PmsButton, type DataTableColumn } from "@/components/pms/ui";
import type { OutboxRowView } from "@/modules/pms/comms/view";
import { formatUkDateTime } from "@/modules/pms/comms/schedule";
import { LettersList } from "./letters-list";
import { MessageStatusPill } from "./message-status";
import { SendMessageForm } from "./send-form";
import { focusRing } from "./format";

function Reach({ label, why }: { label: string; why: string | null }) {
  return (
    <li className="flex flex-col rounded-lg border border-border px-3 py-2 text-sm">
      <span className="font-medium">{label}</span>
      <span className={cn("text-xs", why ? "text-[#864E0E]" : "text-[#166534]")}>{why ?? "Yes"}</span>
    </li>
  );
}

export function PatientMessages({ view, send, openSend }: { view: PatientMessagesView; send: SendFormView | null; openSend: boolean }) {
  const [sending, setSending] = React.useState(openSend);
  const p = view.patient;
  const columns: DataTableColumn<OutboxRowView>[] = [
    { id: "when", header: "When", cell: (r) => <span className="whitespace-nowrap tabular-nums">{formatUkDateTime(r.at)}</span> },
    { id: "ch", header: "Channel", cell: (r) => CHANNEL_LABELS[r.channel] },
    { id: "what", header: "Message", cell: (r) => r.summary },
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <MessageStatusPill state={r.state} label={r.summary.startsWith("Reply") ? "Received" : undefined} />
          {r.why ? <span className="text-xs text-[#475569]">{r.why}</span> : null}
        </span>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-4" data-testid="patient-messages">
      <section aria-labelledby="pm-reach" className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="pm-reach" className="text-base font-semibold">
            How {p.name} hears from the clinic
          </h2>
          {view.canSend && send ? (
            <PmsButton variant={sending ? "secondary" : "primary"} onClick={() => setSending((x) => !x)} aria-expanded={sending} data-testid="record-send-message">
              <Send aria-hidden />
              {sending ? "Close" : "Send a message"}
            </PmsButton>
          ) : null}
        </div>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-4" aria-label="Message preferences">
          <Reach label={`Texts${p.mobile ? ` (${p.mobile})` : ""}`} why={p.sms} />
          <Reach label={`Emails${p.email ? ` (${p.email})` : ""}`} why={p.emailService} />
          <Reach label="Marketing texts" why={p.smsMarketing} />
          <Reach label="Marketing emails" why={p.emailMarketing} />
        </ul>
        {sending && send ? (
          <div className="border-t border-border pt-3">
            <SendMessageForm view={send} onSent={() => setSending(false)} />
          </div>
        ) : null}
      </section>
      <section aria-labelledby="pm-log" className="flex flex-col gap-2">
        <h2 id="pm-log" className="text-base font-semibold">
          Messages
        </h2>
        <DataTable
          label="Messages to and from the patient"
          columns={columns}
          rows={view.rows}
          rowKey={(r) => r.id}
          minWidth={720}
          renderCard={(r) => (
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-white p-3 text-sm">
              <span className="flex justify-between gap-2">
                <strong>{r.summary}</strong>
                <MessageStatusPill state={r.state} />
              </span>
              <span className="text-xs text-[#475569]">
                {formatUkDateTime(r.at)} · {CHANNEL_LABELS[r.channel]}
                {r.why ? ` · ${r.why}` : ""}
              </span>
            </div>
          )}
          empty={<EmptyState title="No messages yet" />}
        />
      </section>
      <section aria-labelledby="pm-letters" className="flex flex-col gap-2 rounded-xl border border-border bg-white">
        <h2 id="pm-letters" className="px-4 pt-4 text-base font-semibold">
          Letters
        </h2>
        <LettersList rows={view.letters} canOpen={view.canLetters} patientId={view.canLetters ? p.id : undefined} />
      </section>
      {view.consent.length ? (
        <section aria-labelledby="pm-consent" className="flex flex-col gap-2 rounded-xl border border-border bg-white p-4">
          <h2 id="pm-consent" className="text-base font-semibold">
            Changes to message preferences
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {view.consent.map((c, i) => (
              <li key={i}>
                <span className="tabular-nums text-[#475569]">{formatUkDateTime(c.at)}</span> · {c.label}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Link href="/app/clinic/messages" className={cn("self-start text-sm text-primary-strong underline underline-offset-2", focusRing)}>
        All messages
      </Link>
    </div>
  );
}
