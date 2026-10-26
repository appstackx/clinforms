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
import type { Clinician } from "../../../../core/types";
import { WORDING } from "../../../../core/wording";
import type { MedreportDeps } from "../../../deps";
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
