"use client";

import { PmsButton } from "@/components/pms/ui";

export function PortalSignOut({ clinicId, action }: { clinicId: string; action: (clinicId: string) => Promise<void> }) {
  return (
    <form action={() => action(clinicId)}>
      <PmsButton type="submit" variant="ghost" size="sm" className="h-11 min-w-11 px-3">
        Sign out
      </PmsButton>
    </form>
  );
}
