# GCP project probe: recorded provider responses (2026-10-03)

Source: `bash scripts/qa/provider_probe.sh` with the owner's dev keys. The output is redacted: keys, project numbers and `consumer` values are masked.

## Unknown Gemini model (the probe built in WP-3.6): unusable

`GET generativelanguage.googleapis.com/v1beta/models/invalid-model` (key in header or query) returns:
```json
{ "error": { "code": 404, "message": "Model is not found: models/invalid-model for api version v1beta", "status": "NOT_FOUND" } }
```
There is no `details` field and no project. This probe can never produce a project number (RA-07).

## Service blocked by the key's API restrictions: usable

`GET translation.googleapis.com/language/translate/v2?q=hi&target=fr` with `x-goog-api-key` returns HTTP 403:
```json
{ "error": { "code": 403, "status": "PERMISSION_DENIED", "details": [
  { "@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "API_KEY_SERVICE_BLOCKED", "domain": "googleapis.com",
    "metadata": { "consumer": "projects/<NUM>", "apiName": "translate",
                  "methodName": "google.cloud.translate.v2.TranslateService.TranslateText",
                  "service": "translate.googleapis.com" } } ] } }
```

## Service not enabled in the project: usable

`GET youtube.googleapis.com/youtube/v3/videos?part=id&id=x` with `x-goog-api-key` returns HTTP 403:
```json
{ "error": { "code": 403, "status": "PERMISSION_DENIED", "details": [
  { "@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "SERVICE_DISABLED", "domain": "googleapis.com",
    "metadata": { "consumer": "projects/<NUM>", "service": "youtube.googleapis.com", "containerInfo": "<NUM>",
                  "activationUrl": "https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=<NUM>" } },
  { "@type": "type.googleapis.com/google.rpc.Help", "links": [ { "url": "...overview?project=<NUM>" } ] } ] } }
```

## Not usable

`cloudresourcemanager.googleapis.com/v1/projects` returns 401 `CREDENTIALS_MISSING`, because API keys are not accepted. The response has no consumer.

## Probe design (WP-F.4)

1. Call Translation v2 with the key in `x-goog-api-key`.
2. If that gives no `consumer`, for example because the key may call Translation and the API is enabled, call YouTube `videos`.
3. Read `ErrorInfo.metadata.consumer` (`projects/<n>`). Fall back to `containerInfo`, then to the `project=` query parameter in `Help` links or `activationUrl`.
4. A 200 from both means the project cannot be verified, so the result is `unavailable`.

## Invalid key (RA-04)

Gemini answers an invalid key with HTTP **400** `INVALID_ARGUMENT`, `ErrorInfo.reason = "API_KEY_INVALID"`, `metadata.service = "generativelanguage.googleapis.com"`, and no consumer.

## Proof-of-life (RA-08)

| Call | Result |
|---|---|
| Gemini `gemini-3.5-flash-lite:generateContent`, `maxOutputTokens: 1` | 200 |
| Gemini `gemini-3.8-flash` | 200 |
| Gemini `gemini-2.5-flash` | 200 (this is an older account; Google limits 2.5 to past users) |
| Gemini `gemini-2.0-flash` | **404** |
| Groq `openai/gpt-oss-20b`, `max_tokens: 1` | 200 (`finish_reason: length`) |
| Groq `llama-3.1-8b-instant` | **404** `{"code":"model_not_found","type":"invalid_request_error"}` |

## Models visible to the keys (2026-10-03)

- **Gemini text models:** `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`, `gemma-4-26b-a4b-it`, `gemma-4-31b-it`.
  - Aliases: `gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-pro-latest`.
- **Groq chat models:** `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`, `allam-2-7b`.
  - `llama-3.3-70b-versatile` is **not** offered to this key, although Groq's docs page still lists it.

---

## Addendum (2026-10-21): Modern Google AI Studio Scoped Tokens (`AQ...`) & Probe Limitations

### Upstream Token Format Change
In late 2024 / 2025, Google AI Studio began issuing scoped OAuth2 / service tokens formatted as `AQ.[A-Za-z0-9_-]{51}` (54 characters total), in addition to legacy GCP API keys formatted as `AIzaSy...` (39 characters).

### Probe Behavior for `AQ.` Tokens
1. **Translation v2 & YouTube v3 Probes:**
   - When an `AQ.` token is sent in `x-goog-api-key`, Google Cloud API Gateway rejects the token with HTTP 400 `INVALID_ARGUMENT` or HTTP 401 `CREDENTIALS_MISSING`.
   - The response **does not include** `ErrorInfo.metadata.consumer` (`projects/<NUM>`), `containerInfo`, or activation URLs.
   - Probing returns `null` project hash.
2. **Database Invariant Impact:**
   - In D1, `api_keys.provider_project_hash` is `NULL` for `AQ.` keys (identical to Groq, Cerebras, and SambaNova keys).
   - `project_hash_registry` is not populated for `AQ.` keys.
   - Consequently, static pre-registration project collision detection (`409 project_mismatch`) cannot be evaluated at registration or key rotation time for `AQ.` keys.
3. **Architectural Resolution:**
   - Retain existing `project_hash_registry` schema and probe logic for legacy `AIzaSy...` keys.
   - See [ADR-006: Modern Google AI Studio Scoped Tokens (`AQ.`) & Runtime Quota Co-Tripping Detection](file:///home/akshit/Projects/Key%20Collective/docs/adr/006-modern-aq-key-quota-clustering.md) for the runtime telemetric cluster inference roadmap.

