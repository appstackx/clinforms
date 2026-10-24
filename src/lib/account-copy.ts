/**
 * Customer-facing copy for sign-in, invitations, two-step verification and the clinic settings area
 * (browser-safe: no env, no server imports). Neutral wording only – it describes what the product does,
 * never the technology or any vendor. Checked by src/server/auth/neutral-copy.test.ts with the same banned
 * terms as src/modules/medreport/core/wording.ts.
 */

export const PRODUCT_NAME = "ClinForms";
export const COMPANY_NAME = "AppstackX Ltd";

export const ROLE_LABELS = {
  owner: "Owner",
  admin: "Administrator",
  clinician: "Clinician",
  staff: "Staff",
} as const;

export const ROLE_DESCRIPTIONS = {
  owner: "Full control of the clinic account, including other owners.",
  admin: "Manages clinic details, members, invitations and API keys.",
  clinician: "Completes and reviews forms.",
  staff: "Prepares forms for clinicians.",
} as const;

export type RoleKey = keyof typeof ROLE_LABELS;

export function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role] ?? role;
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const RETENTION_MIN_DAYS = 30;
export const RETENTION_MAX_DAYS = 3650;

/** Plain-English messages for the error codes the auth actions return. */
export const ACCOUNT_ERRORS = {
  generic: "Something went wrong. Please try again.",
  invalidCredentials: "The email address or password is not right.",
  tooManyAttempts: "Too many attempts. Please wait a few minutes and try again.",
  invalidCode: "That code is not right. Check the time on your phone and try again.",
  invalidBackupCode: "That backup code is not right, or it has already been used.",
  challengeExpired: "Your sign-in timed out. Please sign in again.",
  accountLocked: "Two-step verification is locked for a few minutes after too many wrong codes.",
  passwordTooShort: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  passwordTooLong: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  passwordMismatch: "The two passwords do not match.",
  wrongPassword: "That password is not right.",
  inviteInvalid: "This invitation link is not valid, has expired, or has already been used.",
  inviteWrongAccount: "This invitation is for a different email address. Sign out and open the link again.",
  inviteAccountExists: "An account already exists for this email address. Sign in to accept the invitation.",
  resetInvalid: "This reset link is not valid or has expired. Ask for a new one.",
  forbidden: "You do not have permission to do that.",
  notMember: "You are not a member of this clinic.",
  alreadyMember: "That person is already a member of this clinic.",
  alreadyInvited: "That person already has an open invitation.",
  lastOwner: "A clinic always needs at least one owner.",
  invalidEmail: "Enter a valid email address.",
  invalidHcpc: "Enter the registration number as shown on the HCPC register: the profession's letters (PH for physiotherapists), then the digits.",
  resetOtherClinic:
    "This person also belongs to another clinic, so their password can only be reset by email to them. Ask them to use “Forgotten your password?” on the sign-in page.",
  canSignNeedsHcpc: "A member who signs forms needs an HCPC registration number.",
  staffCannotSign: "Staff members cannot sign forms.",
  retentionRange: `Choose between ${RETENTION_MIN_DAYS} and ${RETENTION_MAX_DAYS} days.`,
} as const;

export type AccountErrorKey = keyof typeof ACCOUNT_ERRORS;

/**
 * Drafting from the notes (Settings → Clinic and the overview's set-up checklist). Owner decision: OFF for a
 * new clinic – a clinic opts in to sending notes to the drafting service once it has signed the data
 * processing agreement. Plain words, and only what is true today (data minimisation: core NOTICES).
 */
export const DRAFTING_COPY = {
  label: "Draft answers from the notes",
  whatItDoes:
    "When this is on, the patient's notes – with the name, date of birth, address and contact details taken out – are sent to the drafting service listed in your data processing agreement. It drafts each answer with the note it came from, for a clinician to check and approve. Free text in the notes can still identify a patient.",
  whenToSwitchOn:
    "It is off until your clinic switches it on. Switch it on only once your clinic has signed the data processing agreement and is content for notes to be used this way. While it is off, nothing from the notes is sent and your clinicians write those answers themselves.",
  checklistOff:
    "Off until you switch it on. When on, the patient's notes (without name, date of birth, address or contact details) are sent to the drafting service in your data processing agreement to draft answers for the clinician to check. Switch it on in Clinic details once the agreement is signed; until then your clinicians write the answers.",
  checklistOn: "Switched on: answers are drafted from the notes for the clinician to check and approve.",
  /** Replaces whenToSwitchOn while the clinic's trial runs (made-up notes only until the DPA is signed). */
  whenToSwitchOnTrial: "During your trial, switch this on to try drafting with made-up notes only.",
  /** Replaces checklistOff while the clinic's trial runs. */
  checklistOffTrial:
    "Off until you switch it on. During your trial, switch it on in Clinic details to try drafting with made-up notes only; until then your clinicians write the answers.",
} as const;

/**
 * A clinic's trial (10/2026, owner direction 24/10: no real patient data in a trial): the banner at the top of the
 * clinic area and the Studio (src/lib/trial-copy.ts builds it from this), and the platform page's description.
 */
export const TRIAL_NOTES_RULE = "Use made-up notes only until your data processing agreement is signed.";

export const TRIAL_COPY = {
  running: (daysLeft: number) => `Trial – ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left. ${TRIAL_NOTES_RULE}`,
  ended: (contactEmail: string) =>
    `Your trial has ended. You can still open and download your existing reports and forms. To create new reports, upload files or read new forms, contact us at ${contactEmail}.`,
  /** For ClinForms staff (platform page). */
  platformDescription:
    "A trial lets a clinic try ClinForms with made-up notes only, before its data processing agreement is signed. When it ends, the clinic can still open and download its records but cannot create anything new. Drafting limits replace the defaults for one clinic. Every change is recorded here and in the clinic's own activity.",
} as const;

/**
 * How long reports are kept (Settings → Clinic). Matches the retention job (src/server/cron/retention.ts →
 * src/server/repos/maintenance.ts runRetention/purgeExpiredReports): once a day, every report of the clinic – draft
 * or approved, with the notes it was made from – whose last change is older than the period is deleted; the period
 * is read at run time, so a shorter one applies to existing reports at the next run. Form maps, form files, the
 * clinic's details, members and the activity log are not touched.
 */
export const RETENTION_COPY = {
  hint: (minDays: number, maxDays: number) =>
    `${minDays}–${maxDays} days. Every night, reports that have not been changed for this many days are deleted automatically – drafts and approved reports, with the notes they were made from. A shorter period applies to existing reports from the next night. Your forms library, clinic details, members and activity log are kept, and so are copies you have downloaded.`,
} as const;

/**
 * Invitations (Settings → Members and the platform page) and the links they carry. A link lets whoever opens it
 * join the clinic, so it is shown with a warning not to forward it – also when it was emailed (a copy for the
 * person who invited, in case the email does not arrive).
 */
export type InviteDelivery = "sent" | "failed" | "off" | "withheld";

export const INVITE_COPY = {
  outcome: (delivery: InviteDelivery, email: string) =>
    ({
      sent: `Invitation emailed to ${email}.`,
      failed: `The invitation email to ${email} could not be sent. Pass the link below to them yourself.`,
      off: `Email is not set up, so nothing was sent. Pass the link below to ${email} yourself.`,
      withheld: `The invitation was not emailed, as you chose. Pass the link below to ${email} yourself.`,
    })[delivery],
  /** Settings → Members after an emailed invitation (no link is shown then – security fix 24/10/2026). */
  sentHint: "If it does not arrive within a few minutes, ask them to check their spam folder, or invite them again: the earlier link then stops working.",
  linkLabel: (delivery: InviteDelivery) => (delivery === "sent" ? "A copy of the invitation link" : "Invitation link"),
  /** `expires`: "in 7 days" or "on 31 October 2026". */
  linkWarning: (delivery: InviteDelivery, expires: string) =>
    `${delivery === "sent" ? "Keep this copy only in case the email does not arrive. " : ""}Do not forward it to anyone else: whoever opens it can create the account and join the clinic. It works once and expires ${expires}.`,
} as const;

/** A password reset link that ClinForms support creates for a clinic owner (platform page). */
export const OWNER_RESET_COPY = {
  note: "Shown only this once. It works once and expires in 2 hours. Confirm who you are speaking to before passing it on (call the clinic on a known number), and never forward it by email to a shared inbox. The owner still needs their authenticator app to sign in.",
  /** /reset-password while email is off: for an owner with nobody else to ask. */
  soleOwner: (contactEmail: string) => `If you are your clinic's only owner, contact us at ${contactEmail}.`,
  /** /reset-password after asking for a link by email. */
  notArrived: (contactEmail: string) =>
    `Nothing after a few minutes? Check your spam folder, or ask your clinic's owner or an administrator for a link (Settings → Members). If you are your clinic's only owner, contact us at ${contactEmail}.`,
} as const;
