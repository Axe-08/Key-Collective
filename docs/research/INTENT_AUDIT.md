# Key Collective — Intent vs. Implementation Audit

As of 2026-09-30 · commit `ba9151d` + uncommitted working tree on `master` · baseline: `docs/PRD.md` v4.0

## Executive summary

**Verdict: Key Collective works today as a private multi-key LLM proxy, not as the reciprocal commons the PRD describes, and its dashboard API can be driven as any user, including admin, without credentials.** The routing core (cascade, fallback, SSE, HKDF encryption) is sound. Almost everything that makes the product a commons is either unwired, blocked by schema drift, or displayed from hard-coded defaults. The PRD marks all 19 v4.0 capabilities "Implemented": 2 work as specified, 5 are partial and 12 are broken or absent.

| Area | Critical | High | Medium | Low |
| --- | --- | --- | --- | --- |
| Security and auth | 6 | 7 | 0 | 0 |
| Core economics | 3 | 10 | 4 | 0 |
| Data layer | 2 | 8 | 4 | 1 |
| Frontend flows | 3 | 5 | 2 | 0 |
| Routing and proxy | 1 | 6 | 6 | 1 |
| **Total** | **15** | **36** | **16** | **2** |

Counts are rated findings per section; a few issues appear in two sections (S6 and R2 are the same leak). A further 11 cases of invented UI data and 10 success-returning stubs are listed without severity.

**Top 10 to fix, in order**

1. **S1** Any unauthenticated request with `x-tenant-id: admin` gets admin on `/api/*`, including `PURGE_ALL_KEYS`. The frontend relies on this header by design (F1).
2. **S2** `POST /api/auth/sync-session` mints a bearer token for any `id` in the body, including `admin`.
3. **S4** Anyone can list community key ids anonymously and revoke them through the takedown endpoint.
4. **S3, S5** A user id works as an admin token; Turnstile accepts hard-coded test fixtures in production.
5. **F2, D1, D2** Contributing a key cannot succeed: no Turnstile widget exists, and the consent and project-hash INSERTs do not match the schema (verified against SQLite).
6. **FR-07** Nothing promotes keys out of the 24h observation state, so only admin-promoted keys ever reach the communal pool.
7. **FR-03, FR-17** Debt never accrues and the multiplier is never applied to limits; standing screens show hard-coded 1.5x / 4.5x / PRISTINE.
8. **FR-20** The surge brake has no minimum pool size, so a lone active tenant is braked after one request.
9. **R2** Up to 500 chars of raw provider error text reach clients in `details.attemptedRoutes`.
10. **Tests** 1,268 tests pass against D1 mocks that accept any SQL; 386 of them are outside the gate, and 9 of 15 acceptance criteria have no test.

The current uncommitted diff is type-only: it adds pool fields (`poolType`, `dispatchedToday`, `vestingTier`, …) to five interfaces, three of which are in unreachable modules. It changes no runtime behaviour and does not address any finding above.

## Method and intent baseline

The baseline is `docs/PRD.md` (v4.0): 26 functional requirements (FR-01 to FR-26), 20 infrastructure requirements (IR-01 to IR-20), 7 NFRs and 15 acceptance criteria (AC-01 to AC-15). `CONTEXT.md`, `GEMINI.md` and `README.md` add the invariants. The PRD's own table in section 1.2 marks every v4.0 capability as "Implemented"; this audit tests that claim against the code.

Each finding was verified by reading the code path end to end, not by trusting file names or comments. Code as of commit `ba9151d` plus the uncommitted working tree on `master`.

**Severity scale**

| Severity | Meaning |
| --- | --- |
| Critical | Breaks a core promise in production, loses data, or is exploitable |
| High | A PRD requirement is missing or inert; users see wrong behaviour |
| Medium | Partial implementation, drift, or misleading data shown to users |
| Low | Dead code, hygiene, doc drift |

**What the product is meant to do, in one paragraph.** Developers donate zero-billing free-tier keys. Their own traffic always goes to their own keys first (FR-02). Only when those are exhausted do they draw on other people's COMMUNITY keys, via a global PoolCoordinatorDO that picks the key (section 9.3). Every communal request adds debt to the borrower and credits the lender (FR-03). Debt against contribution drives a multiplier from 1.0x to 5.0x, with soft warning, quota jail, 20%/day decay and a trusted tier (FR-17, FR-21, FR-26). New keys sit out 24h before serving others (FR-07). GCP project hashes stop one project being donated twice (FR-06, FR-08). Abuse, errors and headers are shielded (FR-10, FR-11).

## Core economics: the commons does not function

The reciprocal-commons economy (debt, multiplier, jail, vesting, hero/parasite, observation) is modelled in types and DO state, but no request ever moves it. Of the 16 economic FRs in the table below, 1 works as specified (FR-22), 5 are partial and 10 are absent or inert.

| FR | Intent | What the code does | Status | Evidence |
| --- | --- | --- | --- | --- |
| FR-07 | New COMMUNITY keys join the pool after 24h | Keys are written as `OBSERVATION` with `observation_until`, but nothing ever promotes them. There are no cron triggers in `wrangler.jsonc` and no alarm that reads `observation_until`. Only the admin `PROMOTE` action sets `ACTIVE`. The communal pool contains only admin-promoted keys. | Critical | `post_key.ts:103`, `admin_handler.ts:136,213` |
| FR-03 | Debt accrues on every communal request; lender is credited | `TenantQuotaDO.accrueDebt` / `decrementDebt` exist but have zero callers and no HTTP route. Debt only changes via admin reset. | Critical | `tenant_do.ts:189-203` |
| FR-03 / Flow F | Jailed tenant gets HTTP 429 `quota_jail` | `evaluateQuota` never reads `multiplierCeiling` or debt; it passes them through as response fields only. No `quota_jail` error exists. | High | `quota/tenant/evaluator.ts` |
| FR-17 / FR-26 | Multiplier (1.5x to 5.0x) scales the tenant's quota; vesting ramp by key age; utilisation bands | The multiplier is never applied to any limit. Limits come from `getTierLimits(tier)` alone. No vesting ramp or U_pool band code exists (`vesting_tier` column is never written). | High | `evaluator.ts:66-70` |
| FR-21 | Nightly 20% decay, 30% for trusted; trusted after 7 debt-free days | `processDailyDebtReset` sets `trustedContributor = false` before choosing the rate, so the 30% branch is unreachable. Decay uses float math (`Number(debt) * 0.2`), violating the microdollar invariant. Threshold is `> 30` days, not 7 (CONTEXT.md says 30, PRD says 7). | High | `debt.ts:44-56` |
| FR-21 | Debt decays; contribution resets | Nightly reset zeroes `dailyContributedCu` then recomputes the ceiling with contribution = 0. Any residual debt gives ratio 1000 → ceiling 1.0x. Every tenant with debt would be jailed at midnight. Latent today only because debt never accrues. | High | `debt.ts:59-60`, `debt.ts:17-19` |
| FR-03 (display) | Standing shown from `contributor_standing` | No code ever inserts into `contributor_standing`; DO state is never mirrored to D1. `/api/pool/standing` therefore always returns the hard-coded fallback: multiplier 1.5, ceiling 4.5, PRISTINE. | High | `pool_routes.ts:222-231` |
| FR-02 | Own key first; commons only when own keys exhausted | Works by priority (+10000 for own keys) inside `KeyPoolDO`. But `selfKeyRouted` is always false because `ChatHandler` never sets `tenantId` on the cascade request, so every dispatch is counted as communal. | Medium | `fallback.ts:71`, `chat/handler.ts:92-114` |
| Section 9.3 | Coordinator picks community keys (`getNextCommunityKey`) | Not implemented. Each tenant DO copies every ACTIVE community key from D1 into its own storage, once. The snapshot never refreshes while storage is non-empty, so revocations, pool-mode changes and new keys never propagate. | High | `key_pool_do.ts:198-260` |
| FR-04 | Shared key limits are global | Circuit breaker and RPM state for a shared key live in each consumer's DO. N tenants can each use a 15 RPM key at 15 RPM. | High | `key_pool_do.ts:88-105` |
| FR-16 | Hero/parasite on 429; parasite CU suspended | `recordDispatch` exists on `KeyPoolDO` but not on `DurableObjectKeyPoolClient`, which production uses, so no dispatch is ever recorded. The midnight alarm only emits telemetry; no CU suspension. `api_keys.dispatched_today/communal` are never written. | High | `do_client.ts`, `fallback.ts:154` |
| FR-20 | Brake at >35% of pool traffic | Implemented, but with no minimum pool size. A lone active tenant is 100% of the pool and is braked after its first request. It also brakes own-key traffic. Volumes are in memory only, so eviction resets them. | Critical | `coordinator_do.ts:108` |
| FR-19 | Draw only from providers you contributed to | Computed as a display flag (`eye_for_eye_accessible`) only; routing ignores it. | High | `pool_routes.ts:173` |
| FR-12 | 40% cold-start share cap | Absent. | High | none |
| FR-18 | 60-min anti-cycling tier | Absent. | Medium | none |
| FR-05 / FR-23 | Midnight jitter and leaky-bucket queue | Absent. `MIDNIGHT_FREEZE` is an unrelated env kill-switch that returns 503. | Medium | `dispatcher.ts:89` |
| FR-13 | Passive canary probe at 00:00 | Alarm classifies and resets counters; no probe is ever fired. | Medium | `key_pool_do.ts:390-415` |
| FR-22 | Pool toggle frozen 23:30-00:30 UTC | Implemented correctly (returns 423). The only fully working economic FR. | OK | `ops.ts:66-76` |

**Net effect.** Today a contributor gets nothing for contributing: no multiplier, no burst, no standing. A borrower pays nothing for borrowing. The pool itself only contains keys an admin has manually promoted.

**Other economic drift**

- `wProvider = activeRatio × 1000 / latencyMs`, so a healthy provider at the 120 ms default shows 8.33, not the PRD's 1.00x "Optimal" scale (`coordinator_do.ts:124`).
- `pool_utilization_percent` is computed as communal ÷ total dispatches. That is a communal-share ratio, not utilisation of capacity. Both inputs are always 0, so the UI shows 0% (`pool_routes.ts:46`).
- A key's communal priority is fixed when the DO first loads, so debt and hero/parasite boosts never update (`key_pool_do.ts:225-240`).

## Routing and proxy hot path

The request path works end to end for Gemini and Groq, but per-key accounting is mis-keyed, provider errors leak to clients, and two of the four promised providers cannot be called.

| # | Finding | Severity | Evidence |
| --- | --- | --- | --- |
| R1 | **Model id used as key id.** Both response handlers call `keyPool.recordUsage(cascadeRes.modelDef.id, …)` and write `key_id = modelDef.id` to `cost_ledger`. The DO throws `KeyNotFound` (swallowed), so streaming requests never increment the per-key RPM limiter. Every ledger row has a model name in `key_id`, so per-key analytics are impossible. | High | `chat/stream.ts:64,74`, `chat/non_streaming.ts:31,40` |
| R2 | **Upstream error text reaches clients (FR-10, NFR-04).** `mapUpstreamHttpError` embeds 500 chars of the provider body in the message. `FallbackExhaustedError.details.attemptedRoutes[].error` carries it out. `formatRouterError` sanitises only `body.error`, and `sanitizeErrorMessage` does not include the GCP project or billing patterns. | Critical | `proxy/upstream/errors.ts:49`, `worker/router/errors.ts:66`, `error_normalizer.ts:30` |
| R3 | **The header/body normaliser is dead code.** `normalizeUpstreamResponse` is only reached from `UpstreamClient.toClientResponse`, which has no callers. The chat path builds its own headers, so headers are safe by accident, but the PRD-mandated `x-kc-request-id` and `x-kc-model-used` are never sent (code sends `x-kc-model`, `x-kc-trace-id`). | Medium | `client.ts:619` |
| R4 | `SECRET_REGEX` only matches `sk-…` and `Bearer …`; it misses `AIza…` (Gemini) and `gsk_…` (Groq), the two key formats actually in use. | High | `error_normalizer.ts:17` |
| R5 | **Cerebras and SambaNova are unroutable.** No base URL, no catalog models. The fallback URL builder would guess `https://api.cerebras.com/v1` (wrong domain). Key submission still accepts both providers. | High | `proxy/upstream/types.ts:46-56`, `catalog.ts` |
| R6 | **Catalog is hard-coded and off-intent.** 18 models, including OpenAI, Anthropic and DeepSeek, which the product has no free-tier keys for; they are tried and fail at key acquisition on every `auto` request. The README's aliases `auto`, `coder-high`, `open-groq`, `cerebras-speed` do not exist in the registry. Several ids (`gemini-3.8-flash`, `qwen/qwen3.8-27b`) should be checked against provider model lists. | Medium | `router/registry/catalog.ts` |
| R7 | **Free-tier traffic is priced at paid rates.** Every request is costed with list prices, so dashboards show "spend" that nobody pays. The PRD intends CU accounting for the commons. | Medium | `catalog.ts:18-281` |
| R8 | **Tool calls are dropped on non-streaming responses.** `extractContentFromPayload` returns text only; the response always has `finish_reason: "stop"` and no `tool_calls`. Tools are advertised as a capability. | High | `upstream/payload.ts`, `non_streaming.ts:108-119` |
| R9 | **No key quarantine on 401/429 (Flow G).** Upstream 429/401 only call `recordResult(false)`. `recordStatusCode` has no callers. Keys are never marked QUARANTINED or `invalid`, so the notifications endpoint never fires. | High | `fallback.ts:190`, `client.ts:330` |
| R10 | `/v1beta/models/:model:generateContent` and `:streamGenerateContent` (PRD 10.1) are not routed. | Medium | `core/dispatcher.ts` |
| R11 | Coordinator volume for streaming requests uses the prompt-token estimate, because usage is only known after the stream ends. The brake measures prompt size, not traffic. | Low | `chat/handler.ts:176` |
| R12 | **Key decryption falls back to the key id.** If all four decryption attempts fail, `resolvePlaintextKey` returns `key_…` and it is sent upstream as the credential. Any string over 30 chars without spaces is also treated as a raw key. | Medium | `core/key_resolver.ts:50-57,168` |
| R13 | Rate-limiter and circuit-breaker state for a communal key is per consumer DO (see Economics). | High | `key_pool_do.ts` |
| R14 | `FR-24` passthrough: only fields named in the request object are forwarded; `safetySettings`, `generationConfig`, `extra_body` and `extra_headers` are dropped because `ChatHandler` builds the cascade request field by field. | Medium | `chat/handler.ts:92-114` |

**Working as intended:** capability filtering, context-window rejection (400), cheapest-first candidate ordering, fallback escalation with abort handling, `waitUntil` for ledger and telemetry writes, SSE passthrough without buffering.

## Security, auth and compliance

The whole `/api/*` surface can be driven as any tenant, including `admin`, without credentials. Fix S1 to S4 before anything else in this report; the production domains listed in the README are live.

### Critical

| # | Finding | Evidence |
| --- | --- | --- |
| S1 | **Header-only impersonation.** `DashboardHandler.handle` sets `tenantId` from the `x-tenant-id` header when the request has no token (or, for GET, an invalid token). A request with no credentials and `x-tenant-id: admin` passes the `/api/admin/*` gate and every `tenantId === "admin"` branch: delete any key, rotate any key, `POST /api/admin/pool/manage` with `PURGE_ALL_KEYS`. Any other value impersonates that user. Reachable on `api.*` and `console.*`. | `dashboard/handler.ts:109-111, 131-133, 292` |
| S2 | **Unauthenticated token minting.** `POST /api/auth/sync-session` issues a valid bearer token for whatever `id` the body names. `id: "admin"` yields a token whose `auth_tokens.tenant_id` is `admin`, which `verifyAdminRequest` accepts as an administrator. The tier guard only checks the `tier` field, not the `id`. | `dashboard/auth_routes.ts:170-230`, `admin_verifier.ts:108` |
| S3 | **User id accepted as an admin password.** `verifyAdminRequest` looks up the raw bearer string as a `users.id`. If an admin's user id (e.g. a GitHub numeric id with a prefix) is known, presenting it as the token grants admin. | `admin_verifier.ts:141-170` |
| S4 | **Anyone can revoke any community key.** `/api/abuse/report-key` revokes by `keyId` with no proof of possession, and anonymous `GET /api/keys` lists every COMMUNITY key's id, label and 8+4-char prefix/suffix. It also revokes every key whose 8-char `key_prefix` equals the submitted string's, so one report can take out unrelated keys sharing a prefix (about 4,096 prefix buckets for Gemini). Verified against the migrated schema in SQLite. The listing itself breaks the PRD information boundary (other contributors' labels, and more than 6+4 chars). | `abuse_routes.ts:69-81` |
| S5 | **Turnstile bypass in production.** `verifyTurnstileToken` accepts the literal fixtures `valid_turnstile_response` and Cloudflare's public dummy token before it looks at the secret. The abuse route skips Turnstile entirely when both token and secret are absent. | `sybil/turnstile.ts:28-38`, `abuse_routes.ts:40` |
| S6 | Upstream error bodies (possibly GCP project numbers) leak through `details.attemptedRoutes` (see R2). | `worker/router/errors.ts:66` |

### High

| # | Finding | Evidence |
| --- | --- | --- |
| S7 | **Ownership takeover of `default` keys.** `PATCH /api/keys/:id/pool-mode` updates `WHERE tenant_id = ? OR tenant_id = 'default'` and sets `tenant_id` to the caller. Admin-added keys land in `default` when no header is sent, so any user can claim them. Rotate has the same `OR 'default'` clause. | `keys/ops.ts:104, 232, 255` |
| S8 | **OAuth callback skips everything the PRD requires.** No PKCE or `state` check, no anti-Sybil (score hard-coded `95`), tier hard-coded `max`, client id hard-coded. Token is posted with `postMessage(…, "*")` and falls back to `/?token=` in the URL. The real PKCE client in `src/auth/oauth/` and the 5-layer engine in `src/auth/sybil/` are never imported by the worker. | `auth_routes.ts:52-150` |
| S9 | **Tenant-id prefix mismatch.** GitHub OAuth creates `gh_<id>` tenants, but COMMUNITY contribution requires `usr_gh_`. Users who sign in via the Worker's own GitHub callback cannot contribute to the pool. | `auth_routes.ts:83`, `post_key.ts:62` |
| S10 | `KC_MASTER_KEY` doubles as an admin bearer in the dashboard and middleware, compared with `===`. `admin_verifier.ts` explicitly says admin auth must be separate from the master key. | `dashboard/handler.ts:97`, `auth/middleware.ts:205` |
| S11 | **Demo mode consumes contributor keys (FR-25).** Demo tokens map to tenant `demo`, whose KeyPoolDO loads every ACTIVE community key. The PRD says no contributor keys are involved. | `auth/middleware.ts:251` |
| S12 | Admin tokens accepted from `?token=` query strings, which end up in logs and history. | `admin_verifier.ts:30-38`, `dashboard/handler.ts:77-85` |
| S13 | `INSERT OR REPLACE INTO users` on quarantine wipes email, tier and role for existing users when the UPDATE path misses. | `admin_handler.ts:687` |

### Compliance intent

| Requirement | State |
| --- | --- |
| C1-C3 registration consent (FR-15, AC-15) | Never recorded server-side. No endpoint accepts or stores them; no 422 on missing consent. |
| K1/K2 key consent (IR-18) | Checked, but the INSERT targets columns that do not exist (see Data layer), so the whole submission fails. IP and user agent never captured. |
| Takedown rate limit 5/IP/hr (FR-11) | Absent. Migration 0008 dropped the table "in favour of DO memory"; no DO implements it. |
| Takedown tombstones the project | Uses the SHA-256 of the key where the project hash is expected, so it never matches. |
| Proof-of-life probe (Flow B phase 2) | Absent. |
| GCP probe (FR-06) | Only acts on HTTP 400. Needs a live check: if Google answers `models/invalid-model` with 404, the probe returns null and the whole Sybil guard is a no-op. |
| HKDF (FR-09) | Correct construction: salt = tenantId, info = `aes-256-gcm-key`. But the resolver's 4-way fallback tries the caller's and `default` subkeys too, which weakens the isolation guarantee AC-07 tests. |
| Secret rotation runbook (NFR-06) | `docs/ops/secret-rotation.md` does not exist. |

## Data layer: schema drift breaks key submission

Code and migrations disagree on at least five tables. The worst case makes `POST /api/keys` fail for every Gemini key and leave half-written rows for every other key. Unit tests do not catch it because they run against mocked D1.

| # | Finding | Impact | Severity | Evidence |
| --- | --- | --- | --- | --- |
| D1 | `consent_attestations` INSERT uses `key_id, consent_type, consent_version, created_at`. Migration 0007 has `event_type, checkbox_id, attested_at, ip_address, user_agent`. | The INSERT throws after the `api_keys` row is written, so the user gets a 500, the key exists in D1 but was never pushed to their DO, and no consent is recorded. | Critical | `post_key.ts:129-130` vs `0007` |
| D2 | `project_hash_registry` INSERT omits `provider`, which is `NOT NULL`. | Whenever the GCP probe returns a project, the INSERT throws and Gemini key submission fails with 500. | Critical | `post_key.ts:83` vs `0006` |
| D3 | `v4_types.ts` `ConsentAttestationSchema` (`consent_type`, `consent_version`, numeric `attested_at`) matches neither the PRD SQL nor the migration. | Three different shapes for one table. | Medium | `contracts/v4_types.ts:6` |
| D4 | `admin_audit_logs` is written in 3 places but no migration creates it. | Admin actions are not audited (errors swallowed). | High | `admin_handler.ts:93, 256, 297` |
| D5 | Takedown updates `api_keys.key_hash`, which does not exist. | Hash-based revocation is a no-op; only the dangerous prefix match (S4) works. | High | `abuse_routes.ts:86` |
| D6 | Migration 0002 creates a stub `keys` table (`id, tenant_id, project_id`) instead of adding `project_id` to `api_keys`. Nothing writes to `keys`. | Keys cannot be attached to projects. The Workbench's "project-level isolation" is cosmetic. | High | `0002`, `project_routes.ts:252` |
| D7 | Project scoping reads a client-supplied `x-project-id` header; tokens have no `project_id` column. | A caller escapes a project sub-cap by omitting or changing the header. | High | `auth/middleware.ts:374` |
| D8 | `contributor_standing` is never inserted or synced from TenantQuotaDO. | Every standing/contribution API returns defaults (see Economics). | High | `pool_routes.ts` |
| D9 | `api_keys.dispatched_today`, `dispatched_communal`, `vesting_tier`, `provider_project_hash`, `hkdf_migrated` are never written by the worker. | Pool telemetry, U_pool and contribution stats are permanently 0. | High | grep: no writers |
| D10 | `0010_purge_all_keys.sql` is a normal migration containing `DELETE FROM api_keys`. | Applying migrations to any fresh or staging database deletes all keys; a QA utility sits in the production chain. | High | `migrations/0010` |
| D11 | Mixed timestamp types in `TIMESTAMP` columns: `observation_until` and `project_hash_registry.created_at` get epoch ms, `projects.created_at` epoch seconds, others ISO strings or `CURRENT_TIMESTAMP`. | SQL date comparisons silently misbehave across these columns. | Medium | `post_key.ts:83,103`, `project_routes.ts:178` |
| D12 | Notifications select keys by `created_at > since`, not by status-change time; no status-change timestamp exists. | A key that goes bad days after creation never notifies. Combined with R9 (no quarantine writes), the feed is always empty. | High | `pool_routes.ts:305-312` |
| D13 | `api_keys.status` values drift: `'Healthy'`, `'healthy'`, `'invalid'`, `'quarantined'`, `'exhausted'`. KeyPoolDO loads only `status = 'Healthy'`. | Case differences can drop keys from routing or double count. | Medium | `post_key.ts`, `admin_handler.ts:141`, `key_pool_do.ts:207` |
| D14 | `seed.sql` seeds `default`-tenant tokens and keys; with S7, anything in `default` is claimable. | Seed data is an attack surface if applied to production. | Medium | `scripts/seed.sql` |
| D15 | Two copies of `0001_initial_schema.sql` (identical today) in `migrations/` and `src/storage/migrations/`. | Drift risk; only one is applied by Wrangler. | Low | both paths |

**Fixed-point invariant violations.** `debt.ts:52` (`Number(debt) * 0.2`), `pool_routes.ts:227` (`debt / contributed` float ratio), `coordinator_do.ts:124` (`wProvider` float), and `auth_tokens/repository.ts:379,409` (`Number(bigint)` before binding) all break the "no IEEE 754 in financial math" rule. The last one silently loses precision above 2^53 µ$.

## Frontend: well built, but the primary flow cannot succeed

The Svelte 5 console (about 14.7k lines) has polished components and almost no `Math.random`. But its identity model is the root cause of S1, the "add a key" flow is blocked by a Turnstile widget that does not exist, and many panels show invented numbers when real ones are missing.

### Broken flows

| # | Finding | Severity | Evidence |
| --- | --- | --- | --- |
| F1 | **Identity lives in `localStorage` and a header.** `api.ts` sends `x-tenant-id` from `localStorage.kc_user`. The comment says it plainly: "All simulated logins share one bearer token; this header is the actual discriminator." This is the client half of S1: edit `kc_user.id` and you are someone else. | Critical | `ui/src/lib/api.ts:38-44` |
| F2 | **Add Key always fails in production.** No Turnstile widget is rendered anywhere (no `challenges.cloudflare.com` script, no sitekey). The modal waits for a `postMessage` that never comes and sends `turnstile_token: ""` in the body; the server only reads the `x-turnstile-token` header, gets an empty string and returns 403. Even past that, D1/D2 break the insert. | Critical | `AddKeyModal.svelte:51-154`, `post_key.ts:34` |
| F3 | **Firebase Google login is trusted blindly.** The client signs in with Firebase, then posts its own `id` to `/api/auth/sync-session`. The Firebase ID token is never sent or verified server-side (this is how S2 is reached). | Critical | `OAuthModal.svelte:255`, `api.ts:274` |
| F4 | GitHub PKCE flow is theatre: verifier and state are generated and stored, but the server callback never checks them. The progress text shows "Verifying Cloudflare Turnstile bot proof…" for 0 ms, with no Turnstile involved. The callback then drops the token into `/?token=` and `api.ts` persists any `?token=` or `?admin_token=` from the URL. | High | `OAuthModal.svelte:78-99`, `api.ts:25-31` |
| F5 | `deleteKey` returns `true` even when the request fails, so the key disappears from the table but still exists. | High | `api.ts:83-98` |
| F6 | DebtLedgerWidget "Resolve" calls `/api/debts/:id/resolve`, which does not exist. On network error it removes the debt locally and reports success. "Resolving" debt also contradicts the PRD, where debt only decays or is paid by serving others. | High | `DebtLedgerWidget.svelte:137-158` |
| F7 | Workbench token rotate calls `/api/tokens/:id/rotate`, which has no server route. Project archive and RPM sub-cap edits are sent without auth headers and are never persisted (the server only updates name and description; the table has no such columns). The UI updates optimistically and swallows errors. | High | `Workbench.svelte:476, 945-967`, `project_routes.ts:337` |
| F8 | Admin circuit override and global kill switch have no effect on the backend (stub handlers, see Stubs). The UI shows them as active. | High | `AdminView.svelte:312, 348` |
| F9 | Playground reads `x-request-cost-micros`; the server sends `x-kc-cost-microdollars`. Live cost always shows 0. It also sends `x-tenant-id`, which triggers a 403 tenant-isolation error whenever the stored user id differs from the token's tenant (e.g. Firebase id vs `gh_` id). | Medium | `Playground.svelte:204, 226` |
| F10 | API Docs document `/v1/projects`, `/v1/projects/:id/keys` and `/v1/telemetry`, none of which are routed. The pricing table lists Cerebras, SambaNova and DeepSeek models the backend cannot call, with prices kept separately from the backend catalog. | Medium | `api_docs/generators.ts:117-213`, `api_docs/PricingTable.svelte` |

### Hard-coded or invented data shown as real

| Where | What the user sees | Evidence |
| --- | --- | --- |
| Sybil matrix | "PASS – Active: 420 days", "84 public commits", Turnstile always PASS, for every Builder+ user. Thresholds (>90 days, >15 commits) differ from the PRD (30 days, 5 contributions). | `oauth/SybilMatrixSection.svelte:44, 64` |
| Admin audit log | Entries built client-side with invented `syncDurationMs` (2.5, 3.1, 2.1, 1.8), added whether or not the API call succeeded. Default props include fake "Initial Edge Cluster Bootstrapping (SIN-01)" entries. | `AdminView.svelte:147-200`, `CircuitBreakerControls.svelte:59-78` |
| Admin "Reset quota" | Actually sets the tenant's tier to `builder`, a demotion for Max users. | `AdminView.svelte:191` |
| Circuit panel defaults | Latencies 242/118/82/380 ms and a DeepSeek failure count of 1. | `CircuitBreakerControls.svelte:28-57` |
| Request log | Missing model shows `gemini-1.5-pro`; missing tokens show `410` and `89`. Server-side, `bytes_in` is `prompt_tokens × 4`, and the UI labels it as tokens. | `TelemetryLogs.svelte:125,150`, `metrics_routes.ts:19` |
| Nav bar | Trust score falls back to `92/100`, tier to `builder`, name to `collective-dev`. | `TopNavBar.svelte:74, 220-256` |
| Standing | Backend fallback plus client fallback both default to 1.5x / 4.5x / PRISTINE (see D8), so every user appears to be a healthy contributor. | `DebtLedgerWidget.svelte:103-110` |
| Demo card | "15 RPM" and "15-Min sandbox"; actual demo limits are 3 RPM / 25 RPD. | `oauth/EphemeralSandboxCard.svelte:23,42` |
| Key table | RPD limit falls back to 10,000, RPM to 60. | `KeysTable.svelte:182-185` |
| Spend ring | Daily budget fixed at $1.00 for everyone. | `MetricCards.svelte:94` |
| Workbench | Project `assignedRpm` is invented as `min(subCap ≈ 20, keys × 5)`. The clock falls back to `UTC 2024-11-14 08:34:11`. | `Workbench.svelte:225, 916` |
| Proxy endpoint | Hard-coded to the apex domain, not `api.*` as the PRD specifies. | `App.svelte:69` |

### Information architecture vs PRD section 4

| PRD | Built |
| --- | --- |
| Tabs: Dashboard, Keys, Pool, Analytics | Tabs: Pool, Workbench, Docs, Playground, Admin, Commons |
| Keys sub-tabs: My Keys / Private Pool / Observation, with key detail (vesting tier, 24h dispatch, communal share) | Single keys table; no observation countdown, vesting or dispatch detail |
| Analytics: usage by day/model, cost ledger, multiplier history | Absent |
| Standing card with trusted streak and jail states | DebtLedgerWidget, fed by defaults |
| Public `/report` page | Modal inside the console (acceptable), but no Turnstile |
| Rotate modal with 30-min same-project window | Rotate replaces the secret in place; no grace window |
| Notification toasts every 30 s | Polling exists; the backend feed is always empty (D12) |

## Stubs, silent failures and dead code

There are no `TODO` or `FIXME` markers left in the code; the unfinished work is hidden behind endpoints that return success without acting, and behind 95 empty `catch` blocks (of 191 total in `src/`).

### Endpoints that report success but do nothing

| Endpoint / function | What it claims | What it does | Evidence |
| --- | --- | --- | --- |
| `POST /api/admin/circuit-breaker` | Trip or reset a provider's circuit platform-wide | Tries to insert an audit row into a missing table, swallows the error, returns `success: true`. No circuit is touched. | `admin_handler.ts:239-279` |
| `POST /api/admin/kill-switch` | Global 503 kill switch | Same pattern; nothing reads the flag. The only real kill switch is the `MIDNIGHT_FREEZE` env var. | `admin_handler.ts:281-318` |
| `POST /api/keys/:id/test` (Cerebras, SambaNova, others) | Live connectivity probe | Returns `success: true`, "key syntax verified", without any network call. | `keys/ops.ts:192-196` |
| `POST /api/abuse/report-key` | Revoke a leaked key by hash | Hash and project-hash UPDATEs target a missing column / wrong value; errors swallowed. | `abuse_routes.ts:83-106` |
| `POST /api/keys` | Store key + consent + push to DO | DO push is wrapped in `catch {}`, so a failed sync leaves D1 and the DO out of step silently. | `post_key.ts:132-158` |
| `KeyPoolDO.alarm()` | Canary probe, hero/parasite with CU suspension | Emits a telemetry event and clears counters. | `key_pool_do.ts:390-415` |
| `TenantQuotaDO.accrueDebt / decrementDebt` | Debt engine | Unreachable. | `tenant_do.ts:189-203` |
| `UpstreamClient.toClientResponse` | FR-10 normaliser | Unreachable. | `client.ts:619` |
| `KeyPoolDO.recordDispatch` | FR-16 counters | Unreachable in production (not on the RPC client). | `do_client.ts` |
| Coordinator `update-provider` | Live provider health | Only called as a side effect of someone opening the Pool telemetry page. With no page views, `wProvider` never updates. | `pool_routes.ts:105-127` |

### Code unreachable from the Worker entry point

A reachability pass from `src/index.ts` finds **39 of 197 non-test files (4,085 lines) unreachable**. Most notable:

| Module | Lines | Why it matters |
| --- | --- | --- |
| `storage/repositories/api_keys/*` | 1,056 | The typed repository for `api_keys` is unused; every handler writes inline SQL instead, which is how the schema drift in D1/D2 crept in. |
| `storage/d1/*`, `storage/do.ts` | 827 | A second, parallel storage layer. |
| `auth/oauth/*` | 788 | The real PKCE client; the Worker uses a hand-rolled callback instead (S8). |
| `storage/repositories/model_registry/*` | 730 | Registry is hard-coded in `catalog.ts`; the D1 table is never read. |
| `proxy/cost_calculator.ts` | 286 | Superseded by `registry.calculateCost`. |
| `contracts/v4_types.ts`, `keys.ts`, `providers.ts` | 115 | The v4 contracts named in the PRD are not imported by any runtime code. Several are edited in the current uncommitted diff. |
| `utils/logger.ts` | 59 | The "Structured Logger (TELEMETRY-01)" commit shipped an unused module. |

The Sybil engine (`auth/sybil/engine.ts`, `scoring.ts`, 5 layers) is technically reachable through its barrel file, but only `verifyTurnstileToken` is called. Its 38 tests take 8 of the suite's 10 seconds.

### Type-safety and hygiene

- 27 `any` in `src/` and 32 in `ui/src/`, against the "no `any`" constitution rule (e.g. `key_pool_do.ts:77`, `tenant_do.ts:81-173`, `admin_handler.ts`, `dashboard/handler.ts:307` casts `this as any` into the admin handler).
- Back-compat facade files (`durable_objects/key_pool_do.ts`, `worker/router/chat_handler.ts`, `dashboard_handler.ts`) remain after the decoupling refactor.
- 15 `console.*` calls in `src/`, some logging raw error messages from OAuth.
- Hard-coded GitHub client id `Ov23lijtT90CwzFc8jcy` in both server and client; hard-coded Firebase project config.
- `docs/data_contracts.go` and `docs/data_contracts.py` describe contracts in languages the project does not use.

## Tests and quality gate

All 1,268 tests pass, yet none of the Critical findings above is caught. The suite tests modules in isolation against hand-written D1 mocks that accept any SQL, and the PRD's acceptance criteria are mostly untested.

| Suite | Files | Tests | Result | In `npm run gate`? |
| --- | --- | --- | --- | --- |
| Root `test/` + `tests/` | 36 | 842 | Pass, 10.2 s (NFR-05 target: under 10 s) | Yes |
| Co-located `src/**/*.test.ts` / `*.spec.ts` | 17 | 386 | Pass when run directly | No; excluded by `vitest.config.ts` include globs |
| UI `ui/src/**/*.test.ts` | 4 | 40 | Pass | Only via `make test-ui` |

**Why the suite misses real bugs**

- Every D1 interaction is mocked (e.g. `test/abuse_routes.test.ts:28` returns canned rows for any query). Only migration 0003 is ever executed against real SQLite. Replaying the production INSERTs against all 10 migrations fails immediately (D1, D2, D4, D5).
- `POST /api/keys`, `sync-session`, `pool-mode`, and the dashboard's header-based tenant resolution have no tests at all.
- Tests exercise dead modules heavily: the Sybil engine's 38 tests take about 8 of the 10 seconds.
- No integration test drives a request through `MainWorker.fetch` with real DO classes (Miniflare / `@cloudflare/vitest-pool-workers` are not installed).

**PRD acceptance criteria coverage**

| AC | Criterion | Test exists? | Would it pass today? |
| --- | --- | --- | --- |
| AC-01 | Own key chosen first | Partial (selector priority unit tests) | Yes, by priority |
| AC-02 | Debt accumulates and is repaid | No | No: nothing accrues |
| AC-03 | `quota_jail` 429 | No | No: error code does not exist |
| AC-04 | Same GCP project → 409 | No | No: insert fails first (D2) |
| AC-05 | Key absent from pool until 24h | No | Never joins at all (FR-07) |
| AC-06 | Tombstone blocks re-registration 14 days | No | No: delete never tombstones |
| AC-07 | Tenant B cannot decrypt tenant A | 1 file (crypto unit) | Unit yes; resolver fallback weakens it |
| AC-08 | No `x-goog-*` or project number in responses | 3 files (normaliser unit) | Headers yes; bodies no (R2) |
| AC-09 | Takedown timing uniform | 1 file | Likely; mocked DB |
| AC-10 | Hero classification | No | No: counters never recorded |
| AC-11 | Counters survive eviction | Partial | Coordinator volumes do not |
| AC-12 | Midnight jitter | No | Not implemented |
| AC-13 | `make gate` under 10 s | Yes | Borderline (10.2 s) |
| AC-14 | 40% cold-start cap | No | Not implemented |
| AC-15 | Registration without C1-C3 → 422 | No | Not implemented |

**Documentation drift.** README quotes 304 tests and a "304/304 in under 10 s" badge. The most recent hive commit claims "1199/1199 tests passing". The PRD table in section 1.2 marks all 19 v4.0 capabilities "Implemented"; this audit finds 2 working as specified (HKDF, pool-mode toggle), 5 partial (pool telemetry, console, coordinator DO, header normaliser, GCP probe) and 12 broken or absent.

## Remediation plan

Six phases, in dependency order. Phase 0 is incident response and should ship before anything else; phases 1 and 2 restore the product's core promise.

### Phase 0: stop the bleeding (security)

- [ ] Remove every `x-tenant-id` fallback in `dashboard/handler.ts` (lines 109-111, 131-133). Unauthenticated means `anonymous`, always. (S1)
- [ ] Stop the UI sending `x-tenant-id` and reading identity from `localStorage.kc_user`. (F1)
- [ ] Require a verified identity on `/api/auth/sync-session`: verify the Firebase ID token or drop the route; never accept `id` from the body; reserve `admin`. (S2, F3)
- [ ] Delete the "raw token as `users.id`" branch in `admin_verifier.ts`. Separate admin auth from `KC_MASTER_KEY`. (S3, S10)
- [ ] Takedown: drop `keyId` and prefix matching; store `key_hash` (SHA-256 of the plaintext) at submission and revoke on exact hash only. (S4, D5)
- [ ] Anonymous `GET /api/keys` returns aggregates only; no ids, labels or prefixes. (S4, section 12 of PRD)
- [ ] Remove Turnstile fixtures from production code paths; require the secret. (S5)
- [ ] Strip `details` from client error bodies; add AIza/gsk patterns and GCP patterns to the message sanitiser. (R2, R4, S6)
- [ ] Remove `OR tenant_id = 'default'` from pool-mode and rotate. (S7)
- [ ] Incident check: list `auth_tokens` rows with `tenant_id = 'admin'` or a tenant with no `users` row, and `api_keys` owned by unexpected tenants. There is no admin audit table to consult (D4), so Cloudflare request logs are the only record. Revoke and rotate as needed.

### Phase 1: make key contribution work

- [ ] Migration 0011: align `consent_attestations` with the PRD (event_type, checkbox_id, ip, user agent), add `api_keys.key_hash`, create `admin_audit_logs`. Fix the `project_hash_registry` insert to include `provider`. (D1, D2, D4)
- [ ] Render the real Turnstile widget in AddKeyModal and ReportKeyModal and send `x-turnstile-token`. (F2)
- [ ] Make `POST /api/keys` transactional (`DB.batch`) and fail loudly if the DO sync fails.
- [ ] Move all `api_keys` SQL into the existing `ApiKeysRepository`. (D-drift root cause)
- [ ] Take `0010_purge_all_keys.sql` out of the migration chain. (D10)
- [ ] Record C1-C3 at registration; return 422 without them. (AC-15)
- [ ] Verify the GCP probe live against Google's current error shape (400 vs 404).

### Phase 2: turn the commons economy on

- [ ] Promote OBSERVATION → ACTIVE after `observation_until` (cron trigger or coordinator alarm). (FR-07)
- [ ] Choose one design for communal selection: coordinator-picked keys per PRD section 9.3, or per-tenant snapshots with refresh plus a shared per-key limiter. Either way, a shared key's RPM must be global. (Economics)
- [ ] Call `accrueDebt` on the borrower and `decrementDebt` on the lender for every communal dispatch; mirror standing to `contributor_standing`. (FR-03, D8)
- [ ] Apply the multiplier to quota limits; enforce `quota_jail` 429. (FR-17, FR-26, AC-03)
- [ ] Fix `processDailyDebtReset`: decide the rate before clearing trust, integer math only, do not jail on the contribution reset. (FR-21)
- [ ] Add `recordDispatch` to the RPC client and set `tenantId` on the cascade request. (FR-16, FR-02)
- [ ] Brake only on communal traffic and only above a minimum pool volume or tenant count. (FR-20)
- [ ] Enforce eye-for-eye, cold-start cap, and keep demo traffic off contributor keys. (FR-19, FR-12, FR-25)

### Phase 3: hot-path correctness

- [ ] Pass the key id, not the model id, to `recordUsage` and `cost_ledger.key_id`. (R1)
- [ ] On upstream 401/429, call `recordStatusCode`, quarantine or cool down the key, and write a status-change timestamp for notifications. (R9, D12)
- [ ] Forward `tool_calls` and `finish_reason`; pass `extra_body`, `safetySettings`, `generationConfig`. (R8, R14)
- [ ] Add Cerebras and SambaNova properly or remove them from submission, pricing and docs. Trim the catalog to providers users can actually contribute. (R5, R6)

### Phase 4: make the UI tell the truth

- [ ] Replace every invented fallback (Sybil matrix, trust 92, 410/89 tokens, circuit defaults, demo "15 RPM") with real data or an explicit empty state. (Frontend table)
- [ ] Read audit logs from the server; surface API failures instead of optimistic success (delete, resolve, project edits, token rotate). (F5-F8)
- [ ] Align headers (`x-kc-cost-microdollars` vs `x-request-cost-micros`), docs endpoints and pricing with the backend. (F9, F10)
- [ ] Rebuild navigation to the PRD's Dashboard / Keys / Pool / Analytics, including the Analytics tab. (IA table)

### Phase 5: gate and docs

- [ ] Include `src/**/*.test.ts` in the root Vitest config; add the UI suite to `npm run gate`.
- [ ] Add a Workers-runtime integration suite (`@cloudflare/vitest-pool-workers`) that applies all migrations and drives real requests through `MainWorker`; encode AC-01 to AC-15 there.
- [ ] Delete the 39 unreachable files or wire them in.
- [ ] Replace the PRD's "Implemented" column and the README's test badge with the real status.
