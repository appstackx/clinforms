import "server-only";

/**
 * POST /sign – the signer's own voice (fix wave 2; fix round 1, B0-1): a clinic's member never approves drafted answers
 * that speak in ANOTHER clinician's first person (report.author ≠ the signer and an unedited drafted answer says
 * "I …"): 409 SIGNER_NOT_AUTHOR with the questions to edit (core/voice.ts otherClinicianVoice); on a report with no
 * author, a member's approval is refused the same way against the signer (unsignableFirstPerson). The demo is
 * unchanged.
 *
 * Split out of api/handlers/sign.ts by W0.4 (bh2 module split): the same code, moved; sign/index.ts calls it in the same order.
 * Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Actor } from "../../../../auth/actor";
import type { Clinician, Report } from "../../../../core/types";
import { otherClinicianVoice, unsignableFirstPerson } from "../../../../core/voice";
import { WORDING } from "../../../../core/wording";
import { problem } from "../../../http";

/** The refusal (409 SIGNER_NOT_AUTHOR) when the signer would approve another clinician's first person, else null. */
export function voiceRefusal(actor: Actor, report: Report, signer: Clinician): Response | null {
  if (actor.via !== "demo") {
    // The approver's own first person must be theirs: never another clinician's treatment and opinions as "I".
    const voice = otherClinicianVoice(report, signer);
    if (voice) {
      return problem(409, WORDING.server.access.otherVoiceTitle, {
        code: "SIGNER_NOT_AUTHOR",
        detail: WORDING.server.access.otherVoiceDetail(voice.author, signer.name, voice.keys),
      });
    }
    // Fix round 1 (B0-1): with no author named (the validators check those), the signer's own "I" must still be
    // theirs – never "told me" about another clinician's note.
    const notesVoice = unsignableFirstPerson(report, signer);
    if (notesVoice) {
      return problem(409, WORDING.server.access.otherVoiceTitle, {
        code: "SIGNER_NOT_AUTHOR",
        detail: WORDING.server.access.notesVoiceDetail(notesVoice.names, notesVoice.keys),
      });
    }
  }
  return null;
}
