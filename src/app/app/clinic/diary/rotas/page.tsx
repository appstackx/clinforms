import { requireClinicActor } from "@/server/pms/actor";
import { RotaWaitingView } from "../rota-waiting-view";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "Rota and waiting list" }, "diary.rota");

/** /app/clinic/diary/rotas?practitioner=…&from=YYYY-MM-DD&site=… – the rota editor and the waiting list. diary.rota. */
export default async function RotasPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const actor = await requireClinicActor({ permission: "diary.rota" });
  return <RotaWaitingView actor={actor} searchParams={searchParams} rota />;
}
