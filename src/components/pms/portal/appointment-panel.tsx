"use client";

/**
 * One appointment for the patient (design round 2g "Portal" → appointment): when, what, with whom, where; free to
 * change until …; inside the notice period a late-cancellation warning with the fee; cancel with a confirmation
 * ("Cancel and accept the fee" when late); "Move to another time" only outside the notice period.
 */
import * as React from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { PmsButton } from "@/components/pms/ui";
import { formatWhen } from "@/modules/pms/portal/time";
import type { AppointmentPanelData } from "@/modules/pms/portal/flow-types";

type Answer = { ok: true; message?: string } | { ok: false; error: string };

export function AppointmentPanel({ data, moveHref, cancel }: { data: AppointmentPanelData; moveHref: string | null; cancel: () => Promise<Answer> }) {
  const [asking, setAsking] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fee = data.lateFee ? ` of up to ${data.lateFee}` : "";
  return (
    <div className="space-y-4">
      <h1 className="text-[22px] font-bold text-foreground">{data.when}</h1>
      <div className="rounded-[12px] border border-border bg-white p-4">
        <strong className="block text-[16px] text-foreground">{data.service}</strong>
        {data.practitioner ? <span className="block text-[14px] text-[#334155]">with {data.practitioner}</span> : null}
        <span className="block text-[14px] text-[#334155]">
          {data.site}
          {data.siteAddress ? ` · ${data.siteAddress}` : ""}
        </span>
        <span className={`mt-1 block text-[13px] font-medium ${data.status === "booked" ? "text-[#166534]" : "text-[#9A3412]"}`}>
          {data.statusWords}
          {data.reference ? ` · Ref ${data.reference}` : ""}
        </span>
      </div>
      {data.status === "booked" && data.late ? (
        <div role="note" className="flex gap-2 rounded-[10px] border border-[#FDBA74] bg-[#FFF7ED] p-3 text-[14px] text-[#9A3412]">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            This appointment is <strong>less than {data.noticeHours} hours away</strong>. If you cancel it now, it counts as a late cancellation and a fee{fee} may be charged. To move it, please call the clinic.
          </span>
        </div>
      ) : null}
      {data.status === "booked" && !data.late && data.canCancel ? (
        <p className="text-[14px] text-[#334155]">
          You can change or cancel free of charge until <strong>{formatWhen(data.freeUntil)}</strong>.
        </p>
      ) : null}
      {data.refusal ? <p className="text-[14px] text-[#334155]">{data.refusal}</p> : null}
      {error ? (
        <p role="alert" className="rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] p-3 text-[14px] text-destructive-strong">
          {error}
        </p>
      ) : null}
      {asking ? (
        <div role="alertdialog" aria-labelledby="cc-h" aria-describedby="cc-d" className="space-y-3 rounded-[12px] border border-border bg-white p-4">
          <strong id="cc-h" className="block text-[16px] text-foreground">
            Cancel this appointment?
          </strong>
          <span id="cc-d" className="block text-[14px] text-[#334155]">
            {data.late ? `Because it's less than ${data.noticeHours} hours away, a late cancellation fee${fee} may be charged.` : "You won't be charged. We'll send you a confirmation."}
          </span>
          <PmsButton
            type="button"
            variant="destructive"
            size="lg"
            className="w-full"
            loading={pending}
            loadingText="Cancelling…"
            onClick={async () => {
              setPending(true);
              setError(null);
              const r = await cancel();
              setPending(false);
              if (r && !r.ok) setError(r.error);
            }}
          >
            {data.late ? "Cancel and accept the fee" : "Yes, cancel it"}
          </PmsButton>
          <PmsButton type="button" variant="secondary" size="lg" className="w-full" onClick={() => setAsking(false)} autoFocus>
            Keep my appointment
          </PmsButton>
        </div>
      ) : data.status === "booked" ? (
        <div className="space-y-2">
          {moveHref && data.canMove ? (
            <Link href={moveHref} className="flex h-12 w-full items-center justify-center rounded-[10px] bg-primary-strong text-[16px] font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              Move to another time
            </Link>
          ) : null}
          {data.canCancel ? (
            <PmsButton type="button" variant="secondary" size="lg" className="h-12 w-full text-destructive-strong" onClick={() => setAsking(true)}>
              Cancel appointment
            </PmsButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
