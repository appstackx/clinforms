"use client";

import { SectionError } from "@/components/pms/ui/section-error";

export default function SetupError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} section="set-up" backHref="/app/clinic/setup" backLabel="Back to set-up" />;
}
