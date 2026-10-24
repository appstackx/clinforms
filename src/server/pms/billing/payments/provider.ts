/**
 * Card payment providers for invoice payment links (contract §11). The default is "manual": no provider – card
 * payments are taken on the clinic's own terminal and recorded by hand. A provider is chosen per deployment by env
 * (CLINIC_PAYMENTS_PROVIDER) and runs in TEST MODE ONLY: it refuses a live-looking key, so no real card can be
 * charged from this code.
 *
 * No webhook: staff press "Check for payment" on the invoice and the provider is asked which checkout sessions of
 * the link were paid (each recorded once, by its reference). A webhook needs a public route outside /app –
 * an orchestrator decision (docs/clinic-system/billing.md).
 */

export interface CreateLinkInput {
  tenantId: string;
  invoiceId: string;
  /** Printed on the payment page ("Invoice RIV00042"). Never clinical detail. */
  invoiceNumber: string;
  clinicName: string;
  amountPence: number;
  /** The same key twice returns the same link (the provider's idempotency). */
  idempotencyKey: string;
}

export interface CreatedLink {
  providerLinkId: string;
  url: string;
}

export interface PaidSession {
  /** The provider's checkout reference (recorded as the payment's provider reference). */
  sessionId: string;
  amountPence: number;
  /** "YYYY-MM-DD" (UK) the payment was made. */
  paidOn: string;
}

export interface PaymentLinkProvider {
  /** "manual" | "stripe" – stored on payments and links. */
  readonly id: string;
  readonly mode: "off" | "test";
  /** Whether links can be made. */
  readonly configured: boolean;
  /** Plain reason when not configured (for the settings screen). */
  readonly unavailableReason: string | null;
  createLink(input: CreateLinkInput): Promise<CreatedLink>;
  listPaidSessions(providerLinkId: string): Promise<PaidSession[]>;
  deactivate(providerLinkId: string): Promise<void>;
}

export class PaymentProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

/** No provider: payments are recorded by hand. */
export const MANUAL_PROVIDER: PaymentLinkProvider = {
  id: "manual",
  mode: "off",
  configured: false,
  unavailableReason: "Card payment links are not set up for this system. Record card payments by hand.",
  createLink: async () => {
    throw new PaymentProviderError("Card payment links are not set up for this system.");
  },
  listPaidSessions: async () => [],
  deactivate: async () => undefined,
};
