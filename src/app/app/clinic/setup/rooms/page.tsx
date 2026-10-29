import type { Metadata } from "next";
import { RoomsSetup } from "@/components/pms/reporting/setup-pages";
import { requireClinicActor } from "@/server/pms/actor";
import { roomsScreenFor } from "@/server/pms/reporting/setup";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rooms" };

/** /app/clinic/setup/rooms[?site=&room=] – Set-up → Rooms (settings.setup; the member's sites only). */
export default async function RoomsSetupPage({ searchParams }: { searchParams: { site?: string; room?: string } }) {
  const actor = await requireClinicActor({ permission: "settings.setup" });
  const r = await roomsScreenFor(actor);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <RoomsSetup sites={r.value.sites} rooms={r.value.rooms} siteId={searchParams.site ?? null} roomId={searchParams.room ?? null} />;
}
