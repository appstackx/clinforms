/**
 * The product switch of a clinic that has both the clinic system and ClinForms (design round 3: "Clinic system |
 * ClinForms"), shown above ClinForms' own Studio header. The clinic system's shell has the same switch in its header
 * (clinic-shell.tsx, "Product areas"). Rendered only for a clinic with the clinic-system package – every other
 * ClinForms clinic sees its Studio exactly as before.
 */
import Link from "next/link";
import { Activity } from "lucide-react";

export function ProductSwitchBar({ clinicSystemName, clinicHref }: { clinicSystemName: string; clinicHref: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-slate-200 bg-white px-4 py-1.5" data-testid="product-switch">
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#1842B4] text-white" aria-hidden>
        <Activity className="h-3.5 w-3.5" />
      </span>
      <nav aria-label="Product areas" className="flex gap-0.5 rounded-[10px] bg-slate-100 p-[3px] text-sm">
        <Link href={clinicHref} className="inline-flex h-[28px] items-center rounded-[8px] px-3 font-medium text-slate-600 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
          {clinicSystemName}
        </Link>
        <Link href="/app/studio" aria-current="page" className="inline-flex h-[28px] items-center rounded-[8px] bg-white px-3 font-semibold text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.08)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
          ClinForms
        </Link>
      </nav>
    </div>
  );
}
