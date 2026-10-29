"use client";

import { useParams } from "next/navigation";
import { SectionError } from "@/components/pms/ui/section-error";
import { CLINIC_BASE_PATH } from "@/modules/pms/core/modules";

/** A record tab failed: the record layout stays; "back" goes to the record's summary. */
export default function RecordTabError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams<{ patientId?: string }>();
  const id = typeof params?.patientId === "string" ? params.patientId : null;
  return (
    <SectionError
      error={error}
      reset={reset}
      section="this part of the record"
      backHref={id ? `${CLINIC_BASE_PATH}/patients/${id}` : `${CLINIC_BASE_PATH}/patients`}
      backLabel={id ? "Back to the record" : "Back to patients"}
    />
  );
}
