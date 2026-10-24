/**
 * The deployment's card payment provider (contract §11):
 *
 *   CLINIC_PAYMENTS_PROVIDER = "manual" (default, also when unset) | "stripe_test"
 *   CLINIC_STRIPE_TEST_SECRET_KEY = a TEST key (sk_test_… / rk_test_…) – only for "stripe_test"
 *
 * Anything else (an unknown provider, a missing key, a live key) gives the manual provider with a plain reason:
 * the clinic records card payments by hand and nothing is ever charged.
 */
import { MANUAL_PROVIDER, PaymentProviderError, type PaymentLinkProvider } from "./provider";
import { createStripeTestProvider } from "./stripe-test";

export type { PaymentLinkProvider } from "./provider";
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
    return createStripeTestProvider(key, fetchImpl);
  } catch (err) {
    if (err instanceof PaymentProviderError) return manualBecause("The payment provider key is not a test key, so card payment links are off. Only test mode is allowed.");
    throw err;
  }
}
