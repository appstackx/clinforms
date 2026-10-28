"use client";
/** Attach a file (PDF, JPEG, PNG or Word, up to 4 MB) to the patient's record; stored encrypted. */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ACCEPT_ATTRIBUTE, MAX_ATTACHMENT_BYTES, formatBytes } from "@/modules/pms/records/attachments";
import { INPUT_CLASS, type Option } from "./form";

export function AttachmentUpload({ uploadUrl, notes }: { uploadUrl: string; notes: Option[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setMessage({ ok: false, text: "Choose a file to attach." });
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setMessage({ ok: false, text: `The file is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.` });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(uploadUrl, { method: "POST", body: data, credentials: "same-origin" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
      if (!res.ok || !body?.ok) {
        setMessage({ ok: false, text: body?.error?.message ?? "The file could not be attached. Please try again." });
      } else {
        setMessage({ ok: true, text: `${file.name} is attached.` });
        formRef.current?.reset();
        router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: "The file could not be sent. Check the connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-4" aria-busy={busy}>
      <div aria-live="polite">
        {message ? (
          <div role={message.ok ? "status" : "alert"} className={message.ok ? "rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-[#0B5F58]" : "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"}>
            {message.text}
          </div>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="attachment-file" className="block text-sm font-medium text-foreground">
          File
        </label>
        <input
          id="attachment-file"
          name="file"
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          required
          aria-describedby="attachment-file-hint"
          className="block w-full text-sm text-foreground file:mr-3 file:h-10 file:rounded-lg file:border file:border-input-strong file:bg-white file:px-3 file:text-sm file:font-medium file:text-foreground hover:file:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
        <p id="attachment-file-hint" className="text-xs text-muted-foreground">
          PDF, JPEG, PNG or Word (.docx), up to {formatBytes(MAX_ATTACHMENT_BYTES)}. Stored encrypted.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="attachment-description" className="block text-sm font-medium text-foreground">
          Description
        </label>
        <input id="attachment-description" name="description" maxLength={200} className={`${INPUT_CLASS} h-10`} aria-describedby="attachment-description-hint" />
        <p id="attachment-description-hint" className="text-xs text-muted-foreground">
          For example “GP referral letter” or “MRI report, cervical spine”.
        </p>
      </div>
      {notes.length > 0 ? (
        <div className="space-y-1.5">
          <label htmlFor="attachment-note" className="block text-sm font-medium text-foreground">
            Belongs to the note
          </label>
          <select id="attachment-note" name="noteId" defaultValue="" className={`${INPUT_CLASS} h-10`}>
            <option value="">No particular note</option>
            {notes.map((n) => (
              <option key={n.value} value={n.value}>
                {n.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-10 items-center justify-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Attaching…" : "Attach file"}
      </button>
    </form>
  );
}
