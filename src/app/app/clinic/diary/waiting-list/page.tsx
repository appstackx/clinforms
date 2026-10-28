import type { Metadata } from "next";
import { requireClinicActor } from "@/server/pms/actor";
import { RotaWaitingView } from "../rota-waiting-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Waiting list" };

/**
 * /app/clinic/diary/waiting-list?site=… – the site's waiting list (diary.view; changes need diary.book). Members who
 * may change rotas (diary.manage) see the rota editor beside it, as in the design.
 */
export default async function WaitingListPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "diary.view" });
  return <RotaWaitingView actor={actor} searchParams={searchParams} rota={actor.can("diary.manage")} />;
}
