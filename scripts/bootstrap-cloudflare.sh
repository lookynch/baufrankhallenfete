#!/usr/bin/env bash
set -euo pipefail

PROJECT="${PAGES_PROJECT:-baufrankhallenfete}"
DB_NAME="fete"
REPO="${GITHUB_REPO:-lookynch/baufrankhallenfete}"
cd "$(dirname "$0")/.."

echo "== Einmalige Cloudflare-Einrichtung für $PROJECT =="
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login

if grep -q '00000000-0000-0000-0000-000000000000' wrangler.toml; then
  echo "-> D1-Datenbank '$DB_NAME' anlegen"
  output="$(npx wrangler d1 create "$DB_NAME" 2>&1 || true)"
  id="$(echo "$output" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
  if [ -z "$id" ]; then
    id="$(npx wrangler d1 info "$DB_NAME" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).uuid))')"
  fi
  sed -i.bak "s/00000000-0000-0000-0000-000000000000/$id/" wrangler.toml && rm -f wrangler.toml.bak
  echo "   database_id=$id in wrangler.toml eingetragen – bitte committen."
fi

echo "-> Pages-Projekt '$PROJECT' anlegen (falls nicht vorhanden)"
npx wrangler pages project create "$PROJECT" --production-branch main 2>/dev/null || echo "   existiert bereits"

secret() { openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48; }

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "-> GitHub-Environment 'production' und Secrets setzen ($REPO)"
  gh api -X PUT "repos/$REPO/environments/production" >/dev/null
  for name in SESSION_PEPPER COOKIE_SECRET QR_SECRET IP_HASH_SECRET BUZZER_HMAC_SECRET ENC_KEY BOOTSTRAP_TOKEN; do
    if gh secret list --env production --repo "$REPO" | grep -q "^$name\b"; then
      echo "   $name existiert – unverändert (niemals rotieren ohne Neu-Einladung der Admins)"
    else
      value="$(secret)"
      gh secret set "$name" --env production --repo "$REPO" --body "$value"
      if [ "$name" = "BOOTSTRAP_TOKEN" ] || [ "$name" = "BUZZER_HMAC_SECRET" ]; then
        echo "   $name=$value   <- sicher notieren (Bootstrap bzw. PC-Agent)"
      fi
    fi
  done
else
  echo "-> GitHub CLI nicht angemeldet. Secrets manuell im Environment 'production' anlegen:"
  for name in SESSION_PEPPER COOKIE_SECRET QR_SECRET IP_HASH_SECRET BUZZER_HMAC_SECRET ENC_KEY BOOTSTRAP_TOKEN; do
    echo "   $name=$(secret)"
  done
fi

cat <<TXT

Noch manuell (siehe README, Abschnitt "Einmalige Einrichtung"):
  1. Cloudflare API-Token erstellen: Rechte "Account / Cloudflare Pages / Edit" und "Account / D1 / Edit",
     nur dieses Konto, mit Ablaufdatum -> GitHub-Secret CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID).
  2. Spotify-App anlegen (Redirect-URI https://$PROJECT.pages.dev/admin/spotify/callback)
     -> Secrets SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET.
  3. Turnstile-Widget (Modus "Invisible") für $PROJECT.pages.dev -> TURNSTILE_SITE_KEY, TURNSTILE_SECRET.
  4. Cloudflare Access für /admin* und /api/admin* (auch *.$PROJECT.pages.dev) -> ACCESS_TEAM_DOMAIN, ACCESS_AUD.
  5. Optional: Analytics-Token (Account Analytics: Read) -> CF_ANALYTICS_TOKEN.
  6. Branch-Protection für main aktivieren (PR + Review + grüne CI).
  7. wrangler.toml committen, nach main mergen -> Deploy läuft automatisch.
TXT
