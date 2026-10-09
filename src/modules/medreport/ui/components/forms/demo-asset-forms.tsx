"use client";

/**
 * Forms library, dev/demo only: the local demonstration forms whose map is prepared on this server
 * (GET /forms/samples entries with `uploadRequired`, ai/demo-assets.ts). Their files are never served,
 * so each card asks staff to upload their own copy of exactly that file; the upload then gets the
 * prepared map to check and confirm. Renders nothing when there are none (always, in production).
 */
import { Upload } from "lucide-react";
import type { FormSample } from "../../../api/contract";
import { REFERRER_TYPE_LABELS } from "../../../core/labels";
import { Button, Card } from "../../primitives";
import { FormKindBadge } from "../shared/ui-bits";

export function DemoAssetForms({ samples, onUpload }: { samples: FormSample[]; onUpload(sample: FormSample): void }) {
  if (samples.length === 0) return null;
  return (
    <section aria-labelledby="demo-forms-heading" className="space-y-3">
      <div>
        <h2 id="demo-forms-heading" className="text-lg font-semibold text-slate-900">
          Demonstration forms
        </h2>
        <p className="text-sm text-slate-600">
          Public forms prepared for this demonstration. Upload your copy of the exact file to load its prepared mapping, then
          check and confirm it as usual.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {samples.map((sample) => (
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
            <div className="mt-3">
              <Button size="sm" onClick={() => onUpload(sample)}>
                <Upload className="mr-1.5 h-4 w-4" aria-hidden />
                Upload this form
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
