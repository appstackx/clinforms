/**
 * The demo clinic banner of the clinic area (/app) and the clinic's Studio (/app/studio): a clinic that ClinForms
 * staff made a DEMO clinic (clinic_plan.demo_clinic – src/modules/medreport/core/demo-clinic.ts) holds made-up data
 * only. `on` is worked out on the server (src/server/admin/clinic-plan.ts isDemoClinic); renders nothing otherwise.
 * Server-safe; the wording is WORDING.demoClinic.banner (one source with the Studio's header pill).
 */
import { WORDING } from "@/modules/medreport/core/wording";
import { cn } from "@/lib/utils";

export function DemoClinicBanner({ on, className }: { on: boolean | null | undefined; className?: string }) {
  if (on !== true) return null;
  return (
    <div
      role="note"
      data-demo-clinic-banner=""
      className={cn("border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-950", className)}
    >
      {WORDING.demoClinic.banner}
    </div>
  );
}
