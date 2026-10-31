#!/usr/bin/env bash
# CLINFORMS MAILERSEND ACCOUNT ONLY (clinforms.co.uk). Do NOT paste ClinDesk's token here: ClinDesk (clindesk.co.uk)
# has its own, separate MailerSend account, whose token goes in MAILERSEND_API_KEY_CLINIC – set separately, never
# with this script (docs/auth.md §4).
#
# Sets the MailerSend API token for ClinForms: in the private secrets file
# (~/.config/appstackx/clinforms.secrets.env, as PRODUCTION_MAILERSEND_API_KEY) and in Vercel
# (production + preview, as MAILERSEND_API_KEY, sensitive). The token is read with hidden input
# and never printed or logged. Non-secret settings (sender address, provider switch) are set separately.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "This sets the token of the ClinForms MailerSend account (clinforms.co.uk) only – not ClinDesk's."
printf 'Paste the MailerSend API token for clinforms.co.uk (input is hidden), then press Enter: '
IFS= read -rs KEY
echo
case "$KEY" in
  mlsn.*) ;;
  *) echo "That doesn't look like a MailerSend API token (it should start with mlsn.). Nothing changed."; unset KEY; exit 1 ;;
esac

SECRETS="$HOME/.config/appstackx/clinforms.secrets.env"
mkdir -p "$(dirname "$SECRETS")"
touch "$SECRETS"
chmod 600 "$SECRETS"
tmp="$(mktemp)"
grep -v '^PRODUCTION_MAILERSEND_API_KEY=' "$SECRETS" > "$tmp" || true
printf 'PRODUCTION_MAILERSEND_API_KEY=%s\n' "$KEY" >> "$tmp"
mv "$tmp" "$SECRETS"
chmod 600 "$SECRETS"
echo "Saved to the private secrets file."

for env in production preview; do
  npx -y vercel@63.1.0 env rm MAILERSEND_API_KEY "$env" --yes >/dev/null 2>&1 || true
  if printf '%s' "$KEY" | npx -y vercel@63.1.0 env add MAILERSEND_API_KEY "$env" --sensitive --yes >/dev/null 2>&1; then
    echo "Added to Vercel $env."
  else
    echo "Could not add to Vercel $env – tell Claude."
  fi
done
unset KEY
echo "Done. Tell Claude it's set. (The secrets file changed – refresh the iCloud backup when convenient.)"
