import "server-only";

/**
 * POST /sign – what would be issued: the validators re-run on the report (core/validation validateReport, with the
 * form map – mail-merge fields left on the form block approval, 10/2026); 409 SIGNOFF_BLOCKED (problem.flags) if
 * blocking items remain.
 *
 * Split out of api/handlers/sign.ts by W0.4 (bh2 module split): the same code, moved; sign/index.ts calls it in the same order.
 * Owner: WA1 (issue state and receipt) – docs/bh2-ownership.json.
 */
import { validateReport, type ValidateReportResult } from "../../../../core/validation";
import type { FormDefinition, Report, ReportTemplate } from "../../../../core/types";
import { logEvent, problem } from "../../../http";

/** The validators' result, and the refusal (409 SIGNOFF_BLOCKED) when blocking items remain. */
export function validationCheck(input: { report: Report; template: ReportTemplate; form: FormDefinition | null; started: number }): { result: ValidateReportResult; response: Response | null } {
  const { report, template, started } = input;
  // A form report: the form map too (10/2026 – mail-merge fields left on the form block approval).
  const result = validateReport(report, template, { form: input.form });
  if (!result.canSign) {
    logEvent("sign_blocked", { template: template.id, blocking: result.blocking.length, ms: Date.now() - started });
    return {
      result,
      response: problem(409, "Blocking items remain", {
        code: "SIGNOFF_BLOCKED",
        detail: `${result.blocking.length} item${result.blocking.length === 1 ? "" : "s"} must be resolved before approval.`,
        flags: result.blocking,
      }),
    };
  }
  return { result, response: null };
}
