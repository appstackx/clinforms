# Sending your invoices and payments to Xero – clinic guide

**For clinics using ClinDesk.** Last updated 12/11/2026.

ClinDesk can send the invoices, credit notes and payments you record in ClinDesk to your clinic's own Xero
organisation, so your accountant sees them in Xero without anyone typing them in twice.

> **Today:** this is being prepared and is not switched on for clinics yet. We will tell you when you can use it.
> Everything below describes how it will work.

## What it does – and what it does not

| ClinDesk sends to Xero | ClinDesk does not send |
|---|---|
| Each invoice when it is **issued** (never drafts), with ClinDesk's own invoice number | Clinical notes, diagnoses, letters or anything clinical |
| Credit notes (credits, voids, write-offs, moves to another payer), set against their invoice | What you type into an invoice line's own description |
| Payments, against the invoice they paid | Money left "on account" until you put it against an invoice |
| The patient or payer each invoice is addressed to, as a Xero contact | Refunds (record them in Xero yourself for now) |

- **One way only.** ClinDesk stays where you bill. Nothing you change in Xero comes back into ClinDesk – if you edit
  or pay an invoice in Xero, ClinDesk does not know.
- **In the order it happened.** A credit note goes after the payments taken on its invoice before it.
- **Patients appear in Xero by name and number**, for example *Megan Hart (P12)*. Their email and postal address are
  sent only if you tick that option.
- **Only from the date you choose.** Invoices issued before your "send from" date are not sent (and nor are their
  payments). Nothing from the past is copied across.
- **Nothing is sent twice.** ClinDesk remembers what it has sent; if Xero is slow or busy, it tries again later and
  never posts the same invoice or payment twice.

## Before you start

- You need a **Xero organisation that keeps its books in pounds (GBP)** and a Xero login that can add invoices.
- Have your **accounts ready in Xero**: a sales account, a bank or clearing account for each way patients pay (card,
  cash, bank transfer, …) and, if you write off bad debts, an account for those. ClinDesk does not create accounts in
  Xero – you choose from the ones you already have.
- If you are **VAT-registered**, your VAT rates must be set up in Xero (most UK clinics' treatments are exempt).
- Only the clinic's **owner or an admin** can connect Xero and choose the accounts.

## 1. Connect

1. Go to **Set-up → Xero** and switch on **Send this clinic's invoices and payments to Xero**.
2. Press **Connect to Xero**. You go to Xero's own sign-in page – ClinDesk never sees your Xero password.
3. In Xero, choose **one** organisation and press **Allow access**. You come back to ClinDesk, which shows the
   organisation's name.

If Xero says the organisation is not in pounds, or you chose more than one, nothing is connected – try again with a
single GBP organisation.

## 2. Choose where things go in Xero

Once connected, the same page lists your Xero accounts, tax rates and tracking options. Choose:

| Setting | What it is for |
|---|---|
| **Default sales account** (required) | Every treatment line, unless a service has its own |
| Items | Products and other non-treatment lines |
| Missed and late-cancelled appointments | Charges for a missed or late-cancelled visit, if you want them apart |
| Write-offs | Needed before any write-off is sent |
| A different account for one service | Optional, for example massage on its own sales account |
| **Payments** – one account per way of paying | The Xero bank or clearing account card, cash, bank transfer … payments go into. Optional: a different account for one site |
| **VAT** – one tax rate per VAT code you use | Pre-suggested from your Xero rates – check them with your accountant. Not needed if you are not VAT-registered |
| Sites (optional) | Tag each site's invoices with a Xero tracking option |

Then set **Send invoices issued on or after** (today, unless your accountant wants another date – change it only
before the first send) and whether to include patients' and payers' contact details.

## 3. Day to day

You do nothing different: issue invoices and take payments in ClinDesk as usual. ClinDesk sends them to Xero every
few minutes. **Set-up → Xero → Sending** shows how many were sent and anything that needs you:

| You see | What to do |
|---|---|
| **Needs a fix** | Read the message – usually an account or tax rate not chosen yet, or one Xero no longer allows. Fix it, then press **Retry** |
| **Waiting** with a reason | A payment or credit note waits for its invoice (or for an earlier payment on it). It goes by itself once that is sent; if its invoice is skipped, it is skipped too |
| **Failed – needs you** | Xero was unreachable for a long time. Press **Retry** (or **Skip** if you have entered it in Xero yourself) |
| **Skipped** | Not sent. Record it in Xero by hand if it should be there |
| **Reconnect Xero** banner | Xero stopped accepting the connection (for example it was removed in Xero, or not used for a long time). Press **Connect again** – nothing is lost, sending carries on where it stopped |

**Send now** sends anything waiting straight away.

## Disconnecting

**Set-up → Xero → Disconnect** stops all sending at once and removes ClinDesk's access to Xero. Everything already in
Xero stays there, and ClinDesk keeps its list of what was sent – if you connect the same organisation again later,
nothing already sent is sent again. You can also remove ClinDesk from Xero's own connected-apps settings; ClinDesk then
shows the **Reconnect Xero** banner.

## Questions

- **Can I send old invoices?** Not at the moment – only invoices issued on or after your "send from" date.
- **Can two ClinDesk clinics share one Xero organisation?** No – each Xero organisation can be connected to one
  clinic only, so two clinics' invoice numbers and contacts never mix in one ledger.
- **What if a number is already used in Xero?** ClinDesk never takes over a Xero invoice, credit note or contact it
  did not create. The item shows **Needs a fix** – check that record in Xero, then press Retry or Skip.
- **Who can see this page?** Only the owner and admins. Every change (switching on, connecting, accounts, Retry,
  Skip, Disconnect) is in the clinic's activity log.
