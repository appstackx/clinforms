# Taking card payments – clinic guide

**For clinics using ClinDesk.** Last updated 13/11/2026.

Take card payments straight into **your clinic's own payment account**: on a card reader at the desk, from a
patient's saved card, and online when patients pay in the patient portal. Payments are processed by **Stripe**. The
money is yours, paid out to your bank by Stripe; you pay Stripe's card fees and you handle any refunds or disputes,
just as with any card terminal.

> Card payments are being switched on clinic by clinic. If you do not see **Set-up → Card payments**, it is not on
> for your clinic yet – ask us.

## 1. Connect your payment account (the clinic's owner, once – about 10 minutes)

1. Go to **Set-up → Card payments** and choose **Connect the clinic's payment account**.
2. You are taken to Stripe's own secure pages. Enter the clinic's business details, the person responsible and the
   bank account for payouts. ClinDesk never sees these details.
3. When you come back, the status shows:
   - **Active – can take payments**: you are ready.
   - **Set-up not finished**: choose **Continue set-up** to carry on where you left off.
   - **Restricted**: Stripe needs something more – choose **Continue set-up** to see what.
4. Turn on **Take card payments**.

You also get your own Stripe Dashboard (sign in at stripe.com) for payouts, disputes and statements.

## 2. Card readers at the desk (owner)

**Set-up → Card payments → Card readers:** choose the site, give the reader a name (for example "Front desk"), enter
the site's address the first time, and the pairing code shown on the reader. Each site can have several readers.

## 3. Taking a payment at the desk

Open the invoice. Under **Card payments**:

- **Send to card reader:** choose the reader and (optionally) an amount – leave it empty for the full balance. Ask
  the patient to tap or insert their card. Then choose **Check payment** – the payment is recorded on the invoice.
- Changed your mind? **Cancel on the reader** – nothing is taken. (If the card already went through, it is recorded
  instead.)
- **Charge saved card:** if the patient has a saved card, choose it and charge the invoice.

A payment is recorded **once**, however many times anyone presses Check payment. If an invoice was meanwhile paid
another way, the card payment stays on the patient's account as credit.

## 4. Saving a patient's card (with their consent)

On the patient's **Invoices** tab → **Saved cards and memberships → Save a card**:

1. **Read the words on screen to the patient.** They say the clinic may keep the card with Stripe and charge it for
   treatment after telling them the amount, and that they can ask for it to be removed at any time.
2. If your clinic charges for missed appointments (section 5), you can tick that the patient also agrees to those
   charges – they hear your policy as part of the words.
3. Tick **The patient has read or heard these words and agreed**, then **Open the card form**.
4. **Hand the screen to the patient** to type their card on Stripe's secure form. Never type a patient's card number
   yourself, and never write card numbers down.

ClinDesk keeps a record of exactly what the patient agreed to, when, and who recorded it – open **Consent** under the
card to see it. Patients can also save a card themselves in the patient portal.

**Remove** a card when the patient asks: any membership charged to it is cancelled too.

## 5. Missed appointments and late cancellations (owner)

**Set-up → Card payments → Missed appointments:** turn on *Charge missed-appointment fees to saved cards* and write
your policy in plain words (for example "Appointments cancelled with less than 24 hours' notice, or missed, are
charged in full"). A missed-appointment fee can then be charged to a saved card **only if the patient agreed to it
when that card was saved**. Otherwise ClinDesk refuses and you take the payment another way.

## 6. Refunds

Open the invoice → **Paid by card → Refund to card**. Enter the amount (up to what is left of that payment) and the
reason. The invoice is credited first (a credit note), then the money goes back to the same card – usually within
5–10 days for the patient. Only owners and administrators can refund (Set-up → Member access can change this).

## 7. Memberships

Owner: **Set-up → Card payments → Membership plans** – a name and a monthly price.
On the patient's **Invoices** tab → **Memberships**: choose the plan, the saved card and the day of the month, read
the words to the patient, tick that they agreed and **Start membership**. Each month ClinDesk issues an invoice and
charges the card once. If the card is declined it tries again the next two days, then marks the membership
*Payment failed* and leaves the invoice open for you to collect another way.

## 8. Patients paying online

Signed-in patients see **Payments → Pay now** on the portal's home page for any invoice they owe. They pay on
Stripe's secure page and come back to a thank-you message; the payment is on the invoice straight away.

## 9. Payouts and fees

**Billing → Card payouts and fees** shows what is waiting to be paid out, each payout to your bank, and each card
payment with Stripe's fee and the net amount, linked to its invoice.

## 10. Good to know

- In **test mode** (shown at the top of the screens) no real card is charged: use the test reader's *Tap a test card*
  and the card number 4242 4242 4242 4242.
- Disputes (chargebacks) are handled in your own Stripe Dashboard; ClinDesk notes them in the activity log.
- If you refund in your Stripe Dashboard instead of ClinDesk, the refund is still recorded on the patient's account –
  add a credit note to the invoice to match.
