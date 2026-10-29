"use client";

import { SectionError } from "@/components/pms/ui/section-error";

export default function AccessError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} section="staff access" backHref="/app/clinic/access" backLabel="Back to staff access" />;
}
