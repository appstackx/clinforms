import "server-only";

/**
 * POST /sign – what every check of the approval pipeline sees (W0.6 plumbing, bh2). sign/index.ts builds it and runs
 * the checks in order; a check returns its refusal (a problem Response) or null to go on.
 *
 *   SignerCheckContext   once the signer is known (sign/checks/roles.ts approverCheck – WC)
 *   SignCheckContext     once the template or form map is resolved and the approval is complete
 *                        (issue.ts staleReportCheck before the validators; voice.ts signerConfirmationsCheck and
 *                        issue.ts issuedDocumentCheck after them – WB, WA1)
 *
 * Owner: W0 (shared; changes through the integrator) – docs/bh2-ownership.json.
 */
import type { Actor } from "../../../../auth/actor";
import type { Clinician, FormDefinition, Report, ReportTemplate } from "../../../../core/types";
import type { MedreportDeps } from "../../../deps";

export interface SignerCheckContext {
  /** The request (its body is already read – the parsed report is `report`). */
  req: Request;
  deps: MedreportDeps;
  /** Who is calling (auth/actor.ts: a clinic's signed-in member, or the public demo). */
  actor: Actor;
  /** The report as the request body carries it. */
  report: Report;
  /** Who signs: the member themselves, or the demo's fictional signer (roles.ts resolveSigner). */
  signer: Clinician;
}

export interface SignCheckContext extends SignerCheckContext {
  template: ReportTemplate;
  /** The verified form map of a form report, else null. */
  form: FormDefinition | null;
  /** Date.now() when the checks after the typed signature started (for the log's timings). */
  started: number;
}

/** A check of the approval: its refusal, or null to go on. */
export type SignCheck<C extends SignerCheckContext = SignCheckContext> = (ctx: C) => Promise<Response | null> | Response | null;
