"use client";
/** The day sheet's screen-only controls: Print, and (owners/administrators) the date-of-birth setting. */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { setDaySheetDobAction } from "@/app/app/clinic/diary/actions";
import { PmsButton } from "../ui/button";
import { Switch } from "../ui/inputs";
import { useToast } from "../ui/toast";

export function DaySheetControls({ showDob, canSet }: { showDob: boolean; canSet: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {canSet ? (
        <Switch
          checked={showDob}
          disabled={busy}
          label="Show date of birth on the printed day sheet"
          onCheckedChange={async (on) => {
            setBusy(true);
            const r = await setDaySheetDobAction({ on });
            setBusy(false);
            if (r.ok) toast.success(r.message);
            else toast.error(r.error);
            router.refresh();
          }}
        />
      ) : null}
      <PmsButton onClick={() => window.print()}>
        <Printer aria-hidden />
        Print
      </PmsButton>
    </div>
  );
}
