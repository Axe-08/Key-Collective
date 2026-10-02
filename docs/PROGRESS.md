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
- [ ] T-5.10.2 Truthful telemetry endpoints (/api/pool/telemetry, get_keys, contribution)

### WP-5.11
- [ ] T-5.11.1 Migration 0022_project_hash_vesting.sql (vesting_started_at)
- [ ] T-5.11.2 Soft delete, 30-min resubmission window, vesting inheritance
- [ ] T-5.11.3 Tombstone lifecycle and project-preserving key rotation

### WP-5.12
- [ ] T-5.12.1 calculateMultiplierPct with vesting_cap, debt_cap, band_cap
- [ ] T-5.12.2 Quota evaluator effective_limit scaling with multiplier
- [ ] T-5.12.3 Quota jail enforcement, Flow F body, notice header, would-deny logging

## Phases 6–8

Not carded yet. Before each phase, write a plan like docs/PHASE4_PLAN.md / docs/PHASE5_PLAN.md, then the same loop.

