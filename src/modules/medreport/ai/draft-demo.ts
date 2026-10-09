import "server-only";

/**
 * Demo drafting: loads a file from ai/demo-drafts/ (see demo-format.ts), filtered to the requested
 * sections. Same schema, assembly and validators as live output; no fake delay; always badged –
 * "Pre-written draft – no AI call" (demo_prewritten) or "Recorded Claude output, {date}, {model},
 * prompt v{n}" (demo_recorded).
 *
 * Built-in templates: `{patientId}__{templateId}`. Referrer forms: `{patientId}__form-{sampleId|formId}`,
 * or any form draft for this patient recorded against the same referrer file (SHA-256) – a draft
 * recorded for a different file is never used, because its field IDs could point at other questions.
 *
 * A draft is only used for the record it was made from: a simulated-TM3 bundle whose notes match the
 * file's bundleFingerprint (ai/bundle-fingerprint.ts). An upload that reuses a demo patient ID, or a
 * record whose notes differ, never receives another record's answers.
 *
 * Owner: ai agent.
 */
import { answerKindFor, formAnchorKeys } from "../core/forms";
import type { EpisodeBundle, FormDefinition, GenerationMeta } from "../core/types";
import { WORDING } from "../core/wording";
import { RECORDED_DRAFT_CONNECTOR, bundleNotesFingerprint } from "./bundle-fingerprint";
import { DEMO_DRAFT_SOURCES } from "./demo-drafts";
import { DemoDraftFileSchema, demoDraftKey, demoFormDraftKey, type DemoDraftFile } from "./demo-format";
import { DraftGenerationError, type DraftOutput, type GenerateDraftInput, type GenerateDraftResult } from "./types";

const parsed = new Map<string, DemoDraftFile | null>();

function loadDemoFile(key: string): DemoDraftFile | null {
  if (parsed.has(key)) return parsed.get(key) ?? null;
  const raw = DEMO_DRAFT_SOURCES[key];
  const result = raw === undefined ? null : DemoDraftFileSchema.safeParse(raw);
  const file = result && result.success ? result.data : null;
  parsed.set(key, file);
  return file;
}

type DraftBundle = Pick<EpisodeBundle, "source" | "notes">;

/** Whether a recorded file was made from exactly this record. */
function madeFrom(file: DemoDraftFile, bundle: DraftBundle): boolean {
  return (
    bundle.source.connectorId === RECORDED_DRAFT_CONNECTOR &&
    file.patientId === bundle.source.externalPatientId &&
    file.bundleFingerprint !== undefined &&
    file.bundleFingerprint === bundleNotesFingerprint(bundle)
  );
}

/** The demo draft file for this record + built-in template, or null. Parsed (and validated) once per instance. */
export function getDemoDraftFile(bundle: DraftBundle, templateId: string): DemoDraftFile | null {
  const file = loadDemoFile(demoDraftKey(bundle.source.externalPatientId, templateId));
  return file && madeFrom(file, bundle) ? file : null;
}

/**
 * The demo draft file for a patient + referrer form, or null: by sample/form key first, then any form
 * draft of this patient recorded against the same file. Only a draft bound to the form's file SHA-256 is used.
 */
export function getDemoFormDraftFile(bundle: DraftBundle, form: Pick<FormDefinition, "id" | "sampleId" | "file">): DemoDraftFile | null {
  const patientId = bundle.source.externalPatientId;
  const matches = (f: DemoDraftFile | null): f is DemoDraftFile =>
    f !== null && f.formSha256 === form.file.sha256 && madeFrom(f, bundle);
  const direct = loadDemoFile(demoFormDraftKey(patientId, form));
  if (matches(direct)) return direct;
  for (const key of Object.keys(DEMO_DRAFT_SOURCES).sort()) {
    if (!key.startsWith(`${patientId}__form-`)) continue;
    const file = loadDemoFile(key);
    if (matches(file)) return file;
  }
  return null;
}

/** Whether a demo draft exists for this record and template (lets the UI offer "Use demo draft"). */
export function hasDemoDraft(bundle: DraftBundle, templateId: string, form?: Pick<FormDefinition, "id" | "sampleId" | "file">): boolean {
  return (form ? getDemoFormDraftFile(bundle, form) : getDemoDraftFile(bundle, templateId)) !== null;
}

/** Which demo drafts exist for this record: built-in template IDs and referrer-form file SHA-256s. */
export function demoDraftAvailability(bundle: DraftBundle): { templateIds: string[]; formSha256s: string[] } {
  const patientId = bundle.source.externalPatientId;
  const templateIds = new Set<string>();
  const formSha256s = new Set<string>();
  for (const key of Object.keys(DEMO_DRAFT_SOURCES).sort()) {
    if (!key.startsWith(`${patientId}__`)) continue;
    const file = loadDemoFile(key);
    if (!file || !madeFrom(file, bundle)) continue;
    if (file.formSha256) formSha256s.add(file.formSha256);
    else templateIds.add(file.templateId);
  }
  return { templateIds: Array.from(templateIds), formSha256s: Array.from(formSha256s) };
}

export async function draftDemo(input: GenerateDraftInput): Promise<GenerateDraftResult> {
  const file = input.form ? getDemoFormDraftFile(input.bundle, input.form) : getDemoDraftFile(input.bundle, input.template.id);
  if (!file) {
    throw new DraftGenerationError(
      "NO_DEMO_DRAFT",
      input.form
        ? WORDING.server.noDemoFormAnswers
        : WORDING.server.noDemoTemplateDraft,
    );
  }

  // Which recorded section answers each requested key. Forms: matched by answer space and answer
  // type (formAnchorKeys), so a map of the same file with different field IDs still gets the right
  // answers – and an answer whose space is not in this map is never used.
  const recordedKeyFor = new Map<string, string>();
  if (input.form && file.fields) {
    const byAnchor = new Map(Object.entries(file.fields).map(([id, f]) => [f.anchor, { id, answerType: f.answerType }]));
    const keys = formAnchorKeys(input.form);
    for (const key of input.sectionKeys) {
      const field = input.form.fields.find((f) => f.id === key);
      const rec = field ? byAnchor.get(keys.get(key) ?? "") : undefined;
      if (field && rec && answerKindFor(rec.answerType) === answerKindFor(field.answerType)) recordedKeyFor.set(rec.id, key);
    }
  } else {
    for (const key of input.sectionKeys) recordedKeyFor.set(key, key);
  }

  const output: DraftOutput = { sections: [], gaps: [] };
  const found = new Set<string>();
  for (const group of Object.values(file.groups)) {
    for (const section of group.sections) {
      const key = recordedKeyFor.get(section.sectionKey);
      if (!key || found.has(key)) continue;
      found.add(key);
      output.sections.push({ ...section, sectionKey: key });
      output.gaps.push(...group.gaps.filter((g) => g.sectionKey === section.sectionKey).map((g) => ({ ...g, sectionKey: key })));
    }
  }
  if (found.size === 0) {
    throw new DraftGenerationError(
      "NO_DEMO_DRAFT",
      input.form ? "The demo answers for this patient do not cover these questions." : "The demo draft for this patient does not cover these sections.",
    );
  }
  // Keep the requested order.
  output.sections.sort((a, b) => input.sectionKeys.indexOf(a.sectionKey) - input.sectionKeys.indexOf(b.sectionKey));

  const meta: GenerationMeta = {
    mode: file.mode,
    sectionKeys: input.sectionKeys.slice(),
    at: new Date().toISOString(),
    promptVersion: file.promptVersion,
  };
  if (file.mode === "demo_recorded") {
    if (file.model) meta.model = file.model;
    if (file.recordedAt) meta.recordedAt = file.recordedAt;
    if (file.effort) meta.effort = file.effort;
  }
  return { output, meta };
}
