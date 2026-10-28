"use client";
import Link from "next/link";
import { Printer } from "lucide-react";
import { PmsButton, pmsButtonVariants } from "@/components/pms/ui";

/** Above an A4 print view (hidden when printing): Print / Save as PDF, and back. */
export function PrintToolbar({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <div className="print-toolbar mx-auto flex w-full max-w-[794px] flex-wrap items-center gap-2">
      <Link href={backHref} className={pmsButtonVariants({ variant: "secondary" })}>
        {backLabel}
      </Link>
      <span className="text-sm text-[#475569]">A4. Use Print, then &quot;Save as PDF&quot; for a PDF.</span>
      <PmsButton className="ml-auto" onClick={() => window.print()} data-testid="print-button">
        <Printer aria-hidden />
        Print
      </PmsButton>
    </div>
  );
}
