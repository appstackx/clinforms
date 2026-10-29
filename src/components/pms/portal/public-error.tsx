"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { clinicPublicPaths } from "@/modules/pms/portal/paths";

export type PublicSection = "home" | "book" | "booking" | "portal";

const BACK: Record<PublicSection, { label: string; path: (p: ReturnType<typeof clinicPublicPaths>) => string }> = {
  home: { label: "Back to the clinic's page", path: (p) => p.root },
  book: { label: "Back to booking", path: (p) => p.book },
  booking: { label: "Back to the clinic's page", path: (p) => p.root },
  portal: { label: "Back to your portal", path: (p) => p.portal },
};

/**
 * Error boundary for the clinic's public pages (route error.tsx), in the patient pages' own style – no staff shell,
 * no internal detail: only the digest as a short reference the clinic can match to its logs. "Try again" re-renders
 * the page. redirect() and notFound() pass straight through (Next rethrows them past error boundaries).
 */
export function PublicError({ error, reset, section }: { error: Error & { digest?: string }; reset: () => void; section: PublicSection }) {
  const params = useParams<{ clinicId?: string }>();
  const clinicId = typeof params?.clinicId === "string" ? decodeURIComponent(params.clinicId) : null;
  const back = BACK[section];
  return (
    <main className="px-4 pb-16 pt-6" data-testid="public-error">
      <div role="alert" className="rounded-[12px] border border-border bg-white p-5 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[#FEF2F2] text-destructive-strong" aria-hidden="true">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <h1 className="mt-3 text-[20px] font-bold text-foreground">Sorry, this page didn’t load</h1>
        <p className="mt-2 text-[15px] text-[#334155]">Something went wrong on our side. Please try again. If it keeps happening, call the clinic.</p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="h-11 w-full rounded-[10px] bg-primary-strong text-[15px] font-semibold text-white hover:bg-[#095E57] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Try again
          </button>
          {clinicId ? (
            <Link
              href={back.path(clinicPublicPaths(clinicId))}
              className="inline-flex h-11 w-full items-center justify-center rounded-[10px] border border-border bg-white text-[15px] font-medium text-foreground hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {back.label}
            </Link>
          ) : null}
        </div>
      </div>
      {error.digest ? <p className="mt-3 text-center text-[12px] text-[#475569]">Reference: {error.digest}</p> : null}
    </main>
  );
}
