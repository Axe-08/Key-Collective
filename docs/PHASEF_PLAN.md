# Phase F execution plan: audit fixes, re-audit fixes and dev QA fixes

**Executing agent:** Claude.

**Inputs:**
- `docs/REMEDIATION_PLAN_V3.md`, Phase F: AU-02 to AU-05.
- `docs/specs/dev_smoke_2026-10-03.md`: QA-01 to QA-16.
- The re-audit of 2026-10-03, below as RA-01 to RA-15.

**Protocol:** the Phase G `wp.sh` loop from `docs/HANDOVER.md` §3:
- `start` → `red T-id` → fix → `check` → one commit per task → tick `docs/PROGRESS.md` → `finish`.
- **STOP** marks an owner step.

**Owner decisions (2026-10-03):**
- **QA-15:** option A, a separate `kc_admin_session` issued at Google sign-in for `ADMIN_EMAILS`.
- **QA-02:** a Google-only account has no trust score. The UI shows "Unverified, link GitHub"; GitHub linking produces the real score.
- **Proof-of-life models:** chosen from the providers' current model lists (research below), not from memory.
- **Catalog:** rebuilt so that `/v1/models`, the API docs and the Playground model picker list only models that exist.

---

## 1. Re-audit findings (2026-10-03, at `7a34e02`)

Every finding below was checked in the code. RA-07 and RA-05 were also checked against the live Google API.

| Id | Severity | Finding | Where |
|---|---|---|---|
| RA-01 | **High (security)** | Every Google sign-in mints a non-expiring, unscoped bearer token (`kc_<tier>_…`, 50 M CU budget) and returns it in the JSON body. WP-7.2 claimed bearer tokens were retired. The same rows are the QA-13 "Production Gateway" keys. | `src/worker/router/dashboard/auth_routes.ts:134-152` |
| RA-02 | **High (privacy)** | `x-kc-tenant-id` and `x-kc-trace-id` are sent upstream to Google and Groq. The upstream filter strips `kc-tenant-id`, not `x-kc-tenant-id`. | `chat/handler.ts:117-120`, `proxy/upstream/types.ts:33` |
| RA-03 | **High (D-21)** | Lease rights fail open: a tenant with no `users` row, or no DB binding, gets `communityPool: true`. Test convenience was left in production code. | `router/leases/orchestrator.ts:152-168` |
| RA-04 | **High** | Gemini answers an invalid or revoked key with **HTTP 400** `API_KEY_INVALID` (verified live). The classifier maps every 400 to `request_error`: no quarantine, no fallback. A dead community key keeps being lent, and every borrower gets a 400. | `proxy/upstream/classify.ts:231` |
| RA-05 | **High** | Upstream 404 (model not found or retired) maps to `upstream_error`, which counts a breaker failure against the **key**. Requests to a dead model open the breaker on healthy keys. | `classify.ts:238-242`, `key_pool_do.ts:1261` |
| RA-06 | **High** | The catalog is stale. `gemini-2.0-flash` and `gemini-1.5-pro` were shut down 2026-06-01 but are `isActive: true` and carry the aliases `fast`/`smart-fast`. `gemini-2.5-*` is limited to past users, yet `auto` points at `gemini-2.5-flash`. `qwen/qwen3.6-27b` does not exist on Groq. Routing ignores `deprecatedAt`. | `router/registry/catalog.ts`, `registry.ts` |
| RA-07 | **Critical (Sybil)** | The GCP project probe cannot work. Google's 404 for `models/invalid-model` has no `details` and no project (verified live). So **every** COMMUNITY Gemini submission gets 422 `project_unverifiable`, and private keys get no project hash: AC-04, rotation same-project and tombstones have no input. | `src/ingress/probe.ts:48-65` |
| RA-08 | High | Proof-of-life models are retired: `gemini-2.0-flash` (QA-12), and Groq `llama-3.1-8b-instant`, shut down 2026-08-16. Once QA-11 is fixed, Groq submissions will fail with 503 too. | `src/ingress/probe.ts:13-14` |
| RA-09 | Medium | T-7.7.9 is ticked, but 149 µ$ references remain (`*CostPerMTokMicro` in catalog and registry). The registry still picks the "cheapest" model by µ$ price. The Phase 7 gate amendment is not met. | `router/registry/*` |
| RA-10 | Medium | Invented UI data that QA did not list: `VerificationProofModal` (fake Turnstile signature, `ed25519:iad-edge-01:…`, "Score 92/100", "ASN 13335"); `VelocityDials` ("< 250ms SLA", "12ms (SIN-01)", "±2.1%"); `DashboardView` ("Sub-15ms Edge Routing"); `ProjectsSection` (`'12ms avg'` fallback); `CodePlayground` ("simulatedLatency"); dead `DebtLedgerWidget.svelte` with mock fallbacks. | `ui/src/lib/**` |
| RA-11 | Medium | `scripts/check-ui-literals.mjs` blocks only the exact strings already removed, so it can never catch new invented data. | `scripts/check-ui-literals.mjs` |
| RA-12 | Medium | `GET /api/pool/standing` returns a 200 with invented PRISTINE standing and 450 caps for `anonymous`/`default`/`guest`. WP-5.3 says a missing standing is an error, not PRISTINE. | `worker/pool_routes.ts:165-185` |
| RA-13 | Low | `openapi_spec.ts` documents an `x-tenant-id` request parameter and an apex contact URL and email that do not exist. | `src/worker/openapi_spec.ts:17-19,74` |
| RA-14 | Low | `docs/specs/provider_quotas.md` (WP-5.8 human step) was never written, so the reset timezones are unverified. | — |
| RA-15 | Process | Antigravity ticked tasks that were not done (T-7.7.9). Several guards are tautological (RA-11). Tests encode the plan's assumptions instead of real provider behaviour (Gemini invalid key = 401). Treat every Antigravity tick as unverified until a test proves it. | — |

**Verified correct:**
- Admin routes are gated.
- Session cookies are `HttpOnly; Secure; SameSite=Lax`.
- Lease tests for order, global limit, concurrency and D-21 exist.
- Coordinator HTTP endpoints were removed.
- `x-kc-commons-notice`, the jail body, jitter with `crypto.getRandomValues`, and the canary are present.
- Reachability passes.
- The `wp.sh` selftest passes.
- `ops/` is typechecked.

## 2. Model research (2026-10-03)

**Google** ([models](https://ai.google.dev/gemini-api/docs/models), [deprecations](https://ai.google.dev/gemini-api/docs/deprecations)):
- **Stable:** `gemini-3.8-flash` (latest), `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite` (cheapest 3.5), `gemini-3.1-flash-lite` (shutdown 2027-05-07, replaced by 3.5-flash-lite).
- **Preview:** `gemini-3.1-pro-preview`, `gemini-3-flash-preview`.
- **Limited to past users:** `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`.
- **Shut down 2026-06-01:** `gemini-2.0-flash*`.

**Groq** ([models](https://console.groq.com/docs/models), [deprecations](https://console.groq.com/docs/deprecations)):
- **Production:** `llama-3.3-70b-versatile`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`.
- **Preview:** `qwen/qwen3.8-27b`.
- `llama-3.1-8b-instant` was shut down 2026-08-16, replaced by `openai/gpt-oss-20b`.

**Live check (2026-10-03, `docs/specs/gcp_probe.md`) overrides the docs pages:**
- Groq does **not** offer `llama-3.3-70b-versatile` to our key. Remove it from the catalog and aliases.
- The Groq catalog is `openai/gpt-oss-120b`, `openai/gpt-oss-20b` and `qwen/qwen3.8-27b` (preview).
- Alias changes:
  - `smart-fast` → 3.8-flash then gpt-oss-120b;
  - `open-groq` → gpt-oss-120b then gpt-oss-20b;
  - `fast` → 3.5-flash-lite then gpt-oss-20b.
- Groq answers a missing model with **404** `model_not_found`.
- `gpt-oss-20b` accepts `max_tokens: 1` (200), so the probe keeps `max_tokens: 1`.

**Proof-of-life models:** `gemini-3.5-flash-lite` (stable, no shutdown announced, cheapest) and `openai/gpt-oss-20b`.
- `gpt-oss-20b` is a reasoning model; `max_tokens: 1` was verified to return 200.
- **STOP (owner):** confirm both answer 200 on a real key during D.3 pass 2.

## 3. Work packages, in order

Security first, then the provider-facing bugs that block D.3, then the QA fixes, then V3's original Phase F.

### WP-F.1 Security leaks (RA-01, RA-02, RA-03, RA-13)

- **T-F.1.1 (RA-01)** Delete the bearer-token mint and the `token` field from `handleGoogleAuth`.
  - Test: sign in twice. No `auth_tokens` row is created, and the body has no `token`.
  - **STOP (owner):** purge the existing rows on dev and prod:
    ```sql
    DELETE FROM auth_tokens WHERE project_id IS NULL AND id NOT LIKE 'tok_play_%'
    ```
    Check the count first.
- **T-F.1.2 (RA-02)** Stop sending internal headers upstream.
  - `rewriteHeaders` drops every `x-kc-*` header and `x-tenant-id`.
  - The chat handler stops adding them to `cascadeReq.headers`.
  - Test: fetchMock captures the upstream request and asserts that no `x-kc-*` or `x-tenant-id` header is present.
- **T-F.1.3 (RA-03)** `resolveRights` always calls `loadPoolRights`. With no DB binding or no user row, the result is `{ privatePool: false, communityPool: false }` (fail closed).
  - Fix the tests that relied on the fallback by seeding `users` rows. The world helper should create them.
  - Test: a token for a tenant with no `users` row gets no community lease.
- **T-F.1.4 (RA-13)** Clean up `openapi_spec.ts`:
  - Remove the `x-tenant-id` parameter.
  - Take the contact URL from the console host and drop the email.
  - Test: no `x-tenant-id` appears in `/v1/openapi.json`.

### WP-F.2 Upstream outcome classification (RA-04, RA-05)

- **T-F.2.1** A 400 whose body has `ErrorInfo.reason` of `API_KEY_INVALID` (or `status: INVALID_ARGUMENT` with "API key not valid") maps to `key_invalid`. Use the verified live body as the fixture (§1, RA-04).
- **T-F.2.2** A 404, or a 400 with Groq `model_not_found`/`model_decommissioned`, maps to a new outcome `model_unavailable`:
  - no key action and no breaker change;
  - fall back to the next candidate;
  - logged with the model id.

  Test: five 404s leave the key HEALTHY with its breaker closed, and the next candidate serves the request.
- **T-F.2.3** Fix `test/integration/commons/upstream_outcomes.test.ts` so its Gemini-invalid fixture is the real 400 body, not a 401.

### WP-F.3 Model catalog and probes (owner request, RA-06, RA-08, QA-12, RA-09)

- **T-F.3.1** Rebuild `DEFAULT_MODEL_DEFINITIONS` from §2.
  - **Google:** 3.8-flash, 3.7-flash, 3.6-flash, 3.5-flash, 3.5-flash-lite, 3.1-flash-lite (with `sunsetAt` 2027-05-07), and 3.1-pro-preview.
  - **Groq:** gpt-oss-120b, gpt-oss-20b, and qwen/qwen3.8-27b (preview). Not llama-3.3-70b-versatile, which the live models list does not offer.
  - **Removed:** 2.0-flash, 1.5-pro, the 2.5 family, qwen3.6-27b, llama-3.1-8b-instant, and llama-3.3-70b-versatile.
  - **Context windows and output limits** come from each model's page on ai.google.dev and console.groq.com. Fetch them; never guess.
  - **Aliases:**
    - `auto` → cheapest leasable by CU;
    - `smart-fast` → 3.8-flash then gpt-oss-120b;
    - `coder-high` → 3.1-pro-preview then gpt-oss-120b;
    - `open-groq` → gpt-oss-120b then gpt-oss-20b;
    - `fast` → 3.5-flash-lite then gpt-oss-20b.
- **T-F.3.2** The registry and router skip any model whose `deprecatedAt` or `sunsetAt` has passed. `/v1/models` marks such models deprecated or omits them.
  - Test: with a clock past `sunsetAt`, the model is not routable and is not listed.
- **T-F.3.3 (RA-09)** Delete every `*CostPerMTokMicro` field. Cheapest-model selection uses `cuBase` + `cuInPer1k` + `cuOutPer1k`.
  - Done when `grep -rniE "microdollar|micro_cu|CostPerMTokMicro|µ\\$" src ui/src` returns nothing.
- **T-F.3.4 (QA-12, RA-08)** Fix the proof-of-life probe:
  - `PROOF_MODEL_GOOGLE = "gemini-3.5-flash-lite"`, `PROOF_MODEL_GROQ = "openai/gpt-oss-20b"` (`max_tokens: 1`).
  - An unexpected 404 or `model_decommissioned` from the probe is logged as `probe_model_unavailable` and answers 503 `provider_unavailable`.
  - A Gemini 400 `API_KEY_INVALID` answers `key_invalid`.
- **T-F.3.5** The UI model pickers (Playground, API docs, pricing table) read `/v1/models` only, with no hard-coded list.
  - Test: the msw `/v1/models` fixture with 2 models gives a picker with exactly those 2.
- **STOP (owner):** run `scripts/verify_catalog.mjs` with real keys and record the output in `docs/specs/catalog_verification_<date>.md`.

### WP-F.4 GCP project probe redesign (RA-07)

- **Done (2026-10-03):** `docs/specs/gcp_probe.md` records the live responses; Translation and YouTube both return `ErrorInfo.metadata.consumer`.
- **T-F.4.1** `forceErrorGcpProbe` sends the key in the `x-goog-api-key` header to a Google endpoint the key is not allowed to use. It reads `ErrorInfo.metadata.consumer` from the `API_KEY_SERVICE_BLOCKED` or `SERVICE_DISABLED` error (documented in [ErrorReason](https://docs.cloud.google.com/php/docs/reference/common-protos/latest/Api.ErrorReason)).
  - Use the endpoint chosen from the Q-01 result, with the recorded response as the test fixture.
- **T-F.4.2** If no endpoint yields the project, **STOP**. The owner chooses between:
  - (a) accept COMMUNITY Gemini keys with the key hash only, and drop the project-hash Sybil guard (a PRD change);
  - (b) keep blocking COMMUNITY Gemini keys.

### WP-F.5 Session and identity (QA-01, QA-02, QA-03, QA-09)

- **T-F.5.1** `GET /api/session` returns `providers[]`, `github_id`, `github_username` (from `user_identities`) and `sybil_score: null` for unlinked accounts. Remove `?? 95` (`handler.ts:279`).
- **T-F.5.2** `handleGoogleAuth` stores `sybil_score = NULL` for new Google-only users (remove `const sybilScore = 95`). Check that every reader handles null.
- **T-F.5.3** `App.svelte` maps `githubId`, `githubUsername` (empty if not linked, never the email prefix) and `authProvider`. `AddKeyModal` gets `isGitHubAuth={sessionRights.communityPool}`, and the Workbench uses rights, not `githubId`.
- **T-F.5.4** `IdentityCard` shows "Unverified, link GitHub" and no GitHub age or repo checks unless GitHub is linked. The checks render from real data only.
- **T-F.5.5** `StandingCard` and `DashboardView` fetch when `userAccount.id` becomes non-empty, and never before sign-in (DOM test).

### WP-F.6 Add-key modal (QA-10, QA-11)

- **T-F.6.1 (QA-11)** `handleProviderSelect` writes `modalState.type`. `handleSubmit` captures `const selectedProvider = provider` before any awaits.
  - DOM test: select Groq, submit; the request body has `provider: "groq"`.
- **T-F.6.2 (QA-10)** Make the modal scroll:
  - backdrop `items-start sm:items-center`;
  - card `max-h-[calc(100vh-2rem)] flex flex-col`;
  - form `overflow-y-auto`.

  DOM test: the card has the max-height class and the form scrolls.

### WP-F.7 Workbench truth (QA-04, QA-05, QA-06, QA-13, QA-14, RA-10, RA-11, RA-12)

- **T-F.7.1 (QA-04)** Tier cards are read-only. Delete `handleSelectTier` and its toast.
- **T-F.7.2 (QA-05)** Strip invented telemetry from `formatters.ts` and `Workbench.svelte`. Rename the PDF action to "Print view".
- **T-F.7.3 (QA-13)** `GET /api/tokens` excludes `tok_play_%` and rows with `project_id IS NULL`. `getProjectName` falls back to `'—'`.
- **T-F.7.4 (QA-14)**
  - Remove the copy button for masked secrets and the `44781d09e` literal.
  - Show a static Active badge and a single Revoke action.
  - Send `name` on token creation if the API accepts it; otherwise remove the input.
- **T-F.7.5 (QA-06)** The Workbench uses `propProviderKeys` when it is defined (even if empty). Notifications are polled by one owner only.
- **T-F.7.6 (RA-10)**
  - Archive `VerificationProofModal`, or render it from real Turnstile, session and score data.
  - Remove the SLA, latency and region literals from `VelocityDials`, `DashboardView`, `ProjectsSection` and `CodePlayground`.
  - Archive `DebtLedgerWidget.svelte`.
- **T-F.7.7 (RA-11)** Rewrite `check-ui-literals.mjs` to be pattern-based. Over `ui/src/**/*.svelte|ts` (tests and mocks excluded), it rejects:
  - `\b\d+(\.\d+)?\s?ms\b` in markup text;
  - `iad-|SIN-\d|ASN \d`;
  - hex strings of 32 or more characters;
  - email literals;
  - `/ 100</strong>` and similar score literals.

  Allowed exceptions go in a reviewed allowlist file. Self-test with positive and negative samples.
- **T-F.7.8 (RA-12)** `/api/pool/standing` answers 401 for `anonymous`, `guest` and `default`, never invented standing.

### WP-F.8 Gateway CORS and capacity errors (QA-07, QA-08)

- **T-F.8.1** On the API host:
  - `access-control-allow-headers` adds `x-pool-fallback` and drops `x-tenant-id`;
  - add `access-control-expose-headers: x-kc-cu, x-kc-model-used, x-kc-provider, x-kc-request-id, x-kc-attempts, x-kc-commons-notice`.
  - Test: a preflight carrying those headers is allowed.
- **T-F.8.2** `FALLBACK_EXHAUSTED` caused by "no lease available" on every candidate answers **503** `type: "service_unavailable"`, `code: "no_capacity"`, with a `Retry-After`. Real upstream failures stay 502 `upstream_error`.

### WP-F.9 Admin access and public report (QA-15 option A, QA-16)

- **T-F.9.1** Google sign-in where `email_verified` is true and the email is in `ADMIN_EMAILS`:
  - sets `users.role = 'admin'` (insert and conflict-update);
  - also creates `createSession(db, id, "admin")`;
  - sets `kc_admin_session` (HttpOnly, Secure, SameSite=Strict, `Domain` scoped so the admin host receives it).

  A non-admin email gets no admin session, and removing an email from `ADMIN_EMAILS` revokes admin at the next sign-in.
- **T-F.9.2** The admin host serves the SPA shell and `POST /api/auth/google` without the 404 gate. `/api/admin/*` stays gated. `App.svelte` treats `admin.` and `admin-dev.` as admin hosts.
- **T-F.9.3** `getAdminActor` uses `lookupSession` (hashed `id_hash`).
  - Test: an admin action writes `admin_audit_logs.admin_user_id`.
- **T-F.9.4 (QA-16)** `POST /api/abuse/report-key` skips the session CSRF check and never uses session authority. The UI shows the server's error code.
  - Test: a signed-in report with Turnstile gives 200 (with the Turnstile test secret).

### WP-F.10 V3's original audit fixes

- **T-F.10.1 (AU-03):** migration `0025_would_deny_hourly.sql`.
- **T-F.10.2 (AU-03):** the would-deny endpoint reads D1. Delete the in-memory array.
- **T-F.10.3 (AU-04):** a new tenant's `lastResetDay` is set to today.
- **T-F.10.4 to T-F.10.12 (AU-02):** the 22 `void err;` sites, one task per file (`docs/PHASE8_PLAN.md` §5 lists them). Set the `voidErr` baseline to 0.
- **T-F.10.13 (AU-05):** archive `ops/migrate_keys_hkdf.ts`. The D.1 counts were 0 on both databases, so the precondition is met.

## 4. Phase F gate

1. `npm run gate` passes.
2. The `voidErr` baseline is 0.
3. The µ$ grep returns nothing.
4. The new `check-ui-literals` passes.
5. **STOP (owner):** D.3 pass 2 and D.4 on dev, including §5.

## 5. QA instructions for the owner (D.3 pass 2 and beyond)

Run these after Phase F is deployed to dev. Record results in `docs/specs/dev_smoke_<date>.md`. Never paste a full key; redact project numbers if you share output.

**Q-01. GCP probe** (before WP-F.4). With your Gemini key in `$K`:
```
curl -s -H "x-goog-api-key: $K" "https://generativelanguage.googleapis.com/v1beta/models/invalid-model"
curl -s -H "x-goog-api-key: $K" "https://translation.googleapis.com/language/translate/v2?q=hi&target=fr"
curl -s -H "x-goog-api-key: $K" "https://youtube.googleapis.com/youtube/v3/videos?part=id&id=x"
```
For each, note the HTTP code, `reason`, and whether `metadata.consumer` = `projects/<number>` appears.

**Q-02. Catalog.** Run `node scripts/verify_catalog.mjs` with both keys. Every model in `/v1/models` must exist for your key.

**Q-03. Each model answers.** In the Playground, send one request per model in the picker. Each returns 200 with an `x-kc-model-used` header. No model gives 404.

**Q-04. Groq key end to end.** Add a Groq key (QA-11 fix): expect 201, and see it in Keys. Chat with a Groq model: 200.

**Q-05. Invalid key handling (RA-04).**
1. Add a Gemini key, then delete that key in AI Studio.
2. Send a chat request. Expect: it falls back or answers 503 `no_capacity`; the key shows QUARANTINED; one "key invalid" notification appears.

**Q-06. No leaked headers (RA-02).** Check `wrangler tail` on a chat request; also confirm with a test, since the outgoing headers aren't visible in the tail.

**Q-07. Login token gone (RA-01).**
1. Sign out and back in twice.
2. `SELECT COUNT(*) FROM auth_tokens WHERE project_id IS NULL AND id NOT LIKE 'tok_play_%'` stays 0.
3. The Workbench keys list shows only project keys.

**Q-08. Second account (economy).** Needs a second Google account linked to a different GitHub account.
- Account B, with no community key, tries to borrow: in observe mode it is served, and `would_deny` shows `eye_for_eye`.
- After B uses A's community key, B's standing shows debt and A's shows contribution.
- `GET /api/admin/commons/would-deny` shows the counts, and they survive a redeploy (AU-03).

**Q-09. Observation (24 h).** A Community key submitted at T is `OBSERVATION` until T+24 h. After that it becomes `ACTIVE`, with a "joined the community pool" notification.

**Q-10. Rotation and delete (needs Q-01 to pass).**
- Rotate a key with a key from another GCP project: 409 `project_mismatch`.
- Delete, then resubmit within 30 minutes: accepted, and vesting is kept.

**Q-11. Admin (QA-15).**
- Sign in on `admin-dev` with an `ADMIN_EMAILS` account: the panel loads.
- A non-admin account gets no admin panel and no admin cookie.
- Provider override and kill switch take effect on the next request. The audit log shows your user id.
- Kill switch: `/v1` answers 503 `maintenance` while the console keeps working.

**Q-12. Report page (QA-16).** Submit signed in and signed out; both give 200. A bad Turnstile shows the real error.

**Q-13. Limits.** The 11th key submission in a day gives 429 `rate_limited`. A duplicate key gives 409 `key_already_registered`.

**Q-14. Viewports.** Every modal (add key, rotate, pool toggle, create project, report) scrolls and fits at 1366×768 and at phone width.

**Q-15. Midnight UTC (D.4).** Check that rows were written: one per tenant in `standing_history` and one per key in `key_daily_stats`. A new tenant created that afternoon has no reset row (AU-04).

**Q-16. Streaming.** A Playground streaming request shows the tokens and the final `kc.usage` CU, and the header values are readable (QA-07 expose-headers).
