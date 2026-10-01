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
- [ ] T-3.3.4 Exclude keys of owners without community rights from tenant lending

### WP-3.4
- [ ] T-3.4.1 Switch typed API client auth transport to cookie session and CSRF
- [ ] T-3.4.2 Purge localStorage auth and fetch identity from GET /api/session in App.svelte
- [ ] T-3.4.3 Render locked call-to-action on Pool tab for users without communityPool
- [ ] T-3.4.4 Refactor OAuthModal to Google SignIn, ConsentScreen C1-C3, and Settings Link GitHub card
- [ ] T-3.4.5 Migrate stage-0 security tests for console /api/* to createSession and CSRF

### WP-3.5
- [ ] T-3.5.1 Implement POST /api/auth/claim-legacy and claimable accounts in GET /api/session
- [ ] T-3.5.2 Add Claim your old keys console UI card when session reports claimable accounts

### WP-3.6
- [ ] T-3.6.1 Implement Turnstile widget and wire into AddKeyModal and ReportKeyModal
- [ ] T-3.6.2 Implement GCP error probe extraction and proof-of-life checks
- [ ] T-3.6.3 Route all api_keys table SQL queries through ApiKeyRepository
- [ ] T-3.6.4 Rewrite post_key handler with validation, atomic batching, DO sync, and submit tests

### WP-3.7
- [ ] T-3.7.1 Create migration 0016_projects.sql and update auth_token schema
- [ ] T-3.7.2 Support project_id and rotation in token dashboard routes
- [ ] T-3.7.3 Persist name, description, rpm_sub_cap, and is_archived in project patch route
- [ ] T-3.7.4 Enforce project scoping, sub-cap, and archival rejection in auth middleware

### WP-3.8
- [ ] T-3.8.1 Truthful key testing with proof-of-life probe and D1 status sync

### WP-3.9
- [ ] T-3.9.1 Implement typed API client methods and contracts for project and token actions
- [ ] T-3.9.2 Display real RPM sub-cap and render pessimistic project edits with inline error
- [ ] T-3.9.3 Wire typed client actions, secret reveal modal, and reload persistence in Workbench

### WP-3.10
- [ ] T-3.10.1 Update Playground to use playground token, read CU header and SSE, and drop tenant ID
- [ ] T-3.10.2 Render API Docs dynamically from GET /v1/openapi.json and delete hand-written endpoints
- [ ] T-3.10.3 Render CU weights in PricingTable strictly from /v1/models

## Phases 4–8

Not carded. Each WP in the plan: list its tests from the plan, then the same loop.
