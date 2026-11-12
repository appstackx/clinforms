/**
 * Self-serve sign-up in a request (pages and server actions): the switch per host, and the dependencies of
 * ./self-signup.ts from the environment and the request. docs/auth.md §1b.
 */
import "server-only";
import type { BrandId } from "@/lib/brand";
import { selfSignupEnabled } from "@/lib/self-signup";
import { authSecret, baseUrlSetting, isPlatformAdmin, requestBrand } from "@/server/auth/config";
import { requestHeaders } from "@/server/auth/session";
import { currentBrand } from "@/server/brand";
import { getDb } from "@/server/db";
import { signupClientIp } from "./client-ip";
import { signupHostServed, type SignupDeps } from "./self-signup";

/**
 * Vercel's waitUntil for this request, when the platform provides one: the same request context @vercel/functions'
 * waitUntil() reads (globalThis[Symbol.for("@vercel/request-context")]), without adding the package. Next 14.2 has no
 * after(). Null off Vercel.
 */
function vercelWaitUntil(): ((promise: Promise<unknown>) => void) | null {
  try {
    const store = (globalThis as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined } | undefined>)[
      Symbol.for("@vercel/request-context")
    ];
    const waitUntil = store?.get?.()?.waitUntil;
    return typeof waitUntil === "function" ? waitUntil : null;
  } catch {
    return null;
  }
}

/** When the answer cannot be sent before the work (no waitUntil on Vercel): at least this long, plus jitter. */
const FALLBACK_MIN_RESPONSE = { ms: 1500, jitterMs: 500 } as const;

/**
 * How start-trial runs its after-the-answer work (docs/auth.md §1b):
 *   - on Vercel, through the request's waitUntil (the function stays alive until it is done);
 *   - on a long-running Node server (local runs, the e2e server – no VERCEL), as a detached promise;
 *   - on Vercel without a request context (not expected): inline, and the answer is padded to a minimum time.
 */
export function signupDeferral(env: Readonly<Record<string, string | undefined>> = process.env): Pick<SignupDeps, "defer" | "minResponse"> {
  const waitUntil = vercelWaitUntil();
  if (waitUntil) return { defer: (task) => waitUntil(task().catch(() => undefined)) };
  if (!env.VERCEL) return { defer: (task) => void task().catch(() => undefined) };
  return { minResponse: FALLBACK_MIN_RESPONSE };
}

/**
 * For pages: the host brand when self sign-up is switched on for it, else null (the page answers 404). Presentation
 * only – the actions re-check with the trusted host (signupBrandForAction).
 */
export function signupBrandForPage(): BrandId | null {
  const brand = currentBrand().id;
  return selfSignupEnabled(brand) ? brand : null;
}

/**
 * Whether this deployment serves the brand's own host, so a sign-up link for it opens on that brand. Not served: the
 * pages show SIGNUP_COPY.hostNotServed instead of the form, and startSignup() refuses ("unavailable").
 */
export function signupHostServedForPage(brand: BrandId): boolean {
  try {
    return signupHostServed(baseUrlSetting(), brand);
  } catch {
    return false;
  }
}

/**
 * For server actions: the brand of the request's Host when it is one of the app's own origins AND the switch is on
 * for it, else null (the action refuses). Never a host outside the allow-list.
 */
export function signupBrandForAction(): BrandId | null {
  let brand: BrandId | null = null;
  try {
    brand = requestBrand(baseUrlSetting(), requestHeaders());
  } catch {
    return null;
  }
  return brand && selfSignupEnabled(brand) ? brand : null;
}

export function signupDeps(brand: BrandId): SignupDeps {
  const h = requestHeaders();
  return {
    db: getDb(),
    secret: authSecret(),
    baseUrl: baseUrlSetting(),
    brand,
    ip: signupClientIp(h),
    userAgent: h.get("user-agent") ?? "",
    isPlatformAdminEmail: (email) => isPlatformAdmin(email),
    ...signupDeferral(),
  };
}
