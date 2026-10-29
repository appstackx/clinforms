"use client";

import { SectionError } from "@/components/pms/ui/section-error";

export default function ClinicTodayError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} section="today’s dashboard" backHref="/app/clinic" backLabel="Back to Today" />;
}
