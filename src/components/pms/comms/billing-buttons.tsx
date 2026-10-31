"use client";
/**
 * Billing's message buttons (comms, M6): "Email" on an invoice, "Text payment link", "Email statement". Each sends
 * through the outbox / test service and says what happened (sent, kept in the outbox, or why not).
 */
import { useRouter } from "next/navigation";
import * as React from "react";
import { Mail, MessageSquare } from "lucide-react";
import { PmsButton, useToast } from "@/components/pms/ui";
import { emailInvoiceAction, emailStatementAction, sendPaymentLinkAction } from "@/app/app/clinic/messages/actions";

export function EmailInvoiceButton({ invoiceId, className }: { invoiceId: string; className?: string }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <PmsButton
      variant="secondary"
      size="sm"
      className={className}
      loading={busy}
      data-testid="email-invoice"
      onClick={() => {
        setBusy(true);
        void emailInvoiceAction(invoiceId).then((r) => {
          setBusy(false);
          if (r.ok) toast.success(`Invoice emailed. ${r.sent.label}`);
          else toast.error(r.error);
          router.refresh();
        });
      }}
    >
      <Mail aria-hidden />
      Email
    </PmsButton>
  );
}

export function TextPaymentLinkButton({ invoiceId }: { invoiceId: string }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <PmsButton
      variant="secondary"
      loading={busy}
      data-testid="text-payment-link"
      onClick={() => {
        setBusy(true);
        void sendPaymentLinkAction(invoiceId, "sms").then(async (r) => {
          if (!r.ok && /text/i.test(r.error)) r = await sendPaymentLinkAction(invoiceId, "email");
          setBusy(false);
          if (r.ok) toast.success(`Payment link sent. ${r.sent.label}`);
          else toast.error(r.error);
          router.refresh();
        });
      }}
    >
      <MessageSquare aria-hidden />
      Text payment link
    </PmsButton>
  );
}

export function EmailStatementButton({ who, from, until }: { who: { patientId: string } | { payerReferrerId: string }; from: string; until: string }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  return (
    <PmsButton
      variant="secondary"
      loading={busy}
      data-testid="email-statement"
      onClick={() => {
        setBusy(true);
        void emailStatementAction(who, from, until).then((r) => {
          setBusy(false);
          if (r.ok) toast.success(`Statement emailed. ${r.sent.label}`);
          else toast.error(r.error);
        });
      }}
    >
      <Mail aria-hidden />
      Email statement
    </PmsButton>
  );
}
