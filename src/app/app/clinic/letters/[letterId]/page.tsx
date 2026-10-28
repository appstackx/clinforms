import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LetterEditor } from "@/components/pms/comms/letter-editor";
import { requireClinicActor } from "@/server/pms/actor";
import { letterFor } from "@/server/pms/comms/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Letter" };

/** /app/clinic/letters/[letterId] (design round 3, "Letter editor"). messages.letters – reception gets the 404 page. */
export default async function LetterPage({ params }: { params: { letterId: string } }) {
  const actor = await requireClinicActor({ permission: "messages.letters" });
  const r = await letterFor(actor, params.letterId);
  if (!r.ok) notFound();
  return <LetterEditor view={r.value} />;
}
