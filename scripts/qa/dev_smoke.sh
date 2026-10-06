#!/usr/bin/env bash
# Key Collective — automated dev smoke checks that need no browser sign-in (Phase F QA pass 2).
# Usage: bash scripts/qa/dev_smoke.sh [api_host] [console_host] [admin_host]
# Optional: KC_PROJECT_KEY=kc_proj_live_... enables the authenticated /v1 checks (chat per model).
set -uo pipefail
API="${1:-https://api-dev.key-col.axe08.tech}"
CONSOLE="${2:-https://console-dev.key-col.axe08.tech}"
ADMIN="${3:-https://admin-dev.key-col.axe08.tech}"
pass=0; fail=0
ok()  { echo "PASS  $1"; pass=$((pass+1)); }
bad() { echo "FAIL  $1  ($2)"; fail=$((fail+1)); }
code() { curl -s -o /dev/null -w '%{http_code}' -m 20 "$@"; }

# 1. Health and catalog
[[ "$(curl -s -m 20 "$API/v1/health")" == '{"status":"ok"}' ]] && ok "api health is {\"status\":\"ok\"}" || bad "api health" "$(curl -s -m 20 "$API/v1/health" | head -c 120)"
models=$(curl -s -m 20 "$API/v1/models")
ids=$(printf '%s' "$models" | grep -oE '"id": *"[^"]+"' | sed -E 's/.*"id": *"//; s/"$//' | sort -u | tr '\n' ' ')
echo "      /v1/models: $ids"
for dead in gemini-2.0-flash gemini-1.5-pro gemini-2.5-flash llama-3.1-8b-instant llama-3.3-70b-versatile qwen/qwen3.6-27b; do
  [[ " $ids " == *" $dead "* ]] && bad "retired model hidden: $dead" "listed"
done
[[ " $ids " == *" gemini-3.5-flash-lite "* && " $ids " == *" openai/gpt-oss-20b "* ]] && ok "new catalog models listed" || bad "new catalog models listed" "missing"
printf '%s' "$models" | grep -qiE 'micro|mtok' && bad "no µ\$ pricing in /v1/models" "found" || ok "no µ\$ pricing in /v1/models"

# 2. OpenAPI
spec=$(curl -s -m 20 "$API/v1/openapi.json")
printf '%s' "$spec" | grep -q 'x-tenant-id' && bad "openapi has no x-tenant-id" "found" || ok "openapi has no x-tenant-id (RA-13)"
printf '%s' "$spec" | grep -q 'keycollective.io' && bad "openapi has no fake contact" "found" || ok "openapi has no fake contact email"

# 3. CORS preflight for the browser Playground (QA-07)
pre=$(curl -s -D - -o /dev/null -m 20 -X OPTIONS "$API/v1/chat/completions" \
  -H "Origin: $CONSOLE" -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type,x-pool-fallback" | tr -d '\r')
printf '%s' "$pre" | grep -qi '^access-control-allow-headers:.*x-pool-fallback' && ok "CORS allows x-pool-fallback (QA-07)" || bad "CORS allows x-pool-fallback" "missing"
printf '%s' "$pre" | grep -qi '^access-control-allow-headers:.*x-tenant-id' && bad "CORS drops x-tenant-id" "still allowed" || ok "CORS no longer allows x-tenant-id"
post=$(curl -s -D - -o /dev/null -m 20 -X POST "$API/v1/chat/completions" -H "Origin: $CONSOLE" -H 'content-type: application/json' -d '{}' | tr -d '\r')
printf '%s' "$post" | grep -qi '^access-control-expose-headers:.*x-kc-cu' && ok "CORS exposes x-kc-* headers (QA-07)" || bad "CORS exposes x-kc-* headers" "missing"

# 4. Auth gates
[[ "$(code -X POST "$API/v1/chat/completions" -H 'content-type: application/json' -d '{"model":"auto","messages":[{"role":"user","content":"hi"}]}')" == 401 ]] && ok "/v1 without a key is 401" || bad "/v1 without a key is 401" "other"
[[ "$(code "$CONSOLE/api/pool/standing")" == 401 ]] && ok "standing signed-out is 401 (RA-12)" || bad "standing signed-out is 401" "$(code "$CONSOLE/api/pool/standing")"
[[ "$(code "$CONSOLE/api/tokens")" == 401 ]] && ok "tokens signed-out is 401" || bad "tokens signed-out is 401" "$(code "$CONSOLE/api/tokens")"

# 5. Admin host (QA-15): SPA served, API gated
[[ "$(code "$ADMIN/")" == 200 ]] && ok "admin host serves the SPA" || bad "admin host serves the SPA" "$(code "$ADMIN/")"
[[ "$(code "$ADMIN/api/admin/tenants")" == 404 ]] && ok "admin API is 404 without an admin session" || bad "admin API gated" "$(code "$ADMIN/api/admin/tenants")"
[[ "$(code -H 'Authorization: Bearer not-a-real-token' "$ADMIN/api/admin/tenants")" == 404 ]] && ok "admin API rejects a fake bearer" || bad "admin API rejects a fake bearer" "other"

# 6. Public report (QA-16): bad Turnstile gives a real error, not csrf_required
rep=$(curl -s -m 20 -X POST "$CONSOLE/api/abuse/report-key" -H 'content-type: application/json' -H 'cookie: kc_session=bogus' \
  -d '{"key":"AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","turnstile_token":"invalid"}')
printf '%s' "$rep" | grep -q 'csrf_required' && bad "report skips CSRF (QA-16)" "csrf_required" || ok "report does not demand CSRF (QA-16)"
printf '%s' "$rep" | grep -q 'turnstile_failed' && ok "report shows turnstile_failed for a bad token" || echo "INFO  report body: $(printf '%s' "$rep" | head -c 160)"

# 7. Authenticated /v1 checks (optional)
if [[ -n "${KC_PROJECT_KEY:-}" ]]; then
  for m in $ids; do
    r=$(curl -s -D /tmp/kc_h -o /tmp/kc_b -w '%{http_code}' -m 60 -X POST "$API/v1/chat/completions" \
      -H "authorization: Bearer $KC_PROJECT_KEY" -H 'content-type: application/json' \
      -d "{\"model\":\"$m\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with OK\"}],\"max_tokens\":16}")
    used=$(grep -i '^x-kc-model-used:' /tmp/kc_h | tr -d '\r' | cut -d' ' -f2)
    cu=$(grep -i '^x-kc-cu:' /tmp/kc_h | tr -d '\r' | cut -d' ' -f2)
    if [[ "$r" == 200 ]]; then ok "chat $m → 200 (used $used, cu $cu)"; else bad "chat $m" "HTTP $r $(head -c 160 /tmp/kc_b)"; fi
  done
  rm -f /tmp/kc_h /tmp/kc_b
else
  echo "SKIP  per-model chat checks (set KC_PROJECT_KEY=kc_proj_live_... to enable)"
fi

echo "---- $pass passed, $fail failed"
[[ $fail -eq 0 ]]
