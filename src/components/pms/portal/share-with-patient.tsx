"use client";

/**
 * "Share with the patient" under one file on the record's Attachments tab (PORTAL-004): a plain title (the portal
 * lists it – keep clinical detail out of it), an optional message, "email the patient a link"; the file's shares
 * with who shared it and when, whether the patient opened it, and Withdraw.
 */
import { useRouter } from "next/navigation";
import * as React from "react";
import { Share2 } from "lucide-react";
import { Checkbox, PmsButton, TextArea, TextInput, useToast } from "@/components/pms/ui";

type Answer = { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export interface ShareWithPatientProps {
  fileLabel: string;
  shares: { id: string; title: string; sharedAt: string; sharedBy: string; viewedAt: string | null; withdrawnAt: string | null }[];
  canShare: boolean;
  /** Why sharing is not possible now (portal off, access off) – null when it is. */
  blocked: string | null;
  canEmail: boolean;
  share: (input: { title: string; message?: string; notify?: boolean }) => Promise<Answer>;
  withdraw: (shareId: string) => Promise<Answer>;
}

export function ShareWithPatient(p: ShareWithPatientProps) {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = React.useState("A document from the clinic");
  const [message, setMessage] = React.useState("");
  const [notify, setNotify] = React.useState(p.canEmail);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  const run = async (key: string, fn: () => Promise<Answer>) => {
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast.success(r.message ?? "Done.");
    router.refresh();
  };
  const live = p.shares.filter((s) => !s.withdrawnAt);
  if (!p.canShare && p.shares.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {p.shares.length > 0 ? (
        <ul className="space-y-1" aria-label={`Shared with the patient: ${p.fileLabel}`}>
          {p.shares.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-[8px] bg-[#F8FAFC] px-2 py-1.5 text-xs text-[#334155]">
              <Share2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className={s.withdrawnAt ? "line-through" : "font-medium text-foreground"}>“{s.title}”</span> shared with the patient {s.sharedAt} by {s.sharedBy}
                {s.viewedAt ? ` · opened ${s.viewedAt}` : " · not opened yet"}
                {s.withdrawnAt ? ` · withdrawn ${s.withdrawnAt}` : ""}
              </span>
              {!s.withdrawnAt && p.canShare ? (
                <PmsButton size="sm" variant="secondary" loading={busy === s.id} onClick={() => void run(s.id, () => p.withdraw(s.id))} aria-label={`Withdraw “${s.title}” from the patient's portal`}>
                  Withdraw
                </PmsButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {p.canShare ? (
        <details>
          <summary className="cursor-pointer rounded text-xs font-medium text-primary-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            {live.length > 0 ? "Share again with the patient" : "Share with the patient"}
          </summary>
          <div className="mt-2 max-w-md space-y-2">
            {p.blocked ? (
              <p className="text-xs text-[#864E0E]">{p.blocked}</p>
            ) : (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run("share", () => p.share({ title, message: message.trim() || undefined, notify }));
                }}
              >
                <div className="space-y-1">
                  <label htmlFor={`${id}-t`} className="block text-xs font-medium text-foreground">
                    Title the patient sees
                  </label>
                  <TextInput id={`${id}-t`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required aria-describedby={`${id}-th`} />
                  <p id={`${id}-th`} className="text-xs text-[#475569]">
                    Shown in the portal&apos;s list – keep clinical detail out of it.
                  </p>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`${id}-m`} className="block text-xs font-medium text-foreground">
                    Message (optional)
                  </label>
                  <TextArea id={`${id}-m`} rows={2} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
                </div>
                <Checkbox checked={notify} disabled={!p.canEmail} onChange={(e) => setNotify(e.target.checked)} label={p.canEmail ? "Email the patient a link to their portal" : "No email address on the record – the patient sees it next time they sign in"} />
                <PmsButton type="submit" size="sm" disabled={!title.trim()} loading={busy === "share"}>
                  Share with the patient
                </PmsButton>
              </form>
            )}
          </div>
        </details>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive-strong">
          {error}
        </p>
      ) : null}
    </div>
  );
}
