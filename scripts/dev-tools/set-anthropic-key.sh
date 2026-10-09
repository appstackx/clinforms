#!/usr/bin/env bash
# Sets ANTHROPIC_API_KEY in clinforms/.env.local (gitignored) and, optionally, in Vercel
# (production + preview). The key is read with hidden input and never printed or logged.
set -euo pipefail
cd "$(dirname "$0")/../.."

printf 'Paste your Anthropic API key (input is hidden), then press Enter: '
IFS= read -rs KEY
echo
case "$KEY" in
  sk-ant-*) ;;
  *) echo "That doesn't look like an Anthropic API key (it should start with sk-ant-). Nothing changed."; unset KEY; exit 1 ;;
esac

touch .env.local
chmod 600 .env.local
tmp="$(mktemp)"
grep -v '^ANTHROPIC_API_KEY=' .env.local > "$tmp" || true
printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" >> "$tmp"
mv "$tmp" .env.local
chmod 600 .env.local
echo "Saved to clinforms/.env.local (local only, gitignored)."

printf 'Also add it to Vercel (production + preview) so clinforms.co.uk can draft live? [y/N] '
read -r yn
if [[ "$yn" =~ ^[Yy]$ ]]; then
  for env in production preview; do
    npx -y vercel@63.1.0 env rm ANTHROPIC_API_KEY "$env" --yes >/dev/null 2>&1 || true
    if printf '%s' "$KEY" | npx -y vercel@63.1.0 env add ANTHROPIC_API_KEY "$env" --sensitive --yes >/dev/null 2>&1; then
      echo "Added to Vercel $env."
    else
      echo "Could not add to Vercel $env (run: npx vercel env add ANTHROPIC_API_KEY $env)."
    fi
  done
  echo "Tell Claude it's done - production needs a redeploy to pick it up."
fi
unset KEY
echo "Done. You can close this tab."
