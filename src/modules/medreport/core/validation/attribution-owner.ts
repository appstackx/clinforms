/**
 * Whose "I" a report speaks in when the caller names no owner (plan WB design 6; seam "voice-owner", bh2-base2).
 * context.ts voiceOwnerOf asks this, so every validateReport call that passes no `voice` – the review screen,
 * /validate, the /sign validators, "Leave optional boxes blank" – follows the same rule: the report's approving
 * clinician (Report.approver, chosen when the report is created – WC – and hashed), everywhere.
 *
 * No approving clinician on the report: a report made before the approver was chosen at creation (every report before
 * this release; WC's picker sets one on every new report) speaks in its author's voice – the clinician its drafts were
 * written for – so the author is the owner, and /sign still refuses any other signer for its drafted first person
 * (sign/checks/voice.ts). Neither an approver nor an author (a staff-prepared draft, a built-in report – B3-1,
 * R-safety-6): strict mode (null) – every cited note counts as another clinician's, so any first person over a note and
 * any finding or opinion from a note that does not name its clinician is flagged for the approving clinician. An
 * approver always wins over the author (N-ATTR-3: drafted for Tom Ellis, approved by Sarah Reid – Sarah's voice).
 * A signed report with no approver speaks in its signer's voice (the receipt's signer – who approved it; /render, a
 * signed report's preview). /sign reads the signer itself (sign/checks/voice.ts signVoiceOwner); /render may pass the
 * receipt's signer itself (WA1 design 7); drafting is WD's (DraftsRequest.approver).
 *
 * Pure; browser and server. Owner: WB (opinion guard and attribution) – docs/bh2-ownership.json.
 */
import type { Clinician, Report } from "../types";

export function defaultVoiceOwner(report: Pick<Report, "author" | "approver"> & Partial<Pick<Report, "status" | "receipt">>): Clinician | null {
  const a = report.approver;
  if (a && a.name.trim()) return { name: a.name, hcpc: a.hcpc };
  const signer = report.status === "signed" ? report.receipt?.signer : undefined;
  if (signer && signer.name.trim()) return signer;
  return report.author?.name.trim() ? report.author : null;
}
