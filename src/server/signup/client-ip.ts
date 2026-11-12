/**
 * The client's address for self sign-up's limits (docs/auth.md §1b). Pure (no Next): tested in self-signup.test.ts.
 *
 * On Vercel (VERCEL set) the platform's own header comes first: `x-vercel-forwarded-for` is set by Vercel's edge and,
 * unlike `x-forwarded-for`, is not replaced by a proxy in front of Vercel; then `x-real-ip` (also Vercel's); only then
 * the first `x-forwarded-for` entry. Vercel overwrites a client-supplied `x-forwarded-for`
 * (https://vercel.com/docs/headers/request-headers), so a visitor cannot pick their own address there either.
 * Off Vercel (local runs, the e2e server): the first `x-forwarded-for` entry, else `x-real-ip` – as clientIp() in
 * src/server/auth/session.ts, which the other callers keep using unchanged.
 */

type Env = Readonly<Record<string, string | undefined>>;

function firstEntry(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first ? first : null;
}

export function signupClientIp(h: Headers, env: Env = process.env): string {
  const candidates = env.VERCEL
    ? [firstEntry(h.get("x-vercel-forwarded-for")), firstEntry(h.get("x-real-ip")), firstEntry(h.get("x-forwarded-for"))]
    : [firstEntry(h.get("x-forwarded-for")), firstEntry(h.get("x-real-ip"))];
  return (candidates.find((c): c is string => Boolean(c)) ?? "local").slice(0, 64);
}

/** Eight 16-bit groups of an IPv6 address (null when it is not one). Accepts "::", an IPv4 tail, brackets, a zone. */
function ipv6Groups(raw: string): number[] | null {
  let s = raw.trim().toLowerCase();
  if (s.startsWith("[")) s = s.slice(1, s.indexOf("]") > 0 ? s.indexOf("]") : undefined);
  s = s.split("%")[0];
  if (!s.includes(":") || !/^[0-9a-f:.]+$/.test(s)) return null;
  let tail: number[] = [];
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    tail = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    s = s.slice(0, v4.index);
    if (s.endsWith(":") && !s.endsWith("::")) s = s.slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...rest].some((n) => Number.isNaN(n))) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 1 && known !== 8) return null;
  if (halves.length === 2 && known > 7) return null;
  return [...head, ...Array(8 - known).fill(0), ...rest, ...tail];
}

/**
 * What the per-network limits count: an IPv4 address as it is (a port dropped); an IPv6 address by its /64 – one
 * home or office line gets a whole /64, so counting single IPv6 addresses would let one network rotate through
 * billions of them. An IPv4-mapped IPv6 address (::ffff:a.b.c.d) counts as its IPv4 address. Anything else unchanged.
 */
export function ipLimitSubject(ip: string): string {
  const value = String(ip ?? "").trim();
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/.exec(value);
  if (v4) return v4[1];
  const groups = ipv6Groups(value);
  if (!groups) return value.toLowerCase();
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}
