# Backups and recovery policy

AppstackX Ltd · Owner: Khuram · Approved 11/11/2026 · Next review 11/11/2027

## What we back up
| Data | Where it lives | Backup |
|---|---|---|
| Production database: clinic data (encrypted free text and files), accounts, audit log | **Supabase Postgres**, project `clinforms`, London (since 29/10/2026) | (1) Supabase **daily backups, kept 7 days** (Pro plan). (2) **PITR – OFF today; must be on before real clinic data** (add-on, about $100/month). (3) Our own logical dumps (below) |
| Patient files (when `CLINFORMS_FILE_STORE=supabase` is on) | Supabase Storage bucket `clinic-files` (private) | **Not in database backups.** Copy the bucket alongside the dump once it is in use |
| Frozen fallback | Cloudflare **D1 `clinforms-prod`** (EU), read-only since 29/10/2026 | D1 Time Travel. **Delete it after about 29/11/2026** once the rollback window closes (it still holds data) |
| Data-encryption keys and app secrets | Vercel env; `~/.config/appstackx/clinforms.secrets.env` (chmod 600) | Encrypted disk image in iCloud Drive; passphrase in Apple Passwords. **Re-make it after any key change.** Without the keys, backups cannot be read |
| Source code | GitHub `appstackx/clinforms` (private) + the Mac | Git history on both |
| Company documents (DPAs, contracts) | Google Workspace / Mac | Google retention + Time Machine or iCloud (? Khuram to confirm) |

## Our own database dumps
- **How:** `pg_dump` from a Docker `postgres:17` container over the Supabase **session pooler** with
  `sslmode=verify-full` and the project CA certificate, in custom format (`-Fc`). The connection string is read from
  the chmod 600 env file and never typed into the command line or chat.
- **Where:** `~/Projects/Appstackx/backups/` (folder chmod 700, files chmod 600). The Mac has FileVault on. Name:
  `supabase-prod-<reason or date>-YYYYMMDD.dump`. An off-site copy goes into an encrypted disk image, never as a plain
  file in cloud storage. The dump holds ciphertext of clinic free text, but it also holds plaintext names, emails and
  metadata, so treat it as patient data.
- **When:** before every production migration or risky change (as on 02/11/2026,
  `supabase-prod-before-healthcode-20261102.dump`), and **weekly** once a clinic has real data. Keep 4 weekly + 3
  monthly dumps. Delete older ones securely (so that deleted patient data does not live on in old dumps longer than the
  retention set out in the DPA).
- **Today:** only one manual dump exists. There is no schedule yet. That is a gap: add a weekly reminder or a launchd
  job.

## Recovery
- **Targets (to agree in each DPA):** recovery point ≤ 24 hours now (daily backups); ≤ minutes once PITR is on.
  Recovery time ≤ 1 working day.
- **Options, in order:** Supabase PITR/daily restore (dashboard → Database → Backups) → restore our dump into a new
  Supabase project with `pg_restore` and point `DATABASE_URL` at it → as a last resort during the window, the frozen
  D1 (`CLINFORMS_DB=d1` + redeploy; it holds data only up to 29/10/2026).
- After any restore: check the key fingerprint (`npm run ops:key-fingerprint`), open a report in the internal clinic,
  and run the read-only checks in `docs/go-live.md`. Tell affected clinics what was lost (see
  [incident response](incident-response.md)).

## Testing
**Every quarter**, restore the latest dump into a scratch database (Docker `postgres:17` locally, or a throwaway
Supabase project). Check table counts, that one encrypted record decrypts, and that the audit trigger exists. Record
the date and result here.

| Date | Backup tested | Result |
|---|---|---|
| – | – | No restore test recorded yet |
