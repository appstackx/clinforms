"use client";

import { SectionError } from "@/components/pms/ui/section-error";

export default function MessagesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} section="messages" backHref="/app/clinic/messages" backLabel="Back to messages" />;
}
