import "server-only";

/**
 * GET /api/reports/v1/forms/samples → FormSamplesResponse {samples}: the bundled fictional referrer
 * forms (metadata, file hash and size, highlights) with their pre-confirmed form maps where recorded,
 * each carrying the server's attestation of exactly that map (confirmed.mapSha256 + mac).
 *
 * Dev/demo only: with local demo assets on (ai/demo-assets.ts – never in production; any AI mode),
 * the local demonstration forms that have a prepared map are listed too, as `uploadRequired` entries:
 * no map is attached (nothing is seeded into the library) and the file itself is never served – staff
 * upload their own copy, and the upload gets the prepared map.
 *
 * Owner: forms-engine agent.
 */
import { listDemoAssetFormAnalyses } from "../../ai/recorded-forms";
import { verifyFormConfirmation, withAttestedConfirmation } from "../../auth/attestations";
import { isQuestionSet } from "../../core/question-set";
import { listSampleForms } from "../../forms/samples/registry";
import type { FormSample, FormSamplesResponse } from "../contract";
import { json, type MedreportHandler } from "../http";

/**
 * The local demonstration forms with a prepared map, as library entries to upload – whenever the demo
 * assets are on (ai/demo-assets.ts: dev/demo only, never in production), whatever MEDREPORT_AI_MODE says:
 * an "auto" .env.local with a key and a passcode resolves to "live", yet a request without the passcode is
 * still demo, and these entries only point at a file to upload.
 */
function demoAssetSamples(bundled: FormSample[]): FormSample[] {
  const ids = new Set(bundled.map((s) => s.id));
  const files = new Set(bundled.map((s) => s.file.sha256));
  return listDemoAssetFormAnalyses()
    .filter((rec) => !ids.has(rec.sampleId) && !files.has(rec.fileSha256))
    .map((rec): FormSample => {
      const questions = rec.form.fields.length;
      // A prepared portal question set has no file to upload: it is seeded into the library with its
      // confirmed map (attested here, as the bundled samples are), so nobody types the questions live.
      if (isQuestionSet(rec.form)) {
        const at = rec.form.confirmed?.at ?? rec.recordedAt;
        const by = rec.form.confirmed?.by ?? "Prepared for this demonstration";
        return {
          id: rec.sampleId,
          title: rec.form.title,
          description: "Portal questions prepared for this demonstration (illustrative and fictional): answered from the notes, ready to copy into the portal.",
          referrer: rec.form.referrer,
          kind: rec.form.kind,
          file: rec.form.file,
          highlights: [`${questions} question${questions === 1 ? "" : "s"}`],
          form: withAttestedConfirmation({ ...rec.form, status: "confirmed", sampleId: rec.sampleId }, by, at),
        };
      }
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
