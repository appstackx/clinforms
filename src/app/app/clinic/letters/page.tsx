import { redirect } from "next/navigation";
import { requireClinicActor } from "@/server/pms/actor";

/** /app/clinic/letters – the letters list lives on Messages → Letters. */
export default async function LettersIndex() {
  await requireClinicActor({ permission: "messages.send" });
  redirect("/app/clinic/messages?tab=letters");
}
