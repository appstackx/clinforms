"use client";

import { SectionError } from "@/components/pms/ui/section-error";

export default function PatientRecordError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} section="the patient record" backHref="/app/clinic/patients" backLabel="Back to patients" />;
}
