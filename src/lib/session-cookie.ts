/**
 * Edge-safe: the name of Better Auth's session cookie with the ClinForms prefix (src/server/auth/create-auth.ts
 * COOKIE_PREFIX = "clinforms"). Secure deployments add the "__Secure-" prefix. Used by the optimistic check
 * in src/middleware.ts; a test checks it against what Better Auth actually sets.
 */
export const SESSION_COOKIE_NAMES = ["__Secure-clinforms.session_token", "clinforms.session_token"] as const;

export function hasSessionCookie(cookies: { get(name: string): { value: string } | undefined }): boolean {
  return SESSION_COOKIE_NAMES.some((name) => Boolean(cookies.get(name)?.value));
}
