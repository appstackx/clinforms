import "server-only";

/**
 * POST /sign – what every check of the approval pipeline sees (W0.6 plumbing, bh2). sign/index.ts builds it and runs
 * the checks in order; a check returns its refusal (a problem Response) or null to go on.
 *
 *   SignerCheckContext   once the signer is known (sign/checks/roles.ts approverCheck – WC)
 *   SignCheckContext     once the template or form map is resolved and the approval is complete
 *                        (issue.ts staleReportCheck before the validators; voice.ts signerConfirmationsCheck and
 *                        issue.ts issuedDocumentCheck after them – WB, WA1)
 *   receiptAdditions     (bh2 W0 follow-up, seam "receipt-mac") what a check adds to the receipt: each check sets only its
 *                        own keys – WC's approverCheck the takeover, WB's signerConfirmationsCheck the confirmations,
 *                        WA1's issuedDocumentCheck the issued-document and acknowledgement hashes – and sign/index.ts hands
 *                        the same object to mintReceipt, so no check needs another's file or auth/sign-receipt.ts.
 *
 * Owner: W0 (shared; changes through the integrator) – docs/bh2-ownership.json.
 */
import type { Actor } from "../../../../auth/actor";
import type { ReceiptAdditions } from "../../../../auth/sign-receipt";
import type { Clinician, FormDefinition, Report, ReportTemplate, SignerConfirmation } from "../../../../core/types";
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
  /** What the checks add to the receipt (one object for the whole pipeline; empty unless a check sets a key). */
  receiptAdditions: ReceiptAdditions;
  /**
   * bh2 (WB design 13; ownership exception – W0's file): the confirmations the approver gave in the approve dialog
   * (SignRequest.confirmations), read by voice.ts signerConfirmationsCheck. Absent: none given.
   */
  confirmations?: SignerConfirmation[];
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
