"use client";

import { SectionError } from "@/components/pms/ui/section-error";

export default function AccountError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} section="your account" backHref="/app/clinic/account" backLabel="Back to my account" />;
}
