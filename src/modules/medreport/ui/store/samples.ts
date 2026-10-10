/**
 * The bundled sample forms (GET /forms/samples), fetched once per page load – shared by both store backends
 * (the browser backend seeds them into the demo's library; the forms library offers them in either mode).
 */
import { FormSamplesResponseSchema, reportApiPaths, type FormSample } from "../../api/contract";

let samplesPromise: Promise<FormSample[]> | null = null;

/** GET /forms/samples, once per page load ([] when unreachable; retried on the next call). */
export function fetchSampleForms(): Promise<FormSample[]> {
  if (!samplesPromise) {
    samplesPromise = (async () => {
      const res = await fetch(reportApiPaths.formSamples(), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = FormSamplesResponseSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("Unexpected /forms/samples response");
      return parsed.data.samples;
    })();
    samplesPromise.catch(() => {
      samplesPromise = null;
    });
  }
  return samplesPromise.catch(() => [] as FormSample[]);
}

/** Forget the cached samples (resetDemo). */
export function resetSampleCache(): void {
  samplesPromise = null;
}
