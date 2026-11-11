# Access control policy

AppstackX Ltd · Owner: Khuram · Approved 11/11/2026 · Next review 11/11/2027

## Purpose
Only the right people get into our systems and clinic data, with no more access than they need.

## Rules for our own accounts
1. **One person, one login.** Logins are never shared. Every cloud service is opened with a named account, where possible
   on an `@appstackx.co.uk` address.
2. **MFA everywhere it is offered:** an authenticator app or a passkey, and SMS only where nothing else exists. This
   applies to every cloud service in the [supplier list](supplier-management.md), plus the registrar, Apple ID, bank,
   Companies House and HMRC. A service that offers MFA but has it switched off is a breach of this policy.
3. **Passwords:** made by the password manager (Apple Passwords), unique per service, at least 12 characters. No forced
   expiry and no complexity rules (NCSC guidance). Change one at once if it is known or suspected to be exposed (see
   [incident response](incident-response.md)).
4. **Admin rights are separate from daily use.**
   - Mac: the daily account is a Standard user. Software is installed by entering a separate admin account's
     credentials when prompted.
   - Google Workspace: a separate super-admin account, used only in the Admin console.
   - Other consoles (Vercel, Supabase, Cloudflare, GitHub, Stripe, MailerSend, PostHog): used only for administration,
     in a dedicated browser profile that is not used for email or general browsing.
5. **API tokens and keys** are scoped to the least they need, named for their use, stored only in Vercel/Worker
   secrets or `~/.config/appstackx/*.env` (chmod 600), and revoked when no longer used. Never in git, chat or
   screenshots.
6. **Production access** (database writes, Vercel env, deploys to `main`, admin scripts with `--env production`) is
   done by Khuram, or by a contractor or agent only with his explicit go for that action.

## Joiners, movers, leavers (contractors and future staff)
- **Joiner:** Khuram approves the access in writing (email is enough), gives the minimum role, MFA is on before first
  use, and the person is added to the admin register if they hold admin rights.
- **Mover:** access is changed on the day the role changes.
- **Leaver:** all accounts are disabled the same day. Any token, deploy key or secret they could see is rotated, and
  the register is updated.

## Clinic (customer) accounts
- A clinic is created by the platform only after its DPA is signed. Members are **invite-only**. **Two-step (TOTP) is
  required** and cannot be switched off. Roles are owner / admin / clinician / staff. Sessions last 12 hours.
- The clinic's owner/admin manages its own members. We act on a clinic's instructions only after checking them with a
  known contact. Two-step resets are done only after that check (`scripts/admin/reset-two-factor.ts`).
- Platform admin (`/app/platform`) is limited to `CLINFORMS_PLATFORM_ADMINS`, with two-step on.

## Admin register (review every quarter)
| Person | System | Level | Granted | Last reviewed |
|---|---|---|---|---|
| Khuram | All company cloud services, Mac admin account | Owner/admin | – | 11/11/2026 |

## Checks
Every quarter: review the register, remove stale accounts and tokens in every console, and confirm MFA is on everywhere.
There are no inbound firewall rules on company devices; confirm that this is still true at each review.
