import "server-only";

/**
 * POST /sign – who signs (wave 2): a clinic's signed-in member signs as themselves (name from the account, HCPC number
 * and job title from the member profile – never the body's `signer`); the public demo signs as the body's fictional
 * `signer`; a launch from the clinic system for another clinician is refused. Checked last: a made-up PH-DEMO number
 * approves in a demo clinic only.
 *
 * Split out of api/handlers/sign.ts by W0.4 (bh2 module split): the same code, moved; sign/index.ts calls it in the same order.
 * Owner: WC (review roles and provenance) – docs/bh2-ownership.json.
 */
import { actorInDemoClinic, memberSigner, type Actor } from "../../../../auth/actor";
import { isDemoHcpc } from "../../../../core/demo-clinic";
import type { Clinician, ReportApprover } from "../../../../core/types";
import { WORDING } from "../../../../core/wording";
import type { MedreportDeps } from "../../../deps";
import type { SignCheck, SignerCheckContext } from "./context";
import { logEvent, problem } from "../../../http";

const normaliseHcpc = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toUpperCase();

/** The signer of this approval, or the refusal (403 SIGNER_MISMATCH; memberSigner throws 403 SIGNER_NOT_ALLOWED). */
export function resolveSigner(actor: Actor, bodySigner: Clinician): { ok: true; signer: Clinician } | { ok: false; response: Response } {
  let signer: Clinician;
  if (actor.via === "demo") {
    signer = bodySigner;
  } else {
    signer = memberSigner(actor); // 403 SIGNER_NOT_ALLOWED
    if (normaliseHcpc(bodySigner.hcpc) !== normaliseHcpc(signer.hcpc)) {
      return { ok: false, response: problem(403, WORDING.server.access.signAsYourselfTitle, { code: "SIGNER_MISMATCH", detail: WORDING.server.access.signAsYourself(signer.name) }) };
    }
  }
  const launched = actor.session?.kind === "launch" ? actor.session.clinician : undefined;
  if (launched && normaliseHcpc(launched.hcpc) !== normaliseHcpc(signer.hcpc)) {
    return {
      ok: false,
      response: problem(403, "Approve as yourself", {
        code: "SIGNER_MISMATCH",
        detail: `The clinic system opened this report for ${launched.name} (HCPC ${launched.hcpc}). Only they can approve it from this session; another clinician must open the patient from the clinic system themselves.`,
      }),
    };
  }
  return { ok: true, signer };
}

/**
 * Whether the actor's clinic is a demo clinic (false for the public demo), and the refusal when a made-up PH-DEMO
 * number would approve outside one (403 DEMO_NUMBER_NOT_ALLOWED). Run after every other check.
 */
export async function demoNumberCheck(input: { deps: MedreportDeps; actor: Actor; signer: Clinician; templateId: string; started: number }): Promise<{ demoClinic: boolean; response: Response | null }> {
  const { deps, actor, signer, started } = input;
  // 10/2026: a made-up PH-DEMO number approves in a demo clinic only – never on a real clinic's form. Checked last, so
  // every other refusal reads as before. The clinic's flag is the server's (false for the public demo, and when the
  // clinic's profile cannot be read: fail closed).
  const demoClinic = actor.via === "demo" ? false : await actorInDemoClinic(deps, actor);
  if (actor.via !== "demo" && isDemoHcpc(signer.hcpc) && !demoClinic) {
    logEvent("sign_refused_demo_number", { template: input.templateId, ms: Date.now() - started });
    return { demoClinic, response: problem(403, WORDING.demoClinic.numberNotAllowedTitle, { code: "DEMO_NUMBER_NOT_ALLOWED", detail: WORDING.demoClinic.numberNotAllowedDetail }) };
  }
  return { demoClinic, response: null };
}

/**
 * The signer is this approver: the same member account – the member id the review compares when it decides who makes
 * the approver's decisions (core/provenance.ts sameMember). Never the registration number alone (check-WC problem 2):
 * the approver chosen on a report could otherwise name one member's id with another's number. The receipt carries the
 * signer's own number from their member profile.
 */
function signerIsApprover(ctx: Pick<SignerCheckContext, "actor">, approver: ReportApprover): boolean {
  return Boolean(ctx.actor.userId && approver.memberId === ctx.actor.userId);
}

/**
 * WC design 1: a clinic's approval is the report's approving clinician's (Report.approver, hashed, chosen when the
 * report was created). Another member who may sign takes over first – "Take over as approver" on the review screen,
 * audited and hashed (Report.approverTakeovers; the report's approver is then them) – else 409 APPROVER_MISMATCH.
 * The receipt repeats the last takeover (SignReceipt.approverTakeover, MAC-covered). A report with no approver (an
 * earlier build's) and the public demo (one fictional user) are as before.
 */
export const approverCheck: SignCheck<SignerCheckContext> = (ctx) => {
  const approver = ctx.report.approver;
  if (!approver || ctx.actor.via === "demo") return null;
  if (!signerIsApprover(ctx, approver)) {
    logEvent("sign_refused_not_approver", { report: ctx.report.id });
    return problem(409, "Take over as approver first", {
      code: "APPROVER_MISMATCH",
      detail: `${approver.name} is this report's approving clinician. To approve it yourself, choose “Take over as approver” on the review screen first – their decisions on it then need yours.`,
    });
  }
  const takeovers = ctx.report.approverTakeovers ?? [];
  const last = takeovers[takeovers.length - 1];
  if (last && last.to.memberId === approver.memberId && normaliseHcpc(last.to.hcpc) === normaliseHcpc(approver.hcpc)) ctx.receiptAdditions.approverTakeover = last;
  return null;
};
