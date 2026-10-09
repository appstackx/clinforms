import "server-only";

/**
 * GET /api/reports/v1/forms/samples → FormSamplesResponse {samples}: the bundled fictional referrer
 * forms (metadata, file hash and size, highlights) with their pre-confirmed form maps where recorded,
 * each carrying the server's attestation of exactly that map (confirmed.mapSha256 + mac).
 *
 * Dev/demo only: in demo mode with local demo assets on (ai/demo-assets.ts – never in production),
 * the local demonstration forms that have a prepared map are listed too, as `uploadRequired` entries:
 * no map is attached (nothing is seeded into the library) and the file itself is never served – staff
 * upload their own copy, and the upload gets the prepared map.
 *
 * Owner: forms-engine agent.
 */
import { listDemoAssetFormAnalyses } from "../../ai/recorded-forms";
import { verifyFormConfirmation, withAttestedConfirmation } from "../../auth/attestations";
import { resolveAiMode } from "../../config.server";
import { listSampleForms } from "../../forms/samples/registry";
import type { FormSample, FormSamplesResponse } from "../contract";
import { json, type MedreportHandler } from "../http";

/** The local demonstration forms with a prepared map, as library entries to upload (demo mode only). */
function demoAssetSamples(bundled: FormSample[]): FormSample[] {
  if (resolveAiMode() !== "demo") return [];
  const ids = new Set(bundled.map((s) => s.id));
  const files = new Set(bundled.map((s) => s.file.sha256));
  return listDemoAssetFormAnalyses()
    .filter((rec) => !ids.has(rec.sampleId) && !files.has(rec.fileSha256))
    .map((rec) => {
      const questions = rec.form.fields.length;
      return {
        id: rec.sampleId,
        title: rec.form.title,
        description: `Prepared for this demonstration. Upload your copy of exactly this file (${rec.form.file.fileName}) to load its prepared map – the file itself is not provided here.`,
        referrer: rec.form.referrer,
        kind: rec.form.kind,
        file: rec.form.file,
        highlights: [`${questions} question${questions === 1 ? "" : "s"} mapped in advance`, ...(rec.form.demoNotice ? [rec.form.demoNotice] : [])],
        uploadRequired: true,
      };
    });
}

export const handleFormSamples: MedreportHandler = async () => {
  const samples = await listSampleForms();
  const body: FormSamplesResponse = {
    // The bundled maps were checked and confirmed when the samples were built: the server attests
    // them here (auth/attestations.ts), exactly as POST /forms/confirm does for a staff-confirmed map.
    samples: [
      ...samples.map((sample) => {
        const form = sample.form;
        if (!form || form.status !== "confirmed" || !form.confirmed || verifyFormConfirmation(form).ok) return sample;
        return { ...sample, form: withAttestedConfirmation(form, form.confirmed.by, form.confirmed.at) };
      }),
      ...demoAssetSamples(samples),
    ],
  };
  return json(body);
};
