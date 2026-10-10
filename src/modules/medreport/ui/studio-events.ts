/**
 * Product-event properties for HostHooks.track (wave 2, tenant Studio). Pure and browser-safe.
 *
 * Only enumerated values, small counts and booleans ever leave here: never a patient, clinician, clinic
 * or referrer name, an id, a file name, a date or any text from a record or a form. The host passes them
 * through its own allow-list (src/components/analytics/events.ts) as well. Pinned by studio-events.test.ts.
 */
import type { ConnectorId, FormDefinition, FormKind, ReferrerType, Report } from "../core/types";
import type { StudioEventProps } from "./host-hooks";

const FORM_KIND: Record<FormKind, NonNullable<StudioEventProps["form_kind"]>> = {
  docx: "docx",
  pdf_acroform: "pdf_fillable",
  pdf_flat: "pdf_flat",
  questions: "questions",
};

const REFERRER_TYPE: Record<ReferrerType, NonNullable<StudioEventProps["referrer_type"]>> = {
  insurer: "insurer",
  mlc: "medico_legal",
  solicitor: "solicitor",
  case_manager: "case_manager",
  employer: "employer",
  other: "other",
};

const SOURCE: Record<ConnectorId, NonNullable<StudioEventProps["source"]>> = {
  tm3: "clinic_system",
  "tm3-sim": "simulated_clinic_system",
  "file-import": "export_upload",
};

/** Whole numbers 0 – 100 000 only (anything else is dropped). */
function count(n: number): number | undefined {
  return Number.isInteger(n) && n >= 0 && n <= 100_000 ? n : undefined;
}

function withCounts(props: StudioEventProps): StudioEventProps {
  const out: StudioEventProps = {};
  for (const [key, value] of Object.entries(props) as Array<[keyof StudioEventProps, StudioEventProps[keyof StudioEventProps]]>) {
    if (value === undefined) continue;
    if (typeof value === "number") {
      const n = count(value);
      if (n !== undefined) (out as Record<string, unknown>)[key] = n;
    } else {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/** A form map: its kind, referrer type, number of questions and how it was read. */
export function formEventProps(form: Pick<FormDefinition, "kind" | "referrer" | "fields"> & { analysis?: { mode?: string } }): StudioEventProps {
  const analysisMode = form.analysis?.mode;
  return withCounts({
    form_kind: FORM_KIND[form.kind],
    referrer_type: REFERRER_TYPE[form.referrer.type],
    question_count: form.fields.length,
    ...(analysisMode === "live" ? { mode: "live" as const } : analysisMode ? { mode: "demo" as const } : {}),
  });
}

/** A report: where its record came from, its form kind, answers, open gaps and whether anything was drafted live. */
export function reportEventProps(report: Pick<Report, "episodeRef" | "sections" | "gaps" | "generation" | "form" | "instructingParty">): StudioEventProps {
  const answered = report.sections.filter((s) => s.status === "complete" || s.status === "drafted").length;
  const openGaps = report.gaps.filter((g) => !g.resolution).length;
  const live = report.generation.some((g) => g.mode === "live");
  return withCounts({
    source: SOURCE[report.episodeRef.connectorId],
    ...(report.form ? { form_kind: FORM_KIND[report.form.kind] } : {}),
    referrer_type: REFERRER_TYPE[report.form?.referrer.type ?? report.instructingParty.type],
    question_count: report.sections.length,
    answer_count: answered,
    gap_count: openGaps,
    ...(report.generation.length ? { mode: live ? ("live" as const) : ("demo" as const) } : {}),
  });
}

/** Seconds between two timestamps (ms), rounded; undefined when negative or absurd. */
export function durationSeconds(startedMs: number, endedMs: number = Date.now()): number | undefined {
  return count(Math.round((endedMs - startedMs) / 1000));
}

/** The file format of a download ("original" Word → docx, PDF form → pdf). */
export function downloadFormat(contentType: string): "docx" | "pdf" {
  return contentType.includes("pdf") ? "pdf" : "docx";
}
