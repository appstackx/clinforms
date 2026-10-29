"use client";

import { SectionError } from "@/components/pms/ui/section-error";

export default function BillingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} section="billing" backHref="/app/clinic/billing" backLabel="Back to billing" />;
}
