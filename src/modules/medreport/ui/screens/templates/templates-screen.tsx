"use client";

/**
 * Built-in report templates (/reports/templates) – the FALLBACK for when a referrer sends no form of
 * their own. Lists our templates with their sections, offers the tagged Word template for download and
 * checks a clinic's own tagged .docx (POST /templates/validate).
 *
 * Owner: studio-a agent.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Download, Files, LayoutTemplate } from "lucide-react";
import type { TemplatesValidateResponse } from "../../../api/contract";
import { MAX_TEMPLATE_DOCX_BYTES } from "../../../config.public";
import { INSTRUCTING_PARTY_LABELS, SECTION_KIND_LABELS } from "../../../core/labels";
import type { ReportTemplate } from "../../../core/types";
import { api, saveBlob, toBase64 } from "../../api-client";
import { Button, Card, Skeleton } from "../../primitives";
import { FileDrop } from "../../components/shared/file-drop";
import { errorMessage, formatBytes, plural } from "../../components/shared/format";
import { StudioShell } from "../../components/shared/studio-shell";
import { EmptyState, Notice, Spinner } from "../../components/shared/ui-bits";

export function TemplatesScreen() {
  const [templates, setTemplates] = useState<ReportTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.templates().then(
      (res) => live && setTemplates(res.templates),
      (err) => live && setError(errorMessage(err)),
    );
    return () => {
      live = false;
    };
  }, []);

  const download = async (t: ReportTemplate) => {
    setDownloading(t.id);
    try {
      const file = await api.templateDocx(t.id);
      saveBlob(file.blob, file.fileName);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <StudioShell
      title="Built-in templates"
      description="Our own report layouts, used only when a referrer has not sent a form of their own. When they have, complete their form instead – in its original layout."
      actions={
        <Button asChild variant="outline">
          <Link href="/reports/forms">
            <Files className="mr-2 h-4 w-4" aria-hidden />
            Referrer forms
          </Link>
        </Button>
      }
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!templates && !error ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : templates && templates.length === 0 ? (
        <EmptyState icon={LayoutTemplate} title="No built-in templates" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates?.map((t) => (
            <Card key={t.id} className="flex flex-col rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{t.name}</h2>
                  <p className="text-xs text-slate-500">
                    Written for: {INSTRUCTING_PARTY_LABELS[t.audience]} · v{t.version}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => void download(t)} disabled={downloading === t.id}>
                  {downloading === t.id ? <Spinner /> : <Download className="mr-1.5 h-4 w-4" aria-hidden />}
                  Word template
                </Button>
              </div>
              <p className="mt-2 text-sm text-slate-600">{t.description}</p>
              <ol className="mt-3 space-y-1 text-sm">
                {t.sections.map((s, i) => (
                  <li key={s.key} className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-1 last:border-0">
                    <span className="text-slate-800">
                      {i + 1}. {s.title}
                      {!s.required ? <span className="text-xs text-slate-500"> (optional)</span> : null}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-500">{SECTION_KIND_LABELS[s.kind]}</span>
                  </li>
                ))}
              </ol>
              {t.scope.excludeFields.length ? (
                <p className="mt-3 text-xs text-slate-500">Scope: past medical and social history are removed before drafting.</p>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      <ValidateOwnTemplate />
    </StudioShell>
  );
}

function ValidateOwnTemplate() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ fileName: string; res: TemplatesValidateResponse } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async (file: File) => {
    setError(null);
    setResult(null);
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setError("Choose a Word .docx file.");
      return;
    }
    if (file.size > MAX_TEMPLATE_DOCX_BYTES) {
      setError(`The file is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_TEMPLATE_DOCX_BYTES)}.`);
      return;
    }
    setBusy(true);
    try {
      const res = await api.validateTemplate({ fileName: file.name, docxBase64: await toBase64(file) });
      setResult({ fileName: file.name, res });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="own-template" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <div>
        <h2 id="own-template" className="text-base font-semibold text-slate-900">
          Your own tagged Word template
        </h2>
        <p className="text-sm text-slate-600">
          Download a template above, restyle it in Word (keep the {"{tags}"}), and check it here. For a referrer&apos;s form, use{" "}
          <Link href="/reports/forms" className="font-medium text-teal-700 underline">
            Referrer forms
          </Link>{" "}
          instead – no tags needed.
        </p>
      </div>
      <FileDrop accept=".docx" onFile={(f) => void check(f)} title={busy ? "Checking…" : "Drop a tagged .docx to check it"} hint="Word .docx only" disabled={busy} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {result ? (
        result.res.ok ? (
          <Notice tone="success" icon={CheckCircle2} title={`${result.fileName} is ready to use`}>
            {plural(result.res.tags.length, "tag")} found.
            {result.res.unusedTags.length ? ` Not used: ${result.res.unusedTags.slice(0, 6).join(", ")}${result.res.unusedTags.length > 6 ? "…" : ""}.` : ""}
          </Notice>
        ) : (
          <Notice tone="error" title={`${result.fileName}: ${plural(result.res.errors.length, "problem")} to fix`}>
            <ul className="list-disc space-y-0.5 pl-4">
              {result.res.errors.slice(0, 10).map((e, i) => (
                <li key={i}>
                  {e.message}
                  {e.location ? ` (${e.location})` : ""}
                </li>
              ))}
              {result.res.unknownTags.length ? <li>Unknown tags: {result.res.unknownTags.join(", ")}</li> : null}
            </ul>
          </Notice>
        )
      ) : null}
    </section>
  );
}
