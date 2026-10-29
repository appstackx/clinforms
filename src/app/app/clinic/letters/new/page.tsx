import { notFound } from "next/navigation";
import { LetterStart } from "@/components/pms/comms/letter-start";
import { requireClinicActor } from "@/server/pms/actor";
import { letterStartFor } from "@/server/pms/comms/views";
import { gatedMetadata } from "@/server/pms/page-gate";

export const dynamic = "force-dynamic";
export const generateMetadata = gatedMetadata({ title: "New letter" }, "messages.letters");

/** /app/clinic/letters/new?patient=<id> – choose a template, case and recipient. messages.letters (never reception). */
export default async function NewLetterPage({ searchParams }: { searchParams: { patient?: string } }) {
  const actor = await requireClinicActor({ permission: "messages.letters" });
  const r = await letterStartFor(actor, searchParams.patient ?? "");
  if (!r.ok) notFound();
  return <LetterStart view={r.value} />;
}
