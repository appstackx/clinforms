import "server-only";

/**
 * POST /sign – the receipt: how the approval came in (approvedVia) and the server-signed receipt minted for it
 * (auth/sign-receipt.ts createReceipt: an HMAC over the report fingerprint, signer, time, attestations, the verified
 * form map's hash and the session the approval came through).
 *
 * Split out of api/handlers/sign.ts by W0.4 (bh2 module split): the same code, moved; sign/index.ts calls it in the same order.
 * Owner: WA1 (issue state and receipt) – docs/bh2-ownership.json.
 */
import type { Actor } from "../../../auth/actor";
import { createReceipt } from "../../../auth/sign-receipt";
import type { Clinician, Report, ReportTemplate, SignReceipt } from "../../../core/types";

export function approvedVia(actor: Actor): NonNullable<SignReceipt["approvedVia"]> {
  if (actor.via === "demo") {
    const claims = actor.session;
    return {
      kind: claims?.kind ?? "demo",
      sid: actor.sid,
      ...(claims?.clinician ? { clinician: claims.clinician } : {}),
    };
  }
  return {
    kind: "user",
    sid: actor.sid,
    ...(actor.userId ? { userId: actor.userId } : {}),
    ...(actor.session ? { launchSid: actor.session.sid } : {}),
    ...(actor.session?.clinician ? { clinician: actor.session.clinician } : {}),
  };
}

/**
 * The receipt for an approval that passed every check. `formMapSha256`: the form map's attested hash
 * (resolve-template.ts checkAttestedForm – the map as read, or as this build knows it; rollback shim).
 */
export async function mintReceipt(input: { report: Report; signer: Clinician; template: ReportTemplate; formMapSha256?: string; actor: Actor }): Promise<SignReceipt> {
  const { report, signer, template, actor } = input;
  return createReceipt({
    report,
    signer,
    statementAccepted: true,
    attestations: [...template.attestations],
    ...(input.formMapSha256 ? { formMapSha256: input.formMapSha256 } : {}),
    approvedVia: approvedVia(actor),
  });
}
