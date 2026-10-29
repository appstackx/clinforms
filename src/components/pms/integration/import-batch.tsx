"use client";
/**
 * Import from the previous system – one import after the upload (design round 2c "Import"): the five steps (Upload,
 * Map columns, Check, Import, Done), the column matching, the check (ready / warnings / errors and the issues list –
 * nothing is written to the records), the run with its progress, and Done with the 7-day undo. The long steps run one
 * page per server call; the page calls again until the step is done, so a large file never needs one long request.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Check, TriangleAlert } from "lucide-react";
import { PmsButton, PmsNotice } from "@/components/pms/ui";
import type { ImportIssueRow, ImportView } from "@/modules/pms/integration/import-view";
import { approveAction, cancelImportAction, checkStepAction, importStepAction, issuesAction, saveMappingAction, undoStepAction } from "@/app/app/clinic/setup/import/actions";
import { ukDateTimeAt } from "./format";

const STEPS = ["Upload", "Map columns", "Check", "Import", "Done"] as const;

function stepIndex(status: ImportView["status"]): number {
  switch (status) {
    case "uploading":
      return 0;
    case "mapping":
      return 1;
    case "checking":
    case "checked":
      return 2;
    case "approved":
    case "importing":
      return 3;
    default:
      return 4;
  }
}

const n = (x: number) => x.toLocaleString("en-GB");

type Loop = (id: string) => Promise<{ ok: true; value: { done: boolean; remaining: number; processed: number; busy?: boolean } } | { ok: false; error: string }>;

/** Calls a page-by-page step until it is done (a busy batch is waited for), reporting progress. */
async function runLoop(step: Loop, id: string, onProgress: (done: number) => void): Promise<string | null> {
  let done = 0;
  for (let i = 0; i < 100_000; i++) {
    const r = await step(id);
    if (!r.ok) return r.error;
    if (r.value.done) return null;
    if (r.value.busy) {
      await new Promise((res) => setTimeout(res, 1500));
      continue;
    }
    done += r.value.processed;
    onProgress(done);
  }
  return "The step did not finish. Reload the page to carry on.";
}

export function ImportBatchScreen({ view, basePath, patientsHref }: { view: ImportView; basePath: string; patientsHref: string }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const current = editing ? 1 : stepIndex(view.status);
  const [error, setError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState<null | { label: string; done: number; total: number }>(null);
  const started = React.useRef(false);

  // A step that was interrupted (another tab, a reload) carries on by itself.
  React.useEffect(() => {
    if (started.current) return;
    if (view.status === "checking") {
      started.current = true;
      void loop(checkStepAction, "Checking", view.rowCount);
    } else if (view.status === "approved" || view.status === "importing") {
      started.current = true;
      void loop(importStepAction, `Importing ${view.noun}`, view.counts.ready || view.remaining.ready);
    } else if (view.status === "undoing") {
      started.current = true;
      void loop(undoStepAction, "Undoing the import", view.counts.imported);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.status]);

  async function loop(step: Loop, label: string, total: number) {
    setError(null);
    setRunning({ label, done: 0, total });
    const err = await runLoop(step, view.id, (done) => setRunning({ label, done: Math.min(done, total), total }));
    setRunning(null);
    if (err) setError(err);
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4" data-testid="import-batch" data-status={view.status}>
      <ol aria-label="Import steps" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {STEPS.map((label, i) => {
          const done = i < current || (i === 4 && current === 4);
          const cur = i === current;
          return (
            <li key={label} aria-current={cur ? "step" : undefined} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${cur ? "border-[#0E958A] bg-[#F0FDFA]" : "border-border bg-white"}`}>
              <span aria-hidden className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done && !cur ? "bg-primary-strong text-white" : cur ? "border border-[#0E958A] bg-white text-primary-strong" : "bg-[#F1F5F9] text-[#475569]"}`}>
                {done && !cur ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-foreground">{label}</span>
                <span className="text-xs text-[#475569]">{done && !cur ? "Complete" : cur ? "Current step" : "Not started"}</span>
              </span>
            </li>
          );
        })}
      </ol>

      {error ? (
        <PmsNotice tone="error" title="That did not work">
          {error}
        </PmsNotice>
      ) : null}

      <section className="rounded-2xl border border-border bg-white p-5" aria-live="polite">
        {running ? (
          <Progress label={running.label} done={running.done} total={running.total} />
        ) : view.status === "cancelled" ? (
          <p className="text-sm">This import was cancelled. Nothing was imported.</p>
        ) : view.status === "uploading" ? (
          <UploadInterrupted view={view} onCancel={async () => setError(await cancel(view.id))} />
        ) : current === 1 ? (
          <MapStep view={view} onCheck={async (mapping) => {
            setError(null);
            const saved = await saveMappingAction(view.id, view.rev, mapping);
            if (!saved.ok) return setError(saved.error);
            await loop(checkStepAction, "Checking", view.rowCount);
          }} />
        ) : current === 2 ? (
          <CheckStep
            view={view}
            onBack={() => setEditing(true)}
            onImport={async () => {
              setError(null);
              const a = await approveAction(view.id, view.rev, true);
              if (!a.ok) return setError(a.error);
              await loop(importStepAction, `Importing ${view.noun}`, view.counts.ready);
            }}
          />
        ) : (
          <DoneStep view={view} basePath={basePath} patientsHref={patientsHref} onUndo={() => loop(undoStepAction, "Undoing the import", view.counts.imported)} />
        )}
      </section>
    </div>
  );

  async function cancel(id: string): Promise<string | null> {
    const r = await cancelImportAction(id);
    router.refresh();
    return r.ok ? null : r.error;
  }
}

function Progress({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div role="status" className="flex flex-col gap-2" data-testid="import-progress">
      <strong className="text-foreground">{label}…</strong>
      <div role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2.5 overflow-hidden rounded-full bg-[#E2E8F0]">
        <div className="h-full rounded-full bg-primary-strong transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm text-[#475569]">
        {n(done)} of {n(total)}. Keep this page open until it finishes – if it is closed, open the import again to carry on.
      </span>
    </div>
  );
}

function UploadInterrupted({ view, onCancel }: { view: ImportView; onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        The upload stopped after {n(view.rowCount)} rows. Cancel this import and upload the file again.
      </p>
      <div>
        <PmsButton variant="secondary" onClick={onCancel}>
          Cancel this import
        </PmsButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Map columns
 * ----------------------------------------------------------------------------------------------*/

function MapStep({ view, onCheck }: { view: ImportView; onCheck: (mapping: Record<string, number | null>) => Promise<void> }) {
  const initial = React.useMemo(() => {
    const byColumn: (string | null)[] = view.headers.map(() => null);
    for (const [key, col] of Object.entries(view.mapping ?? {})) if (typeof col === "number" && col >= 0 && col < byColumn.length) byColumn[col] = key;
    return byColumn;
  }, [view.headers, view.mapping]);
  const [byColumn, setByColumn] = React.useState<(string | null)[]>(initial);
  const [busy, setBusy] = React.useState(false);
  const matched = byColumn.filter(Boolean).length;
  const missing = view.fields.filter((f) => f.required && !byColumn.includes(f.key)).map((f) => f.label);
  const groups = Array.from(new Set(view.fields.filter((f) => f.group).map((f) => f.group as string)));
  const missingGroups = groups.filter((g) => !view.fields.some((f) => f.group === g && byColumn.includes(f.key)));

  const toMapping = (): Record<string, number | null> => {
    const m: Record<string, number | null> = Object.fromEntries(view.fields.map((f) => [f.key, null]));
    byColumn.forEach((key, col) => {
      if (key) m[key] = col;
    });
    return m;
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-foreground">
        We matched {matched} of {view.headers.length} columns by their names. Check each match – choose &ldquo;Do not import&rdquo; for a column you do not need.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm" data-testid="import-mapping">
          <thead className="bg-[#F8FAFC] text-xs text-[#475569]">
            <tr>
              <th scope="col" className="px-3.5 py-2 font-semibold">Column in your file</th>
              <th scope="col" className="px-3.5 py-2 font-semibold">Example</th>
              <th scope="col" className="px-3.5 py-2 font-semibold">Import as</th>
              <th scope="col" className="px-3.5 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {view.headers.map((h, col) => {
              const key = byColumn[col];
              const taken = new Set(byColumn.filter((k, i) => k && i !== col));
              return (
                <tr key={`${h}-${col}`} className="border-t border-border">
                  <td className="px-3.5 py-2 font-mono text-[13px]">{h}</td>
                  <td className="max-w-[260px] truncate px-3.5 py-2 text-[#334155]">{view.example?.[col] ?? ""}</td>
                  <td className="px-3.5 py-2">
                    <select
                      aria-label={`Import ${h} as`}
                      value={key ?? ""}
                      onChange={(e) => setByColumn((cur) => cur.map((k, i) => (i === col ? e.target.value || null : k)))}
                      className={`h-9 w-full min-w-[200px] rounded-lg border bg-white px-2.5 ${key ? "border-input-strong" : "border-input-strong"}`}
                    >
                      <option value="">Do not import</option>
                      {view.fields.map((f) => (
                        <option key={f.key} value={f.key} disabled={taken.has(f.key)}>
                          {f.label}
                          {f.required ? " (required)" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3.5 py-2">
                    {key ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#DCFCE7] px-2 py-0.5 text-xs font-semibold text-[#166534]">
                        <Check className="h-3 w-3" aria-hidden /> Matched
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#F1F5F9] px-2 py-0.5 text-xs font-semibold text-[#475569]">
                        <Ban className="h-3 w-3" aria-hidden /> Ignored
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {missing.length || missingGroups.length ? (
        <PmsNotice tone="warning" title="Still needed">
          {[...missing, ...missingGroups.map((g) => (g === "name" ? "a name (first and last name, or one full-name column)" : g))].join(", ")}
        </PmsNotice>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <PmsButton
          type="button"
          loading={busy}
          disabled={missing.length > 0 || missingGroups.length > 0}
          onClick={async () => {
            setBusy(true);
            await onCheck(toMapping());
            setBusy(false);
          }}
          data-testid="import-check"
        >
          Check data
        </PmsButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Check
 * ----------------------------------------------------------------------------------------------*/

function CheckStep({ view, onBack, onImport }: { view: ImportView; onBack: () => void; onImport: () => Promise<void> }) {
  const [rows, setRows] = React.useState<ImportIssueRow[] | null>(null);
  const [more, setMore] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const c = view.counts;

  const load = React.useCallback(
    async (after: number) => {
      const r = await issuesAction(view.id, after);
      if (r.ok) {
        setRows((cur) => [...(after === 0 ? [] : (cur ?? [])), ...r.value.rows]);
        setMore(r.value.more);
      }
    },
    [view.id],
  );
  React.useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3" data-testid="import-counts">
        <Tile label="Ready" value={c.ready - c.warnings} tone="ok" />
        <Tile label="Warnings – will import" value={c.warnings} tone="warn" />
        <Tile label="Errors – will be skipped" value={c.errors + c.duplicates} tone="error" note={c.duplicates ? `${n(c.duplicates)} already in the clinic` : undefined} />
      </div>
      {view.runUnavailable ? (
        <PmsNotice tone="info" title="Checked only">
          {view.runUnavailable}
        </PmsNotice>
      ) : null}
      <div className="rounded-xl border border-border" data-testid="import-issues">
        {rows === null ? (
          <p className="px-3.5 py-3 text-sm text-[#475569]">Loading the issues…</p>
        ) : rows.length === 0 ? (
          <p className="px-3.5 py-3 text-sm text-[#475569]">No issues found.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.rowNo} className="flex flex-wrap items-start gap-3 px-3.5 py-2.5 text-sm">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${r.severity === "error" ? "bg-[#FEE2E2] text-[#991B1B]" : "bg-[#FEF3C7] text-[#864E0E]"}`}>
                  <TriangleAlert className="h-3 w-3" aria-hidden /> {r.severity === "error" ? "Error" : "Warning"}
                </span>
                <span className="w-[72px] shrink-0 font-medium text-foreground">Row {n(r.rowNo)}</span>
                <span className="min-w-0 flex-1 text-[#334155]">{r.messages.join(" ")}</span>
              </li>
            ))}
          </ul>
        )}
        {more && rows ? (
          <div className="border-t border-border px-3.5 py-2">
            <PmsButton variant="link" onClick={() => void load(rows[rows.length - 1].rowNo)}>
              Show more issues
            </PmsButton>
          </div>
        ) : null}
      </div>
      {!view.runUnavailable && c.ready > 0 ? (
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" data-testid="import-confirm" />
          <span>I have looked at the issues. Import the {n(c.ready)} ready rows; rows with errors are skipped.</span>
        </label>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <PmsButton variant="secondary" onClick={onBack}>
          Back
        </PmsButton>
        {!view.runUnavailable ? (
          <PmsButton
            type="button"
            loading={busy}
            disabled={!confirmed || c.ready === 0}
            onClick={async () => {
              setBusy(true);
              await onImport();
              setBusy(false);
            }}
            data-testid="import-run"
          >
            Import {n(c.ready)} {view.noun}
          </PmsButton>
        ) : null}
      </div>
    </div>
  );
}

function Tile({ label, value, tone, note }: { label: string; value: number; tone: "ok" | "warn" | "error"; note?: string }) {
  const colour = tone === "ok" ? "text-[#166534]" : tone === "warn" ? "text-[#864E0E]" : "text-[#991B1B]";
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3">
      <span className="text-xs font-medium text-[#475569]">{label}</span>
      <div className={`text-2xl font-semibold ${colour}`}>{n(Math.max(0, value))}</div>
      {note ? <span className="text-xs text-[#475569]">{note}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Done (and undo)
 * ----------------------------------------------------------------------------------------------*/

function DoneStep({ view, basePath, patientsHref, onUndo }: { view: ImportView; basePath: string; patientsHref: string; onUndo: () => Promise<void> }) {
  const [asking, setAsking] = React.useState(false);
  const c = view.counts;
  if (view.status === "undone") {
    return (
      <div role="status" data-testid="import-undone" className="flex flex-col gap-2 text-sm">
        <span>
          <strong>Import undone.</strong> {n(c.undone)} {view.noun} added on {ukDateTimeAt(view.importedAt).split(" at ")[0]} have been removed
          {c.kept ? `; ${n(c.kept)} were kept because they were changed or used since the import` : ""}. Nothing else was changed.
        </span>
        <span>
          <Link href={basePath} className="font-medium text-primary-strong underline underline-offset-2">
            Back to imports
          </Link>
        </span>
      </div>
    );
  }
  const skipped = c.skipped + c.errors + c.duplicates;
  return (
    <div className="flex flex-col gap-4">
      <div role="status" data-testid="import-done" className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-sm text-foreground">
        <strong>
          {n(c.imported)} {view.noun} imported
        </strong>{" "}
        at {ukDateTimeAt(view.importedAt).replace(" at ", " ")}.{skipped ? ` ${n(skipped)} rows skipped.` : ""}
      </div>
      <div className="flex flex-wrap gap-2">
        {view.kind === "patients" ? (
          <Link href={patientsHref} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-medium">
            View patients
          </Link>
        ) : null}
        <Link href={basePath} className="inline-flex h-9 items-center rounded-lg bg-primary-strong px-3 text-sm font-medium text-white">
          {view.kind === "patients" ? "Next: import cases or appointments" : "Start another import"}
        </Link>
      </div>
      {view.undoUntil ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm" data-testid="import-undo">
          <span className="min-w-0 flex-1">
            {view.undoBlocked ?? (
              <>
                Something wrong? You can undo this whole import until <strong>{ukDateTimeAt(view.undoUntil).split(" at ")[0]}</strong>. Records you have since changed or used are kept and listed.
              </>
            )}
          </span>
          {!view.undoBlocked ? (
            asking ? (
              <>
                <PmsButton variant="destructive" onClick={() => void onUndo()} data-testid="import-undo-confirm">
                  Yes, remove {n(c.imported)} {view.noun}
                </PmsButton>
                <PmsButton variant="secondary" onClick={() => setAsking(false)}>
                  Keep
                </PmsButton>
              </>
            ) : (
              <PmsButton variant="secondary" onClick={() => setAsking(true)} data-testid="import-undo-ask">
                Undo import
              </PmsButton>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
