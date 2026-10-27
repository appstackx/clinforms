/**
 * Safety corpus: the validators a case runs against.
 *
 * The candidate engine is this tree's core/validation. corpus-diff.ts builds a second engine from the production
 * snapshot (e132057) and runs every case through both (the differential gate). Calls pass the release's options too
 * (`voice: {owner}`, the actor as canAcknowledge's third argument); an engine that does not know them ignores them.
 */
import { canAcknowledge, canSign, validateReport } from "../../index";
import type { ComputedFact, FormDefinition, Gap, Report, ReportFlag, ReportTemplate } from "../../../types";

export interface EngineResult {
  flags: ReportFlag[];
  blocking: ReportFlag[];
  canSign: boolean;
}

export interface ValidatorEngine {
  label: string;
  validate(
    report: Report,
    template: ReportTemplate,
    opts: { computedFacts: ComputedFact[]; form: FormDefinition | null; owner: Record<string, unknown> | null },
  ): EngineResult;
  canAcknowledge(flag: ReportFlag, report: Report, actor: Record<string, unknown>): boolean;
  canSign(flags: ReportFlag[], gaps: Gap[]): { ok: boolean; blocking: ReportFlag[] };
}

type LooseValidate = (report: Report, template: ReportTemplate, opts: Record<string, unknown>) => { flags: ReportFlag[]; blocking: ReportFlag[]; canSign: boolean };
type LooseAck = (flag: ReportFlag, report: Report, actor?: unknown) => boolean;
type LooseCanSign = (flags: ReportFlag[], gaps: Gap[]) => { ok: boolean; blocking: ReportFlag[] };

/** An engine from a validation module's exports (this tree's, or a snapshot's). */
export function engineFrom(label: string, mod: { validateReport: unknown; canAcknowledge: unknown; canSign: unknown }): ValidatorEngine {
  const v = mod.validateReport as LooseValidate;
  const ack = mod.canAcknowledge as LooseAck;
  const cs = mod.canSign as LooseCanSign;
  return {
    label,
    validate(report, template, opts) {
      const r = v(report, template, {
        computedFacts: opts.computedFacts,
        ...(opts.form ? { form: opts.form } : {}),
        voice: { owner: opts.owner },
      });
      return { flags: r.flags, blocking: r.blocking, canSign: r.canSign };
    },
    canAcknowledge: (flag, report, actor) => ack(flag, report, actor),
    canSign: (flags, gaps) => cs(flags, gaps),
  };
}

export const CANDIDATE_ENGINE: ValidatorEngine = engineFrom("candidate", { validateReport, canAcknowledge, canSign });
