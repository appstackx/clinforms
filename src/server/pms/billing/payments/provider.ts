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

export interface SavedCardRef {
  customerRef: string;
  methodRef: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface CardCharge {
  /** The provider's reference for the charge (recorded once as the payment's provider reference). */
  chargeRef: string;
  amountPence: number;
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
  /** Saves the provider's TEST card for a patient (test mode only – no real card is ever entered here). */
  saveTestCard(input: { tenantId: string; patientId: string; idempotencyKey: string }): Promise<SavedCardRef>;
  /** Charges a saved card (test mode). */
  chargeSavedCard(input: { customerRef: string; methodRef: string; amountPence: number; description: string; idempotencyKey: string }): Promise<CardCharge>;
  /** Refunds (part of) a card payment made through the provider (test mode). */
  refund(input: { chargeRef: string; amountPence: number; idempotencyKey: string }): Promise<{ refundRef: string }>;
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
  saveTestCard: async () => {
    throw new PaymentProviderError("Saved cards are not set up for this system.");
  },
  chargeSavedCard: async () => {
    throw new PaymentProviderError("Saved cards are not set up for this system. Take the card on the card reader instead.");
  },
  refund: async () => {
    throw new PaymentProviderError("Card refunds through the provider are not set up. Refund on the card reader and record it here.");
  },
};
