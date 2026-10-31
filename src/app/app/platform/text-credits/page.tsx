import { randomBytes } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark, Notice, PageHeader, Panel } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { CREDIT_ENTRY_LABELS, smsPack } from "@/modules/pms/comms/credits";
import { formatPence } from "@/modules/pms/core/text";
import { requirePlatformAdmin } from "@/server/admin/guards";
import { listClinicsOverview } from "@/server/admin/platform-console";
import { clinicCreditHistory, listTextCreditsForPlatform } from "@/server/admin/text-credits";
import { getDb } from "@/server/db";
import { SignOutForm } from "../../session-forms";
import { AdjustCreditsForm } from "./forms";

/**
 * /app/platform/text-credits – ClinForms staff only (as /app/platform: everyone else gets the ordinary 404). Every
 * open clinic's prepaid text credits (balance, last pack, automatic top-up, saved card), one clinic's history with
 * the ledger check (sum of entries = balance), and the support adjustment (+/− with a reason, audited).
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Text credits – Platform" };

const TH = "px-3 py-2 text-left align-bottom text-xs font-semibold uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2 align-top text-sm text-slate-800";
const NUM = `${TD} whitespace-nowrap text-right tabular-nums`;
const UK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function PlatformTextCreditsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const admin = await requirePlatformAdmin();
  const db = getDb();
  const clinics = (await listClinicsOverview(db)).filter((c) => !c.offboardedAt).map((c) => ({ tenantId: c.tenantId, name: c.name }));
  const list = await listTextCreditsForPlatform(db, clinics);
  const raw = searchParams.clinic;
  const chosenId = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const chosen = clinics.find((c) => c.tenantId === chosenId) ?? null;
  const history = chosen && list.available ? await clinicCreditHistory(db, chosen.tenantId) : null;
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[100rem] items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <BrandMark compact />
            <span className="hidden text-slate-300 sm:inline" aria-hidden>
              /
            </span>
            <Link href="/app/platform" className="truncate text-sm font-medium text-slate-800 underline-offset-4 hover:underline">
              Platform
            </Link>
            <span className="text-slate-300" aria-hidden>
              /
            </span>
            <span className="truncate text-sm font-medium text-slate-800">Text credits</span>
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">ClinForms staff</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-slate-600 md:inline">{admin.email}</span>
            <SignOutForm>
              <SubmitButton variant="secondary" className="h-8 px-3 text-xs" pendingText="Signing out…">
                Sign out
              </SubmitButton>
            </SignOutForm>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[100rem] px-4 py-8">
        <PageHeader
          title="Text credits"
          description="Prepaid texts of the clinic system: 1 credit = 1 text segment. Clinics buy packs by card payment; nothing is sent on credit. An adjustment adds or takes off credits with a reason (goodwill, a refund made by hand, a correction) and is recorded in the clinic's activity and here."
        />
        {!list.available ? (
          <div className="mb-6">
            <Notice tone="warning">The text credit tables are not on this database yet (migration 0143). Nothing can be bought or adjusted until it is applied.</Notice>
          </div>
        ) : null}

        <Panel title={`Clinics (${list.rows.length})`} className="mb-6">
          <div className="-mx-3 overflow-x-auto">
            <table className="w-full min-w-[720px]" data-testid="platform-credit-clinics">
              <thead>
                <tr className="border-b border-slate-200">
                  <th scope="col" className={TH}>
                    Clinic
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Balance
                  </th>
                  <th scope="col" className={TH}>
                    Last pack
                  </th>
                  <th scope="col" className={TH}>
                    Automatic top-up
                  </th>
                  <th scope="col" className={TH}>
                    Saved card
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => {
                  const a = r.account;
                  const pack = a ? smsPack(a.autoTopupPack) : null;
                  return (
                    <tr key={r.tenantId} className="border-b border-slate-100 last:border-0">
                      <td className={TD}>
                        <Link href={`/app/platform/text-credits?clinic=${encodeURIComponent(r.tenantId)}`} className="font-medium text-teal-700 underline-offset-4 hover:underline">
                          {r.name}
                        </Link>
                        <span className="block text-xs text-slate-500">{r.tenantId}</span>
                      </td>
                      <td className={NUM}>{a ? a.balance.toLocaleString("en-GB") : "0"}</td>
                      <td className={TD}>{a?.lastPackCredits ? `${a.lastPackCredits.toLocaleString("en-GB")} credits` : "–"}</td>
                      <td className={TD}>{a?.autoTopup ? `${a.autoTopupPausedAt ? "Paused (payment failed)" : "On"} · below ${a.autoTopupThreshold} → ${pack ? pack.credits.toLocaleString("en-GB") : "?"}` : "Off"}</td>
                      <td className={TD}>{a?.card ? `${a.card.brand.toUpperCase()} …${a.card.last4}` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        {chosen && history ? (
          <Panel title={`${chosen.name} – history`}>
            <p className="mb-3 text-sm text-slate-700" data-testid="ledger-check">
              Ledger check: {history.check.ok ? "consistent" : "NOT consistent – investigate"} (balance {history.check.balance.toLocaleString("en-GB")}, sum of {history.check.entries} entries{" "}
              {history.check.ledgerSum.toLocaleString("en-GB")}).
            </p>
            <div className="mb-6">
              <AdjustCreditsForm tenantId={chosen.tenantId} clinicName={chosen.name} requestId={randomBytes(16).toString("base64url")} />
            </div>
            <div className="-mx-3 overflow-x-auto">
              <table className="w-full min-w-[720px]" data-testid="platform-credit-history">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th scope="col" className={TH}>
                      When
                    </th>
                    <th scope="col" className={TH}>
                      What
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Credits
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Balance
                    </th>
                    <th scope="col" className={TH}>
                      Reference
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.entries.map((e) => (
                    <tr key={e.id} className="border-b border-slate-100 last:border-0">
                      <td className={`${TD} whitespace-nowrap tabular-nums`}>{UK.format(new Date(e.createdAt)).replace(",", "")}</td>
                      <td className={TD}>
                        {CREDIT_ENTRY_LABELS[e.kind]}
                        {e.reason ? <span className="block text-xs text-slate-500">{e.reason}</span> : null}
                        {e.amountPence !== null ? <span className="block text-xs text-slate-500">{formatPence(e.amountPence)}</span> : null}
                      </td>
                      <td className={NUM}>{e.credits > 0 ? `+${e.credits.toLocaleString("en-GB")}` : e.credits.toLocaleString("en-GB")}</td>
                      <td className={NUM}>{e.balanceAfter.toLocaleString("en-GB")}</td>
                      <td className={`${TD} text-xs text-slate-500`}>{e.paymentRef ?? e.messageId ?? e.reversesId ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : (
          <p className="text-sm text-slate-600">Choose a clinic to see its history and adjust its credits.</p>
        )}
      </main>
    </>
  );
}
