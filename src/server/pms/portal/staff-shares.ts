/**
 * "Share with the patient" (PORTAL-004): a file attached to the patient's record handed to the patient in their
 * portal ("Shared with you"), from the record's Attachments tab.
 *
 * - Who: whoever may see attachments AND add or withdraw them – clinical.view + clinical.write (attachments stay
 *   clinical; reception never sees them, so never shares them). The patient must be in the member's sites.
 * - What the patient gets: the title (plain – the portal lists it) and an optional message (encrypted), and the file
 *   itself as a download from the portal while the share stands and the file is not withdrawn from the record.
 * - Who and when: the share keeps the member and the time; opened (first view) and withdrawn too. Every write is
 *   audited in its batch (src/server/repos/pms/portal/shares.ts).
 * - Optionally the patient gets an email with a one-time link into their portal (comms' `portal_link` – outbox /
 *   test mode until email is live). The email never names the document.
 */
import "server-only";
import { clinicPublicPaths } from "../../../modules/pms/portal/paths";
import { formatWhen } from "../../../modules/pms/portal/time";
import { RepoInputError } from "../../repos/context";
import { getPatient } from "../../repos/pms/patients";
import { getPortalAccountForPatient } from "../../repos/pms/portal/accounts";
import { getBookingSettings } from "../../repos/pms/portal/settings";
import { getPortalShare, listSharesForPatient, shareAttachment, shareFilesForPatient, withdrawShare } from "../../repos/pms/portal/shares";
import { getAttachment } from "../../repos/pms/records/attachments";
import type { ClinicActor } from "../actor";
import { emailPortalLink } from "./staff";
import { memberNames } from "./staff-names";
import { patientVisible } from "./staff-scope";

export type ShareResult<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const FORBIDDEN = "You do not have permission to do that.";
const GONE = "This file no longer exists on this record.";

export interface FileShareRow {
  id: string;
  title: string;
  sharedAt: string;
  sharedBy: string;
  viewedAt: string | null;
  withdrawnAt: string | null;
}

export interface AttachmentSharesView {
  canShare: boolean;
  portal: { enabled: boolean; access: "active" | "disabled" | "none"; hasEmail: boolean };
  /** attachment id → its shares (newest first). */
  byAttachment: Record<string, FileShareRow[]>;
}

const canSee = (actor: ClinicActor) => actor.can("clinical.view");
const canShare = (actor: ClinicActor) => actor.can("clinical.view") && actor.can("clinical.write");

/** The Attachments tab's sharing panel: each file's shares, and whether this member may share. */
export async function attachmentSharesFor(actor: ClinicActor, patientId: string): Promise<AttachmentSharesView | null> {
  if (!canSee(actor)) return null;
  const ctx = actor.repo();
  const [shares, files, settings, account, patient] = await Promise.all([
    listSharesForPatient(ctx, actor.tenantId, patientId, { includeWithdrawn: true }),
    shareFilesForPatient(ctx, actor.tenantId, patientId),
    getBookingSettings(ctx, actor.tenantId),
    getPortalAccountForPatient(ctx, actor.tenantId, patientId),
    getPatient(ctx, actor.tenantId, patientId),
  ]);
  const names = await memberNames(ctx, actor.tenantId, shares.map((s) => s.sharedBy ?? ""));
  const byAttachment: Record<string, FileShareRow[]> = {};
  for (const s of shares) {
    const attachmentId = files.get(s.id);
    if (!attachmentId) continue;
    (byAttachment[attachmentId] ??= []).push({
      id: s.id,
      title: s.title,
      sharedAt: formatWhen(s.sharedAt),
      sharedBy: s.sharedBy ? (names.get(s.sharedBy) ?? "a former member of staff") : "the clinic",
      viewedAt: s.viewedAt ? formatWhen(s.viewedAt) : null,
      withdrawnAt: s.withdrawnAt ? formatWhen(s.withdrawnAt) : null,
    });
  }
  return {
    canShare: canShare(actor),
    portal: { enabled: settings.portal, access: account ? account.status : "none", hasEmail: Boolean(patient?.email) },
    byAttachment,
  };
}

/** Shares one of the record's files with the patient (and, if asked, emails them a link into the portal). */
export async function shareAttachmentFor(actor: ClinicActor, patientId: string, attachmentId: string, input: { title: string; message?: string | null; notify: boolean }): Promise<ShareResult<{ shareId: string }>> {
  if (!canShare(actor)) return { ok: false, error: FORBIDDEN };
  if (!(await patientVisible(actor, patientId))) return { ok: false, error: GONE };
  const ctx = actor.repo();
  const file = typeof attachmentId === "string" ? await getAttachment(ctx, actor.tenantId, attachmentId) : null;
  if (!file || file.patientId !== patientId) return { ok: false, error: GONE };
  if (file.status !== "active") return { ok: false, error: "A withdrawn file cannot be shared." };
  const settings = await getBookingSettings(ctx, actor.tenantId);
  if (!settings.portal) return { ok: false, error: "The patient portal is switched off. Switch it on in Set-up → Online booking first." };
  const account = await getPortalAccountForPatient(ctx, actor.tenantId, patientId);
  if (account?.status === "disabled") return { ok: false, error: "The patient's portal access is switched off (record → Forms)." };
  let shareId: string;
  try {
    shareId = (await shareAttachment(ctx, actor.tenantId, { patientId, attachmentId: file.id, title: String(input.title ?? ""), message: input.message ? String(input.message) : null }, actor.actor)).id;
  } catch (err) {
    if (err instanceof RepoInputError) return { ok: false, error: err.message, fieldErrors: /title/i.test(err.message) ? { title: err.message } : undefined };
    throw err;
  }
  if (!input.notify) return { ok: true, value: { shareId }, message: "Shared. The patient sees it in their portal under “Shared with you”." };
  const mailed = await emailPortalLink(actor, patientId, clinicPublicPaths(actor.tenantId).portalDocument(shareId));
  return mailed.ok
    ? { ok: true, value: { shareId }, message: "Shared. The patient gets an email with a link to their portal." }
    : { ok: true, value: { shareId }, message: `Shared in the portal, but no email was sent: ${mailed.error}` };
}

/** Withdraws a share: the patient no longer sees or downloads it (kept, with who and when). */
export async function withdrawShareFor(actor: ClinicActor, patientId: string, shareId: string): Promise<ShareResult> {
  if (!canShare(actor)) return { ok: false, error: FORBIDDEN };
  if (!(await patientVisible(actor, patientId))) return { ok: false, error: GONE };
  const ctx = actor.repo();
  const share = typeof shareId === "string" && /^psh_[0-9A-HJKMNP-TV-Z]{26}$/.test(shareId) ? await getPortalShare(ctx, actor.tenantId, shareId) : null;
  if (!share || share.patientId !== patientId) return { ok: false, error: "This shared document no longer exists." };
  const done = await withdrawShare(ctx, actor.tenantId, share.id, actor.actor);
  return done ? { ok: true, value: undefined, message: "Withdrawn. The patient no longer sees it." } : { ok: false, error: "It was already withdrawn." };
}
