# Pricing – all tiers, numbers and reasoning

**Nothing has been formally quoted to any prospect.** All prices below are assistant proposals; Khuram has not explicitly confirmed a price list. RED pricing has not been discussed. Third-party prices came from search snippets – check at source before quoting.

## 1. First proposal (assistant, 2026-10-06 09:24 UTC)
Charge **per clinic, not per clinician**, tiered by report volume.

| Plan | Price | Includes |
|---|---|---|
| Starter | **£99/mo** | Up to 15 reports/month, 1 template, all clinicians |
| Practice | **£199/mo** | Up to 50 reports/month, up to 5 templates |
| Extra reports | **£4 each** | |
| Setup (one-off) | **£750** | Template build, onboarding, data-protection paperwork |
| **Founding customer (Dell)** | **£149/mo fixed for 12 months + £250 setup** | In return for feedback and a case study |

Reasoning:
- **Value:** MedCo/RTA physio report fixed fee £226 since April 2025 (DWF) → one report covers a month. Assumed ~1 h to write a report, ~15 min to review a draft → 20 reports/month frees ~15 clinician-hours (check with Dell).
- **Market:** AI scribes £40–£55 per clinician/month (Physitrack £39.99/user; Heidi UK annual ≈ £50/mo) → £149–£199 for a small clinic is in line.
- **Running cost:** AI well under £1/report; UK hosting tens of pounds/month. Don't go lower – compliance and support cost the same regardless of clinic size.
- Draft reply 1 to Dell said "**typically £99–£199 depending on volume**" (the only price Dell may have seen; unverified whether sent).

## 2. After the forms pivot (assistant, 06/10 15:24 UTC)
Setup includes mapping **up to 5 referrer forms**; then about **£50 per extra form or new version**.

## 3. Research-based recommendation for Blue Heart (briefing, 06/10 16:21 UTC)
- Comfort zone: **£100–300/month + setup up to ~£500** (<1% of estimated turnover; similar to TM3's own price). Five-figure build fee = stretch.
- **Quote: "Practice £199/mo, founding price £149/mo fixed for 12 months, plus £250 setup, paid monthly, cancel any time."** 5 included forms = Blue Heart template + top 4 referrers. Year 1 ≈ **£2,040** vs central saving ~£2k+/month.
- **Don't offer Starter £99** – undersells for 11 sites / ~10 clinicians.
- Extra forms: they'll want 8–15 → **cap it, e.g. "up to 10 extra forms for £300"**, not £50 each.
- **VAT:** physio treatment is VAT-exempt → they probably can't reclaim → £149 ≈ **£179** to them. Say whether prices include VAT.
- Deal-breakers: piling form fees; annual prepayment/lock-in; per-seat pricing (~16 staff); VAT surprise; any doubt about patient data (need DPA, UK/EU hosting, no training on their data, clinician sign-off, audit trail); retyping notes from TM3.
- The plan's demo script ends with "founding offer £149/mo + £250 setup" as a next step.

## 4. ROI model (for an owner like Dell; assumptions unproven – claim no savings until measured)
Assumptions: 30–60 min per form; clinician £30–50/h; tool cuts writing time 50–70%.

| Scenario | Current cost/month | Saving/month |
|---|---|---|
| Low: 50 forms × 0.5 h × £30 | £750 | £375–525 |
| **Central: 125 forms × 0.75 h × £40** | **£3,750** | **£1,900–2,600 (~47–66 h)** |
| High: 300 forms × 1 h × £50 | £15,000 | £7,500–10,500 |
Each saved hour ≈ two half-hour appointments (~£90–120). Progress/discharge reports are usually unpaid admin [I]. Video rule: show real counts, claim no time savings.

## 5. Our cost base (for margin)
| Item | Cost | Source/date |
|---|---|---|
| AI per completed form (Sonnet 5.5, medium) | **$0.10–0.12** (Opus 5.5 was $0.23–0.26) | Measured 09/10 sweep |
| AI per new referrer form analysis | **$0.08–0.14** once per form | Measured 09/10 |
| AI at 125 forms/month | **~$15/month** | Estimate 09/10 |
| Model list prices used | Opus 5.5 $4/$20, Sonnet 5.5 $2/$10 (cache read $0.20), Haiku 4.5 $1/$5 per MTok | claude-api skill table, 09/10 |
| Vercel Pro | ~$20/month (some sources: per member) | Third-party sites, 09/10 – verify at vercel.com/pricing |
| Cloudflare Workers Paid | ~$5/month | Third-party – verify |
| Supabase project per client | ~£20+/month each + upkeep → **doesn't pay at £149/mo** → one shared DB | Estimate 09/10 |
| Word→PDF converter | ~£5/month VPS, or Railway / Fly.io London | Estimate |
| ElevenLabs voice-over (Dell video) | ~$0.85 generation + ~$0.38 QA transcription | 09/10 |

## 6. SaaS packaging ideas (not decided)
- Same UI for all; pooled tenancy; **dedicated Supabase instance = premium option for large groups**.
- Shared library of ready-mapped insurer forms (Bupa, Aviva…) as a selling point / moat.
- Cross-sell idea: "For clinics" link on CareConnect's £299 Practice tier (idea only).
- Pilot/hardening estimate: ~3–5 weeks of work once a clinic commits.
- **RED (PROPOSED by the assistant at hand-off 09/10, not discussed with Khuram – `next-steps.md` §A Q7):** if Daniel asks the price on the call, same structure as Blue Heart – per clinic, not per seat; Practice £199/mo list; founding offer £149/mo fixed 12 months + £250 setup incl. 5 forms (e.g. Bupa, AXA, Aviva + 2), monthly, cancel any time, state VAT treatment – or simply "depends on volume, typically £99–£199/month; we'll confirm after a short pilot".
