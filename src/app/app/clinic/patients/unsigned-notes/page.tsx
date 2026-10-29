import type { Metadata } from "next";
import Link from "next/link";
import { Clock } from "lucide-react";
import { dayLabel, personName } from "@/components/pms/records/format";
import { Card } from "@/components/pms/records/ui";
import { EmptyState } from "@/components/pms/ui";
import { cn } from "@/lib/utils";
import { overdueWindowLabel, signWithinText } from "@/modules/pms/records/settings";
import { ukToday } from "@/modules/pms/core/text";
import { requireClinicActor } from "@/server/pms/actor";
import { unsignedNotesFor } from "@/server/pms/records/notes-service";
import { patientPath } from "@/server/pms/records/record";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsigned notes" };

/**
 * /app/clinic/patients/unsigned-notes – unsigned notes (K2-NOTE-008, design round 2): a clinician's own drafts, oldest
 * consultation first, the overdue ones marked ("Over 24 h" – the clinic's record-keeping setting). Owners and
 * administrators (settings.setup) can switch to every author's, with a count per clinician. clinical.view.
 */
export default async function UnsignedNotesPage({ searchParams }: { searchParams: { scope?: string } }) {
  const actor = await requireClinicActor({ permission: "clinical.view" });
  const canAll = actor.can("settings.setup");
  const scope = canAll && searchParams.scope === "all" ? "all" : "mine";
  const result = await unsignedNotesFor(actor, { scope });
  const today = ukToday();
  const tab = (value: "mine" | "all", label: string) => (
    <Link
      href={value === "all" ? "?scope=all" : "?"}
      aria-current={scope === value ? "page" : undefined}
      className={cn(
        "-mb-px inline-flex h-11 items-center border-b-2 px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
        scope === value ? "border-primary text-foreground" : "border-transparent text-[#475569] hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Unsigned notes</h1>
        <p className="text-sm text-[#475569]">Oldest first. {result.ok ? signWithinText(result.value.days) : ""}</p>
      </div>
      {canAll ? (
        <nav aria-label="Whose notes" className="flex gap-1 border-b border-border">
          {tab("mine", "Mine")}
          {tab("all", "Every clinician")}
        </nav>
      ) : null}
      {!result.ok ? (
        <Card>
          <p role="alert" className="text-sm text-destructive-strong">
            {result.error}
          </p>
        </Card>
      ) : (
        <>
          {scope === "all" && result.value.counts.length ? (
            <Card title="By clinician">
              <ul className="flex flex-col">
                {result.value.counts.map((c) => (
                  <li key={c.authorUserId ?? "none"} className="flex items-center justify-between gap-3 border-t border-border py-2 text-sm first:border-t-0">
                    <span>{c.authorName ?? "A former member"}</span>
                    <span className="tabular-nums text-[#334155]">
                      {c.drafts} unsigned{c.overdue ? <strong className="ml-2 font-semibold text-[#991B1B]">{c.overdue} over {overdueWindowLabel(result.value.days)}</strong> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {result.value.notes.length === 0 ? (
            <EmptyState title="Nothing to sign">Every note is signed.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Unsigned notes">
              {result.value.notes.map((n) => (
                <li key={n.id}>
                  <Link
                    href={patientPath(n.patientId, `notes/${n.id}`)}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-white px-4 py-3 text-sm hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <strong className="font-semibold text-foreground">{n.patient ? personName(n.patient) : "Patient"}</strong>
                    <span className="text-[#334155]">
                      {dayLabel(n.seenOn, today)} · {n.templateName}
                      {scope === "all" && n.authorName ? ` · ${n.authorName}` : ""}
                    </span>
                    {n.overdue ? (
                      <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#FEE2E2] px-2 text-xs font-semibold leading-6 text-[#991B1B]">
                        <Clock className="h-3 w-3" aria-hidden />
                        Over {overdueWindowLabel(result.value.days)}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
