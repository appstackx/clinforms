"use client";

import { SectionError } from "@/components/pms/ui/section-error";

export default function OnlineBookingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} section="online booking" backHref="/app/clinic/online-booking" backLabel="Back to online booking" />;
}
