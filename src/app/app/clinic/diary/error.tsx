"use client";

import { SectionError } from "@/components/pms/ui/section-error";

export default function DiaryError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} section="the diary" backHref="/app/clinic/diary" backLabel="Back to the diary" />;
}
