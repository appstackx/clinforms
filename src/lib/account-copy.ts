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
  invalidHcpc: "Enter the registration number as shown on the HCPC register, for example PH123456.",
  canSignNeedsHcpc: "A member who signs forms needs an HCPC registration number.",
  staffCannotSign: "Staff members cannot sign forms.",
  retentionRange: `Choose between ${RETENTION_MIN_DAYS} and ${RETENTION_MAX_DAYS} days.`,
} as const;

export type AccountErrorKey = keyof typeof ACCOUNT_ERRORS;
