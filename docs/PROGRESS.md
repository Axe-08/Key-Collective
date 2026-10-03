# Remediation progress

Working method (replaces HIVE): one work package at a time, on branch `wp/WP-x.y`.
For each task: write the tests, `scripts/wp.sh red <tests>`, implement, `scripts/wp.sh check <tests>`, commit `type(WP-x.y): title (T-x.y.z)`.
When the WP's tasks are done: `scripts/wp.sh finish WP-x.y` (full gate, then `--no-ff` merge). At the end of a phase: one review pass, then human sign-off.
Task details (files, tests, plan quotes): `.hive/cards/WP-x.y.json`. Phases 4–8 have no cards; work from `docs/REMEDIATION_PLAN_V2.md` directly.
Tick a box in the same commit that finishes the task. **Current position** is the first unticked box.

## Phase 3

### WP-3.1
- [x] T-3.1.1 Create additive migration 0015 for user identities and sessions (498d9d3)
- [x] T-3.1.2 Implement session store with SHA-256 hashing and CSRF tokens
- [x] T-3.1.3 Add createSession helper and identity options to world test helper
- [x] T-3.1.4 Accept kc_admin_session and ADMIN_EMAILS check in admin verifier
- [x] T-3.1.5 Support console sessions side by side with bearer tokens and CSRF check
- [x] T-3.1.6 Rewrite auth middleware unit tests on real D1 and remove legacy cases

### WP-3.2
- [x] T-3.2.1 Implement registration consent C1-C3 and enforce consent gate on console API

### WP-3.3
- [x] T-3.3.1 Update Sybil engine to PRD thresholds and migrate legacy tests
- [x] T-3.3.2 Implement GitHub link flow with state and PKCE in signed cookie
- [x] T-3.3.3 Add poolRights pure function and enforce on keys and pool routes
- [x] T-3.3.4 Exclude keys of owners without community rights from tenant lending

### WP-3.4
- [x] T-3.4.1 Switch typed API client auth transport to cookie session and CSRF
- [x] T-3.4.2 Purge localStorage auth and fetch identity from GET /api/session in App.svelte
- [x] T-3.4.3 Render locked call-to-action on Pool tab for users without communityPool
- [x] T-3.4.4 Refactor OAuthModal to Google SignIn, ConsentScreen C1-C3, and Settings Link GitHub card
- [x] T-3.4.5 Migrate stage-0 security tests for console /api/* to createSession and CSRF

### WP-3.5
- [x] T-3.5.1 Implement POST /api/auth/claim-legacy and claimable accounts in GET /api/session
- [x] T-3.5.2 Add Claim your old keys console UI card when session reports claimable accounts

### WP-3.6
- [x] T-3.6.1 Implement Turnstile widget and wire into AddKeyModal and ReportKeyModal
- [x] T-3.6.2 Implement GCP error probe extraction and proof-of-life checks
- [x] T-3.6.3 Route all api_keys table SQL queries through ApiKeyRepository
- [x] T-3.6.4 Rewrite post_key handler with validation, atomic batching, DO sync, and submit tests

### WP-3.7
- [x] T-3.7.1 Create migration 0016_projects.sql and update auth_token schema
- [x] T-3.7.2 Support project_id and rotation in token dashboard routes
- [x] T-3.7.3 Persist name, description, rpm_sub_cap, and is_archived in project patch route
- [x] T-3.7.4 Enforce project scoping, sub-cap, and archival rejection in auth middleware

### WP-3.8
- [x] T-3.8.1 Truthful key testing with proof-of-life probe and D1 status sync

### WP-3.9
- [x] T-3.9.1 Implement typed API client methods and contracts for project and token actions
- [x] T-3.9.2 Display real RPM sub-cap and render pessimistic project edits with inline error
- [x] T-3.9.3 Wire typed client actions, secret reveal modal, and reload persistence in Workbench

### WP-3.10
- [x] T-3.10.1 Update Playground to use playground token, read CU header and SSE, and drop tenant ID
- [x] T-3.10.2 Render API Docs dynamically from GET /v1/openapi.json and delete hand-written endpoints
- [x] T-3.10.3 Render CU weights in PricingTable strictly from /v1/models

## Operator steps found during Phase 3

- Secrets/vars per environment: `SESSION_SIGNING_KEY` (secret; signs kc_oauth), `GITHUB_CLIENT_ID` (var), `GITHUB_CLIENT_SECRET` (secret). Without them the GitHub link flow answers 503 `github_not_configured`.
- GitHub OAuth app callback URL: `https://<console host>/api/auth/github/callback`.
- UI build needs `VITE_TURNSTILE_SITE_KEY` (Turnstile widget); `TURNSTILE_SECRET` stays a worker secret.
- Record a real GCP probe response in `docs/specs/gcp_probe.md` (plan WP-3.6 step 3); the probe was built against Google's documented error format.
- `kc_pending` is signed with `KC_MASTER_KEY` (WP-3.1); consider moving it to `SESSION_SIGNING_KEY`.

## Phase 4 — Leases behind a switch

Protocol, pitfalls and task details: `docs/PHASE4_PLAN.md`. Phase 3 staging walkthrough and sign-off are still pending (human).

### WP-4.1
- [x] T-4.1.1 ROUTING_ENGINE switch (legacy | leases) and both-engine test runs
- [x] T-4.1.2 Coordinator rewrite: SQLite registry, typed RPC, alarm, D1 reconcile, D-21 filter, HTTP endpoints removed
- [x] T-4.1.3 KeyPoolDO private lease API (leasePrivate, settle, reconcile)
- [x] T-4.1.4 Lease orchestrator (private → own community → borrowed, priority at lease time, owner debt push)
- [x] T-4.1.5 CascadeRouter on leases (LeaseProvider, Groq-only auto)
- [x] T-4.1.6 Lease integration tests (test/integration/commons/leases.test.ts)
- [x] T-4.1.7 Legacy tests migrated (Appendix B list)

### WP-4.2
- [x] T-4.2.1 Ledger and settle use lease.keyId; recordUsage calls removed; key_id must match ^key_

### WP-4.3
- [x] T-4.3.1 Upstream outcome classifier (classify.ts) with per-row tests
- [x] T-4.3.2 Outcomes settle key state + D1 status; breaker timing; 400 without fallback; recordResult/recordStatusCode removed
- [x] T-4.3.3 Migration 0017 notifications; GET/POST notification routes; takedown and key_invalid notifications

### WP-4.4
- [x] T-4.4.1 resolveLeasedKey: strict tenant subkey, lazy HKDF migration, quarantine on failure, per-key cache
- [x] T-4.4.2 Bulk HKDF migration script; AC-07 tests; key_resolver test migrated

### WP-4.5
- [x] T-4.5.1 Demo isolation: sys_operator / sys_demo, operator-only leases, excluded from economy

### WP-4.6
- [x] T-4.6.1 Provider override on coordinator and KeyPoolDO; /api/admin/providers
- [x] T-4.6.2 Kill switch (control instance, 10 s cache, 503 maintenance); MIDNIGHT_FREEZE removed
- [x] T-4.6.3 Audit rows + stored-state responses; admin router echo tests replaced

## Phase 5 — Commons economy (observe first)

Protocol, pitfalls and task details: `docs/PHASE5_PLAN.md`.

### WP-5.1
- [x] T-5.1.1 Enforcement module (src/pool/enforcement.ts, COMMONS_ENFORCEMENT switch, recordWouldDeny, WorkerEnv types)
- [x] T-5.1.2 Admin would-deny endpoint (GET /api/admin/commons/would-deny)

### WP-5.2
- [x] T-5.2.1 Migration 0018_anti_cycling.sql (api_keys.anti_cycling_until)
- [x] T-5.2.2 Coordinator alarm promotes observation keys to D1 and notifies owner
- [x] T-5.2.3 Anti-cycling tier (FR-18) on key submission with tombstoned project

### WP-5.3
- [x] T-5.3.1 Migration 0019_standing.sql (contributor_standing columns)
- [x] T-5.3.2 TenantQuotaDO credit-first and sliding-window 24h contribution buckets
- [x] T-5.3.3 Standing mirror to D1 on TenantQuotaDO dirty alarm
- [x] T-5.3.4 Live standing and contribution endpoints (/api/pool/standing, /api/pool/contribution)

### WP-5.4
- [x] T-5.4.1 Migration 0020_standing_history.sql (standing_history table)
- [x] T-5.4.2 Rewrite processDailyDebtReset to nightlyReset (7-day trust, integer decay, catch-up)

### WP-5.5
- [x] T-5.5.1 Migration 0021_key_daily_stats.sql (key_daily_stats table, api_keys.drain_state)
- [x] T-5.5.2 Coordinator dispatch counters in settle; delete dead dispatch stubs
- [x] T-5.5.3 Hero/parasite and drain classification (D-16) on RPD exhaustion
- [x] T-5.5.4 Midnight stats flush from coordinator to key_daily_stats

### WP-5.6
- [x] T-5.6.1 Remove pre-dispatch brake and report-volume calls
- [x] T-5.6.2 Surge brake in coordinator lease(ownOnly=false) with 5-minute window

### WP-5.7
- [x] T-5.7.1 Eye-for-eye check requiring active community key in shard
- [x] T-5.7.2 Cold-start share cap (FR-12) based on owner trailing 24h CU

### WP-5.8
- [x] T-5.8.1 Provider reset config in src/providers/config.ts (dailyResetTz, nextProviderReset) — used plan defaults (`America/Los_Angeles` for Google, `UTC` for Groq) since `docs/specs/provider_quotas.md` is not present
- [x] T-5.8.2 Jittered reactivate_at on RPD cooldown
- [x] T-5.8.3 Leaky-bucket retry near provider reset window in orchestrator

### WP-5.9
- [x] T-5.9.1 Passive contributor canary in KeyPoolDO midnight alarm via checkProofOfLife

### WP-5.10
- [x] T-5.10.1 Coordinator hourly stats (capacity utilisation, p90 latency, w_provider_pct)
- [x] T-5.10.2 Truthful telemetry endpoints (/api/pool/telemetry, get_keys, contribution)

### WP-5.11
- [x] T-5.11.1 Migration 0022_project_hash_vesting.sql (vesting_started_at)
- [x] T-5.11.2 Soft delete, 30-min resubmission window, vesting inheritance
- [x] T-5.11.3 Tombstone lifecycle and project-preserving key rotation

### WP-5.12
- [x] T-5.12.1 calculateMultiplierPct with vesting_cap, debt_cap, band_cap
- [x] T-5.12.2 Quota evaluator effective_limit scaling with multiplier
- [x] T-5.12.3 Quota jail enforcement, Flow F body, notice header, would-deny logging

## Phase 6 — Frontend truth; stop using microdollars

Plan: `docs/PHASE6_PLAN.md`

### WP-6.5
- [x] T-6.5.1 Remove µ$ from cost ledger writes (cost_microdollars, daily_spend_rollup)
- [x] T-6.5.2 Remove µ$ from auth tokens (budget_microdollars, spent_microdollars)
- [x] T-6.5.3 Remove µ$ from contributor standing D1 sync (community_debt_micro_cu)
- [x] T-6.5.4 Delete calculateCost, financial.ts, x-kc-cost-microdollars header, all µ$ contract fields
- [x] T-6.5.5 UI µ$ cleanup and grep guard (VelocityDials, SurveillanceTable, types.ts)
- [x] T-6.5.6 Update GEMINI.md and CONTEXT.md invariant #4 to CU

### WP-6.1
- [x] T-6.1.1 Audit surviving invented-data components
- [x] T-6.1.2 AdminView.svelte — remove fake audit rows and syncDurationMs
- [x] T-6.1.3 CircuitBreakerControls.svelte — remove hard-coded latencies
- [x] T-6.1.4 TelemetryLogs.svelte — remove invented model/token data
- [x] T-6.1.5 TopNavBar.svelte — remove hard-coded trust/tier/name
- [x] T-6.1.6 DebtLedgerWidget.svelte — remove standing fallback defaults
- [x] T-6.1.7 KeysTable.svelte — remove RPD/RPM fallbacks
- [x] T-6.1.8 MetricCards.svelte — remove $1.00 budget ring, use CU
- [x] T-6.1.9 Workbench.svelte — remove assignedRpm formula and hard-coded timestamp
- [x] T-6.1.10 CI guard scripts/check-ui-literals.mjs

### WP-6.3
- [x] T-6.3.1 Standing data types (ui/src/lib/standing/types.ts)
- [x] T-6.3.2 Standing API client (ui/src/lib/standing/api.ts)
- [x] T-6.3.3 Rewrite DebtLedgerWidget → StandingCard.svelte with PRD states
- [x] T-6.3.4 Delete legacy DebtLedgerWidget.test.ts

### WP-6.2
- [x] T-6.2.1 POST /api/admin/tenants/:id/reset-quota endpoint + TenantQuotaDO.reset()
- [x] T-6.2.2 GET /api/admin/audit endpoint (paginated admin_audit_logs)
- [x] T-6.2.3 GET /api/admin/tenants endpoint (D1 + live DO standing)
- [x] T-6.2.4 Admin Tenants view — server-backed with reset-quota wiring
- [x] T-6.2.5 Admin Keys view — routing status, delete via coordinator RPC
- [x] T-6.2.6 Admin Providers view — coordinator stats + override controls
- [x] T-6.2.7 Admin audit log view — server audit list

### WP-6.4
- [x] T-6.4.1 Top-level navigation: Dashboard / Keys / Pool / Analytics
- [x] T-6.4.2 Dashboard view (standing card, activity, credentials)
- [x] T-6.4.3 Keys view with sub-tabs: My Keys / Private / Observation
- [x] T-6.4.4 Rotate modal and pool toggle modal with PRD text
- [x] T-6.4.5 Pool view with sub-tabs: Community / Provider / My Contribution
- [x] T-6.4.6 Analytics view with sub-tabs: Usage / Ledger / Multiplier History
- [x] T-6.4.7 Public /report page (signed-out, Turnstile)
- [x] T-6.4.8 Notification toasts every 30s

## Phase 7 — Contract: remove everything deprecated

Plan: `docs/PHASE7_PLAN.md`

### WP-7.3
- [x] T-7.3.1 Migration 0023_credit_units_contract.sql
- [x] T-7.3.2 Clean telemetry emitter µ$ remnants
- [x] T-7.3.3 Schema conformance test

### WP-7.4
- [x] T-7.4.1 Rename coordinator SQLite dispatched columns
- [x] T-7.4.2 Migration 0024_key_schema_contract.sql
- [x] T-7.4.3 Clean normaliseKeyStatus legacy branches

### WP-7.5
Precondition waived under D-28 (2026-10-02), not met.
- [x] T-7.5.1 Remove ROUTING_ENGINE switch from cascade router
- [x] T-7.5.2 Shrink KeyPoolDO to private keys only
- [x] T-7.5.3 Remove ROUTING_ENGINE from wrangler.jsonc and scripts
- [x] T-7.5.4 Archive legacy routing tests

### WP-7.6
Precondition waived under D-28 (2026-10-02), not met.
- [x] T-7.6.1 Simplify resolveLeasedKey to HKDF-only
- [x] T-7.6.2 Archive legacy global-key decryption path in crypto.ts

### WP-7.1
- [x] T-7.1.1 Archive legacy routes and unwire
- [x] T-7.1.2 Route matrix integration tests
- [x] T-7.1.3 Remove Deprecation / Sunset header injection

### WP-7.2
- [x] T-7.2.1 Remove console bearer token branch
- [x] T-7.2.2 Add maintenance route to suspend unclaimed legacy accounts
- [x] T-7.2.3 Archive legacy cookie-based auth token fallback

### WP-7.7
- [x] T-7.7.1 Archive parallel storage layer
- [x] T-7.7.2 Archive unused contracts and barrels
- [x] T-7.7.3 Archive facade modules
- [x] T-7.7.4 Archive one-off maintenance routes
- [x] T-7.7.5 Wire src/utils/logger.ts as the only logger
- [x] T-7.7.6 Verify sybil engine is wired
- [x] T-7.7.7 Create scripts/reachability.mjs and add to gate
- [x] T-7.7.8 Wire contracts/keys.ts (KeyStatus, PoolType enums)
- [x] T-7.7.9 Remove µ$ leftovers (AU-07)

## Phase G — Guardrails

Plan: `docs/REMEDIATION_PLAN_V3.md`

### WP-G.1
- [x] T-G.1.1 Add new forbid rules and selftest to scripts/wp.sh
- [x] T-G.1.2 Enforce one commit per task in scripts/wp.sh finish
- [x] T-G.1.3 Add red log tracking and verification to scripts/wp.sh
- [x] T-G.1.4 Add ops/**/* to tsconfig.json include and fix type errors
- [x] T-G.1.5 Add scripts/check-baselines.mjs and scripts/baselines.json to gate:fast

### WP-G.2
- [x] T-G.2.1 Add operator ledger (D.1–D.4) and D-28 waivers to docs/PROGRESS.md

## Operator steps for Phases 4–8

### D.1 Before deploy (STOP)
- [x] D.1.1 Back up both databases (`npx wrangler d1 export key-collective-d1-dev --remote --output backups/dev-<date>.sql` and `key-collective-d1 --remote --output backups/prod-<date>.sql`)
- [x] D.1.2 Count keys that are not HKDF-migrated (`SELECT COUNT(*) AS n FROM api_keys WHERE hkdf_migrated = 0`) on `key-collective-d1-dev` and `key-collective-d1`
- [x] D.1.3 D-27 count on production (`SELECT COUNT(*) FROM users WHERE id LIKE 'gh_%' OR id LIKE 'usr_gh_%'`)
- [x] D.1.4 Check dev secrets (`npx wrangler secret list --env dev`: `KC_MASTER_KEY`, `SESSION_SIGNING_KEY`, `GITHUB_CLIENT_SECRET`, `TURNSTILE_SECRET`)
- [x] D.1.5 List pending migrations on dev (`npx wrangler d1 migrations list key-collective-d1-dev --remote`; expect 0015–0024)

### D.2 Deploy (STOP)
- [x] D.2.1 Push `git push origin docs/intent-audit-and-remediation:develop` and verify CI gate, D1 migrations, and `--env dev` deploy

### D.3 Smoke on dev
Pass 1 (2026-10-03): 16 findings in `docs/specs/dev_smoke_2026-10-03.md`; pass 2 after Phase F (`docs/PHASEF_PLAN.md` §5).
- [ ] D.3.1 Sign in, complete consent, link GitHub; verify rights show private and community pools
- [ ] D.3.2 Submit a Gemini key with Turnstile (expect 201, record GCP probe in `docs/specs/gcp_probe.md`; duplicate returns 409 `key_already_registered`)
- [ ] D.3.3 Create a project and project token; call `POST https://api-dev.key-col.axe08.tech/v1/chat/completions` (expect 200, CU header, Analytics row)
- [ ] D.3.4 Call with a model whose provider has no key (expect honest fallback or 429/503 body, not 500)
- [ ] D.3.5 Admin panel: verify provider override, kill switch, audit log, and reset-quota
- [ ] D.3.6 Verify Standing card and Pool / My Contribution tabs show real numbers with no placeholders
- [ ] D.3.7 Rotate key, delete it, resubmit within 30m (vesting carries over); after 30m project is tombstoned (409 `project_tombstoned`)
- [ ] D.3.8 Submit public `/report` page with Turnstile while signed out
- [ ] D.3.9 Run `npx wrangler tail --env dev` during smoke checks and record findings in `docs/specs/dev_smoke_<date>.md`

### D.4 Soak (next UTC midnight)
- [ ] D.4.1 Verify `standing_history` and `key_daily_stats` each gain a row for the day
- [ ] D.4.2 Verify coordinator hourly stats rows exist
- [ ] D.4.3 Verify no key moved to `QUARANTINED` unexpectedly

## Phase F — Audit, re-audit and dev QA fixes

Plan: `docs/PHASEF_PLAN.md` (executed by Claude). Inputs: V3 AU-02..AU-05, dev smoke QA-01..QA-16, re-audit RA-01..RA-15.

### WP-F.1
- [ ] T-F.1.1 Stop minting the login bearer token (RA-01)
- [ ] T-F.1.2 Strip x-kc-* and x-tenant-id from upstream requests (RA-02)
- [ ] T-F.1.3 Lease rights fail closed (RA-03)
- [ ] T-F.1.4 OpenAPI: no x-tenant-id parameter, real contact (RA-13)

### WP-F.2
- [ ] T-F.2.1 Gemini 400 API_KEY_INVALID → key_invalid (RA-04)
- [ ] T-F.2.2 404 / model_not_found → model_unavailable, no key action (RA-05)
- [ ] T-F.2.3 Real provider fixtures in upstream_outcomes test

### WP-F.3
- [ ] T-F.3.1 Rebuild the model catalog from verified lists (RA-06)
- [ ] T-F.3.2 Skip deprecated / sunset models in routing and /v1/models
- [ ] T-F.3.3 Remove µ$ price fields; cheapest by CU (RA-09)
- [ ] T-F.3.4 Proof-of-life on gemini-3.5-flash-lite and gpt-oss-20b (QA-12, RA-08)
- [ ] T-F.3.5 UI model pickers read /v1/models only

### WP-F.4
- [ ] T-F.4.1 GCP project probe via blocked/disabled service ErrorInfo (RA-07)

### WP-F.5
- [ ] T-F.5.1 /api/session returns linked identities; no 95 fallback (QA-03, QA-09)
- [ ] T-F.5.2 Google-only users get sybil_score NULL (QA-02)
- [ ] T-F.5.3 App maps identity; AddKeyModal and Workbench use rights (QA-03, QA-09)
- [ ] T-F.5.4 IdentityCard shows Unverified until GitHub is linked (QA-02)
- [ ] T-F.5.5 Standing and contribution fetch after sign-in (QA-01)

### WP-F.6
- [ ] T-F.6.1 Provider selection survives submit (QA-11)
- [ ] T-F.6.2 Add-key modal scrolls on short screens (QA-10)

### WP-F.7
- [ ] T-F.7.1 Read-only tier cards (QA-04)
- [ ] T-F.7.2 Export without invented telemetry (QA-05)
- [ ] T-F.7.3 /api/tokens lists only project keys; no 'Production Gateway' (QA-13)
- [ ] T-F.7.4 Honest project-key actions; no fake copy (QA-14)
- [ ] T-F.7.5 No duplicate polling (QA-06)
- [ ] T-F.7.6 Remove remaining invented UI data (RA-10)
- [ ] T-F.7.7 Pattern-based check-ui-literals (RA-11)
- [ ] T-F.7.8 /api/pool/standing 401 for anonymous ids (RA-12)

### WP-F.8
- [ ] T-F.8.1 CORS allow/expose headers for the browser Playground (QA-07)
- [ ] T-F.8.2 No-capacity exhaustion → 503 service_unavailable (QA-08)

### WP-F.9
- [ ] T-F.9.1 Admin session for ADMIN_EMAILS at Google sign-in (QA-15)
- [ ] T-F.9.2 Admin host serves SPA and sign-in; admin-dev host detected (QA-15)
- [ ] T-F.9.3 getAdminActor uses hashed session lookup (QA-15)
- [ ] T-F.9.4 Public report skips session CSRF; real error shown (QA-16)

### WP-F.10
- [x] T-F.10.1 Migration 0025_would_deny_hourly.sql (AU-03)
- [x] T-F.10.2 Would-deny stats in D1 (AU-03)
- [x] T-F.10.3 New tenant lastResetDay = today (AU-04)
- [x] T-F.10.4 coordinator_do.ts swallows (AU-02)
- [x] T-F.10.5 tenant_do.ts swallows (AU-02)
- [x] T-F.10.6 enforcement.ts swallow (AU-02)
- [x] T-F.10.7 pool_routes.ts swallows (AU-02)
- [x] T-F.10.8 control.ts swallow (AU-02)
- [x] T-F.10.9 admin_handler.ts swallow (AU-02)
- [x] T-F.10.10 abuse_routes.ts swallows (AU-02)
- [x] T-F.10.11 keys/ops.ts swallows (AU-02)
- [x] T-F.10.12 get_keys.ts swallow and empty catch (AU-02)
- [x] T-F.10.13 Archive ops/migrate_keys_hkdf.ts (AU-05)

### Operator steps for Phase F
- [ ] Purge login bearer tokens on dev and prod after WP-F.1 deploys: `SELECT COUNT(*) ...` then `DELETE FROM auth_tokens WHERE project_id IS NULL AND id NOT LIKE 'tok_play_%'`
- [ ] Run `scripts/verify_catalog.mjs` with real keys after WP-F.3
- [ ] D.3 pass 2 and §5 Q-01..Q-16 of `docs/PHASEF_PLAN.md`

## Phase 8

Not carded yet. Before this phase, write a plan like docs/PHASE7_PLAN.md, then the same loop.
