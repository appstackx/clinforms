import type { Metadata } from "next";
import { Notice, PageHeader, Panel } from "@/components/account/shell";
import { SubmitButton } from "@/components/account/form-controls";
import { getAuth } from "@/server/auth/auth";
import { requestHeaders, requireAppContext } from "@/server/auth/session";
import { ukDateTime } from "@/server/email/templates";
import { revokeDevice, revokeOtherDevices } from "./actions";
import { BackupCodesForm } from "./forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Security" };

/** "Chrome on macOS" style label from a user agent (best effort, nothing stored). */
function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export default async function SecurityPage() {
  const { session } = await requireAppContext();
  const sessions = await getAuth().api.listSessions({ headers: requestHeaders() });
  const sorted = [...sessions].sort((a, b) => iso(b.updatedAt).localeCompare(iso(a.updatedAt)));
  return (
    <>
      <PageHeader title="Security" description={`Your account: ${session.user.email}.`} />
      <Panel title="Two-step verification" className="mb-6">
        <Notice tone="success">On. You enter a code from your authenticator app each time you sign in.</Notice>
        <div className="mt-5 space-y-2">
          <h3 className="text-sm font-semibold">Backup codes</h3>
          <p className="text-sm text-slate-600">
            Each backup code signs you in once if you cannot use your phone. Making new codes cancels the old ones.
          </p>
          <BackupCodesForm />
        </div>
        <p className="mt-5 text-sm text-slate-600">
          Lost your phone and your backup codes? Ask ClinForms support to reset two-step verification on your account; you then set it up again
          at your next sign-in.
        </p>
      </Panel>

      <Panel title="Where you are signed in" description="Sign out any device you do not recognise.">
        <ul className="divide-y divide-slate-100">
          {sorted.map((s) => {
            const current = s.id === session.session.id;
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {deviceLabel(s.userAgent)} {current ? <span className="text-xs font-normal text-teal-700">(this device)</span> : null}
                  </p>
                  <p className="text-xs text-slate-500">
                    Signed in {ukDateTime(iso(s.createdAt))} · last active {ukDateTime(iso(s.updatedAt))}
                    {s.ipAddress ? ` · ${s.ipAddress}` : ""}
                  </p>
                </div>
                <form action={revokeDevice}>
                  <input type="hidden" name="sessionId" value={s.id} />
                  <SubmitButton variant="danger" className="h-8 px-2.5 text-xs" pendingText="Signing out…">
                    Sign out
                  </SubmitButton>
                </form>
              </li>
            );
          })}
        </ul>
        {sorted.length > 1 ? (
          <form action={revokeOtherDevices} className="mt-4">
            <SubmitButton variant="secondary" pendingText="Signing out…" confirmText="Sign out every other device?">
              Sign out all other devices
            </SubmitButton>
          </form>
        ) : null}
      </Panel>
    </>
  );
}
