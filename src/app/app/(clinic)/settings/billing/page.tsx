import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader, Panel } from "@/components/account/shell";
import { CLINFORMS_NAME, CLINIC_SYSTEM_NAME } from "@/lib/brand";
import { requireAppContext } from "@/server/auth/session";
import { currentBrand } from "@/server/brand";
import { billingViewFor, canManageBilling } from "@/server/billing/views";
import { getDb } from "@/server/db";
import { clinicPackages } from "@/server/pms/entitlements";
import { AddReportsPanel, ChoosePlanForm, ManageBillingButton } from "./forms";
import { ClinDeskOfferCard } from "@/components/account/clindesk-offer";
import { showClinDeskOffer } from "@/lib/clindesk-offer";
import { clinicBrand, otherBrandSignIn } from "@/server/brand-home";
import type { BillingView } from "@/server/billing/views";

const c0 = (view: BillingView) => view.current.choice;

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Plan and billing" };

/**
 * Settings → Plan and billing (31/10/2026), both brands. Owners and admins: the clinic's plan, its state and next
 * payment, notices (payment overdue, on hold, ending), the practitioner check, choosing or changing the plan
 * (ClinDesk band monthly or yearly + optional Reports add-on, or ClinForms on its own) and "Manage billing". Everyone
 * else sees who to ask. No VAT is charged (AppstackX is not VAT registered); no vendor names. Logic: src/server/billing/views.ts.
 */
export default async function PlanBillingPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { session, membership } = await requireAppContext();
  if (!canManageBilling(membership.role)) {
    return (
      <>
        <PageHeader title="Plan and billing" />
        <Panel>
          <p className="text-sm text-slate-700">Your clinic&apos;s owner and administrators choose the plan and manage billing.</p>
        </Panel>
      </>
    );
  }
  const [packages, ownBrand] = await Promise.all([clinicPackages(membership.tenantId), clinicBrand(membership.tenantId)]);
  const raw = searchParams.product;
  const asked = Array.isArray(raw) ? raw[0] : raw;
  // 01/11/2026 (Khuram's R1): a ClinDesk clinic is never offered ClinForms' own plans – the Reports add-on is its way to reports.
  const clinicSide = packages.clinic || ownBrand === "clinic";
  const product = clinicSide ? "clindesk" : asked === "clinforms" || asked === "clindesk" ? asked : currentBrand().id === "clinic" ? "clindesk" : "clinforms";
  const view = await billingViewFor(
    getDb(),
    { tenantId: membership.tenantId, clinicName: membership.clinicName, role: membership.role, userId: session.user.id, sessionId: session.session.id },
    { product, switchToClinDesk: !clinicSide && asked === "clindesk" },
  );
  // R2: the full clinic system offered to a ClinForms clinic (owners and admins – this page is theirs), plan or no plan.
  const offer = showClinDeskOffer({ clinicSystem: packages.clinic, clinicBrand: ownBrand, role: membership.role }) && view.product === "clinforms";
  // R3: a clinic whose plan now includes the clinic system, still on ClinForms' host – where to sign in to it.
  const clinicSignIn = packages.clinic ? otherBrandSignIn("clinic") : null;
  const movingToClinDesk = view.changesRunning && view.product === "clindesk" && c0(view)?.product === "clinforms";
  const c = view.current;
  const included =
    view.product === "clindesk"
      ? [
          "All your sites and staff",
          `${CLINIC_SYSTEM_NAME} plans are by the number of active practitioners`,
          `The Reports add-on includes a number of completed referrer forms a month; extra ones are ${view.extraReport} each`,
          "Pay by card (including phone wallets) or Direct Debit",
        ]
      : ["All your sites and staff", `${CLINFORMS_NAME} plans include a number of completed referrer forms a month; extra ones are ${view.extraReport} each`, "Pay by card (including phone wallets) or Direct Debit"];
  const hasPlan = c.state !== "none";
  // 01/11/2026: a running ClinDesk plan without Reports – adding the add-on is its own, obvious action.
  const offerReports = view.paymentsReady && view.canChoose && view.changesRunning && c.choice?.product === "clindesk" && !c.choice.reports;
  return (
    <>
      <PageHeader title="Plan and billing" description="Your clinic's plan, payments and invoices. No VAT is charged." />

      {c.readOnly ? (
        <div className="mb-4" data-testid="billing-read-only">
          <Notice tone="error">
            A payment for your plan is overdue. Clinical work – notes, the diary, patient records, letters and messages to patients – carries on as normal. Settings changes, new staff invitations, imports, marketing messages and new reports are paused until it is paid. Update your payment details under Manage billing.
          </Notice>
        </div>
      ) : c.state === "past_due" ? (
        <div className="mb-4" data-testid="billing-past-due">
          <Notice tone="warning">The latest payment did not go through. Please update your payment details under Manage billing by {c.graceUntil}. After that, settings changes and new reports are paused until it is paid – clinical work always carries on.</Notice>
        </div>
      ) : null}
      {c.state === "pending_payment" ? (
        <div className="mb-4" data-testid="billing-pending">
          <Notice tone="info">Your first payment is being processed. A Direct Debit takes a few working days to clear – your plan starts as soon as it has.</Notice>
        </div>
      ) : null}
      {view.seat?.over ? (
        <div className="mb-4" data-testid="billing-seat-warning">
          <Notice tone="warning">
            Your clinic has {view.seat.active} active practitioners, more than the {view.seat.max} your plan includes. Nothing stops working – please move to {view.seat.suggested ?? "a larger plan"} below.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Your plan">
          <p className="text-lg font-semibold text-slate-900" data-testid="billing-plan">
            {c.planLabel ?? "No plan yet"}
          </p>
          <dl className="mt-3 space-y-1 text-sm text-slate-700">
            {hasPlan ? (
              <div className="flex gap-2">
                <dt className="text-slate-500">Status:</dt>
                <dd data-testid="billing-status">{c.stateLabel}</dd>
              </div>
            ) : null}
            {c.amount ? (
              <div className="flex gap-2">
                <dt className="text-slate-500">Price:</dt>
                <dd>
                  {c.amount} {c.interval === "year" ? "a year" : "a month"}
                </dd>
              </div>
            ) : null}
            {c.nextPayment ? (
              <div className="flex gap-2">
                <dt className="text-slate-500">Next payment:</dt>
                <dd data-testid="billing-next">{c.nextPayment}</dd>
              </div>
            ) : null}
            {c.endsOn ? (
              <div className="flex gap-2">
                <dt className="text-slate-500">{c.state === "canceled" ? "Ended:" : "Ends on:"}</dt>
                <dd>{c.endsOn}</dd>
              </div>
            ) : null}
          </dl>
          {c.managedBySupport ? <p className="mt-3 text-sm text-slate-600">Your plan is managed for you by our support team.</p> : null}
          {c.testMode ? <p className="mt-3 text-xs text-amber-800">Test payments only – nothing is charged.</p> : null}
          {hasPlan && view.paymentsReady && !c.managedBySupport ? (
            <div className="mt-4">
              <ManageBillingButton />
            </div>
          ) : null}
        </Panel>
        <Panel title="What is included">
          <ul className="space-y-1 text-sm text-slate-700" data-testid="billing-included">
            {included.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Questions about billing: {currentBrand().contactEmail}.
            {packages.reports || ownBrand === "clinforms" ? (
              <>
                {" "}
                See also <Link href="/app/settings/plan" className="underline">Plan &amp; usage</Link>.
              </>
            ) : null}
          </p>
        </Panel>
      </div>

      {clinicSignIn ? (
        <div className="mt-6" data-testid="billing-clinic-sign-in">
          <Notice tone="info">
            {CLINIC_SYSTEM_NAME} has its own address. <a href={clinicSignIn} className="font-medium underline">Sign in to {CLINIC_SYSTEM_NAME}</a> with the same email and password – you will be asked for your two-step code again.
          </Notice>
        </div>
      ) : null}

      {offer ? <ClinDeskOfferCard className="mt-6" showSwitchNote={view.changesRunning} /> : null}

      <AddReportsPanel view={view} offer={offerReports} />

      <Panel title={view.changesRunning ? "Change your plan" : "Choose a plan"} className="mt-6">
        {!view.paymentsReady ? (
          <p className="text-sm text-slate-700">{view.paymentsUnavailable}</p>
        ) : view.chooseBlocked ? (
          <p className="text-sm text-slate-700" data-testid="billing-choose-blocked">
            {view.chooseBlocked}
          </p>
        ) : (
          <>
            {movingToClinDesk ? (
              <p className="mb-4 text-sm text-slate-700" data-testid="billing-move-to-clinic">
                Move your {CLINFORMS_NAME} plan to {CLINIC_SYSTEM_NAME}: choose a plan and keep your reports with the Reports add-on. Any difference is charged (or credited) today, and the change applies once the payment goes through.{" "}
                <Link href="?product=clinforms" className="underline">
                  Keep {CLINFORMS_NAME} on its own
                </Link>
                .
              </p>
            ) : !view.changesRunning ? (
              <p className="mb-4 text-sm text-slate-700">
                {view.product === "clindesk" ? (
                  clinicSide ? (
                    <>{CLINIC_SYSTEM_NAME} – the full clinic system. Add the Reports add-on to have referrer forms completed for you.</>
                  ) : (
                    <>
                      {CLINIC_SYSTEM_NAME} – the full clinic system, with your reports as the Reports add-on. Only need referrer forms completed?{" "}
                      <Link href="?product=clinforms" className="underline">
                        See {CLINFORMS_NAME} plans
                      </Link>
                      .
                    </>
                  )
                ) : (
                  <>{CLINFORMS_NAME} on its own: referrer forms completed from your notes.</>
                )}
              </p>
            ) : (
              <p className="mb-4 text-sm text-slate-700">Any difference is charged (or credited) today, and the change applies once the payment goes through.</p>
            )}
            <ChoosePlanForm view={view} />
          </>
        )}
      </Panel>
    </>
  );
}
