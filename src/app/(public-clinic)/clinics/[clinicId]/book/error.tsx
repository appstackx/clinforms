"use client";

import { PublicError } from "@/components/pms/portal/public-error";

export default function BookError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PublicError error={error} reset={reset} section="book" />;
}
