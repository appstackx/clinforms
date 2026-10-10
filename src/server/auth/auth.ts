/**
 * The app's Better Auth instance (one per process), on getDb() and the environment (./config.ts).
 * Never built at import time: `next build` and the public demo (/reports) never need auth settings.
 */
import "server-only";
import { getDb, getDbKind } from "../db";
import { authSecret, baseUrlSetting } from "./config";
import { createAuth, type Auth } from "./create-auth";

interface AuthGlobal {
  __clinformsAuth?: { key: string; auth: Auth };
}
const holder = globalThis as unknown as AuthGlobal;

async function requestHeaders(): Promise<Headers | null> {
  // Inside a request or server action: Next's request headers. Elsewhere (scripts, tests) this throws → null.
  const mod = await import("next/headers");
  return mod.headers() as unknown as Headers;
}

export function getAuth(): Auth {
  const dialect = getDbKind();
  const secret = authSecret();
  const baseUrl = baseUrlSetting();
  const key = `${dialect}|${JSON.stringify(baseUrl)}|${secret.length}:${secret.slice(-6)}`;
  const cached = holder.__clinformsAuth;
  if (cached && cached.key === key) return cached.auth;
  const auth = createAuth({ db: getDb(), dialect, secret, baseUrl, currentHeaders: requestHeaders });
  holder.__clinformsAuth = { key, auth };
  return auth;
}
