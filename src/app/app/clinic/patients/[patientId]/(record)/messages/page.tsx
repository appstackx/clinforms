import type { Metadata } from "next";
import { PatientMessages } from "@/components/pms/comms/patient-messages";
import { requireClinicActor } from "@/server/pms/actor";
import { patientMessagesFor, sendFormFor } from "@/server/pms/comms/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Messages" };

/**
 * A patient's record → Messages (comms' tab): preferences, Send a message (?send=1 opens it – the record's "Send
 * message" button), messages and planned ones, letters (titles; opened with messages.letters), preference changes.
 * messages.send.
 */
export default async function PatientMessagesPage({ params, searchParams }: { params: { patientId: string }; searchParams: { send?: string } }) {
  const actor = await requireClinicActor({ permission: "messages.send" });
  const [r, send] = await Promise.all([patientMessagesFor(actor, params.patientId), sendFormFor(actor, params.patientId)]);
  if (!r.ok) return <p role="alert">{r.error}</p>;
  return <PatientMessages view={r.value} send={send.ok ? send.value : null} openSend={searchParams.send === "1"} />;
}
