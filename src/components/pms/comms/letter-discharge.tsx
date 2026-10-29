"use client";
/**
 * "Write discharge letter" on a signed discharge note (K2-LTR-006): starts the letter to the GP filled from the note
 * and its case's outcome scores, then opens the letter editor. Shown only to members who may create clinical letters.
 */
import { useRouter } from "next/navigation";
import * as React from "react";
import { FileText } from "lucide-react";
import { PmsButton } from "@/components/pms/ui";
import { startDischargeLetterAction } from "@/app/app/clinic/letters/actions";
import { LETTERS_PATH } from "./format";

export function DischargeLetterButton({ patientId, noteId }: { patientId: string; noteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function start() {
    setBusy(true);
    setError(null);
    const r = await startDischargeLetterAction({ patientId, noteId });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    router.push(`${LETTERS_PATH}/${r.id}`);
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <PmsButton variant="secondary" loading={busy} onClick={() => void start()} data-testid="discharge-letter">
        <FileText aria-hidden />
        Write discharge letter
      </PmsButton>
      {error ? (
        <span role="alert" className="text-sm text-[#991B1B]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
