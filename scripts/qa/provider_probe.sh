#!/usr/bin/env bash
# Key Collective — read-only provider probes for Phase F research (RA-04, RA-07, RA-08, RA-06).
# Reads the first key of GEMINI_API_KEYS / GROQ_API_KEYS from .env itself; keys never appear in
# arguments or output. Output is redacted: keys, project numbers and consumer ids are masked.
# Usage: bash scripts/qa/provider_probe.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

first_key() { # VAR_NAME -> first comma-separated value, quotes/brackets stripped
  grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '"[] ' | cut -d, -f1
}
GK="$(first_key GEMINI_API_KEYS)"
QK="$(first_key GROQ_API_KEYS)"

redact() {
  sed -E \
    -e 's/AIza[0-9A-Za-z_-]{35}/AIza<KEY>/g' \
    -e 's/gsk_[A-Za-z0-9]+/gsk_<KEY>/g' \
    -e 's#projects/[0-9]+#projects/<NUM>#g' \
    -e 's/project=[0-9]+/project=<NUM>/g' \
    -e 's/project [0-9]+/project <NUM>/g' \
    -e 's/"containerInfo": *"[^"]*"/"containerInfo": "<NUM>"/g' \
    -e 's/"consumer": *"[^"]*"/"consumer": "<CONSUMER-PRESENT>"/g'
}

g() { # label url [curl args...]
  local label="$1" url="$2"; shift 2
  echo "=== $label"
  curl -s -m 15 -w '\nHTTP %{http_code}\n' -H "x-goog-api-key: $GK" "$url" "$@" | redact | head -60
}
q() {
  local label="$1" url="$2"; shift 2
  echo "=== $label"
  curl -s -m 20 -w '\nHTTP %{http_code}\n' -H "authorization: Bearer $QK" "$url" "$@" | redact | head -60
}

if [[ -n "$GK" ]]; then
  echo "##### Google: GCP project probe candidates (RA-07)"
  g "unknown model (current probe)" "https://generativelanguage.googleapis.com/v1beta/models/invalid-model"
  g "translation API" "https://translation.googleapis.com/language/translate/v2?q=hi&target=fr"
  g "youtube API" "https://youtube.googleapis.com/youtube/v3/videos?part=id&id=x"
  g "cloudresourcemanager" "https://cloudresourcemanager.googleapis.com/v1/projects"

  echo "##### Google: models this key can list (RA-06)"
  echo "=== ListModels (names only)"
  curl -s -m 15 -H "x-goog-api-key: $GK" "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200" \
    | grep -oE '"name": *"models/[^"]+"' | sed -E 's/.*models\///; s/"$//' | sort | tr '\n' ' '; echo

  echo "##### Google: proof-of-life candidates (RA-08)"
  for m in gemini-3.5-flash-lite gemini-3.8-flash gemini-2.5-flash gemini-2.0-flash; do
    echo "=== generateContent $m"
    curl -s -m 20 -o /dev/null -w 'HTTP %{http_code}\n' -H "x-goog-api-key: $GK" -H 'content-type: application/json' \
      "https://generativelanguage.googleapis.com/v1beta/models/$m:generateContent" \
      -d '{"contents":[{"parts":[{"text":"ping"}]}],"generationConfig":{"maxOutputTokens":1}}'
  done
else
  echo "GEMINI_API_KEYS not set in .env; skipping Google"
fi

if [[ -n "$QK" ]]; then
  echo "##### Groq: models this key can list"
  curl -s -m 15 -H "authorization: Bearer $QK" https://api.groq.com/openai/v1/models \
    | grep -oE '"id": *"[^"]+"' | sed -E 's/.*"id": *"//; s/"$//' | sort | tr '\n' ' '; echo
  for m in openai/gpt-oss-20b llama-3.1-8b-instant; do
    for mt in 1 16; do
      q "chat $m max_tokens=$mt" https://api.groq.com/openai/v1/chat/completions -H 'content-type: application/json' \
        -d "{\"model\":\"$m\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":$mt}"
    done
  done
else
  echo "GROQ_API_KEYS not set in .env; skipping Groq"
fi
