/** Wording of filed referrer forms (pure – the case panel and the record's Forms tab). */

const LONDON = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** "28/10/2026 at 11:06" (UK time) for an ISO instant. */
export function ukDateTimeAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const parts = Object.fromEntries(LONDON.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month}/${parts.year} at ${parts.hour}:${parts.minute}`;
}

/** "PDF, 84 KB" */
export function fileLabel(mimeType: string, sizeBytes: number): string {
  const kind = mimeType === "application/pdf" ? "PDF" : "Word";
  const kb = Math.max(1, Math.round(sizeBytes / 1024));
  return `${kind}, ${kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`}`;
}

/** "Approved by Priya Shah (PH-DEMO-01) on 28/10/2026 at 11:06 · PDF, 84 KB" */
export function formatFiledLine(f: { signerName: string | null; signerRegistration: string | null; signedAt: string | null; filedAt: string; mimeType: string; sizeBytes: number }): string {
  const who = f.signerName ? `Approved by ${f.signerName}${f.signerRegistration ? ` (${f.signerRegistration})` : ""}` : "Approved";
  return `${who} on ${ukDateTimeAt(f.signedAt ?? f.filedAt)} · ${fileLabel(f.mimeType, f.sizeBytes)}`;
}
