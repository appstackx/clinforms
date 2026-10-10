"use client";
/**
 * Sign-out and clinic-switch forms of the signed-in area (fix wave 2). They run the server action, then load the
 * next page in full, so no client-side state – above all the Studio's in-memory clinic records – survives into
 * another sign-in or another clinic (a server action's redirect would be a client-side navigation).
 */
import type { ReactNode } from "react";
import { chooseClinicAction, endSessionAction } from "./actions";

export function SignOutForm({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <form
      className={className}
      action={async () => {
        window.location.assign(await endSessionAction());
      }}
    >
      {children}
    </form>
  );
}

export function SwitchClinicForm({ organizationId, children, className }: { organizationId: string; children: ReactNode; className?: string }) {
  return (
    <form
      className={className}
      action={async (form: FormData) => {
        window.location.assign(await chooseClinicAction(form));
      }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      {children}
    </form>
  );
}

/** For the Studio's account menu (HostHooks.onSignOut). */
export async function signOutAndReload(): Promise<void> {
  window.location.assign(await endSessionAction());
}
