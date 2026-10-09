/** Turning a response's Set-Cookie headers into a request Cookie header (for chained server-side calls). */

export function cookieHeaderFromSetCookie(responseHeaders: Headers | null | undefined, base = ""): string {
  const jar = new Map<string, string>();
  for (const part of base.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  const list =
    responseHeaders && typeof (responseHeaders as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (responseHeaders as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : (responseHeaders?.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_.\-]+=)/).filter(Boolean);
  for (const line of list) {
    const [pair, ...attrs] = line.split(";").map((p) => p.trim());
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (value === "" || attrs.some((a) => /^max-age=(0|-\d+)$/i.test(a))) jar.delete(name);
    else jar.set(name, value);
  }
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
