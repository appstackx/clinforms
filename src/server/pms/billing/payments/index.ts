/**
 * The deployment's card payment provider (contract §11):
 *
 *   CLINIC_PAYMENTS_PROVIDER = "manual" (default, also when unset) | "stripe_test"
 *   CLINIC_STRIPE_TEST_SECRET_KEY = a TEST key (sk_test_… / rk_test_…) – only for "stripe_test"
 *   CLINIC_STRIPE_TEST_API_BASE   = optional, LOCAL runs only: a stand-in for the provider's API on this machine
 *                                   (http://127.0.0.1:<port>/v1, scripts/e2e/stripe-test-stub.cjs) – anything else
 *                                   but Stripe's own host is refused
 *
 * Anything else (an unknown provider, a missing key, a live key) gives the manual provider with a plain reason:
 * the clinic records card payments by hand and nothing is ever charged.
 */
import { MANUAL_PROVIDER, PaymentProviderError, type PaymentLinkProvider } from "./provider";
import { createStripeTestProvider } from "./stripe-test";

export type { CardCharge, PaymentLinkProvider, SavedCardRef } from "./provider";
export { PaymentProviderError } from "./provider";

function manualBecause(reason: string): PaymentLinkProvider {
  return { ...MANUAL_PROVIDER, unavailableReason: reason };
}

export function paymentLinkProvider(env: Record<string, string | undefined> = process.env, fetchImpl?: (url: string, init: RequestInit) => Promise<Response>): PaymentLinkProvider {
  const choice = (env.CLINIC_PAYMENTS_PROVIDER ?? "manual").trim().toLowerCase();
  if (choice === "" || choice === "manual" || choice === "none") return MANUAL_PROVIDER;
  if (choice !== "stripe_test") return manualBecause("The payment provider setting is not recognised, so card payment links are off.");
  const key = env.CLINIC_STRIPE_TEST_SECRET_KEY ?? "";
  if (!key) return manualBecause("The payment provider's test key is not set, so card payment links are off.");
  try {
    return createStripeTestProvider(key, fetchImpl, env.CLINIC_STRIPE_TEST_API_BASE || undefined);
  } catch (err) {
    if (err instanceof PaymentProviderError && /address/.test(err.message)) return manualBecause("The payment provider address is not allowed, so card payments are off.");
    if (err instanceof PaymentProviderError) return manualBecause("The payment provider key is not a test key, so card payment links are off. Only test mode is allowed.");
    throw err;
  }
}
