# Incident response policy

AppstackX Ltd · ICO ZC135044 · Owner: Khuram · Approved 11/11/2026 · Next review 11/11/2027

## What counts
Any event that could harm the confidentiality, integrity or availability of our systems or of clinic data. Examples: a
lost or stolen device; a suspected account takeover; a leaked secret or key; data sent to the wrong person; a supplier
breach notice; malware; an outage that loses data; a bug that shows one clinic's data to another. A **personal-data
breach** is any of these that affects personal data.

## Our role decides who we tell
- **Clinic data (patients, notes, reports, appointments):** the clinic is the **controller**, we are the **processor**.
  We tell the **clinic**, and the clinic decides whether to report to the ICO and to the patients. We help it.
- **Our own data** (website visitors, demo requests, clinic users' account details where we decide the purpose): we
  are the **controller**. We report to the ICO ourselves.

## Steps
1. **Contain (first hour).** Revoke the exposed key or session, change passwords, sign out all sessions, take the
   affected feature offline if needed (Vercel env/redeploy, `CLINFORMS_DB` rollback only if the database is the
   problem), and preserve evidence: logs, screenshots, timestamps in UTC. Do not delete anything.
2. **Log it.** Start an entry in the incident log (below) with the time we **became aware**. The deadlines run from
   that moment.
3. **Assess.** Which clinics and data, how many people, special-category (health) data or not, and the likely risk.
4. **Tell clinics (processor duty, UK GDPR Art. 33(2)).** Without undue delay. **Target: within 24 hours of becoming
   aware**, or sooner if the DPA says so. Send what we know, then updates: what happened, what data and roughly how many
   people, likely consequences, what we have done and what we suggest. Use the clinic's named DPA contact.
5. **Report to the ICO when we are controller.** Within **72 hours** of becoming aware, unless the breach is unlikely
   to result in a risk to people. If not all facts are known, report in phases. Tell the affected people directly
   without undue delay if there is a **high risk** to them. Record the reasons if we decide not to report.
   ICO: <https://ico.org.uk/for-organisations/report-a-breach/> · 0303 123 1113.
6. **Other reports as relevant:** Action Fraud / Report Fraud (fraud or cybercrime) 0300 123 2040; NCSC
   (<https://report.ncsc.gov.uk/>); the cyber insurer's helpline (if the Cyber Essentials insurance is taken out) –
   **call before engaging paid help**, so costs are covered; the police for theft.
7. **Recover.** Restore from backup if needed ([backups and recovery](backups-and-recovery.md)), rotate all related
   secrets, and check the audit log (`/app/settings/activity`, `audit_log`) for misuse.
8. **Review within 2 weeks.** What happened, why, and what changes. Update the policies and the log.

## Contact list (fill in and keep current)
| Who | Contact |
|---|---|
| Incident lead (director) | Khuram – khuram@appstackx.co.uk – [mobile] |
| Deputy / trusted contractor | [name, contact] |
| ICO breach line | 0303 123 1113 · ico.org.uk report form |
| Cyber insurance helpline / broker | [from the insurance documents] |
| Legal adviser | [name, contact] |
| Each clinic's DPA contact | [clinic – name – email – phone] (keep in the DPA folder, not in git) |
| Supplier security contacts | Vercel, Supabase, Cloudflare, MailerSend, PostHog, Stripe, drafting provider – support/security pages listed in [supplier management](supplier-management.md) |
| Action Fraud / Report Fraud | 0300 123 2040 |

## Incident log
Keep it outside the repo if it holds personal data (e.g. an encrypted note). Fields: ID · became aware (UTC) · found
by · what happened · data and people affected · clinics told (when) · ICO told (when, reference) or reason not ·
actions · closed (date) · lessons.
