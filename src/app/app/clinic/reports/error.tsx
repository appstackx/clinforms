"use client";

import { SectionError } from "@/components/pms/ui/section-error";

export default function ReportsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} section="reports" backHref="/app/clinic/reports" backLabel="Back to reports" />;
}
