"use client";

import { SectionError } from "@/components/pms/ui/section-error";

export default function PatientsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} section="patients" backHref="/app/clinic/patients" backLabel="Back to patients" />;
}
