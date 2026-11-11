# Billing insurers through Healthcode – clinic guide

**For clinics using ClinDesk.** Last updated 11/11/2026.

Healthcode is the clearing house most UK private medical insurers (Bupa, AXA Health, Aviva, Vitality, WPA and
others) receive bills through. ClinDesk keeps every number and code each bill needs, checks each insurer invoice
before you send it, and tracks where each bill has got to.

> **Today:** you still send the bill from Healthcode's own website. ClinDesk tells you which invoices are ready
> and what is missing from the rest. **Coming next:** a Healthcode file you download from ClinDesk and upload in
> one go – and later, sending straight from the invoice. We will let you know when each is switched on.

## 1. Before you start (once, outside ClinDesk)

| You need | Where it comes from |
|---|---|
| A Healthcode account for the clinic and its **Site ID** | Register with Healthcode (healthcode.co.uk). Each separately registered site has its own Site ID |
| The clinic's **payee provider number** | The number insurers pay the clinic under |
| The clinic's **provider number with each insurer** | Each insurer's provider recognition team |
| Each practitioner's **provider number with each insurer** | Each practitioner's recognition letter from the insurer |
| Each insurer's **treatment codes** for your services | The insurer's fee schedule (ask the insurer or Healthcode) |

## 2. Set up ClinDesk (once – owner, or an administrator who works at every site)

1. **Set-up → Billing settings → Healthcode:** enter the **Healthcode Site ID** and **Payee provider number**. If a
   site is registered on its own, add its own Site ID under *Sites registered on their own* (blank = the clinic's).
2. **Set-up → Referrers and insurers →** open each insurer **→ Healthcode:** enter the **Healthcode insurer
   identifier** (as Healthcode lists the insurer, for example `bup`) and the **clinic's provider number with this
   insurer**. *Diagnosis code on every bill* is pre-set for Bupa, AXA Health and Vitality – change it if an insurer
   tells you otherwise.
3. **Set-up → Practitioners →** open each practitioner **→ Insurer provider numbers:** one number per insurer.
4. **Set-up → Insurer treatment codes:** the insurer's code for each of your services. (A CCSD code can also go on
   each service under **Set-up → Services**.)

## 3. For each patient claiming through insurance

- On the **case**: the insurer, the **membership number**, and an **authorisation** (number of sessions and the
  dates it covers).
- **Diagnosis:** on the case's *Diagnosis* panel, an ICD-10 code (for example `M54.5`, low back pain). Pick from the
  common codes or type one; ClinDesk tidies the format (`m545` becomes `M54.5`). An invoice uses the case's code
  unless you set one on the invoice.
- The patient's **first and last name, date of birth and postcode**.

## 4. Sending bills

1. Issue the insurer invoices as normal.
2. Open **Billing → Insurer claims → Healthcode**. Invoices are listed as **Ready** or **Needs review**. Each one in
   *Needs review* says exactly what is missing, with a link to the place to fix it.
3. Send the ready ones through Healthcode's website.
4. On each invoice's **Healthcode** panel, set the **bill status** as it moves: *Exported → Validated → Collected →
   Paid*, or *Failed* if Healthcode or the insurer rejects it. Every change is kept in the audit trail.

## 5. Fixing a failed bill

| Healthcode says | Fix in ClinDesk |
|---|---|
| Provider not recognised | The practitioner's number for that insurer (Set-up → Practitioners) or the clinic's (the insurer's Healthcode card) |
| Invalid or missing treatment code | Set-up → Insurer treatment codes |
| Membership or authorisation not found / expired | The case: membership number, authorisation dates and sessions |
| Diagnosis missing or invalid | The case's Diagnosis panel (or the invoice's Healthcode panel) |
| Patient details do not match | The patient's name, date of birth and postcode, exactly as the insurer holds them |

After fixing it, correct the invoice the usual way (credit note and re-issue if the amount or lines change), send it
again, and set the bill status.

## 6. Who can do what

| Task | Needs |
|---|---|
| Healthcode set-up (sections 2) | Owner, or an administrator for every site |
| See the Healthcode tab | Billing – view |
| Set a bill status | Billing – edit |
| See or change a diagnosis code | Clinical records – view (and patients – edit to change it on the case) |

Questions: **hello@clindesk.co.uk**.
