"use client";
/**
 * Import from the previous system – step 1, Upload (design round 2c "Import"): what is being imported, the CSV file
 * (read in this browser: src/modules/pms/integration/csv.ts), then the rows are sent to the clinic's server in parts
 * of 500 and the page moves on to matching the columns. Nothing is written to the clinic's records yet.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { PmsButton, PmsNotice } from "@/components/pms/ui";
import { CsvError, parseCsv } from "@/modules/pms/integration/csv";
import { IMPORT_KIND_INFO, IMPORT_KINDS, type ImportKind } from "@/modules/pms/integration/import-kinds";
import { addRowsAction, finishUploadAction, startImportAction } from "@/app/app/clinic/setup/import/actions";

const PART = 500;
const MAX_BYTES = 50 * 1024 * 1024;

async function sha256Hex(buf: ArrayBuffer): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(d))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export function ImportStart({ basePath, initialKind }: { basePath: string; initialKind?: ImportKind }) {
  const router = useRouter();
  const [kind, setKind] = React.useState<ImportKind>(initialKind ?? "patients");
  const [file, setFile] = React.useState<File | null>(null);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const choose = async (f: File | null) => {
    setError(null);
    setSummary(null);
    setFile(f);
    if (!f) return;
    if (f.size > MAX_BYTES) return setError("The file is larger than 50 MB. Split it into smaller files.");
    try {
      const table = parseCsv(await f.text());
      setSummary(`${table.rows.length.toLocaleString("en-GB")} rows · ${table.headers.length} columns`);
    } catch (e) {
      setError(e instanceof CsvError ? e.message : "The file could not be read as CSV.");
    }
  };

  const upload = async () => {
    if (!file) return setError("Choose a CSV file first.");
    setBusy(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const table = parseCsv(new TextDecoder("utf-8").decode(buf));
      const started = await startImportAction({ kind, fileName: file.name.slice(0, 200), fileSha256: await sha256Hex(buf), delimiter: table.delimiter, headers: table.headers, expectedRows: table.rows.length });
      if (!started.ok) throw new Error(started.error);
      const id = started.value.id;
      for (let i = 0; i < table.rows.length; i += PART) {
        setProgress(`Uploading ${Math.min(i + PART, table.rows.length).toLocaleString("en-GB")} of ${table.rows.length.toLocaleString("en-GB")} rows…`);
        const r = await addRowsAction(id, { firstRowNo: i + 1, rows: table.rows.slice(i, i + PART) });
        if (!r.ok) throw new Error(r.error);
      }
      const done = await finishUploadAction(id);
      if (!done.ok) throw new Error(done.error);
      router.push(`${basePath}/${id}`);
    } catch (e) {
      setError(e instanceof CsvError ? e.message : e instanceof Error ? e.message : "The upload failed. Try again.");
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <section aria-labelledby="import-upload" className="rounded-2xl border border-border bg-white p-5" data-testid="import-upload">
      <h2 id="import-upload" className="sr-only">
        Upload
      </h2>
      <div className="flex flex-wrap gap-4">
        <label className="flex min-w-[220px] flex-col gap-1 text-sm font-medium text-foreground">
          What are you importing?
          <select id="im-type" value={kind} onChange={(e) => setKind(e.target.value as ImportKind)} className="h-10 rounded-lg border border-input-strong bg-white px-3 font-normal">
            {IMPORT_KINDS.map((k) => (
              <option key={k} value={k}>
                {IMPORT_KIND_INFO[k].label}
              </option>
            ))}
          </select>
        </label>
        <p className="min-w-[240px] flex-1 self-end text-sm text-[#475569]">{IMPORT_KIND_INFO[kind].description}</p>
      </div>
      <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-4 py-8 text-center">
        <strong className="text-foreground">Choose a CSV file</strong>
        <input
          ref={inputRef}
          id="im-file"
          type="file"
          accept=".csv,text/csv,text/plain"
          aria-label="CSV file"
          onChange={(e) => void choose(e.target.files?.[0] ?? null)}
          className="text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-white file:px-3 file:py-1.5"
        />
        <span className="text-xs text-[#475569]">CSV, UTF-8, up to 50 MB. Dates as DD/MM/YYYY.</span>
        <a href={`${basePath}/template/${kind}`} className="text-sm font-medium text-primary-strong underline underline-offset-2">
          Download a template for {IMPORT_KIND_INFO[kind].noun}
        </a>
      </div>
      {file && summary ? (
        <p className="mt-3 text-sm text-[#334155]" data-testid="import-file-summary">
          <strong>{file.name}</strong> · {summary}
        </p>
      ) : null}
      {error ? (
        <div className="mt-3">
          <PmsNotice tone="error" title="The file cannot be used">
            {error}
          </PmsNotice>
        </div>
      ) : null}
      {progress ? (
        <p role="status" className="mt-3 text-sm text-[#334155]">
          {progress}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end">
        <PmsButton type="button" loading={busy} disabled={!file || !summary} onClick={() => void upload()} data-testid="import-continue">
          Continue
        </PmsButton>
      </div>
    </section>
  );
}
