import "server-only";

/**
 * GET /api/reports/v1/forms/samples → FormSamplesResponse {samples}: the bundled fictional referrer
 * forms (metadata, file hash and size, highlights) with their pre-confirmed form maps where recorded,
 * each carrying the server's attestation of exactly that map (confirmed.mapSha256 + mac).
 *
 * Owner: forms-engine agent.
 */
import { verifyFormConfirmation, withAttestedConfirmation } from "../../auth/attestations";
import { listSampleForms } from "../../forms/samples/registry";
import type { FormSamplesResponse } from "../contract";
import { json, type MedreportHandler } from "../http";

export const handleFormSamples: MedreportHandler = async () => {
  const samples = await listSampleForms();
  const body: FormSamplesResponse = {
    // The bundled maps were checked and confirmed when the samples were built: the server attests
    // them here (auth/attestations.ts), exactly as POST /forms/confirm does for a staff-confirmed map.
    samples: samples.map((sample) => {
      const form = sample.form;
      if (!form || form.status !== "confirmed" || !form.confirmed || verifyFormConfirmation(form).ok) return sample;
      return { ...sample, form: withAttestedConfirmation(form, form.confirmed.by, form.confirmed.at) };
    }),
  };
  return json(body);
};
