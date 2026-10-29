"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { pmsButtonVariants, PmsButton } from "./button";
import { ErrorState } from "./error-state";

export interface SectionErrorProps {
  /** From the route's error.tsx (Next): the message is never shown – it may carry internal detail. */
  error: Error & { digest?: string };
  reset: () => void;
  /** What could not load, in plain words, e.g. "the diary". */
  section: string;
  /** Where "back" goes – the section's own start page. */
  backHref: string;
  backLabel: string;
}

/**
 * A clinic-system section's error boundary (route error.tsx): plain words, "Try again" (re-renders the segment) and a
 * way back to the section. Only the error's digest is shown – a short reference the clinic can quote to support, which
 * matches the server log; never the message or stack. redirect() and notFound() never reach here (Next rethrows them
 * past error boundaries), so sign-in redirects and the 404 page behave as before.
 */
export function SectionError({ error, reset, section, backHref, backLabel }: SectionErrorProps) {
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col py-8" data-testid="section-error">
      <ErrorState
        title={`Sorry, ${section} didn't load`}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <PmsButton type="button" onClick={() => reset()}>
              <RotateCcw aria-hidden />
              Try again
            </PmsButton>
            <Link href={backHref} className={pmsButtonVariants({ variant: "secondary" })}>
              {backLabel}
            </Link>
          </div>
        }
      >
        Something went wrong on our side. Your work saved before this is safe. Please try again – if it keeps happening, contact support.
      </ErrorState>
      {error.digest ? <p className="mt-3 text-center text-xs text-[#475569]">Reference: {error.digest}</p> : null}
    </div>
  );
}
