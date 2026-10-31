import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DiaryScreen } from "@/components/pms/diary/diary-screen";
import { SITE_COOKIE } from "@/components/pms/shell/site-cookie";
import { ukToday } from "@/modules/pms/core/text";
import { parseDiaryParams } from "@/modules/pms/diary/view";
import { currentPractitionerId, requireClinicActor } from "@/server/pms/actor";
import { diaryCallerOf } from "@/server/pms/diary/caller";
import { loadDiaryView } from "@/server/pms/diary/view";
import { unsignedNotesFor } from "@/server/pms/records/notes-service";
import { listReferrers } from "@/server/repos/pms/referrers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Diary" };

/**
 * /app/clinic/diary – the diary (design round 2): ?date=YYYY-MM-DD&view=day|week&by=practitioner|room&site=…
 * &resource=…&cancelled=1&focus=…&book=<waiting-list entry>. The site comes from the address, else the shell's
 * site switcher (its cookie), else the member's practitioner's site, else the first site. diary.view.
 */
export default async function DiaryPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "diary.view" });
  const today = ukToday();
  const cookieSite = cookies().get(SITE_COOKIE)?.value ?? null;
  const params = parseDiaryParams(searchParams, today);
  if (!params.siteId && cookieSite && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(cookieSite)) params.siteId = cookieSite;
  const caller = await diaryCallerOf(actor);
  const practitionerId = await currentPractitionerId(actor);
  const view = await loadDiaryView(caller, params, today, { practitionerId });
  if (!view.ok) {
    return <p role="alert" className="text-destructive-strong">{view.error}</p>;
  }
  const ctx = actor.repo();
  const [payers, unsigned] = await Promise.all([
    actor.can("patients.edit") ? listReferrers(ctx, actor.tenantId, { kind: ["insurer", "mlc", "solicitor", "employer"] }) : Promise.resolve([]),
    actor.can("clinical.view") ? unsignedNotesFor(actor, { scope: "mine", limit: 100 }) : Promise.resolve(null),
  ]);
  return (
    <DiaryScreen
      data={view.data}
      cookieSite={cookieSite}
      can={{ book: actor.can("diary.book"), rota: actor.can("diary.rota"), override: actor.can("diary.override"), patientsEdit: actor.can("patients.edit"), clinical: actor.can("clinical.write"), pay: actor.can("billing.pay"), message: actor.can("messages.send") }}
      payers={payers.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, kind: p.kind }))}
      unsignedNotes={unsigned && unsigned.ok ? { count: unsigned.value.notes.length, href: null } : null}
    />
  );
}
