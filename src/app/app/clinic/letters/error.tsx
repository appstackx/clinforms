"use client";

import { SectionError } from "@/components/pms/ui/section-error";

export default function LettersError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} section="letters" backHref="/app/clinic/letters" backLabel="Back to letters" />;
}
