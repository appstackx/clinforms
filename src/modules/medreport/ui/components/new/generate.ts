/**
 * Create a report for one patient and draft it, group by group (shared by the new-report wizard and
 * batch).
 *
 * - Referrer form: createFormReport() fills registration and computed answers by CODE now; the
 *   narrative and opinion questions are drafted by POST /drafts with `form`, in the groups planned by
 *   planDraftGroups() (up to MAX_FORM_FIELDS_PER_DRAFT fields per call).
 * - Built-in template (fallback when the referrer sent no form): createReport() + POST /drafts.
 *
 * Groups run with a concurrency cap; each result is merged with applyDraftResult() as it arrives. A
 * failed group never stops the others: its questions are marked "needs input" and the failure is
 * recorded in the activity log, so the clinician can answer them or redraft later. Finally POST
 * /validate refreshes the flags (best effort).
 *
 * Browser-safe (no SDK, no server code); the API client is injected for tests.
 *
 * Owner: studio-a agent.
 */
import type { BundleResponse } from "../../../api/contract";
import { formToTemplate, isFormReport, primaryTreatingClinician } from "../../../core/forms";
import { appendActivity, applyDraftResult, createFormReport, createReport, planDraftGroups } from "../../../core/report-factory";
import type {
  Clinician,
  EpisodeBundle,
  FormDefinition,
  GenerationMode,
  InstructingParty,
  Report,
  ReportTemplate,
} from "../../../core/types";
import type { ApiClient } from "../../api-client";
import { WORDING } from "../../wording";
import { runPool } from "../shared/pool";
import { errorMessage } from "../shared/format";

export const NO_DEMO_DRAFT_CODE = "NO_DEMO_DRAFT";
export const NO_DEMO_DRAFT_MESSAGE = WORDING.drafting.noDemoDraftMessage;

export type GenerateTarget = { kind: "form"; form: FormDefinition } | { kind: "template"; template: ReportTemplate };

export type DraftGroupStatus = "queued" | "drafting" | "done" | "failed";

export interface DraftGroupProgress {
  index: number;
  keys: string[];
  /** Question labels / section titles, in order. */
  labels: string[];
  status: DraftGroupStatus;
  mode?: GenerationMode;
  model?: string;
  ms?: number;
  error?: string;
  /** Problem code of a failure, e.g. NO_DEMO_DRAFT. */
  code?: string;
  /** Live drafting is at its per-minute limit: this group waits for a free slot, then tries again. */
  waitingForSlot?: boolean;
}

export interface GenerateInput {
  client: Pick<ApiClient, "drafts" | "validate">;
  data: Pick<BundleResponse, "bundle" | "computedFacts" | "demoDrafts">;
  target: GenerateTarget;
  /** Treating clinician for clinician.* form fields (e.g. the clinician who launched from TM3). */
  clinician?: Clinician;
  /**
   * A live drafting passcode is set in this tab, so /drafts may draft live. When false and the bundle
   * response lists the demo drafts it holds (`demoDrafts`), questions with no demo draft are not sent
   * to /drafts (they would return NO_DEMO_DRAFT): they are left for the clinician.
   */
  livePossible?: boolean;
  /** Concurrent /drafts calls (wizard: 3; batch: 1 per item). */
  concurrency?: number;
  signal?: AbortSignal;
  actor?: string;
  /** Called with the latest report after creation and after every merge (persist it here). */
  onReport?(report: Report): void;
  onProgress?(groups: DraftGroupProgress[]): void;
  now?: () => Date;
  /** Wait between attempts when live drafting is at its per-minute limit (injected for tests). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Live drafting is capped per minute on the server (429 RATE_LIMITED, about 6 calls a minute). A
 * group that hits the cap waits for a free slot and tries again – up to RATE_LIMIT_ATTEMPTS times,
 * RATE_LIMIT_WAIT_MS apart – instead of failing, so completing a second form straight after the first
 * (or a batch) still drafts live.
 */
export const RATE_LIMIT_ATTEMPTS = 5;
export const RATE_LIMIT_WAIT_MS = 12_000;

function isRateLimited(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown } | null;
  return !!e && e.status === 429 && e.code === "RATE_LIMITED";
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface GenerateResult {
  report: Report;
  groups: DraftGroupProgress[];
  failedGroups: number;
}

/** The instructing party of an episode: its referral, without the referral-only details. */
export function instructingPartyOf(bundle: EpisodeBundle): InstructingParty {
  const { type, name, reference, contactName, address } = bundle.referral;
  return { type, name, reference, contactName, address };
}

/** The template a target drafts against (forms: formToTemplate). */
export function templateOf(target: GenerateTarget): ReportTemplate {
  return target.kind === "form" ? formToTemplate(target.form) : target.template;
}

/** Create the report (no drafting) – code-filled answers only. */
export function createTargetReport(input: Pick<GenerateInput, "data" | "target" | "clinician" | "actor" | "now">): Report {
  const now = input.now?.() ?? new Date();
  const common = {
    bundle: input.data.bundle,
    instructingParty: instructingPartyOf(input.data.bundle),
    computedFacts: input.data.computedFacts,
    now,
    actor: input.actor,
  };
  const created =
    input.target.kind === "form"
      ? createFormReport({ ...common, form: input.target.form, clinician: input.clinician ?? primaryTreatingClinician(input.data.bundle) ?? undefined })
      : createReport({ ...common, template: input.target.template });
  // Remember whether this deployment holds demo answers for this record (review's "Draft them now").
  const demo = input.data.demoDrafts;
  if (!demo) return created;
  const covered = input.target.kind === "form" ? demo.formSha256s.includes(input.target.form.file.sha256) : demo.templateIds.includes(created.templateId);
  return { ...created, demoDraftsAvailable: covered };
}

export async function generateReport(input: GenerateInput): Promise<GenerateResult> {
  const now = () => input.now?.() ?? new Date();
  const template = templateOf(input.target);
  const form = input.target.kind === "form" ? input.target.form : undefined;
  let report = createTargetReport(input);
  input.onReport?.(report);

  const titleOf = (key: string) => template.sections.find((s) => s.key === key)?.title ?? key;
  const groups: DraftGroupProgress[] = planDraftGroups(report, template).map((keys, index) => ({
    index,
    keys,
    labels: keys.map(titleOf),
    status: "queued",
  }));
  const emit = () => input.onProgress?.(groups.map((g) => ({ ...g })));
  emit();

  // Demo mode without a demo draft for this patient and form: nothing to fetch.
  const demo = input.data.demoDrafts;
  const demoCovered = form ? demo?.formSha256s.includes(form.file.sha256) : demo?.templateIds.includes(report.templateId);
  if (!input.livePossible && demo && !demoCovered) {
    return finish(
      groups.map(() => ({ ok: false, error: Object.assign(new Error(NO_DEMO_DRAFT_MESSAGE), { code: NO_DEMO_DRAFT_CODE }) })),
    );
  }

  const results = await runPool(
    groups,
    input.concurrency ?? 3,
    async (group) => {
      group.status = "drafting";
      emit();
      const started = Date.now();
      const request = {
        templateId: report.templateId,
        bundle: input.data.bundle,
        instructingParty: report.instructingParty,
        sectionKeys: group.keys,
        prefer: "auto" as const,
        ...(form && { form }),
        ...(form && report.author ? { author: report.author } : {}),
      };
      let res;
      for (let attempt = 1; ; attempt++) {
        try {
          res = await input.client.drafts(request, { signal: input.signal });
          break;
        } catch (err) {
          if (!isRateLimited(err) || attempt >= RATE_LIMIT_ATTEMPTS || input.signal?.aborted) throw err;
          group.waitingForSlot = true;
          emit();
          await (input.sleep ?? defaultSleep)(RATE_LIMIT_WAIT_MS, input.signal);
          group.waitingForSlot = false;
          emit();
        }
      }
      report = applyDraftResult(report, res, { now: now() });
      group.status = "done";
      group.mode = res.generation.mode;
      group.model = res.generation.model;
      group.ms = res.generation.durationMs ?? Date.now() - started;
      emit();
      input.onReport?.(report);
      return res;
    },
    input.signal,
  );
  return finish(results);

  async function finish(results: ReadonlyArray<{ ok: boolean; error?: unknown; skipped?: boolean }>): Promise<GenerateResult> {
    let failedGroups = 0;
    results.forEach((result, i) => {
      if (result.ok) return;
      failedGroups += 1;
      const group = groups[i];
      const code = (result.error as { code?: unknown } | null)?.code;
      group.status = "failed";
      group.error = result.skipped ? "Not started (cancelled)." : errorMessage(result.error);
      group.code = typeof code === "string" ? code : undefined;
      const keys = new Set(group.keys);
      report = {
        ...report,
        sections: report.sections.map((s) => (keys.has(s.key) && s.status === "pending" ? { ...s, status: "needs_input" as const } : s)),
      };
      report = appendActivity(
        report,
        {
          actor: "System",
          action: "draft_failed",
          detail: `Could not draft ${group.keys.join(", ")}: ${group.error} These ${isFormReport(report) ? "questions" : "sections"} need completing by the clinician.`,
        },
        now(),
      );
    });
    if (failedGroups > 0) {
      emit();
      input.onReport?.(report);
    }

    if (!input.signal?.aborted) {
      try {
        const validation = await input.client.validate({ report, ...(form && { form }) }, { signal: input.signal });
        report = { ...report, flags: validation.flags };
        input.onReport?.(report);
      } catch {
        // Best effort: the review screen validates again on load.
      }
    }

    return { report, groups: groups.map((g) => ({ ...g })), failedGroups };
  }
}

/** Plain-English label for how a group was drafted (customer-facing wording: core/wording.ts). */
export function generationModeLabel(mode: GenerationMode | undefined, model?: string): string {
  return WORDING.drafting.groupDone(mode, model);
}
