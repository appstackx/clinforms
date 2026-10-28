import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/pms/billing/print-toolbar";
import { LETTERS_PATH } from "@/components/pms/comms/format";
import { LETTER_PRINT_CSS, LetterSheet } from "@/components/pms/comms/letter-sheet";
import { requireClinicActor } from "@/server/pms/actor";
import { letterFor } from "@/server/pms/comms/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Print letter" };

/** /app/clinic/letters/[letterId]/print – the A4 letter; only it prints ("Save as PDF" for a PDF). messages.letters. */
export default async function PrintLetterPage({ params }: { params: { letterId: string } }) {
  const actor = await requireClinicActor({ permission: "messages.letters" });
  const r = await letterFor(actor, params.letterId);
  if (!r.ok) notFound();
  const { letter: l, clinic } = r.value;
  return (
    <div className="flex flex-col gap-4">
      <style>{LETTER_PRINT_CSS}</style>
      <PrintToolbar backHref={`${LETTERS_PATH}/${l.id}`} backLabel="Back to the letter" />
      <div className="letter-print-root overflow-x-auto">
        <LetterSheet
          clinic={clinic}
          letterOn={l.letterOn}
          recipient={{ name: l.recipientName, address: l.recipientAddress, postcode: l.recipientPostcode }}
          subject={l.subject}
          body={l.body}
          signature={l.signatureText}
          draft={l.status === "draft"}
          withdrawn={l.status === "void"}
        />
      </div>
    </div>
  );
}
