/**
 * Structured server log lines for the identity layer: ids, codes and counts only – never an email address,
 * a token, a link or a password.
 */
export function logAuthEvent(event: string, fields: Record<string, string | number | boolean | null | undefined> = {}): void {
  try {
    console.info(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));
  } catch {
    // logging must never break a request
  }
}

/** "jo@example.com" → "j…@example.com" (for the rare log line that must say which address). */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "…";
  return `${email[0]}…${email.slice(at)}`;
}
