"use client";
/**
 * Letters (Messages → Letters, the record's Messages tab): title (the template's name), patient, recipient, date,
 * status. Opening and writing letters needs messages.letters – reception sees titles, not content (design round 2c:
 * "Clinical letters can be created by clinicians only. Reception sees letter titles, not content").
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Info, Lock, Plus } from "lucide-react";
import type { LetterRowView } from "@/modules/pms/comms/view";
import { LETTER_STATUS_LABELS, SENT_VIA_LABELS } from "@/modules/pms/comms/copy";
import { formatUkDate } from "@/modules/pms/core/text";
import { cn } from "@/lib/utils";
import { DataTable, EmptyState, pmsButtonVariants, type DataTableColumn } from "@/components/pms/ui";
import { LETTERS_PATH, focusRing } from "./format";
import { PatientPicker } from "./send-form";

function statusText(r: LetterRowView): string {
  if (r.status === "final" && r.sentVia) return `Signed · sent ${SENT_VIA_LABELS[r.sentVia as keyof typeof SENT_VIA_LABELS]?.toLowerCase() ?? ""}`;
  return r.status === "final" ? "Signed" : LETTER_STATUS_LABELS[r.status];
}

export function LettersList({ rows, canOpen, showPatient, patientId }: { rows: LetterRowView[]; canOpen: boolean; showPatient?: boolean; patientId?: string }) {
  const router = useRouter();
  const [picking, setPicking] = React.useState(false);
  const columns: DataTableColumn<LetterRowView>[] = [
    {
      id: "title",
      header: "Letter",
      cell: (r) =>
        canOpen ? (
          <Link href={`${LETTERS_PATH}/${r.id}`} className={cn("font-medium text-primary-strong underline underline-offset-2", focusRing)}>
            {r.title}
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-[#64748B]" aria-label="Content hidden" />
            {r.title}
          </span>
        ),
    },
    ...(showPatient ? [{ id: "patient", header: "Patient", cell: (r: LetterRowView) => r.patientName } satisfies DataTableColumn<LetterRowView>] : []),
    { id: "to", header: "To", cell: (r) => r.recipientName ?? "–" },
    { id: "on", header: "Date", cell: (r) => formatUkDate(r.letterOn), numeric: true },
    { id: "author", header: "Author", cell: (r) => r.authorName ?? "–" },
    { id: "status", header: "Status", cell: (r) => statusText(r) },
  ];
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="letters-list">
      {canOpen ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-sm text-[#475569]">Letters to GPs, insurers, solicitors and patients – from the clinic&apos;s templates, signed with your signing details.</p>
          {patientId ? (
            <Link href={`${LETTERS_PATH}/new?patient=${patientId}`} className={pmsButtonVariants({ variant: "primary" })} data-testid="write-letter">
              <Plus aria-hidden />
              Write a letter
            </Link>
          ) : (
            <button type="button" className={pmsButtonVariants({ variant: "primary" })} onClick={() => setPicking((x) => !x)} data-testid="write-letter">
              <Plus aria-hidden />
              Write a letter
            </button>
          )}
        </div>
      ) : (
        <div role="note" className="flex items-start gap-2 rounded-lg bg-[#EFF4FF] px-3 py-2 text-sm text-[#1842B4]">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Clinical letters can be created by clinicians only. Reception sees letter titles, not content.
        </div>
      )}
      {picking ? (
        <div className="max-w-xl">
          <PatientPicker id="letter-patient" label="Patient" onPick={(h) => router.push(`${LETTERS_PATH}/new?patient=${h.id}`)} />
        </div>
      ) : null}
      <DataTable
        label="Letters"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        minWidth={760}
        renderCard={(r) => (
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-white p-3 text-sm">
            {canOpen ? (
              <Link href={`${LETTERS_PATH}/${r.id}`} className={cn("font-semibold text-primary-strong underline", focusRing)}>
                {r.title}
              </Link>
            ) : (
              <strong>{r.title}</strong>
            )}
            <span className="text-[#475569]">
              {[showPatient ? r.patientName : null, r.recipientName, formatUkDate(r.letterOn), statusText(r)].filter(Boolean).join(" · ")}
            </span>
          </div>
        )}
        empty={<EmptyState title="No letters yet" />}
      />
    </div>
  );
}
