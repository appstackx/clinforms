import type { Metadata } from "next";
import { requireClinicActor } from "@/server/pms/actor";
import { RotaWaitingView } from "../rota-waiting-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rota and waiting list" };

/** /app/clinic/diary/rotas?practitioner=…&from=YYYY-MM-DD&site=… – the rota editor and the waiting list. diary.rota. */
export default async function RotasPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "diary.rota" });
  return <RotaWaitingView actor={actor} searchParams={searchParams} rota />;
}
