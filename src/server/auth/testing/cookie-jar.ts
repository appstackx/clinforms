/**
 * TESTS ONLY: a minimal cookie jar for driving Better Auth's API in-process.
 *
 * It also refuses any cookie with a Domain attribute, so every identity flow the suites run proves that the app's
 * cookies are host-only. A Domain=.clinforms.co.uk cookie would also be sent to media.clinforms.co.uk by an
 * ordinary request there (the demo video's download link), and the privacy policy says the video carries no cookies.
 */

export class CookieJar {
  private readonly cookies = new Map<string, string>();

  /** Absorb every Set-Cookie of a response (Max-Age=0 / an expired date deletes). */
  absorb(headers: Headers | null | undefined): this {
    if (!headers) return this;
    const list = typeof (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : splitSetCookie(headers.get("set-cookie"));
    for (const line of list) {
      const [pair, ...attrs] = line.split(";").map((p) => p.trim());
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const domain = attrs.find((attr) => /^domain\s*=/i.test(attr));
      if (domain) throw new Error(`Set-Cookie "${name}" has "${domain}": the app's cookies must be host-only (no Domain attribute)`);
      const expired = attrs.some((a) => /^max-age=(0|-\d+)$/i.test(a)) || attrs.some((a) => /^expires=/i.test(a) && Date.parse(a.slice(8)) < Date.now()) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return this;
  }

  has(nameFragment: string): boolean {
    return Array.from(this.cookies.keys()).some((k) => k.includes(nameFragment));
  }

  names(): string[] {
    return Array.from(this.cookies.keys());
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  headers(extra: Record<string, string> = {}): Headers {
    const h = new Headers(extra);
    const cookie = this.header();
    if (cookie) h.set("cookie", cookie);
    return h;
  }

  clear(): void {
    this.cookies.clear();
  }
}

/** Splits a combined Set-Cookie header (commas inside Expires dates are not separators). */
export function splitSetCookie(value: string | null): string[] {
  if (!value) return [];
  return value.split(/,(?=\s*[A-Za-z0-9_.\-]+=)/).map((s) => s.trim());
}
