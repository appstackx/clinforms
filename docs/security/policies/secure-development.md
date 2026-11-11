# Secure development policy

AppstackX Ltd · Owner: Khuram · Approved 11/11/2026 · Next review 11/11/2027

Applies to everyone who changes ClinDesk/ClinForms code, configuration or infrastructure, including contractors and
automated agents.

## Branches and release
1. **`main` = production.** Every push to `main` deploys clinforms.co.uk and clindesk.co.uk. Nobody pushes, merges
   into or rebases `main` without Khuram's explicit go.
2. Work happens on a **feature branch** (`feat/…`, `fix/…`). One change per branch.
3. **Before merging:** the full check chain passes – `npm run typecheck && npm run lint && npm run test:medreport &&
   npm run test:db && npm run test:auth && npm run test:site && npm run test:gateway && npm run build` – plus the
   relevant e2e scripts (`scripts/e2e/`). Merge with `--no-ff`.
4. **Review:** every change that touches sign-in, tenancy, encryption, the audit log, payments, file handling or data
   export gets an **independent security review** (a second reviewer or a separate review pass) before merge. Findings
   are fixed or written down as accepted risks with Khuram's sign-off.
5. **Database migrations** are written for both dialects and tested (`test:db`, parity test). Take a database dump
   ([backups](backups-and-recovery.md)) before applying one to production. Apply only with Khuram's go.
6. After a deploy: smoke checks (health endpoints, pages 200, `/app` redirects, store endpoints 401, no error logs). Keep
   a known-good deployment as the rollback point.

## Secrets
- **Never commit secrets** (`.env*`, keys, passcodes, tokens, invite or reset links, `*.pem`, `*.crt`). Scan the
  staged diff before every commit (e.g. for `sk-`, `-----BEGIN`, `postgres://`, `eyJ`).
- Secrets live only in Vercel/Worker secrets and `~/.config/appstackx/*.env` (chmod 600). Look at them by **names
  only**. Never put them in app `.env` files that a build could bundle.
- Server-only secrets never get a `NEXT_PUBLIC_` prefix.
- A secret that appears in chat, a screenshot, a log or a commit is **burned**: rotate it at once and follow the
  [incident response](incident-response.md) steps.
- Production data keys rotate by adding a new key id. Re-make the offline encrypted key backup after any change.

## Data in development
Fictional data only outside production. Never copy production data to a laptop, preview or test database, except an
encrypted backup dump handled under the backup policy. Third-party forms and prospect files stay out of git.

## Dependencies
- Pin exact versions. New packages must come from a known publisher and are reviewed before they are added.
- Normal updates: only versions published at least **14 days** ago (supply-chain safety).
- **Security fixes override the 14-day wait**: a high or critical advisory (CVSS ≥ 7) in a production dependency is
  patched and deployed within **14 days** of the fix's release.
- **Monthly:** `npm audit --omit=dev` (main app and `workers/data-gateway`), `npm outdated`, and Next.js/Better Auth
  release notes; update. Record the date in the review log. *(Gap: no CI or automated alerts yet. Turn on GitHub
  Dependabot security alerts for the repo.)*

## Secure coding baseline
Server-side authorisation on every endpoint (actor + tenant checks); parameterised queries only; validate and limit
inputs and file sizes; no patient data or secrets in logs; security headers and CSP (move Report-Only to enforced);
customer-facing wording stays neutral (`neutral-wording` tests).
