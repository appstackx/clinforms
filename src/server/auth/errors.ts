/** Better Auth / ClinForms error codes → the plain-English messages in src/lib/account-copy.ts. */
import { ACCOUNT_ERRORS, type AccountErrorKey } from "../../lib/account-copy";
import { RepoInputError } from "../repos/context";
import { logAuthEvent } from "../email/log";
import { TenantSlugError } from "./tenant";

const BY_CODE: Record<string, AccountErrorKey> = {
  INVALID_EMAIL_OR_PASSWORD: "invalidCredentials",
  INVALID_CODE: "invalidCode",
  INVALID_BACKUP_CODE: "invalidBackupCode",
  INVALID_TWO_FACTOR_COOKIE: "challengeExpired",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "challengeExpired",
  ACCOUNT_TEMPORARILY_LOCKED: "accountLocked",
  PASSWORD_TOO_SHORT: "passwordTooShort",
  PASSWORD_TOO_LONG: "passwordTooLong",
  INVALID_PASSWORD: "wrongPassword",
  INVALID_TOKEN: "resetInvalid",
  TOKEN_EXPIRED: "resetInvalid",
  INVITATION_REQUIRED: "inviteInvalid",
  INVITATION_NOT_FOUND: "inviteInvalid",
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: "inviteWrongAccount",
  USER_ALREADY_EXISTS: "inviteAccountExists",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "inviteAccountExists",
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: "alreadyMember",
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: "alreadyInvited",
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER: "lastOwner",
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER: "lastOwner",
  INVALID_EMAIL: "invalidEmail",
  TWO_FACTOR_REQUIRED: "forbidden",
};

export function errorCode(err: unknown): string {
  const e = err as { body?: { code?: unknown }; code?: unknown } | null;
  const code = e?.body?.code ?? e?.code;
  return typeof code === "string" ? code : "";
}

function errorStatus(err: unknown): number | null {
  const e = err as { statusCode?: unknown; status?: unknown } | null;
  if (typeof e?.statusCode === "number") return e.statusCode;
  if (typeof e?.status === "number") return e.status;
  return null;
}

export function authErrorKey(err: unknown): AccountErrorKey {
  const code = errorCode(err);
  if (BY_CODE[code]) return BY_CODE[code];
  const status = errorStatus(err);
  if (status === 429 || (err as { status?: unknown })?.status === "TOO_MANY_REQUESTS") return "tooManyAttempts";
  if (status === 401 || status === 403 || (err as { status?: unknown })?.status === "FORBIDDEN") return "forbidden";
  return "generic";
}

/** A message safe to show in the UI (never raw library text, except our own input-validation messages). */
export function authErrorMessage(err: unknown, context: string): string {
  if (err instanceof RepoInputError || err instanceof TenantSlugError) return err.message;
  const key = authErrorKey(err);
  if (key === "generic") logAuthEvent("auth.action_error", { context, code: errorCode(err) || (err instanceof Error ? err.name : "unknown") });
  return ACCOUNT_ERRORS[key];
}
