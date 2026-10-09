"use client";

/**
 * Referrer forms library (/reports/forms): every MLC / insurer / case manager / employer form the clinic
 * works with, each analysed once into a confirmed mapping and reused for every patient. Upload a new
 * form, try the bundled sample that has no mapping yet, or add an insurer portal's questions (a
 * question set with no file – components/forms/portal-questions-dialog.tsx).
 *
 * Owner: studio-a agent.
 */
import { useEffect, useMemo, useState } from "react";
import { Download, FileSearch, Files, Layers, ListPlus, ShieldCheck, Upload } from "lucide-react";
import type { FormSample } from "../../../api/contract";
import { nowIso } from "../../../core/dates";
import { REFERRER_TYPE_LABELS } from "../../../core/labels";
import { api, saveBlob } from "../../api-client";
import { fetchSampleForms, saveForm, useForms } from "../../store";
import { Button, Card, Skeleton } from "../../primitives";
import { DemoAssetForms } from "../../components/forms/demo-asset-forms";
import { FormCard } from "../../components/forms/form-card";
import { PortalQuestionsDialog } from "../../components/forms/portal-questions-dialog";
import { UploadFormDialog } from "../../components/forms/upload-form-dialog";
import { errorMessage, plural } from "../../components/shared/format";
import { StudioShell } from "../../components/shared/studio-shell";
import { EmptyState, FormKindBadge, Notice } from "../../components/shared/ui-bits";
import { WORDING } from "../../wording";

export function FormsLibraryScreen() {
  const { forms, ready } = useForms();
  const [samples, setSamples] = useState<FormSample[] | null>(null);
  const [upload, setUpload] = useState<{ open: boolean; file?: { name: string; bytes: Uint8Array } | null; sample?: FormSample }>({
    open: false,
  });
  const [portalOpen, setPortalOpen] = useState(false);
  const [busySample, setBusySample] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchSampleForms().then((s) => live && setSamples(s));
    return () => {
      live = false;
    };
  }, []);

  const confirmed = forms.filter((f) => f.status === "confirmed").length;
  const proposed = forms.length - confirmed;
  const referrers = new Set(forms.map((f) => f.referrer.name)).size;

  /** Bundled samples whose file is not in the library (e.g. the un-mapped "try a new form" sample). */
  const tryable = useMemo(
    () => (samples ?? []).filter((s) => !s.uploadRequired && !forms.some((f) => f.file.sha256 === s.file.sha256)),
    [samples, forms],
  );
  /** Local demonstration forms (dev/demo only) not in the library yet: their files are uploaded, never served. */
  const demoForms = useMemo(
    () => (samples ?? []).filter((s) => s.uploadRequired && !forms.some((f) => f.file.sha256 === s.file.sha256)),
    [samples, forms],
  );

  const sampleBytes = async (sample: FormSample) => {
    const dl = await api.formSampleFile(sample.id);
    return { dl, bytes: new Uint8Array(await dl.blob.arrayBuffer()) };
  };

  const analyseSample = async (sample: FormSample) => {
    setBusySample(sample.id);
    setSampleError(null);
    try {
      const { bytes } = await sampleBytes(sample);
      setUpload({ open: true, file: { name: sample.file.fileName, bytes }, sample });
    } catch (err) {
      setSampleError(errorMessage(err));
    } finally {
      setBusySample(null);
    }
  };

  const downloadSample = async (sample: FormSample) => {
    setBusySample(sample.id);
    setSampleError(null);
    try {
      const { dl } = await sampleBytes(sample);
      saveBlob(dl.blob, sample.file.fileName);
    } catch (err) {
      setSampleError(errorMessage(err));
    } finally {
      setBusySample(null);
    }
  };

  const restoreSample = (sample: FormSample) => {
    if (!sample.form) return;
    saveForm({ ...sample.form, builtIn: true, sampleId: sample.id, updatedAt: nowIso() });
  };

  return (
    <StudioShell
      title="Referrer forms"
      description="Each MLC, insurer, case manager or employer sends its own report form. Upload it once: the questions are mapped to where the answers come from, a member of staff checks the mapping, and it is reused for every patient that referrer sends."
      actions={
        <>
          <Button variant="outline" onClick={() => setPortalOpen(true)}>
            <ListPlus className="mr-2 h-4 w-4" aria-hidden />
            {WORDING.questionSet.addButton}
          </Button>
          <Button onClick={() => setUpload({ open: true })}>
            <Upload className="mr-2 h-4 w-4" aria-hidden />
            Upload a referrer form
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Point icon={Layers} title="Any number of referrers">
          Every referrer&apos;s form – and every version – side by side, each with its own questions and layout.
        </Point>
        <Point icon={Files} title="Their layout, not ours">
          Answers are written into the referrer&apos;s own Word or PDF file, in the boxes they printed.
        </Point>
        <Point icon={ShieldCheck} title="Checked once by staff">
          Nothing is used for patients until the mapping is confirmed. Changes need confirming again.
        </Point>
      </div>

      {!ready ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[420px] rounded-2xl" />
          ))}
        </div>
      ) : forms.length === 0 ? (
        <EmptyState
          icon={Files}
          title="No referrer forms yet"
          actions={
            <Button onClick={() => setUpload({ open: true })}>
              <Upload className="mr-2 h-4 w-4" aria-hidden />
              Upload a referrer form
            </Button>
          }
        >
          Upload the form an MLC or insurer sent you (.docx or PDF). The sample forms reappear after “Reset demo” on the
          Reports page.
        </EmptyState>
      ) : (
        <section aria-labelledby="library-heading" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="library-heading" className="text-lg font-semibold text-slate-900">
              Forms library
            </h2>
            <p className="text-sm text-slate-600">
              {plural(forms.length, "form")} from {plural(referrers, "referrer")} · {confirmed} confirmed
              {proposed ? ` · ${proposed} to review` : ""}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {forms.map((form) => (
              <FormCard key={form.id} form={form} />
            ))}
          </div>
        </section>
      )}

      {tryable.length ? (
        <section aria-labelledby="try-heading" className="space-y-3">
          <div>
            <h2 id="try-heading" className="text-lg font-semibold text-slate-900">
              Try a new form
            </h2>
            <p className="text-sm text-slate-600">
              Fictional referrer forms not in your library yet. Download one to see it as the referrer sent it, or analyse it
              now to watch a new form being mapped.
            </p>
          </div>
          {sampleError ? <Notice tone="error">{sampleError}</Notice> : null}
          <div className="grid gap-4 lg:grid-cols-2">
            {tryable.map((sample) => (
              <Card key={sample.id} className="rounded-2xl border-dashed border-slate-300 p-4 shadow-none">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{sample.referrer.name}</p>
                    <h3 className="text-base font-semibold text-slate-900">{sample.title}</h3>
                    <p className="text-xs text-slate-500">{REFERRER_TYPE_LABELS[sample.referrer.type]}</p>
                  </div>
                  <FormKindBadge kind={sample.kind} />
                </div>
                <p className="mt-2 text-sm text-slate-600">{sample.description}</p>
                {sample.highlights.length ? (
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
                    {sample.highlights.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {sample.form ? (
                    <Button size="sm" onClick={() => restoreSample(sample)}>
                      Add with its confirmed mapping
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busySample === sample.id} onClick={() => void analyseSample(sample)}>
                      <FileSearch className="mr-1.5 h-4 w-4" aria-hidden />
                      Analyse this form
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={busySample === sample.id} onClick={() => void downloadSample(sample)}>
                    <Download className="mr-1.5 h-4 w-4" aria-hidden />
                    Download sample form
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <DemoAssetForms samples={demoForms} onUpload={(sample) => setUpload({ open: true, file: null, sample })} />

      <PortalQuestionsDialog open={portalOpen} onOpenChange={setPortalOpen} />
      <UploadFormDialog
        open={upload.open}
        onOpenChange={(open) => setUpload((u) => ({ ...u, open }))}
        initialFile={upload.file ?? null}
        initialReferrer={upload.sample ? { name: upload.sample.referrer.name, type: upload.sample.referrer.type } : null}
      />
    </StudioShell>
  );
}

function Point({ icon: Icon, title, children }: { icon: typeof Files; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{children}</p>
      </div>
    </div>
  );
}
