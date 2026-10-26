/**
 * bh2 W0 follow-up stub for WB (plan WB design 6, seam "voice-owner", bh2-base2): whose "I" a report speaks in when the
 * caller names no owner. context.ts voiceOwnerOf asks this, so every validateReport call that passes no `voice` – the
 * review screen, /validate, the /sign validators, "Leave optional boxes blank" – follows WB's rule without WB editing
 * those callers' files: the report's approver everywhere, and strict mode (null: every cited note counts as another
 * clinician's) when no approver was chosen. /render passes the receipt's signer itself (WA1 design 7); drafting is WD's.
 *
 * Today: the report's author, as before W0.6.
 * Pure; browser and server.
 * Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Clinician, Report } from "../types";

export function defaultVoiceOwner(report: Pick<Report, "author" | "approver">): Clinician | null {
  return report.author ?? null;
}
