import "server-only";

/**
 * POST /sign – the approving clinician's own voice, and their sign-time confirmations (plan WB designs 6 and 13).
 *
 * voiceRefusal (fix wave 2; fix round 1, B0-1; bh2 design 6 "a code mapping"): the validators decide whose "I" a report
 * speaks in – its voice owner (validation/attribution-owner.ts: the approving clinician; a report made before one was
 * chosen, its author). /sign maps the two first-person cases a signer cannot fix by acknowledging to 409
 * SIGNER_NOT_AUTHOR, before the validators run, with the questions to edit:
 * - drafted answers (origin "ai") speak in the voice owner's first person and someone else approves them;
 * - no voice owner at all (strict mode): drafted answers say "I" or "my" about notes the signer did not write.
 * Everything else – the first person over a colleague's note, the possessive the approver may acknowledge ("while
 * covering my annual leave"), edited text – is the validators' (OTHER_CLINICIAN_VOICE, 409 SIGNOFF_BLOCKED). The demo
 * is unchanged.
 *
 * signerConfirmationsCheck (design 13, the safe defaults until the referrer answers): after the validators,
 * - a sign-off field filled from the approval and labelled as the assessing or treating physiotherapist, when the
 *   approver wrote none of the assessment (or treatment) notes, needs "I assessed this patient" / "I treated this
 *   patient";
 * - an HCPC, CSP or registration-number field the form prints that is not filled from the approver's own profile needs
 *   "This number is mine" (with the number as it will be printed).
 * A missing one is 409 CONFIRMATION_REQUIRED; the given ones are recorded in the receipt (receiptAdditions
 * .signerConfirmations – MAC-covered, so audited with the approval).
 *
 * Split out of api/handlers/sign.ts by W0.4 (bh2 module split). Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Actor } from "../../../../auth/actor";
import type { Clinician, Report } from "../../../../core/types";
import { confirmationText, confirms, requiredConfirmations } from "../../../../core/validation/attribution-confirmations";
import { defaultVoiceOwner } from "../../../../core/validation/attribution-owner";
import { voiceIssue } from "../../../../core/validation/voice";
import { sameClinician, speaksInFirstPerson } from "../../../../core/voice";
import { WORDING } from "../../../../core/wording";
import { logEvent, problem } from "../../../http";
import type { SignCheck } from "./context";

/**
 * Whose "I" the /sign validators read: the approving clinician – the report's approver (approverCheck has refused any
 * other signer), and on a report that names none, the signer, who is approving it now. Strict mode (no owner) is for the
 * review before anyone approves; at /sign the approving clinician is known, as at /render (the receipt's signer).
 */
export function signVoiceOwner(report: Pick<Report, "approver">, signer: Clinician): Clinician {
  const a = report.approver;
  return a && a.name.trim() ? { name: a.name, hcpc: a.hcpc } : signer;
}

/** Drafted answers in the voice owner's first person (the questions), when someone else approves them. */
function draftedInAnotherVoice(report: Report, owner: Clinician, signer: Clinician): string[] {
  if (sameClinician(owner, signer)) return [];
  return report.sections.filter((s) => s.paragraphs.some((p) => p.origin === "ai" && speaksInFirstPerson(p.text))).map((s) => s.key);
}

/** Strict mode: drafted answers whose first person is about notes the signer did not write (never the possessive licence). */
function draftedOverOthersNotes(report: Report, signer: Clinician): { names: string[]; keys: string[] } {
  const names = new Set<string>();
  const keys: string[] = [];
  for (const s of report.sections) {
    for (const p of s.paragraphs) {
      if (p.origin !== "ai") continue;
      const issue = voiceIssue(p, report.bundleSnapshot, signer);
      if (!issue) continue;
      issue.others.forEach((n) => names.add(n));
      if (!keys.includes(s.key)) keys.push(s.key);
    }
  }
  return { names: Array.from(names), keys };
}

/** The refusal (409 SIGNER_NOT_AUTHOR) when the signer would approve another clinician's first person, else null. */
export function voiceRefusal(actor: Actor, report: Report, signer: Clinician): Response | null {
  if (actor.via === "demo") return null;
  const owner = defaultVoiceOwner(report);
  if (owner) {
    const keys = draftedInAnotherVoice(report, owner, signer);
    if (keys.length > 0) {
      return problem(409, WORDING.server.access.otherVoiceTitle, { code: "SIGNER_NOT_AUTHOR", detail: WORDING.server.access.otherVoiceDetail(owner.name, signer.name, keys) });
    }
    return null;
  }
  const notes = draftedOverOthersNotes(report, signer);
  if (notes.keys.length > 0) {
    return problem(409, WORDING.server.access.otherVoiceTitle, { code: "SIGNER_NOT_AUTHOR", detail: WORDING.server.access.notesVoiceDetail(notes.names, notes.keys) });
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * Sign-time confirmations (design 13; the rule is core/validation/attribution-confirmations.ts, which the approve
 * dialog uses too)
 * ----------------------------------------------------------------------------------------------*/

export { requiredConfirmations };

/** 409 CONFIRMATION_REQUIRED until the approver gives every confirmation this approval needs; records the given ones. */
export const signerConfirmationsCheck: SignCheck = (ctx) => {
  const required = requiredConfirmations(ctx.report, ctx.form, ctx.signer);
  if (required.length === 0) return null;
  const given = ctx.confirmations ?? [];
  const missing = required.filter((r) => !given.some((g) => confirms(g, r)));
  if (missing.length > 0 && ctx.form) {
    logEvent("sign_confirmation_required", { template: ctx.template.id, missing: missing.length, ms: Date.now() - ctx.started });
    const form = ctx.form;
    return problem(409, "Confirm before approving", {
      code: "CONFIRMATION_REQUIRED",
      detail: `${missing.length === 1 ? "One detail needs" : `${missing.length} details need`} your confirmation before approval – tick it in the approve dialog: ${missing.map((m) => confirmationText(m, form)).join(" ")}`,
      issues: missing.map((m) => ({ path: `confirmations.${m.kind}${m.fieldId ? `.${m.fieldId}` : ""}`, message: confirmationText(m, form) })),
    });
  }
  ctx.receiptAdditions.signerConfirmations = required;
  return null;
};
