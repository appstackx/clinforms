"use client";
/**
 * Preview of an attached image (JPEG/PNG) in a dialog. The file is fetched from the download route (which records
 * the download in the patient's history and always answers as an attachment) and shown from a local blob in an
 * <img> – nothing is rendered inline by the server, and PDFs and documents are never previewed in the page
 * (K2-NFR-004): they are downloaded.
 */
import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { PmsButton } from "@/components/pms/ui";

export function ImagePreview({ href, name }: { href: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let revoke: string | null = null;
    setError(null);
    fetch(href, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("load"))))
      .then((b) => {
        revoke = URL.createObjectURL(b);
        setUrl(revoke);
      })
      .catch(() => setError("The image could not be loaded. Download it instead."));
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
      setUrl(null);
    };
  }, [open, href]);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <PmsButton variant="secondary" size="sm">
          Preview<span className="sr-only"> {name}</span>
        </PmsButton>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.45)]" />
        <DialogPrimitive.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[760px] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl bg-white p-4 shadow-[0_24px_48px_rgba(15,23,42,0.24)]">
          <div className="flex items-center justify-between gap-2">
            <DialogPrimitive.Title className="truncate text-base font-semibold">{name}</DialogPrimitive.Title>
            <DialogPrimitive.Close aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-[#F1F5F9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <X className="h-4 w-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div className="flex min-h-[200px] items-center justify-center overflow-auto rounded-lg bg-[#F8FAFC]">
            {error ? (
              <p role="alert" className="text-sm text-destructive-strong">
                {error}
              </p>
            ) : url ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local blob of the patient's file, never a remote image
              <img src={url} alt={name} className="max-h-[70dvh] max-w-full object-contain" />
            ) : (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
