"use client";

import { SectionError } from "@/components/pms/ui/section-error";

export default function IntakeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} section="intake forms" backHref="/app/clinic/intake" backLabel="Back to intake forms" />;
}
