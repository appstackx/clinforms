/**
 * Self-serve sign-up in a request (pages and server actions): the switch per host, and the dependencies of
 * ./self-signup.ts from the environment and the request. docs/auth.md §1b.
 */
import "server-only";
import type { BrandId } from "@/lib/brand";
import { selfSignupEnabled } from "@/lib/self-signup";
import { authSecret, baseUrlSetting, isPlatformAdmin, requestBrand } from "@/server/auth/config";
import { clientIp, requestHeaders } from "@/server/auth/session";
import { currentBrand } from "@/server/brand";
import { getDb } from "@/server/db";
import type { SignupDeps } from "./self-signup";

/**
 * For pages: the host brand when self sign-up is switched on for it, else null (the page answers 404). Presentation
 * only – the actions re-check with the trusted host (signupBrandForAction).
 */
export function signupBrandForPage(): BrandId | null {
  const brand = currentBrand().id;
  return selfSignupEnabled(brand) ? brand : null;
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
    ip: clientIp(h),
    userAgent: h.get("user-agent") ?? "",
    isPlatformAdminEmail: (email) => isPlatformAdmin(email),
  };
}
