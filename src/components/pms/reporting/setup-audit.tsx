"use client";
/** Set-up → Audit trail: filters (dates, area, action, person, record type, record id), the entries, paging, CSV. */
import * as React from "react";
import Link from "next/link";
import { FormField, PmsButton, SelectInput, TextInput } from "@/components/pms/ui";
import type { AuditSearchParams } from "@/modules/pms/reporting/schemas";
import type { AuditScreen } from "@/modules/pms/reporting/setup-view";
import { SetupCard, SetupGrid, SetupHeader, SetupPage, setupFocus } from "./setup-kit";

const PATH = "/app/clinic/setup/audit";

function query(p: Partial<Record<string, string | null>>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function AuditTrail({ screen, params }: { screen: AuditScreen; params: AuditSearchParams }) {
  const base = { from: params.from, to: params.to, area: params.area, action: params.action, user: params.userId, type: params.targetType, record: params.targetId };
  return (
    <SetupPage>
      <SetupHeader
        title="Audit trail"
        description="Every change in the clinic system: who, what and when. Entries hold ids and codes, never patient details."
        action={
          screen.canExport ? (
            <a href={`${PATH}/export${query(base)}`} className={`inline-flex h-9 items-center rounded-[8px] border border-border bg-white px-3.5 text-sm font-medium hover:bg-[#F8FAFC] ${setupFocus}`} data-testid="audit-export">
              Export CSV
            </a>
          ) : null
        }
      />
      <SetupCard>
        <form method="get" action={PATH} className="flex flex-col gap-3" role="search" aria-label="Search the audit trail">
          <SetupGrid>
            <FormField id="au-from" label="From">
              <TextInput type="date" name="from" defaultValue={params.from ?? ""} />
            </FormField>
            <FormField id="au-to" label="To">
              <TextInput type="date" name="to" defaultValue={params.to ?? ""} />
            </FormField>
            <FormField id="au-area" label="Area">
              <SelectInput name="area" defaultValue={params.area ?? ""}>
                <option value="">Everything</option>
                {screen.areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField id="au-user" label="Person">
              <SelectInput name="user" defaultValue={params.userId ?? ""}>
                <option value="">Anyone</option>
                {screen.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField id="au-type" label="Record type">
              <SelectInput name="type" defaultValue={params.targetType ?? ""}>
                <option value="">Any</option>
                {screen.types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField id="au-record" label="Record id (e.g. a patient's)">
              <TextInput name="record" defaultValue={params.targetId ?? ""} />
            </FormField>
          </SetupGrid>
          <div className="flex justify-end gap-2">
            <Link href={PATH} className={`inline-flex h-9 items-center rounded-[8px] px-3 text-sm font-medium hover:bg-[#F1F5F9] ${setupFocus}`}>
              Clear
            </Link>
            <PmsButton type="submit" data-testid="audit-search">
              Search
            </PmsButton>
          </div>
        </form>
      </SetupCard>
      <div className="overflow-x-auto rounded-2xl border border-border bg-white">
        <table className="w-full min-w-[760px] border-collapse text-sm" data-testid="audit-rows">
          <caption className="sr-only">Audit entries, newest first</caption>
          <thead>
            <tr className="bg-[#F8FAFC] text-left text-xs font-semibold text-[#475569]">
              <th scope="col" className="px-4 py-2.5">When</th>
              <th scope="col" className="px-4 py-2.5">Who</th>
              <th scope="col" className="px-4 py-2.5">What</th>
              <th scope="col" className="px-4 py-2.5">Record</th>
              <th scope="col" className="px-4 py-2.5">Detail</th>
            </tr>
          </thead>
          <tbody>
            {screen.rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-[#475569]">
                  Nothing matches.
                </td>
              </tr>
            ) : null}
            {screen.rows.map((r) => (
              <tr key={r.id} className="border-t border-[#F1F5F9] align-top">
                <td className="whitespace-nowrap px-4 py-2 tabular-nums">{when(r.at)}</td>
                <td className="px-4 py-2">{r.who}</td>
                <td className="px-4 py-2">
                  {r.label}
                  <span className="block font-mono text-xs text-[#475569]">{r.action}</span>
                </td>
                <td className="px-4 py-2">
                  {r.recordType}
                  {r.recordId ? <span className="block break-all font-mono text-xs text-[#475569]">{r.recordId}</span> : null}
                </td>
                <td className="px-4 py-2 text-xs text-[#475569]">{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav aria-label="Pages" className="flex justify-between">
        {screen.hasNewer && screen.rows[0] ? (
          <Link href={`${PATH}${query({ ...base, after: screen.rows[0].id })}`} className={`text-primary-strong underline underline-offset-2 ${setupFocus}`}>
            Newer
          </Link>
        ) : (
          <span />
        )}
        {screen.hasOlder && screen.rows.length ? (
          <Link href={`${PATH}${query({ ...base, before: screen.rows[screen.rows.length - 1].id })}`} className={`text-primary-strong underline underline-offset-2 ${setupFocus}`}>
            Older
          </Link>
        ) : null}
      </nav>
    </SetupPage>
  );
}
