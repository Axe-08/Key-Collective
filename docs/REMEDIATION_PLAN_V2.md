# Key Collective — Remediation Plan v2 (incremental, non-breaking)

As of 2026-09-30 · supersedes the execution order of [`REMEDIATION_PLAN.md`](REMEDIATION_PLAN.md) (v1) for everything after stage 0 · baseline: [`INTENT_AUDIT.md`](INTENT_AUDIT.md) and [`PRD.md`](PRD.md) v4.0

v1 is still the reference for **what** to build: its designs, decisions D-01 to D-20, findings and test expectations carry over unchanged unless this document says otherwise. v2 changes **how and in what order** the remaining work ships, so that every phase is a release that can go to production on its own without breaking users, clients, running deploys or the test suite.

---

## Contents

0. [Where things stand](#0-where-things-stand)
   - [Stage 0 result](#stage-0-result)
   - [Why v2: problems in v1's order](#why-v2-problems-in-v1s-order)
   - [Rules that keep every phase non-breaking](#rules-that-keep-every-phase-non-breaking)
   - [Phase map](#phase-map)
   - [HIVE execution (v2)](#hive-execution-v2)
1. [Decisions log](#1-decisions-log) (D-01 … D-27)
2. [Foundations](#2-foundations-cross-cutting-designs) (v1 sections 2.1–2.5 with v2 rollout notes)
3. Phases 1–8 (one release each)
4. [10.1 Appendix A — traceability (v2 ids)](#101-appendix-a--traceability-matrix-v2-ids)
5. [10.2 Appendix B — test files and their v2 owner](#102-appendix-b--disposition-of-every-existing-test-file-with-v2-owner)
6. [10.3 Appendix C — migration sequence (v2)](#103-appendix-c--migration-sequence-v2)

---

## 0. Where things stand

### Stage 0 result

Stage 0 (v1 phase 0 plus the test harness and test configuration) is complete on branch `hive/stage-0`, not yet merged or deployed.

| Item | State |
| --- | --- |
| v1 WP 0.1 – 0.10, WP 1.0, WP 6.1 | 32 of 32 tasks committed, each gated and reviewed |
| Stage gate (`npm run gate`) | **Pass**: typecheck, 1,184 node tests, 174 Workers tests, 40 UI tests, SQL-mock lint (commit `c9f0de2`) |
| Fixed while closing the gate | Root Vitest config now covers every suite and fails on empty runs (`6e3a6a0`); stale tests reconciled with the new behaviour; `/v1/models/:id` 404 used the old error shape with `details` (leak); Sybil scoring never passed the Turnstile secret, so every scored token threw after v1 0.5 |
| Still open (operator) | Staging check that the S1, S2, S4 exploit requests return 401/404; OP-0.11 (expire pre-hotfix tokens, rotate `ADMIN_TOKEN` and `GITHUB_CLIENT_SECRET`, log review, incident report); run the key-hash backfill once after deploy (WP-1.3 step 7) |

To ship stage 0: merge `hive/stage-0` into `docs/intent-audit-and-remediation` (or `master`), deploy, then do the operator items above.

### Why v2: problems in v1's order

Found while running stage 0 and by re-reading v1 against how `deploy-prod.yml` works (it applies D1 migrations **before** it deploys the new Worker, so for a while the old code runs against the new schema).

| # | Problem in v1 | What breaks | v2 fix |
| --- | --- | --- | --- |
| P2-01 | Migrations rename or rewrite data in place (0012 renames every µ$ column; 0014 rewrites `api_keys.status` to upper case while KeyPoolDO loads `status = 'Healthy'`). | The release still running during a deploy writes to columns that no longer exist and stops routing keys. | Tolerant readers ship first (WP-1.2); schema changes are additive (expand); removals happen one release after the last reader is gone (contract). Rule R-1. |
| P2-02 | v1 WP 1.1 removed the apex, console `/v1` and alias routes in the same release that introduced `api.*`. The UI, README and OpenAPI currently tell users to call `https://key-col.axe08.tech/v1/…`. The apex answered API calls with `301`, which turns a POST into a GET. | Every integration built from our own docs breaks on deploy day. | `api.*` becomes canonical with the old routes kept behind `Deprecation`/`Sunset` headers and a hit counter (WP-2.7); removal only after the sunset and 14 days of zero hits (WP-7.1). `308` for non-GET redirects (D-25). |
| P2-03 | v1 WP 1.2 switched console auth from bearer to cookies inside one WP whose cards merge one by one. | Between merges, a server that wants cookies meets a UI that sends bearer tokens: the console is down on the integration branch and in any deploy cut from it. | Server accepts both (WP-3.1) → UI switches (WP-3.4) → bearer removed a release later (WP-7.2). |
| P2-04 | v1 WP 2.1 replaced the routing engine in one step, with no way back. | A coordinator bug takes all routing down; rollback means reverting a large merge. | `ROUTING_ENGINE=legacy|leases` switch (D-23); staging flip, soak, production flip; legacy engine deleted only after 7 quiet days (WP-7.5). |
| P2-05 | New refusals (surge brake, eye-for-eye, share cap, quota jail) went live the first time they were computed. | Existing users are suddenly refused on numbers nobody has checked on real traffic. | `COMMONS_ENFORCEMENT=observe|enforce` (WP-5.1, D-24): a phase in observe mode, a would-deny report, then the operator enforces. |
| P2-06 | Undeclared dependencies (v1 ids): 5.2 uses 1.5's probe but said "none"; 3.3 adds `usage.kc_cu` (needs CU) but said "none"; 4.6 needs the playground token, API host and CU but declared only 4.1; 4.1's client sent CSRF cookies before sessions existed. | Builders hit missing pieces mid-task, or the runner schedules work too early. | Dependencies re-derived from the text and declared (see each WP). |
| P2-07 | Legacy test rewrites (v1 WP 6.2) were scheduled last. | Every stage fights stale tests with hand-rolled mocks. The stage 0 gate failed with 63 tests asserting removed behaviour. | Each WP owns the Appendix B rows for the modules it changes and moves them to the harness in the same release (**Legacy tests** line in each WP; **Owner** column in 10.2). |
| P2-08 | The per-merge check was only the typecheck. | Parallel tasks broke each other's tests unnoticed (stage 0: the Turnstile fixture removal broke the new S4 and key-hash tests). | Runner `post_merge` now runs typecheck plus both Vitest suites on every merge (already set in `.hive/config.json`). |
| P2-09 | Phase 0 gate required `npm run gate` while legacy suites still asserted the removed behaviour. | The gate cannot pass without extra, unplanned work. | Same fix as P2-07: suites move with the behaviour, so every phase gate is the full gate. |
| P2-10 | The D1 backup step was in v1 WP 5.6/6.5 (last), but table rebuilds ran in stage 1. | A bad rebuild in production has no restore point. | Backup step in phase 1 (WP-1.3). |
| P2-11 | Migration numbers did not follow execution order (0016 ran before 0012). | Confusing history; new databases apply in number order, which differed from how production received them. | Numbers follow execution order (section 10.3). |
| P2-12 | v1 0013 expired **all** `auth_tokens` again. | Every API key created after the hotfix (legitimate, post-S2) stops working. | Not repeated; OP-0.11 already did it once (WP-3.1). |
| P2-13 | D-05 made the community pool GitHub-gated, but v1 said nothing about existing COMMUNITY keys of Google-only users. | Their keys silently stop being lent, or keep being lent against the rule. | D-21: they keep serving their owner, are not lent until the owner links GitHub, and the owner is told (WP-3.3). |
| P2-14 | The stage-0 health test accepts `healthy` as well as `ok` (a builder loosened it). | Drift from the plan. | WP-2.7 tightens it to exactly `{"status":"ok"}`. |

### Rules that keep every phase non-breaking

- **R-1 Expand, then contract.** A migration may only add tables, columns or indexes, or rewrite data that every reader in the **previous** release already tolerates. Dropping or renaming a column, table or value happens in a later phase than the code change that stopped using it (D-26).
- **R-2 Readers before writers.** When a value's shape changes, a release that reads both shapes ships before the release that writes or migrates to the new one.
- **R-3 Old and new side by side.** Public contracts (URLs, auth methods, headers, response fields) get a replacement first, keep the old form with a deprecation signal, and lose it only after evidence that nobody uses it.
- **R-4 Switch, don't swap.** A replacement of a core path (routing engine, enforcement) ships behind a config switch whose default is the old behaviour; the operator flips it per environment and can flip it back without a code change.
- **R-5 Tests move with behaviour.** The WP that changes behaviour updates or rewrites every test that asserted the old behaviour (its **Legacy tests** line). No phase leaves a failing or skipped test behind.
- **R-6 Green at every merge.** Every HIVE merge runs typecheck and both Vitest suites; every phase gate runs `npm run gate`.
- **R-7 Server and UI in one release.** A change to a dashboard response ships in the same phase as the UI that reads it. `/v1` changes follow R-3 instead, because external clients read them.
- **R-8 Backup before migrate.** Production deploys export D1 before applying migrations (WP-1.3).

### Phase map

Each phase is one HIVE stage and one production release. Dependencies between phases are release dependencies: phase *n + 1* assumes phase *n* is **deployed**, not just merged.

| Phase | Release | Theme | WPs | Migrations | Switches / evidence needed before the next phase |
| --- | --- | --- | --- | --- | --- |
| 0 | R0 | Security hotfix (done) | 32 tasks | 0011 | Deploy + operator items above |
| 1 | R1 | Groundwork: nothing user-visible | 1.1–1.5 | 0012 | Deployed (tolerant readers must be live before R2's migration) |
| 2 | R2 | Credit Units, OpenAI completeness, schema repair, one API host | 2.1–2.7 | 0013, 0014 | `LEGACY_SUNSET` set; legacy route counter live |
| 3 | R3 | Identity, sessions, key submission, projects, developer surfaces | 3.1–3.10 | 0015, 0016 | Claim-flow notice period starts (D-27) |
| 4 | R4 | Leases behind `ROUTING_ENGINE`, key state, strict decryption, admin controls | 4.1–4.6 | 0017 | Staging on `leases`, soak, then production on `leases` |
| 5 | R5 | Commons economy with enforcement in observe mode | 5.1–5.12 | 0018–0022 | Would-deny review, then `COMMONS_ENFORCEMENT=enforce` |
| 6 | R6 | Frontend truth; stop using µ$ | 6.1–6.5 | — | — |
| 7 | R7 | Contract: remove everything deprecated | 7.1–7.7 | 0023, 0024 | Each WP's **Human** precondition |
| 8 | R8 | Hardening, AC suite, CI, docs | 8.1–8.7 | — | Release gate |

v1 → v2 id mapping (v1 ids in the text of reused WPs have been rewritten to v2 ids; each reused WP names its v1 id in its title):

| v1 | v2 | v1 | v2 | v1 | v2 | v1 | v2 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1.1 | 2.7 (+7.1) | 2.1 | 4.1 (+7.5) | 2.11 | 5.10 (+7.4) | 4.3 | 6.2 |
| 1.2 | 3.1–3.5 (+7.2) | 2.2 | 5.2 | 2.12 | 4.5 | 4.4 | 6.3 |
| 1.3 | 2.1, 2.2 (+6.5, 7.3) | 2.3 | 5.3 | 2.13 | 5.11 | 4.5 | 3.9 |
| 1.4 | 1.2, 1.3, 2.6 (+7.4) | 2.4 | 5.12 | 3.1 | 4.2 | 4.6 | 3.10 |
| 1.5 | 3.6 | 2.5 | 5.4 | 3.2 | 4.3 | 4.7 | 6.4 |
| 1.6 | 3.7 | 2.6 | 5.5 | 3.3 | 2.3 | 5.1 | 4.6 |
| 2.0 | 1.1 | 2.7 | 5.6 | 3.4 | 1.4 | 5.2 | 3.8 |
| 3.5 | 2.5 | 2.8 | 5.7 | 3.6 | 4.4 (+7.6) | 5.3 | 8.1 |
| 3.7 | 2.4 | 2.9 | 5.8 | 4.1 | 1.5 | 5.4 | 7.7 |
| 6.2 | 8.3 | 2.10 | 5.9 | 4.2 | 6.1 | 5.5 | 8.2 |
| 6.3 | 8.4 | 6.4 | 8.5 | 6.5 | 8.6 | 5.6 | 8.7 |

New in v2: WP-1.2, 1.3, 2.1, 2.2 (CU split), 2.6, 2.7 (rewritten), 3.1–3.5 (identity split), 5.1, 6.5, 7.1–7.6.

### HIVE execution (v2)

1. Sign off stage 0 and merge `hive/stage-0` into the base branch (see "Stage 0 result").
2. Archive the v1 run and start v2 from the merged branch:
   ```bash
   mv .hive .hive-v1 && echo ".hive-v1/" >> .git/info/exclude
   python3 ~/.gemini/config/skills/hierarchical-hive/scripts/hive_runner.py init \
     --plan docs/REMEDIATION_PLAN_V2.md --base docs/intent-audit-and-remediation \
     --stages "1|2|3|4|5|6|7|8" --max-width 3
   ```
3. In `.hive/config.json`, then `compile`:
   ```json
   {
     "stop_at_stage_gate": true,
     "gate": { "always": ["npm run -s typecheck"],
               "post_merge": ["npm run -s typecheck", "npx vitest run", "npx vitest run -c vitest.workers.config.ts"],
               "stage": ["npm run -s gate"] },
     "review": { "globs": ["migrations/*", "**/auth/**", "**/crypto/**", "**/security/**",
                           "**/quota/**", "**/pool/**", "**/key_resolver*", "**/session/**"] },
     "forbid": [
       { "pattern": "catch\\s*(\\([^)]*\\))?\\s*\\{\\s*\\}", "glob": "src/*", "message": "empty catch block" },
       { "pattern": "\\bas any\\b|:\\s*any\\b", "glob": "src/*", "message": "`any` in new code" },
       { "pattern": "\\b(it|test|describe)\\.only\\(", "glob": "*", "message": ".only left in a test" },
       { "pattern": "prepare\\s*:\\s*\\(", "glob": "test*/*", "message": "hand-rolled D1 mock (use the Workers harness)" },
       { "pattern": "x-tenant-id", "glob": "ui/src/*", "message": "client-chosen tenant header" }
     ]
   }
   ```
   The microdollar forbid rule is added after WP-7.3 merges.
4. After each stage gate passes: deploy that release to staging, then production, do the phase's operator steps, and only then `advance`. HIVE never deploys.
5. Within a phase, the runner parallelises WPs whose files do not overlap; `Depends on` lines are enforced. Cards that only move, rewrite or delete tests or code use `red: false`; every other card adds a test that fails before its change.

Operator (Human) steps, in order:

| When | Step | Needed by |
| --- | --- | --- |
| After R0 deploy | OP-0.11; staging exploit checks; run `POST /api/admin/maintenance/backfill-key-hash` once | Stage 0 sign-off, WP-7.7 |
| Before phase 2 | Confirm `consent_attestations` and `project_hash_registry` are empty in production; run `scripts/verify_catalog.mjs` with real keys after WP-1.4 and fix reported ids | WP-2.6, WP-2.1 |
| After R2 deploy | Set `LEGACY_SUNSET` (D-22) and announce it in README and a console banner | WP-7.1 |
| Before phase 3 | Record the GCP forced-error probe response in `docs/specs/gcp_probe.md` | WP-3.6 |
| After R3 deploy | Start the legacy-account notice (D-27) | WP-7.2 |
| Before phase 4 | Record provider reset times in `docs/specs/provider_quotas.md` | WP-5.8 |
| After R4 deploy | `ROUTING_ENGINE=leases` on staging, 48 h soak, then production (D-23) | Phase 5, WP-7.5 |
| After R5 deploy | 7 days in observe mode; review `/api/admin/commons/would-deny`; set `COMMONS_ENFORCEMENT=enforce` (or per rule) | Phase 6 onward |
| Before each phase 7 WP | That WP's **Human** precondition | Phase 7 |

---

## 1. Decisions log

Decisions marked **Owner** were made by the project owner on 2026-09-30. Decisions marked **Default** are this plan's recommendation; each is reversible and flagged where it matters.

| # | Decision | Status |
| --- | --- | --- |
| D-01 | Every OpenAI-compatible call (chat, models, demo usage) is served **only** at `https://api.key-col.axe08.tech/v1/*`. No aliases, no other hosts. | Owner |
| D-02 | Microdollars are removed. The only unit of account is the **Credit Unit (CU)**, an integer (`bigint`). No dollar amounts anywhere, including the UI. | Owner |
| D-03 | CU is a per-request base plus weighted input and output tokens (formula in 2.2). | Owner |
| D-04 | The PoolCoordinator picks communal keys. Borrower key order: **(1) own PRIVATE keys → (2) own COMMUNITY keys → (3) other contributors' COMMUNITY keys**. Only step 3 creates community debt. | Owner |
| D-05 | A Google sign-in is the base account and unlocks the **private pool only**. Linking GitHub on top of Google (and passing the Sybil check) unlocks the **community pool**: contributing, borrowing, and viewing community pool health. GitHub alone is not an account. | Owner (confirmed) |
| D-06 | Cerebras and SambaNova are dropped until re-introduced deliberately. Supported providers: Gemini (`google`) and Groq. | Owner |
| D-07 | Trusted Contributor after **7** consecutive debt-free days (PRD FR-21), not 30 (CONTEXT.md). CONTEXT.md is corrected. | Default |
| D-08 | Console and admin use an HttpOnly session cookie. `/v1` accepts only API keys (`kc_live_…`, `kc_demo_…`) as Bearer. No credentials in URLs or `localStorage`. | Default |
| D-09 | Hostnames come from environment variables, matched exactly. Dev uses `api-dev.`, `console-dev.`, `admin-dev.` under `key-col.axe08.tech`; local uses `api.localhost:8787` etc. | Default |
| D-10 | Tenant id stays `usr_goog_<firebaseUid>` (already used by the Google flow). GitHub becomes a linked identity row, not a tenant id. | Default |
| D-11 | The multiplier scales the tenant's **RPM/RPD ceiling** (burst), computed as `min(vesting cap, debt ceiling, utilisation band)`. Community-pool eligibility is gated separately by the debt ratio. Non-contributors run at 1.00×. | Owner (confirmed) |
| D-12 | Jail ratio compares debt to **CU contributed in the trailing 24 h**, not "today since 00:00", to remove the midnight cliff (audit FR-21 row 2). | Default |
| D-13 | Coordinator is **sharded per provider** (`POOL_COORDINATOR.idFromName("pool:google")`, `"pool:groq"`) from day one. | Default |
| D-14 | NFR-05's "< 10 s" applies to `gate:fast` (typecheck + unit). The full gate (integration against real D1 and DOs) runs in CI with a 3-minute budget. | Default (PRD amended) |
| D-15 | Google-native Gemini endpoints (`/v1beta/models/{model}:generateContent`, PRD 10.1, audit R10) are dropped for now. Only OpenAI-format endpoints are served. Candidate for future or open-source scope; if revived, it lives under `/v1/gemini/…` to respect D-01. | Owner |
| D-16 | FR-16 is redefined around **external draining**, with no credit penalty. The PRD's "parasite" rule (low share served to others) is dropped: under D-04 owners use their own keys first, so a low share is expected. A key counts as drained on a day when it hits its daily limit after Key Collective sent it under 50 % of that limit. A key drained on 5 of the last 7 days is marked `DRAINED`: it stops counting toward its owner's vesting cap until it has 3 consecutive clean days. Credit, debt and the owner's own use of the key are never affected; lending is always capped at the key's learned capacity. `HERO` is a badge only. | Owner |
| D-18 | Steps marked **Human** are done by the operator, not by HIVE builders. They are listed with their timing in **HIVE execution (v3)**. | Default |
| D-19 | One migration file per WP, numbered in advance (section 10.3), so WPs running in parallel never edit the same migration and application order is fixed. | Default |
| D-20 | HIVE stages: `0|1|2,3,4,5|6` with overrides v1 WP 1.0 (done) and v1 WP 6.1 (done) → stage 0, WP-1.4 → stage 1, WP-8.1, WP-7.7, WP-8.2, WP-8.7 → stage 3. | Default |
| D-17 | Key deletion is a soft delete (`status='REVOKED'`), so the 30-minute rotation grace and 14-day tombstone (FR-08) have a row to act on. | Default |
| D-21 | Existing COMMUNITY keys whose owner has no community rights (Google-only under D-05) keep serving their owner, are never lent to other tenants until the owner links GitHub and passes the Sybil check, and the owner is told once. | Default (v2) |
| D-22 | Legacy API routes (apex and console `/v1/*`, path aliases) keep working after `api.*` becomes canonical, with `Deprecation`, `Sunset` and `Link` headers and a `legacy_route_hit` counter. They are removed after the sunset date (default: R2 deploy + 30 days) **and** 14 consecutive days of zero hits. | Default (v2) |
| D-23 | `ROUTING_ENGINE` (`legacy` \| `leases`) selects the routing path; default `legacy` in production until the phase 4 soak passes. Rollback is a config-only deploy. | Default (v2) |
| D-24 | `COMMONS_ENFORCEMENT` (`observe` \| `enforce`, default `observe`), optionally narrowed with `COMMONS_ENFORCE_RULES`, controls brake, eye-for-eye, share cap and jail. Observe for at least 7 days on production traffic before enforcing. | Default (v2) |
| D-25 | Apex redirects to the console use `301` for GET/HEAD and `308` for other methods. | Default (v2) |
| D-26 | Every migration is compatible with the release that is running when it applies (migrations run before the Worker deploy). Destructive schema changes ship one release after the code stopped using the old shape. | Default (v2) |
| D-27 | Legacy GitHub-only accounts get a 30-day notice after the claim flow (WP-3.5) ships; unclaimed accounts are suspended by WP-7.2. | Default (v2) |

---

## 2. Foundations (cross-cutting designs)

Unchanged from v1 except the **v2 rollout** notes at the top of 2.1–2.4, which take precedence over the text below them.

### 2.1 Host topology: all API traffic on `api.key-col.axe08.tech/v1` (N-02, D-01)

**v2 rollout.** The routing tables below are the end state after WP-7.1. WP-2.7 makes `api.*` canonical and keeps the legacy routes answering, with `Deprecation`/`Sunset` headers and a hit counter, until the sunset (D-22). The apex redirect is `301` for GET/HEAD and `308` for other methods (D-25).

**Today.** The OpenAI-compatible handler is reachable on at least five host/path combinations, chosen ad hoc:

| Where | How it reaches the chat handler | Evidence |
| --- | --- | --- |
| `api.*` | Intended path | `gateway/main_worker.ts` step 9 |
| `console.*/v1/*` | Explicit branch forwards `/v1/` and `/api/` to the router | `main_worker.ts` step 4 |
| apex `key-col.axe08.tech` | Anything that is not `GET /` falls through to the router | `main_worker.ts` step 9 |
| `dev.key-col.axe08.tech` | Classified as `apex` by prefix matching | `gateway/subdomain.ts` |
| Path aliases | `/chat/completions`, `/v1/route`, `POST /`, `/models`, `/models/:id`, `/report`, `/demo/token`, `/api/demo/token` | `core/dispatcher.ts` |
| `/v1/keys`, `/v1/metrics`, `/v1/capacity` | Raw forwarding into the tenant DO (see N-01) | `dispatcher.ts:247-258` |
| UI | Playground and docs default to `https://key-col.axe08.tech/v1/chat/completions` (apex) | `ui/src/App.svelte:69` |
| OpenAPI | `servers[0]` is the apex, `servers[1]` the console | `worker/openapi_spec.ts:25-33` |

**Target routing table.** Exact hostname match; anything unlisted returns `404` with no body detail.

| Host | Serves | Auth | CORS |
| --- | --- | --- | --- |
| `api.key-col.axe08.tech` | `POST /v1/chat/completions`, `GET /v1/models`, `GET /v1/models/{id}`, `GET /v1/health`, `GET /v1/openapi.json` | Bearer API key only (`kc_live_…`, `kc_demo_…`). Cookies ignored. | `Access-Control-Allow-Origin: *`, `Allow-Headers: authorization, content-type`, no credentials |
| `console.key-col.axe08.tech` | SPA assets; `/api/*` dashboard API (includes `/api/demo/token`, `/api/playground/token`) | `kc_session` cookie | None (same-origin only) |
| `admin.key-col.axe08.tech` | Admin SPA; `/api/admin/*` | `kc_admin_session` cookie + admin role | None |
| `key-col.axe08.tech` (apex) | `301` → `https://console.key-col.axe08.tech{path}` for every path | — | — |

**Implementation**

1. `wrangler.jsonc`: add `vars` per environment:
   ```jsonc
   "vars": { "API_HOST": "api.key-col.axe08.tech", "CONSOLE_HOST": "console.key-col.axe08.tech",
             "ADMIN_HOST": "admin.key-col.axe08.tech", "APEX_HOST": "key-col.axe08.tech" }
   ```
   `env.dev`: `api-dev.…`, `console-dev.…`, `admin-dev.…`, plus matching `routes` with `custom_domain: true`. Add `POOL_COORDINATOR` to both env-specific DO binding lists (it is missing from `env.dev` and `env.production` today).
2. Replace `parseSubdomain` prefix matching with `resolveHost(hostHeader, env): "api" | "console" | "admin" | "apex" | "unknown"` doing exact, port-stripped, lower-cased comparison against the four vars. `.dev.vars` sets `api.localhost:8787` etc. (browsers and curl ≥ 7.78 resolve `*.localhost` to loopback).
3. Split `MainWorker.fetch` into four small handlers: `ApiHost`, `ConsoleHost`, `AdminHost`, `ApexHost`. Each owns its route table; no fall-through between hosts. `OPTIONS` is answered per host (only `ApiHost` returns CORS headers).
4. New `src/worker/api/v1_router.ts` with a literal route table: `{ method, path, handler }`. Delete the alias branches from `core/dispatcher.ts` (`/chat/completions`, `/v1/route`, `POST /`, `/models*`, `/report`, `/demo/token`, `/api/demo/token`, `/v1/report`, `/v1/keys`, `/v1/metrics`, `/v1/capacity`). Delete `forwardToDO` (N-01).
5. `ConsoleHost` routes `/api/*` to the dashboard handler and never to the v1 router. `POST /api/demo/token` and `POST /api/playground/token` mint short-lived API keys that are then used against `api.*`.
6. `openapi_spec.ts`: single `servers: [{ url: "https://api.key-col.axe08.tech/v1" }]`; paths become `/chat/completions`, `/models`, …
7. UI: one constant `API_BASE_URL = import.meta.env.VITE_API_BASE_URL` (defaults per build mode). Playground, API docs, code snippets, copy-endpoint buttons, and README all use it. The Playground authenticates to `api.*` with a playground token (see 2.3), never with the console cookie.

**Tests** (`test/integration/hosts.test.ts`, Workers runtime, `SELF.fetch`)
- Route matrix: for each host × path in both tables above, assert the exact status (`200/401/404/301`). In particular: `POST https://console…/v1/chat/completions` → 404; `POST https://key-col.axe08.tech/v1/chat/completions` → 301 to console; `POST https://api…/chat/completions` → 404; `GET https://api…/api/keys` → 404; `GET https://api…/v1/keys` → 404.
- CORS: preflight on `api.*` returns `*`; preflight on `console.*` returns no CORS headers.
- Snapshot test on `openapi.json` asserting a single server URL.

**Done when** the route matrix passes and `grep -rn "key-col.axe08.tech" ui/src src` finds only the env/config definitions.

---

### 2.2 Credit Units replace microdollars (N-03, D-02, D-03)

**v2 rollout.** The migration below is the end state. v2 reaches it in three releases so the release that is still running during a deploy never touches a missing column (D-26): WP-2.1 adds the CU columns and writes both units (`0013_credit_units_expand.sql`); WP-6.5 stops using µ$; WP-7.3 drops the µ$ columns (`0023_credit_units_contract.sql`). Follow those WPs' SQL, not the block below. The "code sweep" paragraph is superseded by WP-2.1, WP-2.2 and WP-6.5.

**Why.** Nobody pays money. Pricing free-tier traffic at list prices (audit R7) produced "spend" that means nothing, and two parallel units (µ$ for cost, "micro-CU" for debt) made the economy unreadable. 78 source files and 844 occurrences reference microdollars today; 17 UI files do too.

**Definition.** One CU is the smallest indivisible unit of commons capacity. It is an integer and is never converted to money.

```
request_cu(model, usage) =
      model.cu_base
    + ceil( usage.prompt_tokens      × model.cu_in_per_1k     / 1000 )
    + ceil( usage.cached_tokens      × model.cu_cached_per_1k / 1000 )
    + ceil( (usage.completion_tokens + usage.reasoning_tokens) × model.cu_out_per_1k / 1000 )
```

All operands are `bigint`; `ceil(a/b)` is `(a + b - 1n) / b`. The base term reflects the scarce **requests-per-day** budget of free-tier keys; the token terms reflect **tokens-per-minute** pressure.

**Starting weights** (stored per model in the code catalog `router/registry/catalog.ts`; tune from observed data after launch):

| Model class | Examples | `cu_base` | `cu_in_per_1k` | `cu_cached_per_1k` | `cu_out_per_1k` |
| --- | --- | --- | --- | --- | --- |
| Gemini Flash-Lite | `gemini-*-flash-lite` | 5 | 1 | 0 | 2 |
| Gemini Flash | `gemini-2.5-flash`, `gemini-*-flash` | 10 | 1 | 0 | 4 |
| Gemini Pro | `gemini-*-pro*` | 50 | 5 | 1 | 20 |
| Groq small | `llama-3.1-8b-instant` | 5 | 1 | 0 | 1 |
| Groq large | `llama-3.3-70b-versatile`, `openai/gpt-oss-120b` | 10 | 2 | 0 | 4 |

A typical Flash call with 1,000 prompt and 500 completion tokens costs `10 + 1 + 2 = 13 CU`.

**Pre-flight reservation.** Before dispatch, TenantQuotaDO reserves `estimate_cu = request_cu(model, {prompt: estimated_prompt_tokens, completion: max_tokens ?? 1024})`. After the response it settles with the actual usage (refunding the difference). If a streamed response carries no usage block, completion tokens are estimated as `ceil(streamed_chars / 4)` and the ledger row is flagged `usage_estimated = 1`.

**What changes where**

| Area | Before | After |
| --- | --- | --- |
| Constants | `constants/financial.ts` (`MICRODOLLAR_MULTIPLIER`, `dollarsToMicrodollars`, `microdollarsToDollars`) | `constants/credits.ts` (`CU` type alias `bigint`, `ceilDiv`, `formatCu`) — financial.ts deleted |
| Model definitions (code catalog) | `inputCostPerMTokMicro`, `outputCostPerMTokMicro`, `cacheReadCostPerMTokMicro` | `cuBase`, `cuInPer1k`, `cuCachedPer1k`, `cuOutPer1k` |
| Registry | `calculateCost(model, usage): bigint µ$` | `calculateCu(model, usage): bigint CU` |
| `cost_ledger` | `cost_microdollars` | `cu`, `usage_estimated`, `borrowed` (0/1), `lender_tenant_id` |
| `daily_spend_rollup` | `total_cost_microdollars` | table renamed `daily_cu_rollup`, column `total_cu` |
| `auth_tokens` | `budget_microdollars`, `spent_microdollars` | `budget_cu` (nullable = unlimited), `spent_cu` |
| `contributor_standing` | `community_debt_micro_cu`, `daily_contributed_cu` | `community_debt_cu`, `contributed_cu_24h` (mirror), `multiplier_pct` |
| TenantQuotaDO | `totalCostMicrodollars`, `communityDebtMicroCu` | `cuUsed24h`, `communityDebtCu`, hourly `contributedBuckets` |
| Response headers | `x-kc-cost-microdollars` (non-stream only) | `x-kc-cu` on non-stream; final SSE event `event: kc.usage` with `{cu}` on streams |
| Response body | `cost_microdollars` | `usage.kc_cu` (extension field inside the OpenAI `usage` object) |
| Telemetry | `doubles[0] = Number(costMicrodollars)` | `doubles[0] = Number(cu)` (safe: CU values are far below 2^53) |
| UI | `formatMicrodollars`, "$" spend ring, PricingTable in $ | `formatCu`, "CU today / CU allowance" ring, CU weight table |

**Migration** — `0012_credit_units.sql` (see Appendix C):
```sql
ALTER TABLE cost_ledger RENAME COLUMN cost_microdollars TO cu;
ALTER TABLE cost_ledger ADD COLUMN usage_estimated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cost_ledger ADD COLUMN borrowed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cost_ledger ADD COLUMN lender_tenant_id TEXT;
ALTER TABLE daily_spend_rollup RENAME TO daily_cu_rollup;
ALTER TABLE daily_cu_rollup RENAME COLUMN total_cost_microdollars TO total_cu;
ALTER TABLE auth_tokens RENAME COLUMN budget_microdollars TO budget_cu;
ALTER TABLE auth_tokens RENAME COLUMN spent_microdollars TO spent_cu;
ALTER TABLE contributor_standing RENAME COLUMN community_debt_micro_cu TO community_debt_cu;
-- model_registry is not migrated: the code catalog becomes the only source and the table is dropped in 0016 (WP-1.4).
-- Historical rows: old µ$ values are meaningless as CU. Recompute from token columns:
UPDATE cost_ledger SET cu = 10 + ((prompt_tokens + 999) / 1000) + (((completion_tokens + reasoning_tokens) * 4 + 999) / 1000);
UPDATE auth_tokens SET budget_cu = NULL, spent_cu = 0;   -- budgets were in $; reset
DROP VIEW IF EXISTS cost_ledger_events;  DROP VIEW IF EXISTS daily_spend_rollups;  DROP VIEW IF EXISTS model_defs;
```
(The compatibility views in `0001` reference the old names; they are dropped, not recreated.)

**Code sweep procedure** (mechanical, one PR): rename types and fields with the TypeScript compiler as the checklist (`tsc --noEmit` must reach zero errors); then `grep -rniE "micro|dollar|\\$[0-9]|usd" src ui/src` must return only the migration history. Update `GEMINI.md` and `CONTEXT.md` invariant #4 to "Integer Credit Units: all capacity accounting is `bigint` CU; no floating point; no currency".

**Tests**
- `test/unit/credits/request_cu.test.ts`: table-driven over every catalog model; boundary cases (0 tokens → `cu_base`; 1 token → base + 1; 999/1000/1001 tokens), `ceilDiv` correctness, `bigint` only (a test asserts `typeof result === "bigint"`).
- Property test (fast-check): `request_cu` is monotonic in each token count.
- Integration: a non-streaming completion returns `x-kc-cu` equal to the recomputed value from `usage`; a streaming completion ends with a `kc.usage` event (added by WP-2.3); `cost_ledger.cu` matches.
- `test/integration/schema_conformance.test.ts` (see 2.5) covers the renamed columns.

**Done when** no identifier, column, header, or UI string mentions dollars or microdollars, and the ledger/standing/budget code paths all use CU.

---

### 2.3 Identity, pool rights and sessions (D-05, D-08, D-10; audit S2, S3, S8, S9, S10, S12, F1, F3, F4, C1–C3)

**v2 rollout.** Console `/api/*` accepts the session cookie and the legacy bearer token side by side from WP-3.1 until WP-7.2. GitHub-only legacy accounts get the claim flow (WP-3.5) first and are suspended only in WP-7.2, after the notice period (D-27). Existing `auth_tokens` are **not** expired again: OP-0.11 already expired every token issued before the hotfix, and API keys created since are legitimate.

**Data model** — migration `0013_identity.sql`:
```sql
CREATE TABLE user_identities (
  user_id     TEXT NOT NULL REFERENCES users(id),
  provider    TEXT NOT NULL CHECK (provider IN ('google','github')),
  subject     TEXT NOT NULL,            -- Firebase uid / GitHub numeric id
  username    TEXT,                     -- GitHub login
  email       TEXT,
  profile_json TEXT NOT NULL DEFAULT '{}',-- account age, repos, contributions at link time
  linked_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, subject)
);
CREATE UNIQUE INDEX idx_identity_user_provider ON user_identities(user_id, provider);
CREATE TABLE sessions (
  id_hash     TEXT PRIMARY KEY,          -- SHA-256 of the cookie value
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('console','admin')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  ip_address  TEXT, user_agent TEXT, revoked_at TEXT
);
ALTER TABLE users ADD COLUMN community_eligible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN sybil_assessed_at TEXT;
ALTER TABLE users ADD COLUMN registration_status TEXT NOT NULL DEFAULT 'PENDING_CONSENT'
  CHECK (registration_status IN ('PENDING_CONSENT','ACTIVE','SUSPENDED'));
```

**Pool rights (single function, used everywhere)** — `src/auth/rights.ts`:
```ts
export interface PoolRights { privatePool: boolean; communityPool: boolean; reason?: string }
export function poolRights(u: UserRow, ids: IdentityRow[]): PoolRights {
  const google = ids.some(i => i.provider === "google");
  const github = ids.some(i => i.provider === "github");
  if (u.registration_status !== "ACTIVE" || u.is_quarantined) return { privatePool: false, communityPool: false, reason: "inactive" };
  return { privatePool: google, communityPool: google && github && u.community_eligible === 1 };
}
```
Enforced in: `POST /api/keys` (COMMUNITY requires `communityPool`; any key requires `privatePool`), `PATCH /api/keys/:id/pool-mode`, `GET /api/pool/telemetry` and `GET /api/pool/contribution` (community pool health is visible only with `communityPool`; D-05), and the coordinator borrow path (a tenant without `communityPool` never receives a lease, not even for its own COMMUNITY keys — it cannot have any). Rights are cached in the API-key auth context for 60 s.

**Flows**

1. **Google sign-in (base account).** Client: Firebase `signInWithPopup` → `user.getIdToken()` → `POST /api/auth/google { idToken }`. Server: verify the JWT with `jose` (`createRemoteJWKSet("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")`, `issuer = https://securetoken.google.com/<FIREBASE_PROJECT_ID>`, `audience = <FIREBASE_PROJECT_ID>`, `email_verified === true`). Upsert `users(id = "usr_goog_" + sub)` and `user_identities('google', sub)`. If `registration_status = 'PENDING_CONSENT'`, respond `{ next: "consent" }` and set a 15-minute `kc_pending` cookie; otherwise create a session.
2. **Registration consent (C1–C3, AC-15).** `POST /api/auth/consent { c1: true, c2: true, c3: true }` with `kc_pending`. Missing any → `422 { error: "consent_required", missing: [...] }`. Writes three `consent_attestations` rows (`event_type='REGISTRATION'`, `checkbox_id`, `ip_address = cf-connecting-ip`, `user_agent`, `consent_version`) and flips `registration_status` to `ACTIVE`, then sets `kc_session`.
3. **GitHub link (community unlock).** Signed-in user → `GET /api/auth/github/start` → server creates `state` (32 random bytes) and a PKCE verifier, stores `{state, verifier, user_id, exp}` in a signed, HttpOnly, 10-minute cookie `kc_oauth` (HMAC with `SESSION_SIGNING_KEY`), redirects to GitHub with `state` and `code_challenge` (if GitHub rejects PKCE for OAuth apps, the `state` check alone is still mandatory). Callback `GET /api/auth/github/callback`: verify cookie signature, expiry and `state`; exchange `code` using `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` from env; fetch `/user` plus GraphQL `contributionsCollection`; reject if that GitHub id is already linked to another user (`409`). Run the existing Sybil engine (`src/auth/sybil/engine.ts`, all five layers: Turnstile token carried in the start request, /24 subnet velocity, email, account age ≥ 30 days / ≥ 1 repo / ≥ 5 contributions, datacenter ASN). Score ≥ 65 → `community_eligible = 1`; 40–64 → linked but not eligible (probationary); < 40 → link refused. Redirect to `https://console…/settings?github=linked` — **no token in the URL, no `postMessage`**.
4. **Sessions.** `kc_session` = 32 random bytes, base64url; only its SHA-256 is stored. Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1209600` on the console host only (no `Domain` attribute, so it never reaches `api.*`). State-changing `/api/*` requests also require `x-kc-csrf` equal to a per-session CSRF token served by `GET /api/session`.
5. **API keys for `/v1`.** Created in the console (`POST /api/tokens`), shown once, hash stored in `auth_tokens`. The auth middleware accepts only these. `KC_MASTER_KEY` is never accepted as a credential (S10).
6. **Playground and demo tokens.** `POST /api/playground/token` (session) mints a `kc_live_` key scoped to the user, TTL 15 min, `rpm_limit = 10`. `POST /api/demo/token` (no session, Turnstile) mints a `kc_demo_` key (existing DemoDO limits 3 RPM / 25 RPD per IP) bound to the demo pool (WP-4.5).
7. **Admin.** Admin role is granted only by `wrangler d1 execute` (documented in the runbook), never by an API. `admin.*` requires a `kc_admin_session` created by the same Google flow, plus `users.role = 'admin'`, plus the email in `ADMIN_EMAILS`. `ADMIN_TOKEN` remains only for CLI break-glass calls with `x-kc-admin-token`, and is rejected if the request carries a browser `Origin`.

**Data migration of existing accounts**
- `usr_goog_*` users: keep; insert their `google` identity row; set `registration_status = 'PENDING_CONSENT'` so they re-attest C1–C3 on next login.
- `gh_*` and `usr_gh_*` users: cannot be mapped to a Google account. Mark `registration_status = 'SUSPENDED'`. Their `api_keys` rows are left intact but excluded from routing; a one-time claim flow (`POST /api/auth/claim-legacy` after Google sign-in + GitHub link with the same GitHub id) re-parents keys to the new `usr_goog_*` id and re-encrypts them under the new tenant subkey.
- (v2) Not repeated: OP-0.11 already expired every token issued before the hotfix.

**Tests**
- See v1 WP 0.2 (done), WP-3.1.

---

### 2.4 Communal routing through the coordinator (D-04, D-13; audit 9.3, FR-04, R13, FR-02, FR-16, FR-19, FR-12, FR-20, FR-05/23)

**v2 rollout.** Built behind `ROUTING_ENGINE` (D-23): `legacy` keeps today's KeyPoolDO routing, `leases` uses this design; WP-7.5 deletes the legacy engine. The `eyeForEye`, `jailed` and `braked` checks in step 2c go through `commonsEnforcement()` (WP-5.1), which only records would-be refusals until the operator switches to `enforce` (D-24).

**Ownership of state**

| State | Owner | Why |
| --- | --- | --- |
| Own PRIVATE keys: list, circuit breaker, RPM/RPD counters | Tenant `KeyPoolDO` | Only the owner ever uses them |
| Every COMMUNITY key (including the owner's own): status, observation, cooldown, RPM/RPD counters, dispatch counters, hero/parasite | `PoolCoordinatorDO` shard for its provider | A shared key's limits are global (fixes R13) |
| Borrower debt, contribution, multiplier, RPM/RPD | Borrower/lender `TenantQuotaDO` | Per-tenant accounting |
| Source of truth for key existence, owner, pool_type, status | D1 `api_keys` | Survives DO resets; queried by the UI |

**Request sequence** (`POST /v1/chat/completions`, after auth):

```
1. TenantQuotaDO(t).reserve(estimate_cu)                      → 429 rate_limited / quota_exhausted
2. for provider in candidate providers (cheapest capable model first):
   a. KeyPoolDO(t).leasePrivate(provider)                      → own PRIVATE key, or none
   b. Coordinator(provider).lease({ tenant: t, ownOnly: true })→ own COMMUNITY key, or none   (no debt)
   c. if rights.communityPool && eyeForEye(t, provider) && !jailed(t) && !braked(t):
        Coordinator(provider).lease({ tenant: t, ownOnly: false, estimate_cu })
                                                              → other's COMMUNITY key (debt)
   d. none → next candidate model/provider
3. dispatch upstream with the leased key
4. settle (ctx.waitUntil):
   - lease source a: KeyPoolDO(t).settle(leaseId, status, cu)
   - lease source b/c: Coordinator(provider).settle(leaseId, status, cu)
   - source c only: TenantQuotaDO(t).accrueDebt(cu, leaseId); TenantQuotaDO(owner).credit(cu, leaseId)
   - TenantQuotaDO(t).settle(reservationId, cu)
   - cost_ledger row { cu, borrowed, lender_tenant_id }
5. all candidates exhausted → 429 with code `quota_jail` (if jailed), `pool_exhausted`, or `emergency_brake`
```

`leaseId` makes every settlement idempotent (DO-side `settled_leases` table with 24 h TTL), so a retried `waitUntil` never double-charges.

**Coordinator internals** (`src/pool/coordinator_do.ts`, uses the DO's SQLite storage via `ctx.storage.sql` — the class is already declared in `new_sqlite_classes`):

```sql
CREATE TABLE IF NOT EXISTS keys (
  key_id TEXT PRIMARY KEY, owner TEXT NOT NULL, provider TEXT NOT NULL,
  status TEXT NOT NULL,                  -- OBSERVATION | ACTIVE | COOLDOWN | QUARANTINED | REVOKED
  observation_until INTEGER, cooldown_until INTEGER, reactivate_at INTEGER,
  rpm_limit INTEGER NOT NULL, rpd_limit INTEGER NOT NULL,
  minute_bucket INTEGER NOT NULL DEFAULT 0, minute_count INTEGER NOT NULL DEFAULT 0,
  day_bucket TEXT NOT NULL DEFAULT '', day_count INTEGER NOT NULL DEFAULT 0,
  dispatched_today INTEGER NOT NULL DEFAULT 0, dispatched_communal INTEGER NOT NULL DEFAULT 0,
  classification TEXT, priority_boost INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS leases (lease_id TEXT PRIMARY KEY, key_id TEXT, tenant TEXT, borrowed INTEGER, est_cu INTEGER, created_at INTEGER, settled_at INTEGER);
CREATE TABLE IF NOT EXISTS borrower_window (tenant TEXT, minute INTEGER, cu INTEGER, PRIMARY KEY (tenant, minute));
CREATE TABLE IF NOT EXISTS brakes (tenant TEXT PRIMARY KEY, until INTEGER);
```

RPC methods (native DO RPC, typed; the HTTP `fetch` surface is removed): `lease`, `settle`, `upsertKey`, `removeKey`, `setStatus`, `stats`, `reconcile`. The `alarm()` runs every 60 s: promote observation keys whose `observation_until` has passed, reactivate cooled-down keys at `reactivate_at`, clear expired brakes and old `borrower_window` rows, and every 5 minutes reconcile against D1 (`SELECT … FROM api_keys WHERE pool_type='COMMUNITY' AND provider=?`).

**Selection** inside `lease(ownOnly=false)`:
1. Candidates: `status='ACTIVE'`, `owner != tenant`, `minute_count < rpm_limit`, `day_count < rpd_limit`, not in cooldown.
2. Drop owners over the share cap (FR-12, WP-5.7).
3. Score = `priority_boost` (owner debt boost, hero/parasite adjustment) + headroom (`rpd_limit − day_count`); pick the maximum and break ties round-robin with a rotating cursor, so load spreads across contributors.
4. Increment counters in the same synchronous SQL transaction (DO input gates make this race-free).

**Events that update the coordinator** (called from the worker, awaited, errors surfaced):

| Event | Call |
| --- | --- |
| Key added as COMMUNITY | `upsertKey(status='OBSERVATION', observation_until)` |
| Pool mode PRIVATE→COMMUNITY | `upsertKey(status='OBSERVATION')`; KeyPoolDO removes it from private list |
| Pool mode COMMUNITY→PRIVATE | `removeKey`; KeyPoolDO adds it to private list |
| Delete / takedown / revocation | `removeKey` (+ tombstone flow) |
| Upstream 401/403 | `setStatus('QUARANTINED')` + D1 update + notification |
| Upstream 429 | `setStatus('COOLDOWN', until)` (RPM) or `setStatus('COOLDOWN', next reset + jitter)` (RPD) |

**Tests**
- See WP-4.1.

---

### 2.5 Test strategy and harness (T-01…T-09)

**Findings about the current suite** (new IDs used in Appendix B):

| ID | Finding |
| --- | --- |
| T-01 | 15 test files use hand-rolled D1 mocks whose `run()` returns `{ success: true }` for any SQL (e.g. `test/abuse_routes.test.ts:24-48`). Schema errors are invisible. |
| T-02 | Only `migrations/0003` is executed against real SQLite (`tests/storage/migrations.test.ts`). |
| T-03 | 17 co-located `src/**/*.test.ts` files (386 tests) are excluded from the root Vitest config; UI tests (40) are outside `npm run gate`. |
| T-04 | Tests assert stub behaviour as if it were a feature: `tests/admin/admin_router.test.ts:161-188` "overrides provider circuit state" and "engages edge freeze" only check the echoed JSON. |
| T-05 | Tests assert production acceptance of Turnstile fixtures: `test/abuse_routes.test.ts:186`, `tests/auth/sybil.test.ts:62,642,670`. |
| T-06 | Duplicate suites inflate counts: `src/auth/oauth.test.ts` ≡ `tests/auth/oauth.test.ts` (27 identical tests of an unused module); `test/auth_middleware.test.ts` re-exports `test/unit/worker/auth_middleware.test.ts` (43 tests run twice). |
| T-07 | 38 Sybil tests and 54 OAuth tests exercise modules the Worker never calls. |
| T-08 | No test exercises `POST /api/keys`, `sync-session`, `pool-mode`, dashboard tenant resolution, or any flow through `MainWorker.fetch` with real DO classes. |
| T-09 | 9 of 15 PRD acceptance criteria have no test at all. |

**Harness** (v1 WP 1.0 (done) implements it):

- Add `@cloudflare/vitest-pool-workers` (compatible with the pinned Vitest 2.x). New `vitest.workers.config.ts`:
  ```ts
  import path from "node:path";
  import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
  export default defineWorkersConfig(async () => {
    const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
    return { test: {
      include: ["test/integration/**/*.test.ts", "test/do/**/*.test.ts"],
      setupFiles: ["./test/setup/apply-migrations.ts"],
      poolOptions: { workers: {
        singleWorker: true,
        wrangler: { configPath: "./wrangler.jsonc", environment: "test" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, KC_MASTER_KEY: "test-master-key-please-rotate",
                                 SESSION_SIGNING_KEY: "test-signing", TURNSTILE_SECRET: "test-secret",
                                 API_HOST: "api.test", CONSOLE_HOST: "console.test", ADMIN_HOST: "admin.test", APEX_HOST: "apex.test" } },
      } },
    } };
  });
  ```
  `test/setup/apply-migrations.ts`: `await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)`.
- Outbound HTTP (Gemini, Groq, Google JWKS, GitHub, Turnstile siteverify) is mocked with `fetchMock` from `cloudflare:test` — the only permitted mock in integration tests. A helper `mockUpstream({ provider, status, body, sse })` builds realistic provider responses, including Gemini's `google.rpc.ErrorInfo` bodies.
- DOs are real (`runInDurableObject`, `runDurableObjectAlarm` for alarms).
- **Test locations and commands.** Node tests (no Workers runtime) live under `test/unit/**` or beside the code in `src/**`, and run with `npx vitest run <file>`. Tests that need D1, a DO, `SELF` or `fetchMock` live under `test/integration/**` or `test/do/**` and always run with `npx vitest run -c vitest.workers.config.ts <file>`. A verify command that finds no test files is a failure, never a pass (both configs set `passWithNoTests: false`). New tests are never added under the legacy `tests/` tree or `test/` top level.
- **Rule (enforced by lint script `scripts/check-no-sql-mocks.mjs` in the gate):** no test file under `test/` or `src/` may define an object with a `prepare` property typed as `D1Database`, except `test/unit/**` for pure functions that never touch SQL.
- **Schema conformance test** (`test/integration/schema_conformance.test.ts`): calls every repository method and every handler that writes SQL against the migrated DB with valid inputs and asserts no exception and the expected row. This is the net that would have caught D1, D2, D4, D5.
- **Security regression suite** (`test/integration/security/*.test.ts`): one named test per S-finding and N-01, each written against the old code first to demonstrate the exploit, then kept as a regression test.

**Gate** (WP-8.6): `gate:fast` (typecheck root + UI `svelte-check`, unit tests, lint rule) < 10 s; `gate` = `gate:fast` + workers integration + UI tests, run in CI on every PR.

---

---

## Phase 1 — Groundwork

**Release R1. User-visible change: none** (the provider catalog loses models that could never be routed; the typed client changes error display only).

**Goal:** make the next releases safe: a test clock for time-based tests, readers that accept both old and new data shapes, a backup before every migration, a trimmed provider catalog, and a UI client that reports errors honestly.

**Compatibility:** migration `0012_catalog_cleanup.sql` drops `model_registry` and its `model_defs` view. No running code reads them (checked on `hive/stage-0`: the only importer of the repository is the unused `src/storage/index.ts` barrel), so R0 keeps working after the migration.

**Rollback:** redeploy R0; it does not read the dropped table.

### WP-1.1 Deterministic test clock for Durable Objects (v1 2.0)

**Depends on:** none

**Findings:** prerequisite for the time-based tests of FR-05, FR-07, FR-13, FR-20, FR-21, AC-05, AC-06 and AC-12.

**Implementation**
1. `src/utils/clock.ts`: `export interface Clock { now(): number }` and `systemClock`. `KeyPoolDO`, `TenantQuotaDO`, `PoolCoordinatorDO`, `DemoDO` and the lease orchestrator receive a `Clock` and never call `Date.now()` directly in lease, window, backoff or alarm code.
2. When `env.KC_ENV === "test"`, each of those DOs exposes an RPC method `setClockForTest(ms: number)` that switches it to a fixed clock; in any other environment the method throws.
3. Test helper `test/helpers/clock.ts`: `advance(stub, ms)` sets the clock and then calls `runDurableObjectAlarm(stub)` from `cloudflare:test`.
4. `vitest.workers.config.ts` binds `KC_ENV: "test"`; `wrangler.jsonc` never sets it.

**Legacy tests (Appendix B):** none.

**Tests** (`test/do/clock.test.ts`)
- A DO in the test environment reports the time set by `setClockForTest`.
- `setClockForTest` throws when `KC_ENV` is not `test`.
- `advance()` fires a DO alarm scheduled for the new time.

### WP-1.2 Tolerant readers for key status, pool type and timestamps

**Depends on:** none

**Findings:** D11, D13 (reader half); v2 review P2-01.

**Problem.** Migration `0014_schema_repair.sql` (WP-2.6) rewrites `api_keys.status` to upper-case values and converts the `api_keys` time columns to INTEGER epoch milliseconds; migration `0016_projects.sql` (WP-3.7) converts `projects` timestamps from seconds to milliseconds. `deploy-prod.yml` applies migrations **before** it deploys the Worker, so the release that is still serving traffic reads the new shapes for the length of the deploy. Today `KeyPoolDO` loads keys with `status = 'Healthy'`: without this WP, key routing stops during that window.

**Implementation**
1. `src/contracts/keys.ts` (a 1-line file today) exports `KeyStatus` (`HEALTHY`, `COOLDOWN`, `QUARANTINED`, `REVOKED`), `PoolType` (`PRIVATE`, `COMMUNITY`), and:
   - `normaliseKeyStatus(raw: string | null, communityRoutingStatus?: string | null): KeyStatus` — `Healthy`/`healthy`/`HEALTHY` → `HEALTHY`; `invalid` → `REVOKED` when `communityRoutingStatus = 'REVOKED'`, else `QUARANTINED`; `quarantined`/`QUARANTINED` → `QUARANTINED`; `exhausted`/`rate_limited`/`COOLDOWN` → `COOLDOWN`; `REVOKED` → `REVOKED`; anything else → `QUARANTINED` (fail closed).
   - `normalisePoolType(raw: string | null): PoolType` — case-insensitive; `null` → `PRIVATE`.
2. `src/utils/time.ts` exports `toEpochMs(value: unknown): number | null`: integers ≥ 1e12 are milliseconds, smaller non-negative integers are seconds, numeric strings are parsed as numbers first, ISO-8601 strings via `Date.parse`; anything else → `null`.
3. Every reader of `api_keys.status`, `api_keys.pool_type`, the `api_keys` time columns (`observation_until`, `circuit_open_until`, `last_used_at`, `revoked_at`, `created_at`) and `projects.created_at` / `updated_at` goes through these helpers. Known readers: `src/durable_objects/key_pool/key_pool_do.ts` (the D1 load query becomes `WHERE upper(status) = 'HEALTHY'`), `src/worker/router/dashboard/keys/get_keys.ts`, `src/worker/router/dashboard/keys/ops.ts`, `src/worker/router/dashboard/keys/post_key.ts`, `src/worker/router/dashboard/abuse_routes.ts`, `src/worker/gateway/admin_handler.ts`, `src/worker/pool_routes.ts`, `src/storage/repositories/api_keys/*`, and the projects handlers (find them with `grep -rln "FROM projects" src`).
4. Writers are unchanged in this WP. WP-2.6 switches writers to the canonical values in the same release as its migration.

**Legacy tests (Appendix B):** none.

**Tests** (`test/unit/pure/key_status.test.ts`, `test/integration/keys/tolerant_readers.test.ts`)
- `normaliseKeyStatus` maps every legacy value listed above and returns `QUARANTINED` for an unknown value.
- `toEpochMs` returns the same instant for epoch seconds, epoch milliseconds and an ISO-8601 string, and `null` for garbage.
- A `KeyPoolDO` whose tenant has one key stored as `'Healthy'` and one stored as `'HEALTHY'` loads and serves both.
- `GET /api/keys` returns identical status and timestamps for a row in the legacy shape and the same row in the migrated shape.
- A project stored with epoch-second timestamps and one stored with epoch-millisecond timestamps render the same dates from the projects API.

**Done when** both shapes of every column that WP-2.6 and WP-3.7 migrate are read identically, and `grep -rn "'Healthy'" src` finds only `src/contracts/keys.ts`.

### WP-1.3 Migration safety net

**Depends on:** none

**Findings:** N-05, T-02, D10, D14, D15; v2 review P2-10, P2-12.

**Problem.** Phase 2 rebuilds `api_keys` and phase 7 drops columns, but the production deploy has no backup step and only one migration is ever executed in a test. Migration numbers in v1 did not follow execution order.

**Implementation**
1. `.github/workflows/deploy-prod.yml`: immediately before `npx wrangler d1 migrations apply key-collective-d1 --remote`, add a step that runs `npx wrangler d1 export key-collective-d1 --remote --output backups/d1-${{ github.sha }}.sql` and uploads the file with `actions/upload-artifact` (retention 30 days). The job fails if the export fails.
2. `test/integration/migrations.test.ts` (Workers pool) applies every file in `migrations/` in order: once to an empty database, once on top of `test/fixtures/prod_shape.sql` (status values `Healthy`, `healthy`, `invalid`, `quarantined`; epoch-second `projects` timestamps; ISO time strings in `api_keys`; one `default`-tenant row). Every later WP that adds a migration adds its assertions to this file.
3. Move `migrations/0010_purge_all_keys.sql` to `scripts/qa/purge_all_keys.sql` with a runner `scripts/qa/purge_all_keys.mjs` that refuses to run when the target database is `key-collective-d1` (D10). Databases that already applied 0010 are unaffected.
4. Delete `src/storage/migrations/` (D15); `migrations/` is the only source.
5. Move `scripts/seed.sql` to `scripts/dev/seed.sql`, seeding `usr_goog_dev_alice` and `usr_goog_dev_bob` and no `default`-tenant rows; `seed_local.mjs` refuses `--remote` (D14).
6. New migrations use the numbers in section 10.3, which follow execution order.
7. **Human (before phase 2 starts):** call `POST /api/admin/maintenance/backfill-key-hash` once in production (v1 WP 0.4 step 2) and confirm `SELECT COUNT(*) FROM api_keys WHERE key_hash IS NULL` returns 0. WP-7.7 deletes the route.

**Legacy tests (Appendix B):** `tests/storage/migrations.test.ts` (replaced by `test/integration/migrations.test.ts`; delete it).

**Tests**
- All migrations apply cleanly to an empty database.
- All migrations apply cleanly on top of the production-shaped fixture.
- `migrations/` contains no purge migration, and `scripts/qa/purge_all_keys.mjs` exits non-zero when pointed at `key-collective-d1`.
- `test/unit/pure/deploy_workflow.test.ts` asserts that the D1 export step appears before the migrations-apply step in `deploy-prod.yml`.

**Done when** the deploy workflow backs up D1 before every migration and the migration test covers every file in `migrations/`.

### WP-1.4 Providers and model catalog (v1 3.4)

**Depends on:** none

**Findings:** R5, R6, D-06; README aliases that do not exist.

**Implementation**
1. `src/providers/config.ts` becomes the single provider list: `google` (base `https://generativelanguage.googleapis.com/v1beta/openai`) and `groq` (`https://api.groq.com/openai/v1`). Delete `openai`, `anthropic`, `deepseek`, `cohere`, `mistral`, `together` from `DEFAULT_PROVIDER_BASE_URLS` and the fallback URL guess in `upstream/urls.ts` (`https://api.${provider}.com/v1`). Unknown provider → configuration error. Existing `api_keys` rows with another provider stay in D1 untouched; routing skips them (they could never be routed).
2. Catalog (`router/registry/catalog.ts`) keeps only models callable with free-tier Gemini and Groq keys, keeping their current price fields (this WP runs before WP-2.1, which converts them to CU weights). Remove `gpt-4o*`, `claude-*`, `deepseek-chat`.
3. **Model id verification.** `scripts/verify_catalog.mjs` calls each provider's models endpoint with a staging key and fails if any catalog id is missing (e.g. `gemini-3.8-flash`, `qwen/qwen3.8-27b` flagged in the audit). Add a weekly, non-blocking CI job that runs it with a secret key. **Human:** run it with real keys after this WP merges and before WP-2.1 starts, and correct any ids it reports.
4. **Aliases** defined in the catalog and documented in README: `auto` (cheapest capable model across providers the tenant can get a lease for), `smart-fast` (Gemini Flash → Groq 70B), `coder-high` (Gemini Pro → Groq gpt-oss-120b), `open-groq` (Groq 70B → Groq 8B). `cerebras-speed` is removed.
5. Migration `0012_catalog_cleanup.sql`: `DROP VIEW IF EXISTS model_defs; DROP TABLE model_registry;` (no running code reads either; the only importer of the repository is the unused `src/storage/index.ts` barrel). Delete `src/storage/repositories/model_registry/*` and `tests/storage/repositories/modelRegistry.test.ts` in the same card. The code catalog is the only source; WP-2.1 adds the CU fields to `/v1/models`.
6. UI: provider selector already shows only Gemini and Groq; PricingTable becomes a CU weight table fed by `/v1/models` (WP-3.10).

**Legacy tests (Appendix B):** `tests/storage/repositories/modelRegistry.test.ts` (delete), `src/router/model_registry.test.ts`, `src/router/capability_filter.test.ts` (trimmed catalog, aliases).

**Tests**
- `/v1/models` lists only google/groq models.
- Every alias resolves to at least one catalog model.
- `auto` with a tenant holding only a Groq key routes to Groq without trying Gemini.
- Submission of `provider: "cerebras"` → 400.

### WP-1.5 Typed API client, honest errors (v1 4.1)

**Depends on:** none

**Findings:** F5, F1 follow-through, client-side stat recomputation (`api.ts:136-183`).

**Implementation**
- Shared contracts: `src/contracts/api/*.ts` (zod schemas for every `/api/*` response). The UI imports them (`ui/tsconfig` path alias) and validates responses in dev builds.
- New `ui/src/lib/api/client.ts`: `request<T>(schema, path, init)` with a pluggable auth transport (in phase 1 the existing bearer header; WP-3.4 switches it to `credentials: "same-origin"` plus `x-kc-csrf` on mutations), and a thrown `ApiError { status, code, message }` on any non-2xx. No function returns success on failure; `deleteKey`, `testKey`, `getKeys`, `getLogs` lose their fallbacks and `memoryKeys` / `INITIAL_MOCK_KEYS` are deleted.
- `getStats` stops recomputing health, RPM headroom and quota on the client; the server's `/api/stats` is authoritative. `App.svelte`'s `daily_quota_limit: 50000` initial value is replaced by a loading state.
- A global `ErrorToast` shows `ApiError.message`; optimistic updates roll back on error.

**Legacy tests (Appendix B):** `ui/src/lib/PoolCommonsTab.test.ts` (live schema).

**Tests**
- Component tests with `msw` handlers built from the same zod schemas: delete failure (500) keeps the row and shows an error.
- Schema-violating responses fail tests in CI.

### Phase 1 gate
- `npm run gate` passes; the migration test covers every file in `migrations/`.
- `deploy-prod.yml` shows the D1 export step before migrations.
- Staging: the console works exactly as before; `/v1/models` lists only Gemini and Groq models.

---

## Phase 2 — Credit Units, complete responses, schema repair, one API host

**Release R2. User-visible changes:** CU replaces dollars in the console and in new response fields; responses keep tool calls and pass unknown parameters through; `api.key-col.axe08.tech/v1` is the documented endpoint while the old URLs keep working with deprecation headers.

**Compatibility:** `0013` is additive (R1 ignores the new columns). `0014` rewrites `api_keys` values and time columns, which R1 reads through WP-1.2's tolerant readers. `x-kc-cost-microdollars` is still sent. Old API URLs answer as before.

**Rollback:** redeploy R1. It tolerates `0013` (unused columns) and `0014` (tolerant readers).

### WP-2.1 Credit Units: core and storage (expand)

**Depends on:** WP-1.4

**Findings:** N-03, R7, fixed-point violations (`debt.ts:52`, `pool_routes.ts:227`, `coordinator_do.ts:124`, `auth_tokens/repository.ts:379,409`).

**Problem.** Section 2.2 defines CU. v1 renamed the µ$ columns in place, which breaks the release still running during the deploy (it writes `cost_microdollars`, which would no longer exist). v2 adds the CU columns next to the old ones, writes both, and reads only CU; WP-7.3 removes the old columns one release later.

**Implementation**
1. `src/constants/credits.ts`: `type CU = bigint`, `ceilDiv(a, b)` as `(a + b - 1n) / b`, `formatCu(cu)`. The catalog model type gains `cuBase`, `cuInPer1k`, `cuCachedPer1k`, `cuOutPer1k`, filled for every model that WP-1.4 kept, with the section 2.2 weights. `calculateCu(model, usage): bigint` lives in `src/router/registry`. The µ$ price fields and `calculateCost` stay, marked `@deprecated`, until WP-7.3.
2. Migration `0013_credit_units_expand.sql` (additive only):
   ```sql
   ALTER TABLE cost_ledger ADD COLUMN cu INTEGER;
   ALTER TABLE cost_ledger ADD COLUMN usage_estimated INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE cost_ledger ADD COLUMN borrowed INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE cost_ledger ADD COLUMN lender_tenant_id TEXT;
   UPDATE cost_ledger SET cu = 10 + ((prompt_tokens + 999) / 1000)
                             + (((completion_tokens + reasoning_tokens) * 4 + 999) / 1000)
    WHERE cu IS NULL;
   CREATE TABLE daily_cu_rollup (
     tenant_id TEXT NOT NULL, day TEXT NOT NULL, provider TEXT NOT NULL, model_id TEXT NOT NULL,
     total_requests INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0,
     total_cu INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (tenant_id, day, provider, model_id));
   CREATE INDEX idx_daily_cu_rollup_tenant_day ON daily_cu_rollup (tenant_id, day);
   INSERT INTO daily_cu_rollup (tenant_id, day, provider, model_id, total_requests, total_tokens, total_cu)
     SELECT tenant_id, day, provider, model_id, total_requests, total_tokens, 0 FROM daily_spend_rollup;
   ALTER TABLE auth_tokens ADD COLUMN budget_cu INTEGER;          -- NULL = unlimited
   ALTER TABLE auth_tokens ADD COLUMN spent_cu INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE contributor_standing ADD COLUMN community_debt_cu INTEGER NOT NULL DEFAULT 0;
   ```
   Historical µ$ totals are meaningless as CU, so copied rollup rows start at `total_cu = 0`; new traffic fills them. Budgets were denominated in dollars and are meaningless as CU, so every token starts with `budget_cu = NULL` (unlimited), as section 2.2 decided.
3. **Dual write, CU read.** `src/storage` (cost ledger, rollups, auth-token repository) writes the CU columns (and `daily_cu_rollup`) and keeps writing the µ$ columns (and `daily_spend_rollup`) with the old formula, so the previous release and this one agree during the deploy. Every read path (budget checks, rollups, standing) reads only CU. A ledger row whose `cu` is `NULL` (written by the previous release during the deploy) is read as the token-derived value from step 2's formula.
4. `src/quota`: TenantQuotaDO counts `cuUsed24h` and `communityDebtCu` as `bigint`; all ratios are scaled integers: `ratio_pct = debt * 100n / max(contributed, 1n)`; decay `debt - (debt * DECAY_PCT) / 100n`.
5. `src/storage/repositories/auth_tokens/repository.ts`: bind `bigint` values as strings (`budget_cu.toString()`), never `Number(bigint)`.
6. Leave `coordinator_do.ts` alone (WP-4.1 and WP-5.10 rewrite it).

**HIVE:** one card per module group (`src/router/registry` + `src/constants`; `src/storage`; `src/quota`), each with its tests. The migration goes in the storage card.

**Legacy tests (Appendix B):** `tests/constants.test.ts`, `tests/api_types.test.ts`, `tests/models_and_config_types.test.ts`, `tests/storage/repositories/costLedger.test.ts`, `tests/storage/repositories/authTokens.test.ts`, `src/storage/repositories/auth_tokens/repository.spec.ts`, `test/durable_objects/rate_limiter.test.ts`, `test/durable_objects/index.test.ts` (µ$ → CU parts only).

**Tests**
- `test/unit/credits/request_cu.test.ts`: table-driven over every catalog model; boundaries (0 tokens → `cu_base`; 999, 1000 and 1001 tokens); `ceilDiv` correctness; every result is a `bigint`.
- Property test (fast-check): `request_cu` is monotonic in each token count.
- A non-streaming completion writes a `cost_ledger` row whose `cu` equals the value recomputed from its usage, and whose `cost_microdollars` is still written.
- A ledger row inserted with `cu = NULL` is reported with the token-derived CU by the rollup and standing readers.
- `test/unit/pure/no_float_finance.test.ts` scans `src/quota`, `src/pool`, `src/router/registry`, `src/storage` for `parseFloat`, `toFixed`, `Math.round(` on CU identifiers and `Number(` applied to identifiers ending in `Cu` or `_cu`.
- Migration test: `0013` applies on the production-shaped fixture and backfills `cu` for existing rows.

**Done when** every accounting read uses CU, the µ$ columns are still written, and the no-float scan passes.

### WP-2.2 Credit Units: API, telemetry and UI

**Depends on:** WP-2.1

**Findings:** N-03 (surfaces), F9 (header part).

**Implementation**
1. Non-streaming `/v1/chat/completions` responses carry `x-kc-cu` and `usage.kc_cu`. The old `x-kc-cost-microdollars` header is still sent until WP-7.3 removes it, so existing clients keep working for one release.
2. `/v1/models` entries carry `kc: { cu_base, cu_in_per_1k, cu_cached_per_1k, cu_out_per_1k }`.
3. Telemetry: `doubles[0] = Number(cu)` (CU values stay far below 2^53).
4. `/api/stats`, `/api/pool/*` and every other dashboard response report CU fields (`cu_used_today`, `cu_allowance_today`, `community_debt_cu`, …). Dollar fields are removed from dashboard responses in this WP: only the console UI reads them, and it ships in the same release.
5. UI (`ui/src`): `formatCu` replaces `formatMicrodollars`; the spend ring becomes "CU used today / CU allowance today"; the pricing table becomes a CU weight table fed by `/v1/models`; no `$` amounts remain.

**Legacy tests (Appendix B):** `test/unit/worker/telemetry_emitter.test.ts`, `tests/errors.test.ts` (CU part).

**Tests**
- A non-streaming completion returns `x-kc-cu` equal to the value recomputed from `usage`, `usage.kc_cu` with the same value, and still returns `x-kc-cost-microdollars`.
- `/v1/models` entries carry the four `kc` weight fields.
- A telemetry data point written for a request carries the request's CU in `doubles[0]`.
- UI: `MetricCards` renders CU used and CU allowance from a fixture `/api/stats` response, and no rendered text contains `$`.

**Done when** `grep -rniE "microdollar|dollar|\\$[0-9]" ui/src` returns nothing and every dashboard response is in CU.

### WP-2.3 Complete OpenAI-compatible responses and parameter passthrough (v1 3.3)

**Depends on:** WP-2.1

**Findings:** R8 (tool calls dropped, `finish_reason` hard-coded), R14 (FR-24 passthrough).

**Implementation**
1. **Request.** `ChatHandler` builds the upstream body as a copy of the client body minus KC-only fields (`modelAlias`, `estimatedPromptTokens`), with `model` replaced by the resolved upstream id. Unknown fields (`safetySettings`, `generationConfig`, `extra_body` contents merged by SDKs, `seed`, `top_p`, `logprobs`, …) pass through unchanged. For `stream: true`, set `stream_options: { include_usage: true }` unless the client set it.
2. **Response (non-stream).** Both supported providers speak the OpenAI format through their OpenAI-compatible endpoints, so return the upstream JSON with only these edits: `id` → `chatcmpl-<kc request id>`, `model` → the resolved model id, `usage.kc_cu` added. `choices[].message.tool_calls`, `finish_reason`, `logprobs` survive untouched. Delete `extractContentFromPayload` from the response path (keep it only if a provider without OpenAI format is re-added later).
3. **Streaming.** Pass SSE chunks through; after upstream `[DONE]`, emit `event: kc.usage` + `data: {"cu": …}` then `data: [DONE]`. Mid-stream upstream errors are sanitised (v1 WP 0.6 (done)) before being forwarded as an SSE error event.

**Legacy tests (Appendix B):** `src/proxy/upstream_client.test.ts` (no upstream text in messages; google/groq only).

**Tests**
- Tool-call response (mocked Groq and Gemini fixtures) round-trips `tool_calls` and `finish_reason: "tool_calls"`.
- An arbitrary field `{"foo": 1}` and `safetySettings` reach the mocked upstream body.
- Streaming request carries `include_usage`.
- Final events are `kc.usage` then `[DONE]`.

### WP-2.4 Streaming usage capture (v1 3.7)

**Depends on:** WP-2.3

**Findings:** support for 2.2 settlement; R11 via WP-5.6.

**Implementation.** `proxy/sse/usage_extractor.ts` reads the final usage chunk that `include_usage` produces (both providers' OpenAI-compatible streams). If absent, count streamed `delta.content` characters and estimate `ceil(chars / 4)`, flag `usage_estimated = 1`. Settlement runs in `flush`/`cancel` exactly once (existing `finalized` guard kept).

**Legacy tests (Appendix B):** `src/proxy/sse_transformer.test.ts` (`include_usage`, `kc.usage`, estimation flag).

**Tests**
- Stream with usage chunk → exact CU.
- Without → estimated CU and `usage_estimated = 1`.
- Client abort mid-stream → settlement with partial usage, once.

### WP-2.5 Response headers (v1 3.5)

**Depends on:** WP-2.3, WP-2.2

**Findings:** R3.

**Implementation.** One `applyKcHeaders(res, ctx)` used by every `/v1` response: `x-kc-request-id: kc_req_<uuid>`, `x-kc-model-used`, `x-kc-provider`, `x-kc-cu` (non-stream), `x-kc-attempts`. Keep `x-kc-cost-microdollars` on non-stream responses until WP-6.5 removes it. Remove `x-kc-tenant-id` and `x-kc-trace-id` from responses, and update any UI reader of them in the same card (PRD section 12 information boundary: users do not see routing internals). Delete `UpstreamClient.toClientResponse`; header allow-listing already happens because responses are constructed, and a test guards it.

**Legacy tests (Appendix B):** none.

**Tests**
- A mocked upstream response carrying `x-goog-*`, `server`, `alt-svc`, `x-envoy-*` and `cf-ray` produces a client response with none of them (AC-08, headers half).
- Every `/v1` response carries `x-kc-request-id` (`kc_req_<uuid>`), `x-kc-model-used` and `x-kc-provider`, non-streaming responses also `x-kc-cu`, and none carry `x-kc-tenant-id` or `x-kc-trace-id`.

### WP-2.6 Schema repair (data migration)

**Depends on:** none

**Findings:** D1, D2, D3, D4 (created in 0011), D11, D13.

**Why it is safe now.** WP-1.2 (phase 1, already deployed) made every reader accept both the legacy and the repaired shapes, so the release that is still running while `0014` applies keeps routing keys.

**Human (before phase 2 starts):** confirm that `consent_attestations` and `project_hash_registry` are empty in production (every insert has failed since migrations 0006/0007). If either has rows, stop and amend this WP before it runs.

**Implementation** — migration `0014_schema_repair.sql`:
1. **`consent_attestations` (D1, D3).** Recreate with the PRD schema and CHECKs:
   ```sql
   DROP TABLE consent_attestations;
   CREATE TABLE consent_attestations (
     id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
     event_type TEXT NOT NULL CHECK (event_type IN ('REGISTRATION','KEY_SUBMISSION')),
     checkbox_id TEXT NOT NULL CHECK (checkbox_id IN ('C1','C2','C3','K1','K2')),
     consent_version TEXT NOT NULL, key_id TEXT,
     attested_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
     ip_address TEXT, user_agent TEXT);
   CREATE INDEX idx_consent_tenant ON consent_attestations(tenant_id, event_type);
   CREATE TRIGGER consent_no_update BEFORE UPDATE ON consent_attestations BEGIN SELECT RAISE(ABORT,'append-only'); END;
   CREATE TRIGGER consent_no_delete BEFORE DELETE ON consent_attestations BEGIN SELECT RAISE(ABORT,'append-only'); END;
   ```
   Align `contracts/v4_types.ts` `ConsentAttestationSchema` with these columns and use it at the insert site (parse before bind).
2. **`project_hash_registry` (D2).** Include `provider` in every insert. Rebuild the table with `rotating_until` and `tombstone_until` as INTEGER epoch ms.
3. **`api_keys` rebuild (D13, D11).** SQLite cannot add CHECK constraints with ALTER, so rebuild:
   - `status TEXT NOT NULL CHECK (status IN ('HEALTHY','COOLDOWN','QUARANTINED','REVOKED'))`, mapped exactly as `normaliseKeyStatus` (WP-1.2) maps them.
   - `pool_type TEXT NOT NULL CHECK (pool_type IN ('PRIVATE','COMMUNITY')) DEFAULT 'PRIVATE'` (today the default is `'COMMUNITY'`, the unsafe choice).
   - Time columns as INTEGER epoch ms: `observation_until`, `circuit_open_until`, `last_used_at`, `revoked_at`, `status_changed_at` (new), `created_at`, converted with the same rules as `toEpochMs`.
   - Keep `key_hash`, `provider_project_hash`, `hkdf_migrated`, `dispatched_today`, `dispatched_communal`, `vesting_tier` (WP-7.4 drops the last three).
   - New columns: `sync_pending INTEGER NOT NULL DEFAULT 0` (WP-3.6) and `key_version INTEGER NOT NULL DEFAULT 1` (secret rotation, WP-8.7).
   - Recreate the indexes.
4. **Writers switch to canonical values** in the same release: every INSERT/UPDATE of `api_keys.status` or `pool_type` uses `KeyStatus` / `PoolType`, and time columns are written as epoch ms. The readers from WP-1.2 stay tolerant until WP-7.4.

**Legacy tests (Appendix B):** `tests/storage/repositories/apiKeys.test.ts` (rewrite on the Workers harness, real D1).

**Tests**
- `test/integration/schema_conformance.test.ts` (section 2.5): every repository method and every SQL-writing handler runs against the migrated database without error and produces the expected row.
- Migration test: on the production-shaped fixture, `0014` produces upper-case statuses, `pool_type` never NULL, and INTEGER epoch-ms times.
- After the rebuild, `KeyPoolDO` loads and serves a `HEALTHY` key.
- A consent row can be inserted and cannot be updated or deleted.
- A `project_hash_registry` insert without `provider` fails; with it, succeeds.

**Done when** the schema conformance test passes and every write of `api_keys.status` uses `KeyStatus`.

### WP-2.7 One API host, legacy routes deprecated

**Depends on:** none

**Findings:** N-02, N-07, R10 (dropped by D-15), part of R3.

**Problem.** The UI, README and OpenAPI document tell users to call `https://key-col.axe08.tech/v1/…` (apex). v1 removed the apex, console and alias routes in the same release that introduced `api.*`, which breaks every integration built from our own docs. v2 makes `api.*` canonical now and removes the legacy routes in WP-7.1, after a deprecation window (D-22).

**Implementation** — section 2.1 steps 1–7, with these differences:
1. `resolveHost` and the four host handlers (`ApiHost`, `ConsoleHost`, `AdminHost`, `ApexHost`) exactly as section 2.1. Add `POOL_COORDINATOR` to the `env.dev` and `env.production` DO binding lists (N-07).
2. `src/worker/api/v1_router.ts` holds the literal route table for `api.*`. The raw DO routes stay 404 everywhere (done in stage 0).
3. **Legacy routes keep working for the deprecation window.** `src/worker/api/legacy_routes.ts` lists them: `/v1/*` on the console and apex hosts, and the path aliases `/chat/completions`, `/v1/route`, `POST /`, `/models`, `/models/:id`, `/report`, `/demo/token`, `/api/demo/token`, `/v1/report` on any host. Each is served by the same handler as its `api.*` equivalent and adds `Deprecation: true`, `Sunset: <LEGACY_SUNSET>` (a `vars` value, an HTTP date), and `Link: <https://api.key-col.axe08.tech/v1>; rel="successor-version"`. Each hit writes one telemetry data point `legacy_route_hit` with the route id (no tenant id).
4. Apex non-API paths redirect to the console: `301` for GET/HEAD, `308` for other methods (D-25).
5. `openapi.json` has a single server, `https://api.key-col.axe08.tech/v1`; paths are `/chat/completions`, `/models`, …
6. UI: `API_BASE_URL = import.meta.env.VITE_API_BASE_URL` (`ui/.env.production`: `https://api.key-col.axe08.tech/v1`; `ui/.env.development`: `http://api.localhost:8787/v1`). Playground, API docs, code snippets, the copy-endpoint button and `TopNavBar` use it.
7. README quickstart uses `https://api.key-col.axe08.tech/v1/chat/completions` with a `kc_live_` key and states the sunset date of the old URLs. `docs/PRD.md`: remove the two `/v1beta` rows and note D-15.
8. `GET /v1/health` on `api.*` returns exactly `{"status":"ok"}` (the stage-0 harness test accepts `healthy` too; tighten it to `ok`).

**Legacy tests (Appendix B):** `src/worker/index.test.ts` (→ `test/integration/hosts.test.ts`), `tests/smoke.test.ts`, `test/env.test.ts`, `src/worker/router_handler.test.ts`, `test/unit/worker/router_handler.test.ts`, `test/integration/worker/index.test.ts` (move to the harness; request `api.*`).

**Tests** (`test/integration/hosts.test.ts`)
- Route matrix on `api.*`: every row of the section 2.1 table returns its exact status; `GET https://api…/api/keys` → 404; `GET https://api…/v1/keys` → 404.
- Every legacy route still returns the same status and body as its `api.*` equivalent, plus `Deprecation`, `Sunset` and `Link` headers, and writes one `legacy_route_hit` data point.
- Apex `GET /` → 301 to the console; apex `POST /anything-else` → 308.
- CORS: a preflight on `api.*` returns `Access-Control-Allow-Origin: *`; a preflight on `console.*` returns no CORS headers.
- `openapi.json` lists exactly one server, `https://api.key-col.axe08.tech/v1`.
- `GET https://api…/v1/health` returns `{"status":"ok"}`.
- UI unit test: `Playground`, `ApiDocs`, `CodePlayground` snippets and the copy-endpoint button render `API_BASE_URL`.

**Done when** `grep -rn "key-col.axe08.tech" ui/src src` finds only env/config definitions and the legacy-route list, and every legacy route is served with deprecation headers.

### Phase 2 gate
- `npm run gate` passes, including the host matrix, schema conformance and CU tests.
- Staging: a completion through `https://api-dev…/v1` returns `x-kc-cu`; the same call through the old URL returns the same body plus `Deprecation`; key routing works across the `0014` deploy (keys loaded before and after).
- Operator sets `LEGACY_SUNSET` after the production deploy (D-22).

---

## Phase 3 — Identity, sessions, key submission, projects, developer surfaces

**Release R3. User-visible changes:** Google sign-in with registration consent; console on HttpOnly session cookies; GitHub linking unlocks the community pool; key submission works end to end with Turnstile; projects and project-scoped API keys; playground and docs on `api.*`.

**Compatibility:** `0015` and `0016` are additive or tolerated (WP-1.2 reads both timestamp units). Console `/api/*` still accepts bearer tokens (tabs opened before the deploy keep working). Existing API keys keep working. Legacy GitHub-only accounts keep working and can be claimed.

**Rollback:** redeploy R2. It ignores the new tables and columns; users signed in with cookies sign in again.

### WP-3.1 Identity model and console sessions (side by side with bearer)

**Depends on:** none

**Findings:** S2 (full), S9, F1, F3, D-08, D-10.

**Problem.** Section 2.3 replaces console bearer tokens with an HttpOnly session cookie. Server and UI cards merge one at a time, so a server that stops accepting bearer tokens before the UI sends cookies breaks the console between merges (v2 review P2-03). v2 accepts both until WP-7.2.

**Implementation**
1. Migration `0015_identity.sql` (additive): the `user_identities` and `sessions` tables and the three `users` columns from section 2.3; backfill a `google` identity row for every `usr_goog_*` user; set `registration_status = 'PENDING_CONSENT'` for them (they have never attested C1–C3). It does **not** expire `auth_tokens` (OP-0.11 already expired every token issued before the hotfix) and does **not** suspend GitHub-only accounts (WP-7.2 does, after the claim flow of WP-3.5 has been available for the notice period, D-27).
2. `src/auth/session/store.ts`: create, look up and revoke sessions; `kc_session` = 32 random bytes, base64url, only its SHA-256 stored; cookie `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1209600` on the console host only (no `Domain`). A per-session CSRF token is returned by `GET /api/session`.
3. `POST /api/auth/google` (from stage 0) now creates a session: if `registration_status = 'PENDING_CONSENT'` it responds `{ next: "consent" }` and sets a 15-minute `kc_pending` cookie (WP-3.2 consumes it); otherwise it sets `kc_session`.
4. Console `/api/*` authentication accepts, in order: a valid `kc_session` cookie (state-changing requests must also carry `x-kc-csrf` equal to the session's CSRF token, else 403 `csrf_required`), then the legacy bearer token (unchanged behaviour). Requests authenticated by bearer never need CSRF. `api.*` ignores cookies entirely.
5. `POST /api/auth/logout` revokes the session and clears the cookie.
6. Admin: `admin.*` accepts a `kc_admin_session` created by the same Google flow, plus `users.role = 'admin'`, plus the email in `ADMIN_EMAILS` (section 2.3 item 7). The break-glass header from stage 0 is unchanged.
7. `test/helpers/world.ts` gains `createSession(user, { kind })` and identity options (`google`, `github`, `eligible`).

**Legacy tests (Appendix B):** `test/unit/worker/auth_middleware.test.ts` (rewrite on real D1; delete master-key and header-tenant cases), `test/unit/worker/dashboard_session_telemetry.test.ts` (cookie sessions).

**Tests** (`test/integration/identity/sessions.test.ts`)
- Google sign-in for a new user creates `users`, `user_identities` and `PENDING_CONSENT`, and returns `{ next: "consent" }` with a `kc_pending` cookie.
- Google sign-in for an `ACTIVE` user sets `kc_session` with `HttpOnly; Secure; SameSite=Lax` and no `Domain`.
- `POST /api/keys` with a valid session cookie but no `x-kc-csrf` → 403 `csrf_required`; with it → passes authentication.
- The legacy bearer token still authenticates console `/api/*` and needs no CSRF header.
- A session cookie alone on `api.*` → 401.
- Logout revokes the session: the same cookie then → 401.
- Migration test: `0015` backfills google identities and leaves `auth_tokens` and GitHub-only users untouched.

**Done when** the console can be used entirely through a session cookie while bearer tokens keep working.

### WP-3.2 Registration consent (C1–C3)

**Depends on:** WP-3.1

**Findings:** C1–C3 (FR-15, AC-15).

**Implementation.** Section 2.3 flow 2. `POST /api/auth/consent { c1: true, c2: true, c3: true }` requires the `kc_pending` cookie. Missing any box → `422 { error: "consent_required", missing: [...] }`. Otherwise one `DB.batch` writes three `consent_attestations` rows (`event_type='REGISTRATION'`, `checkbox_id`, `ip_address = cf-connecting-ip`, `user_agent`, `consent_version`) and sets `registration_status = 'ACTIVE'`, then the response sets `kc_session` and clears `kc_pending`. Until consent, every console `/api/*` route except `/api/session`, `/api/auth/*` and `/api/abuse/report-key` returns 403 `consent_required` for that user (session or bearer).

**Legacy tests (Appendix B):** none.

**Tests** (`test/integration/identity/consent.test.ts`)
- Consent missing C2 → 422 listing `C2`, no rows written.
- Full consent → 3 `consent_attestations` rows with IP and UA, status `ACTIVE`, `kc_session` set, `kc_pending` cleared.
- A `PENDING_CONSENT` user gets 403 `consent_required` on `/api/keys` and 200 on `/api/session`.

**Done when** AC-15 passes.

### WP-3.3 GitHub link, Sybil check and pool rights

**Depends on:** WP-3.1

**Findings:** S8 (full), F4, D-05; D-21.

**Implementation**
1. Section 2.3 flow 3: `GET /api/auth/github/start` and `GET /api/auth/github/callback` in `src/auth/github/link_flow.ts` (state + PKCE verifier in a signed, HttpOnly, 10-minute `kc_oauth` cookie; HMAC-SHA256 with `SESSION_SIGNING_KEY` via `crypto.subtle`). The callback replaces the stage-0 `410` stub. `GITHUB_CLIENT_ID` moves to `vars`; the browser no longer builds the authorize URL.
2. The Sybil engine (`src/auth/sybil/engine.ts`) becomes the only scorer, fed by the GitHub profile, GraphQL `contributionsCollection`, `cf.asn` and `cf-connecting-ip`, with the PRD thresholds (account age ≥ 30 days, ≥ 1 public repo, ≥ 5 contributions; pass ≥ 65, probationary 40–64, refuse < 40). The Turnstile secret is passed through (stage 0 made it mandatory).
3. `src/auth/rights.ts` `poolRights(user, identities)` exactly as section 2.3, cached 60 s in the auth context. Enforced now on: `POST /api/keys` (COMMUNITY requires `communityPool`, any key requires `privatePool`), `PATCH /api/keys/:id/pool-mode`, `GET /api/pool/telemetry`, `GET /api/pool/contribution` (403 `github_link_required`).
4. **Existing COMMUNITY keys of users without community rights (D-21).** They keep serving their owner. They are excluded from lending to other tenants (the legacy engine skips keys whose owner lacks `communityPool`; WP-4.1's coordinator never registers them). Each affected owner gets one notification the first time they sign in: "Link GitHub to keep sharing your key with the community pool" (a banner from `GET /api/session` until WP-4.3 adds the notifications table).
5. Delete `src/worker/router/dashboard/auth_routes.ts` routes superseded here and the unused `src/auth/oauth/*` client.

**Legacy tests (Appendix B):** `src/auth/sybil.test.ts` and `tests/auth/sybil.test.ts` (merge into `test/unit/sybil/engine.test.ts`; PRD thresholds; siteverify mocked at the HTTP layer), `tests/auth/two_phase_auth.test.ts` (split into `test/integration/identity/*.test.ts`).

**Tests** (`test/integration/identity/github_link.test.ts`, `rights.test.ts`)
- Callback with wrong `state`, a tampered cookie or an expired cookie → 400 each.
- A GitHub id already linked to another user → 409.
- Sybil score 30 → link refused; 50 → linked, `community_eligible = 0`; 80 → eligible.
- Rights matrix: a Google-only user may add a PRIVATE key (201) but not a COMMUNITY key (403 `github_link_required`); an eligible Google+GitHub user may add COMMUNITY; a Google-only user gets 403 `github_link_required` on `/api/pool/telemetry` and `/api/pool/contribution`, an eligible user gets 200.
- A Google-only owner's existing COMMUNITY key still serves the owner's requests and is never served to another tenant.
- The callback response contains no token in the URL and no `postMessage`.

**Done when** the rights matrix passes and no code path lends a key whose owner lacks `communityPool`.

### WP-3.4 Console UI on sessions

**Depends on:** WP-3.2, WP-3.3

**Findings:** F1, F3, F4 (UI), S8 (UI).

**Implementation**
- `OAuthModal` becomes `SignIn` (Google only) + `ConsentScreen` (C1–C3 with the PRD texts verbatim; submit disabled until all three are ticked) + a `Settings → Link GitHub` card that starts `/api/auth/github/start` and shows the stored Sybil result.
- `App.svelte` stops reading or writing `kc_user` / `kc_auth_token` in `localStorage` (and deletes existing values on load); identity comes from `GET /api/session`.
- The typed API client's auth transport (WP-1.5) switches to `credentials: "same-origin"` plus `x-kc-csrf` on mutations. No bearer header is sent from the console any more.
- The Pool tab shows a locked state with "Link GitHub to join the community pool" for users without `communityPool` (D-05).
- The stage-0 security tests (`test/integration/security/*.test.ts`) that call console `/api/*` use `createSession` and the CSRF header (v1 P-30).

**Legacy tests (Appendix B):** none beyond the security suite update above.

**Tests**
- Sign-in → consent → dashboard flow against msw fixtures; the consent submit stays disabled until C1, C2 and C3 are ticked.
- After load, `localStorage` holds no `kc_user` or `kc_auth_token`.
- Mutations from the API client carry `x-kc-csrf` and no `Authorization` header.
- The Pool tab renders the locked call-to-action for a Google-only session.

**Done when** `grep -rn "localStorage" ui/src` finds no credential or identity key and the console works with cookies only.

### WP-3.5 Legacy GitHub-only account claim

**Depends on:** WP-3.3

**Findings:** S9 follow-through; D-10, D-27.

**Implementation.** `POST /api/auth/claim-legacy` (session required, GitHub already linked through WP-3.3): finds `gh_*` / `usr_gh_*` users whose GitHub id equals the caller's linked GitHub id, re-parents their `api_keys` to the caller's `usr_goog_*` id and re-encrypts each key under the new tenant subkey (decrypt with the old tenant's subkey, encrypt with the new, same `key_hash`), inside one `DB.batch`; writes an `admin_audit_logs` row `legacy_claim`; marks the legacy user `SUSPENDED`. Legacy users are otherwise untouched until WP-7.2. The console shows a "Claim your old keys" card when `GET /api/session` reports claimable legacy accounts.

**Legacy tests (Appendix B):** none.

**Tests** (`test/integration/identity/claim_legacy.test.ts`)
- A user whose linked GitHub id matches `gh_123` claims it: the keys now belong to the caller, decrypt correctly under the new subkey, and `gh_123` is `SUSPENDED`.
- A user whose GitHub id does not match → 404, nothing changes.
- Claiming twice is a no-op the second time.

**Done when** every legacy account can be claimed by its GitHub owner.

### WP-3.6 Key submission end to end (v1 1.5)

**Depends on:** WP-3.3

**Findings:** F2, D1, D2, K1/K2 audit rows (IP, UA), proof-of-life (Flow B phase 2), GCP probe verification (FR-06, IR-09), transactional writes, silent DO-sync failure (`post_key.ts:132-158`), inline SQL drift root cause.

**Implementation**
1. **Turnstile widget (UI).** Add `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` to `ui/index.html`; component `Turnstile.svelte` renders the widget with `VITE_TURNSTILE_SITE_KEY`, exposes the token via a bindable prop and resets after each submission. `AddKeyModal` and `ReportKeyModal` use it; submit stays disabled until a token exists. The API client sends it in `x-turnstile-token` (the header the server reads).
2. **Handler rewrite** (`keys/post_key.ts`), in this order, each failure mapped to a precise error code:
   1. Session (or legacy bearer until WP-7.2) + CSRF for sessions + rights (`privatePool`; `communityPool` if `pool_type=COMMUNITY`).
   2. Rate limit: 10 key submissions per user per day (`RATE_LIMITER`).
   3. Turnstile.
   4. Body validated with zod: `provider ∈ {google, groq}` (D-06), `key` format per provider (`^AIza[0-9A-Za-z_-]{35}$`, `^gsk_[A-Za-z0-9]{20,}$`), `label ≤ 64`, `k1 === true && k2 === true`, `pool_type`.
   5. Duplicate check: `key_hash` exists → 409 `key_already_registered`.
   6. **GCP probe** (Google only): see step 3 below → `project_hash`. Registry state ACTIVE → 409; TOMBSTONED and `tombstone_until > now` → 409 `project_tombstoned`; ROTATING by the same tenant within 30 min → allowed (rotation completion, WP-5.11); revoked within 24 h → FR-18 observation tier flag.
   7. **Proof of life**: one minimal call per provider (Gemini: `generateContent` on the cheapest model with `maxOutputTokens: 1`; Groq: `chat/completions` on `llama-3.1-8b-instant` with `max_tokens: 1`). 200 → OK; 429 → 400 `key_no_quota`; 401/403 → 400 `key_invalid`; 5xx/timeout → 503 `provider_unavailable` (retryable).
   8. Encrypt with the tenant HKDF subkey, compute `key_hash`.
   9. **One `DB.batch([...])`** (atomic in D1): insert `api_keys` (via `ApiKeysRepository`), insert `project_hash_registry` (with `provider`), insert K1 and K2 `consent_attestations` (with `key_id`, `consent_version`, IP, UA).
   10. After commit, add the key to its owner's `KeyPoolDO` (PRIVATE and COMMUNITY alike, as today). COMMUNITY keys are written to D1 with `community_routing_status='OBSERVATION'` and `observation_until = now + 24 h`; the coordinator's D1 reconcile registers them once WP-4.1 lands (until then they serve only their owner, which is what OBSERVATION requires). If the DO call fails, mark the row `sync_pending=1` (column from WP-2.6) and let the KeyPoolDO reconcile on its next load repair it; return 201 with `"sync": "pending"`. No `catch {}`.
3. **GCP probe verification (FR-06).** **Human (before stage 1):** run the probe against a real free-tier key in staging and record the raw response (status and `details[]`) in `docs/specs/gcp_probe.md`; builders implement against that recorded response and use it as a test fixture. Implement `forceErrorGcpProbe` to accept 400 **and** 404 responses, search every `details[]` entry of type `google.rpc.ErrorInfo` for `metadata.consumer` (`projects/<n>`) and also `google.rpc.Help`/`ResourceInfo` fallbacks, and return `{ projectNumber } | { unavailable: reason }`. If the probe cannot extract a project for a Google key, **reject COMMUNITY submission** (PRIVATE is allowed) — the Sybil guard must fail closed for the community pool.
4. **Repository adoption.** All `api_keys` SQL goes through `src/storage/repositories/api_keys/repository.ts` (currently unreachable dead code). In this WP, `keys/*.ts` and `abuse_routes.ts` stop embedding SQL for this table. `KeyPoolDO` (WP-4.1), `pool_routes.ts` (WP-5.10) and `admin_handler.ts` (WP-4.6) adopt the repository when they are rewritten. The repository's queries are covered by the schema conformance test.

**Legacy tests (Appendix B):** `ui/src/lib/AddKeyModal.test.ts` (Turnstile widget, `x-turnstile-token`, error codes).

**Tests** (`test/integration/keys/submit.test.ts`)
- Happy path PRIVATE (Groq) and COMMUNITY (Gemini): 201; rows in `api_keys`, `project_hash_registry` (with provider), two consent rows with IP/UA; the COMMUNITY row is `OBSERVATION` with `observation_until` 24 h ahead; the owner's KeyPoolDO lists both keys.
- Each gate returns its code: missing K2 → 400; bad Turnstile → 403; Google-only user + COMMUNITY → 403; malformed key → 400; duplicate plaintext → 409; same GCP project from another user → 409 (AC-04); tombstoned project → 409; probe 429 → 400 `key_no_quota`; probe unavailable + COMMUNITY → 422 `project_unverifiable`.
- Atomicity: force the consent insert to fail (invalid checkbox via test hook) → no `api_keys` row remains.
- DO sync failure (the KeyPoolDO call fails) → 201 with `sync: pending`, and the next KeyPoolDO load picks the key up.
- `test/helpers/world.ts`: `addProviderKey` now goes through `POST /api/keys` with mocked probes.
- UI (`AddKeyModal.test.ts` rewrite): submit disabled until K1, K2 and a Turnstile token; the request carries `x-turnstile-token`; server error codes render human messages.

### WP-3.7 Projects and project-scoped API keys (v1 1.6)

**Depends on:** WP-3.1

**Findings:** D6, D7, server side of F7.

**Implementation**
- Migration `0016_projects.sql`: `DROP TABLE keys;` (the stub from 0002). `ALTER TABLE auth_tokens ADD COLUMN project_id TEXT REFERENCES projects(id);` `ALTER TABLE projects ADD COLUMN rpm_sub_cap INTEGER; ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;`; `UPDATE projects SET created_at = created_at * 1000, updated_at = updated_at * 1000;` (epoch seconds → milliseconds, D11; safe during the deploy because WP-1.2's reader accepts both units).
- API keys (`POST /api/tokens`) take an optional `project_id` owned by the caller. The auth context carries `projectId` from the token row; `x-project-id` is no longer read (`auth/middleware.ts:374`). Sub-cap comes from `projects.rpm_sub_cap`.
- `PATCH /api/projects/:id` persists `name`, `description`, `rpm_sub_cap` (bounded by tier), `is_archived`; archived projects' tokens are rejected with 403 `project_archived`.
- `POST /api/tokens/:id/rotate` is implemented (the UI already calls it): new secret, same id and project, old hash replaced, response shows the secret once.

**Legacy tests (Appendix B):** none.

**Tests**
- Token bound to project P with sub-cap 2 → third request in a minute returns 429 `project_sub_cap_exceeded` even with `x-project-id` omitted or set to another project.
- Archived project → 403.
- Token rotate returns a new working secret and the old one → 401.

### WP-3.8 Truthful key tests (v1 5.2)

**Depends on:** WP-3.6

**Findings:** stub row "`POST /api/keys/:id/test` … returns success without any network call" (`keys/ops.ts:192-196`).

**Implementation.** `handleTestKey` calls the shared proof-of-life probe (WP-3.6) for the key's provider and returns `{ ok, status: "healthy" | "no_quota" | "invalid" | "unavailable", latency_ms }`. With D-06 there is no "other provider" branch; an unknown provider is a 500 configuration error. The result also updates key status through `settle`-equivalent logic (a `key_invalid` result quarantines).

**Legacy tests (Appendix B):** none.

**Tests**
- 200/429/401/timeout from the mocked provider map to the four statuses.
- The key's D1 status follows.

### WP-3.9 Workbench and projects (v1 4.5)

**Depends on:** WP-3.7, WP-3.4

**Findings:** F7, Workbench rows of WP-6.1.

**Implementation.** All project and token actions go through the typed client (cookie + CSRF). Token rotate uses the endpoint from WP-3.7 and shows the new secret once. Archive and RPM sub-cap edits are pessimistic (update after 200). Project cards show real `rpm_sub_cap` and live RPM.

**Legacy tests (Appendix B):** none.

**Tests**
- Rotate shows secret once and old token fails.
- Archive persists after reload.
- Sub-cap above tier maximum → server 400 shown inline.

### WP-3.10 Playground and API docs (v1 4.6)

**Depends on:** WP-3.1, WP-3.4

**Findings:** F9, F10.

**Implementation.** Playground obtains a playground token (`POST /api/playground/token`) and calls `API_BASE_URL`; reads `x-kc-cu`, `x-kc-model-used`, and the `kc.usage` SSE event; no `x-tenant-id`. API Docs render from `GET https://api…/v1/openapi.json` (single source; delete hand-written `api_docs/generators.ts` endpoint list and the `/v1/projects`, `/v1/telemetry` examples). PricingTable → "CU weights" from `/v1/models`.

**Legacy tests (Appendix B):** none.

**Tests**
- Playground shows CU from the header.
- Docs page lists exactly the OpenAPI paths.
- No model outside `/v1/models` appears in the weights table.

### Phase 3 gate
- `npm run gate` passes, including identity, consent, rights, submission and project tests, and the stage-0 security suite on sessions.
- Staging: a new user signs in with Google, consents, adds a PRIVATE Groq key, creates an API key and calls `https://api-dev…/v1/chat/completions`; after linking GitHub the same user adds a COMMUNITY Gemini key; a legacy GitHub-only account can be claimed.
- `grep` checks: no `x-tenant-id` in the UI; no credential in `localStorage`.

---

## Phase 4 — Leases behind a switch

**Release R4. User-visible change: none while `ROUTING_ENGINE=legacy`.** With `leases`: shared keys respect their real limits, requests are accounted to the right key, upstream failures change key state and notify owners, decryption can only yield the right tenant's key, and admin overrides take effect.

**Compatibility:** `0017` adds `notifications`. The default engine is `legacy`, so production behaves as R3 until the operator flips the switch after a staging soak (D-23).

**Rollback:** set `ROUTING_ENGINE=legacy` (config-only deploy); redeploy R3 if needed.

### WP-4.1 Coordinator key registry and leases (v1 2.1)

**Depends on:** none

**Findings:** PRD 9.3 (`getNextCommunityKey` absent), FR-04 / R13 (shared-key limits tracked per consumer), stale per-tenant snapshots (`key_pool_do.ts:198-260`), priority fixed at first load (`key_pool_do.ts:225-240`), part of FR-02.

**Implementation**
1. **Coordinator rewrite** as specified in 2.4 (SQLite tables, typed RPC `lease/settle/upsertKey/removeKey/setStatus/stats/reconcile`, 60 s alarm, 5 min D1 reconcile). Delete the HTTP `fetch` endpoints (`/coordinator/health`, `/report-volume`, `/update-provider`, `/brake-status/*`).
2. **KeyPoolDO gains a private-key lease API.** While `ROUTING_ENGINE=legacy` it keeps loading community keys for the legacy path (WP-7.5 deletes that load). For the lease path it loads the tenant's PRIVATE keys from D1 on first access and whenever `reconcile()` is called (after add/delete/pool-mode). Its circuit breaker and limiter keep working for private keys only. New RPC: `leasePrivate(provider, estimateCu)`, `settle(leaseId, outcome)`.
3. **Lease orchestrator** `src/router/leases/orchestrator.ts`, implementing the request sequence in 2.4. It exposes `acquire(provider, ctx): Lease | null` with `Lease = { leaseId, keyId, source: "private" | "own_community" | "borrowed", ownerTenantId }` and `settle(lease, outcome)`.
4. **CascadeRouter**, when `ROUTING_ENGINE=leases`, stops calling `keyPool.getKey()`. `executeCascadeRouting` receives a `LeaseProvider`; for each candidate model it asks for a lease on that provider, dispatches, then settles. `selfKeyRouted` and `checkSelfKeyAvailable` are unused on the lease path and deleted by WP-7.5.
5. **Priority is computed at lease time**, not at load: owner debt boost `min(5000, owner_debt_cu / 10)` (0 until WP-5.3 pushes owner debt) (a debtor's key is lent first so they pay down debt), `PARASITE` +2000, `HERO` −1000, then headroom. Owner debt is pushed to the coordinator by TenantQuotaDO whenever it changes (`coordinator.setOwnerDebt(owner, cu)`), so no cross-DO read on the hot path.
6. **Switch (D-23).** `ROUTING_ENGINE` (`vars`, values `legacy` | `leases`) selects the path in `CascadeRouter`; `wrangler.jsonc` sets `legacy` for `production` and `leases` for `dev` and `test`. Both paths stay covered by the suite until WP-7.5. The coordinator registers (reconcile and `upsertKey`) only keys whose owner has `communityPool` rights (D-21); other COMMUNITY keys are served to their owner through KeyPoolDO only.

**Legacy tests (Appendix B):** `src/router/cascade_router.test.ts`, `tests/integration/coordinator_wiring.test.ts`, `tests/pool/coordinator_do.test.ts`, `src/durable_objects/key_pool.spec.ts`, `test/durable_objects/key_pool_do.test.ts`, `test/durable_objects/key_selector.test.ts`, `test/durable_objects/circuit_breaker.test.ts` (move to the Workers pool; `settle` outcomes).

**Tests** (`test/integration/commons/leases.test.ts`)
- Order (AC-01 generalised): tenant T with a PRIVATE Gemini key, a COMMUNITY Gemini key, and access to U's COMMUNITY key → first request uses PRIVATE; after PRIVATE hits its RPM, the next uses T's COMMUNITY key (no debt); after that is exhausted, U's key (debt accrues). Assert `lease.source` via `cost_ledger.borrowed` and `lender_tenant_id`.
- Global limit: U's key `rpm_limit=2`; tenants A and B each send 2 requests in the same minute → exactly 2 are served by U's key and the rest go elsewhere or 429.
- Revocation visibility: revoke U's key via takedown → the very next lease never returns it (no stale snapshot).
- Idempotency: calling `settle` twice with the same lease id changes counters and debt once.
- Concurrency: 50 parallel leases against a key with `rpm_limit=10` → exactly 10 granted.
- `auto` for a tenant holding only a Groq key leases Groq directly: no Gemini lease is attempted (moved here from WP-1.4, where the legacy router had no key-availability ordering).
- With `ROUTING_ENGINE=legacy`, the pre-existing routing tests pass unchanged and the coordinator is never asked for a lease.
- A COMMUNITY key whose owner lacks `communityPool` is never returned by `lease(ownOnly=false)`.

### WP-4.2 Account usage to the key, not the model (v1 3.1)

**Depends on:** WP-4.1

**Findings:** R1.

**Problem.** `chat/stream.ts:64,74` and `chat/non_streaming.ts:31,40` pass `cascadeRes.modelDef.id` (a model name) where a key id is required. `KeyPoolDO.recordUsage` throws `KeyNotFound` (swallowed) and every `cost_ledger.key_id` holds a model name.

**Implementation.** With leases (WP-4.1) the response carries `lease.keyId`; both handlers pass it to `settle` and to the ledger. Delete the separate `recordUsage` calls from the response handlers (settlement is the single accounting point). Add a `NOT NULL` foreign-key-style check in the ledger repository: `key_id` must match `^key_`.

**Legacy tests (Appendix B):** none.

**Tests**
- Non-streaming and streaming completions write `cost_ledger.key_id` equal to the leased key's id.
- The key's minute counter in its DO increments by exactly 1 per request in both modes.

### WP-4.3 Upstream status handling, quarantine and notifications (v1 3.2)

**Depends on:** WP-4.1

**Findings:** R9 (401/429 only call `recordResult(false)`), `recordStatusCode` has no callers, Flow G, D12 (notifications query `created_at`).

**Implementation**
1. `src/proxy/upstream/classify.ts` maps an upstream response to an outcome:

   | Upstream | Outcome | Key action |
   | --- | --- | --- |
   | 200 | `ok` | counters, breaker success |
   | 401, 403 (`API_KEY_INVALID`, `PERMISSION_DENIED`) | `key_invalid` | `QUARANTINED`, notify owner, canary re-checks nightly; 3 consecutive nightly 401s → `REVOKED` + project `TOMBSTONED` (WP-5.11) |
   | 429 with Gemini `QuotaFailure.violations[].quotaId` containing `PerDay`, or Groq `x-ratelimit-remaining-requests: 0` with a reset > 1 h | `rpd_exhausted` | `COOLDOWN` until next reset + jitter (WP-5.8); FR-16 classification (WP-5.5) |
   | other 429 | `rpm_limited` | `COOLDOWN` for `retry-after` (default 60 s) |
   | 5xx, timeout | `upstream_error` | breaker failure; open after 5 consecutive, half-open after 60 s |
   | 400 | `request_error` | no key action; return 400 to the client (sanitised), do not fall back |
2. The status goes to the lease owner (`KeyPoolDO` or coordinator) through `settle(leaseId, outcome)`; D1 `api_keys.status` and `status_changed_at` are updated in the same settle for `key_invalid`, `rpd_exhausted`, and recoveries.
3. Migration `0017_notifications.sql`: `CREATE TABLE notifications (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, type TEXT NOT NULL, key_id TEXT, message TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER); CREATE INDEX idx_notif_tenant_created ON notifications(tenant_id, created_at);`
4. Add the owner notification to the abuse takedown (`abuse_routes.ts`: "Your key was revoked after an abuse report"), deferred from v1 WP 0.4 (done).
5. `GET /api/notifications?since=<ms>` reads that table (tenant-scoped). `POST /api/notifications/:id/read` marks read. Messages use the PRD Flow G text with the key label and provider.
6. Delete `recordResult` and `recordStatusCode` from `KeyPoolContract`; `settle` replaces both.

**Legacy tests (Appendix B):** none.

**Tests**
- For each row of the table, a mocked upstream response produces the stated key state, D1 status, and (where listed) exactly one notification.
- A 400 does not trigger fallback.
- Breaker opens on the 5th consecutive 5xx and half-opens after 60 s of test clock.

### WP-4.4 Strict key decryption (v1 3.6)

**Depends on:** WP-4.1

**Findings:** R12, audit HKDF row (AC-07 weakened by fallbacks).

**Implementation**
1. `core/key_resolver.ts` is replaced by `resolveLeasedKey(lease)`: load the row by `lease.keyId`, assert `row.tenant_id === lease.ownerTenantId`, decrypt with `deriveTenantKey(master, row.tenant_id)` only. If `hkdf_migrated = 0`, use the legacy global key path once, then re-encrypt with the tenant subkey and set `hkdf_migrated = 1` in the same step (lazy migration). Any failure → `KeyDecryptionError` → key `QUARANTINED`, alert logged; the key id is never returned as a credential.
2. Delete the "looks like a raw key" fast path and the caller-tenant and `default` fallback attempts.
3. Cache per key id with the row's nonce in the cache key (so rotation invalidates naturally), TTL 5 min; replace `clearDecryptedKeyCache()` (global) with `evict(keyId)`.
4. `ops/migrate_keys_hkdf.ts`: finish the bulk migration, WP-7.6 removes the legacy path once `SELECT COUNT(*) FROM api_keys WHERE hkdf_migrated = 0` is 0.

**Legacy tests (Appendix B):** `src/worker/router/core/key_resolver.test.ts` (strict decryption).

**Tests**
- AC-07 (ciphertext of tenant A with tenant B's subkey → `KeyDecryptionError`, key quarantined, upstream never called).
- Corrupted ciphertext → quarantine.
- Legacy row decrypts once and is re-encrypted with `hkdf_migrated=1`.

### WP-4.5 Demo pool isolation (v1 2.12)

**Depends on:** WP-4.1

**Findings:** S11 / FR-25 (demo traffic consumes contributor keys), `default`-tenant operator keys (S7 follow-up).

**Implementation.** Reserve tenant `sys_operator` for operator-owned keys (move all `default` rows there after v1 WP 0.7 (done) forensics). Demo tokens authenticate as tenant `sys_demo`; the orchestrator, for `sys_demo`, leases only from `KeyPoolDO("sys_operator")` private keys and never calls the coordinator. Demo requests are excluded from multiplier, debt and pool telemetry.

**Legacy tests (Appendix B):** `src/auth/demo/demo.test.ts` (real DemoDO, `sys_demo`).

**Tests**
- Community keys exist, operator pool empty → demo request 503 `demo_unavailable`, coordinator counters unchanged.
- With an operator key → served, no `cost_ledger` row marked `borrowed`.

### WP-4.6 Make admin circuit override and kill switch real (v1 5.1)

**Depends on:** WP-4.1

**Findings:** stub rows "`POST /api/admin/circuit-breaker`" and "`POST /api/admin/kill-switch`", F8, `MIDNIGHT_FREEZE` (`dispatcher.ts:89`).

**Implementation**
- **Provider override:** coordinator RPC `setProviderOverride(state: "TRIPPED" | "NORMAL", until?, reason, adminUserId)`. While TRIPPED, `lease` returns no keys for that shard and the orchestrator skips the provider; KeyPoolDO checks the same flag (pushed from the coordinator) for private keys. Visible in `/api/admin/providers`.
- **Kill switch:** new singleton `CONTROL` (a coordinator instance named `"control"` is enough) storing `{ maintenance: boolean, reason, since }`. `ApiHost` reads it with a 10-second isolate cache and returns `503 { error: { code: "maintenance" } }` with `Retry-After: 60` while on. `MIDNIGHT_FREEZE` env handling is deleted.
- Both write `admin_audit_logs` (table exists from 0011) and return the stored state, not an echo of the request.

**Legacy tests (Appendix B):** `tests/admin/admin_router.test.ts` (echo tests → effect tests; admin via session).

**Tests** (replace `tests/admin/admin_router.test.ts:161-188`, T-04)
- Trip `groq` → a Groq-only request returns 503 `provider_unavailable` and the upstream mock is not called.
- Resetting the override → the same request is served again.
- Engaging the kill switch → `/v1/chat/completions` returns 503 within 10 s of test clock, while console `/api/*` keeps working.
- Each override and kill-switch change writes an `admin_audit_logs` row.

### Phase 4 gate
- `npm run gate` passes on **both** engines (the Workers suite runs once with `ROUTING_ENGINE=leases` and once with `legacy` for the routing tests).
- AC-01 (lease order), AC-07 (HKDF isolation) pass on `leases`.
- Staging soak on `leases` (48 h, `scripts/soak/commons.mjs` with 5 synthetic tenants): no 5xx increase, ledger `key_id` values are all key ids.

---

## Phase 5 — Commons economy (observe first)

**Release R5. User-visible changes:** keys join the pool after 24 h observation; debt and contribution are real; standing and multiplier are computed; nightly decay; drain detection; jitter at provider resets; the canary probe; truthful pool telemetry; project-hash rotation and tombstones. **New refusals** (brake, eye-for-eye, share cap, jail) are only recorded until the operator enforces them (D-24).

**Compatibility:** `0018`–`0022` are additive. `api_keys.dispatched_today`, `dispatched_communal` and `vesting_tier` are no longer read or written (WP-5.10) but still exist until WP-7.4.

**Rollback:** set `COMMONS_ENFORCEMENT=observe`; redeploy R4 if needed (it ignores the new tables).

### WP-5.1 Commons enforcement switch

**Depends on:** none

**Findings:** v2 review P2-05; D-24.

**Problem.** Phase 5 introduces new refusals for existing users (surge brake, eye-for-eye, share cap, quota jail). Switching them on in the same release that computes them for the first time gives no chance to check the numbers on real traffic.

**Implementation**
1. `src/pool/enforcement.ts`: `type CommonsRule = "brake" | "eye_for_eye" | "share_cap" | "jail"`; `commonsEnforcement(rule, env): "observe" | "enforce"` reads `COMMONS_ENFORCEMENT` (`observe` | `enforce`, default `observe`) and an optional `COMMONS_ENFORCE_RULES` list that enforces only the listed rules.
2. `recordWouldDeny(rule, tenantHash, detail)` writes one telemetry data point `commons_would_deny` (tenant id hashed, never raw).
3. `observe` means: compute the decision, record `would_deny`, and serve the request as if the rule passed. `enforce` means: refuse as the rule's WP specifies.
4. `GET /api/admin/commons/would-deny?hours=24` returns counts per rule and the ten most affected (hashed) tenants, for the operator's review before switching to `enforce`.

**Legacy tests (Appendix B):** none.

**Tests**
- With `COMMONS_ENFORCEMENT` unset, `commonsEnforcement` returns `observe` for every rule.
- `COMMONS_ENFORCEMENT=enforce` with `COMMONS_ENFORCE_RULES=brake` enforces only `brake`.
- `recordWouldDeny` writes exactly one data point without the raw tenant id.
- The admin endpoint aggregates recorded events per rule.

**Done when** every phase-5 refusal can be observed without being enforced.

### WP-5.2 Observation lifecycle and anti-cycling (v1 2.2)

**Depends on:** none

**Findings:** FR-07 (keys never leave OBSERVATION), FR-18 (60-minute anti-cycling tier), AC-05.

**Implementation**
- Coordinator alarm: `UPDATE keys SET status='ACTIVE' WHERE status='OBSERVATION' AND observation_until <= now`, and the same transition in D1 (`api_keys.community_routing_status='ACTIVE'`, `status_changed_at`) in one batch per alarm run. Owners get a notification "Your key joined the community pool" (WP-4.3).
- During OBSERVATION the key is leasable only with `ownOnly=true` (owner's own traffic), per FR-07.
- Pool mode PRIVATE→COMMUNITY always starts a fresh 24 h observation; COMMUNITY→PRIVATE removes it from the coordinator immediately (FR-22 freeze still applies, already correct in `ops.ts:66-76`).
- FR-18: when a submission's project hash had an upstream-revocation tombstone in the prior 24 h, set `api_keys.anti_cycling_until = now + 60 min` (column added by migration `0018_anti_cycling.sql`). Until then the owner's vesting cap is 100 (1.00×) and the key earns no contribution credit.
- Admin "promote all observation" (`admin_handler.ts:213`) stays as an operator override but goes through the coordinator RPC, not raw SQL.

**Legacy tests (Appendix B):** none.

**Tests**
- AC-05: a key submitted at T=0 is not leasable by another tenant at T+23h59m and is at T+24h after one alarm.
- The owner can use it at T+1 min.
- Switching back to COMMUNITY restarts the clock.
- FR-18 case yields multiplier 1.00× for 60 minutes and zero credit.

### WP-5.3 Debt and contribution accounting (v1 2.3)

**Depends on:** none

**Findings:** FR-03 (no callers of `accrueDebt`/`decrementDebt`), D8 (`contributor_standing` never written), AC-02, the hard-coded 1.5×/4.5×/PRISTINE fallbacks (`pool_routes.ts:222-231`, `DebtLedgerWidget.svelte:103-110`).

**Implementation**
1. `TenantQuotaDO` RPC: `accrueDebt(cu, leaseId)`, `credit(cu, leaseId)` (both idempotent on `leaseId`), `standing()`. `credit` first reduces debt, then adds to contribution (PRD: debt "decrements when the contributor's own key serves another user"). Contribution is kept in 24 hourly buckets so `contributed_24h` is a sliding window (D-12).
2. The orchestrator calls both on every `borrowed` settlement (4 in 2.4).
3. **Standing mirror.** Migration `0019_standing.sql` adds `contributor_standing.contributed_cu_24h INTEGER NOT NULL DEFAULT 0`, `multiplier_pct INTEGER NOT NULL DEFAULT 100`, `jail_status TEXT NOT NULL DEFAULT 'PRISTINE'` and `last_reset_day TEXT`. A registration-time `INSERT INTO contributor_standing (tenant_id) VALUES (?)`. TenantQuotaDO marks itself dirty on change; its alarm (every 60 s while dirty) upserts `community_debt_cu`, `contributed_cu_24h`, `multiplier_pct`, `jail_status`, `trusted_contributor`, `consecutive_debt_free_days`, `updated_at`.
4. `GET /api/pool/standing` reads the caller's live standing from their TenantQuotaDO (authoritative); the D1 mirror is used only for admin lists and analytics. Both hard-coded fallbacks are deleted; a missing standing is a 500, not "PRISTINE".
5. `GET /api/pool/contribution` computes `requests_served_for_community_today`, `personal_requests_today`, `cu_contributed_24h`, `cu_borrowed_24h`, `net_cu` from the coordinator (per-owner counters) and TenantQuotaDO.

**Legacy tests (Appendix B):** `test/unit/quota/tenant_do.test.ts` (Workers pool).

**Tests**
- AC-02 with a test catalog override where every request costs exactly 1 CU: 100 borrowed requests → borrower debt 100, lender contribution 100.
- Then the borrower's own community key serves 100 requests for others → borrower debt 0.
- After the alarm, the `contributor_standing` mirror row equals the DO state.
- The standing endpoint for a brand-new user returns debt 0 and multiplier 1.00× from the DO, not from a constant.

### WP-5.4 Nightly reset: decay, trust, streaks (v1 2.5)

**Depends on:** WP-5.3

**Findings:** FR-21 (30 % branch unreachable, float decay, 30 vs 7 days), the midnight jail cliff (audit FR-21 second row), D-07, D-12.

**Implementation** — rewrite `processDailyDebtReset` in `quota/tenant/debt.ts`:
```ts
export function nightlyReset(s: DebtState): DebtState {
  const decayPct = s.trusted ? 30n : 20n;                       // decided BEFORE trust changes
  const debt = s.debtCu - (s.debtCu * decayPct) / 100n;         // floor, integer
  const streak = s.debtCu === 0n ? s.streak + 1 : 0;
  const trusted = s.debtCu > 0n ? false : (s.trusted || streak >= 7);
  return { ...s, debtCu: debt, streak, trusted };               // contribution is a sliding window; not reset
}
```
- The alarm applies `nightlyReset` once per missed day using `last_reset_day` (catch-up after downtime).
- `accrueDebt` resets the streak immediately; the trust flag is cleared at the next reset if debt is positive (PRD: "cleared the first day debt goes positive").
- CONTEXT.md's "30 consecutive days" is corrected to 7.
- Each reset inserts a `standing_history(tenant_id, day, multiplier_pct, debt_cu, contributed_cu_24h, jail_status)` row (migration `0020_standing_history.sql`); the Analytics tab (WP-6.4) reads it.

**Legacy tests (Appendix B):** none.

**Tests**
- Trusted tenant decays 30 %, untrusted 20 %.
- Seven debt-free resets → trusted, 500 ceiling.
- Debt 60 with `contributed_24h` 100 across midnight → SOFT_WARNING, not jailed (the old code jailed).
- Three missed alarms apply three decays.

### WP-5.5 Dispatch counters, hero/parasite, self-key accounting (v1 2.6)

**Depends on:** none

**Findings:** FR-16, FR-02 (`selfKeyRouted` always false), D9 (counter columns never written), AC-10, AC-11, `recordDispatch` missing from the RPC client.

**Implementation**
- Counters live where the key's state lives: coordinator `keys.dispatched_today`/`dispatched_communal` (community keys, incremented in `settle`; `communal` only when `borrowed`), KeyPoolDO for private keys. Both are SQLite-backed DO storage, so they survive eviction (AC-11).
- `recordDispatch` and `selfKeyRouted` are deleted from contracts and code.
- **Classification (FR-16, as decided in D-16).** No credit or debt penalty exists; the only consequence of draining is that a drained key stops earning its owner a multiplier.
  - Counters are kept per key **and model** (Gemini free-tier quotas are per project and per model). On an RPD-exhaustion 429 (detected by WP-4.3), compute `kc_seen_pct = (own + communal dispatches through KC today for that model) × 100 / daily limit` (the model's known limit, else the key's `rpd_limit`) and `communal_pct = communal × 100 / total`.
  - `kc_seen_pct ≥ 50`: a clean exhaustion. Classify `HERO` when `communal_pct ≥ 80` (badge and telemetry only), otherwise `NORMAL`.
  - `kc_seen_pct < 50`: a **drained day**. Store `effective_rpd` (rolling 7-day median of dispatches at exhaustion) and lend at most `min(rpd_limit, effective_rpd)` from then on.
  - A key with drained days on 5 of the last 7 days becomes `DRAINED` (coordinator `keys.drain_state`, mirrored to `api_keys.drain_state` by migration `0021_key_daily_stats.sql`). The owner receives one notification (WP-4.3's table) explaining that the key no longer counts toward their multiplier and how to recover.
  - A day without a drained exhaustion is clean. After 3 consecutive clean days the key returns to `OK` and counts again; the owner is notified.
  - Telemetry event `key_classification` records `kc_seen_pct`, `communal_pct` and the result for every exhaustion.
- At the coordinator's midnight run, per-key daily totals are written to a new D1 table `key_daily_stats(key_id, day, dispatched, communal, cu_served, classification)` (migration `0021_key_daily_stats.sql`) and counters reset.

**Legacy tests (Appendix B):** none.

**Tests**
- AC-10: a key with 85 % communal share that hits its daily limit with `kc_seen_pct ≥ 50` is classified `HERO`; its owner's credit and multiplier are unchanged.
- A key used mostly by its owner through Key Collective and exhausted with `kc_seen_pct ≥ 50` is not a drained day and triggers no notification.
- A key exhausted with `kc_seen_pct < 50` records a drained day and stores `effective_rpd`, which then caps lending.
- Drained days on 5 of 7 days mark the key `DRAINED` and create exactly one notification; the owner's credit, debt and own use of the key are unchanged.
- 3 consecutive clean days return a `DRAINED` key to `OK` with one notification.
- Counters are per model: exhausting the key's Flash quota does not count against its Pro quota.
- AC-11: evicting the coordinator mid-day (via `runInDurableObject` + abort) leaves counters and drain state intact.
- A `key_daily_stats` row per key and model is written at the midnight run.

### WP-5.6 Surge brake (v1 2.7)

**Depends on:** WP-5.1

**Findings:** FR-20 (lone tenant braked after one request, own-key traffic braked, volumes in memory only), R11 (volume = prompt estimate).

**Implementation**
- Remove the pre-dispatch `brake-status` call and the fire-and-forget `report-volume` call from `chat/handler.ts:117-206`.
- The coordinator records **borrowed CU at settle time** (actual CU, fixing R11) into `borrower_window(tenant, minute, cu)`.
- In `lease(ownOnly=false)`: compute the 5-minute window. A brake triggers only when `pool_cu_5min ≥ BRAKE_MIN_POOL_CU` (default 2,000), `active_borrowers ≥ 3`, and `tenant_cu_5min × 100 > 35 × pool_cu_5min`. Brake = refuse borrowed leases for 60 s (`brakes` table) when `commonsEnforcement('brake')` is `enforce`; in `observe` mode record `recordWouldDeny('brake', …)` and grant the lease (WP-5.1). Own keys are never braked.
- Constants in `src/constants/commons.ts`, overridable via `vars` for tuning.

**Legacy tests (Appendix B):** none.

**Tests**
- Single borrower sending 1,000 CU in 5 min → never braked.
- Three borrowers with shares 60/20/20 over the minimum → the 60 % tenant is braked for 60 s, still served by its own keys, and unbraked at +61 s.
- State survives coordinator eviction.
- In `observe` mode the 60/20/20 scenario serves the 60 % tenant from borrowed keys and records exactly one `would_deny` event for `brake`.

### WP-5.7 Eye-for-eye firewall and cold-start share cap (v1 2.8)

**Depends on:** WP-5.1

**Findings:** FR-19 (display flag only), FR-12 (absent), AC-14.

**Implementation**
- FR-19: `lease(ownOnly=false)` requires that the borrower owns at least one `ACTIVE` community key **in this provider shard**. Otherwise, when `commonsEnforcement('eye_for_eye')` is `enforce`, `null` with reason `eye_for_eye` (in `observe` mode: `recordWouldDeny` and continue); the final 429 says which provider needs a contribution. `eye_for_eye_accessible` in `/api/pool/telemetry` is computed from the same function.
- FR-12: coordinator tracks each owner's share of CU served to borrowers over the trailing 24 h. With `N` = distinct owners with ACTIVE keys in the shard, cap = 40 % if `N ≤ 5`, else `max(20 %, 200/N %)`. Owners at or above the cap are excluded from borrowed-lease candidates when `commonsEnforcement('share_cap')` is `enforce` (in `observe` mode: `recordWouldDeny` and keep them).

**Legacy tests (Appendix B):** none.

**Tests**
- Gemini-only contributor cannot borrow Groq (429 `eye_for_eye`).
- AC-14 with N = 4 owners and skewed priority → no owner exceeds 40 % of served CU over 1,000 simulated leases.
- N = 10 → cap 20 %.
- In `observe` mode the Gemini-only contributor is served from Groq community keys and one `would_deny` event for `eye_for_eye` is recorded.

### WP-5.8 Reset jitter and leaky-bucket queue (v1 2.9)

**Depends on:** none

**Findings:** FR-05, FR-23, AC-12; `MIDNIGHT_FREEZE` is an unrelated kill switch (`dispatcher.ts:89`).

**Implementation**
- Provider reset policy in `src/providers/config.ts`: `{ google: { dailyResetTz: "America/Los_Angeles" }, groq: { dailyResetTz: "UTC" } }` — values come from `docs/specs/provider_quotas.md`, which the operator records before stage 2 (**Human**).
- On an RPD-exhaustion 429, the coordinator sets `status='COOLDOWN'`, `reactivate_at = next_reset(provider) + uniform(0, 300 s)` using `crypto.getRandomValues`. The alarm reactivates keys whose `reactivate_at` has passed.
- Leaky bucket: when `lease` returns `null` because every candidate is in COOLDOWN and `now` is within ±5 minutes of that provider's reset, the orchestrator retries with 250 ms backoff for up to 5 s total before returning 429.
- `MIDNIGHT_FREEZE` is renamed `MAINTENANCE_MODE` and folded into the kill switch (WP-4.6).

**Legacy tests (Appendix B):** none.

**Tests**
- AC-12: exhaust 100 keys at 23:59:30 provider time → all `reactivate_at` within [reset, reset+300 s], spread > 240 s, Kolmogorov–Smirnov statistic against uniform below the 0.05 critical value.
- A request at reset−2 s waits and succeeds when a key reactivates within 5 s.

### WP-5.9 Passive contributor canary (v1 2.10)

**Depends on:** none

**Findings:** FR-13 (alarm only classifies).

**Implementation.** KeyPoolDO's 00:00 UTC alarm (it already runs) asks TenantQuotaDO for yesterday's personal request count. If `< 50`, it asks the coordinator for the tenant's community keys and runs the shared proof-of-life probe (WP-3.6) on each: 200 → `HEALTHY`; 401/403 → quarantine flow (WP-4.3); 429 → no action. One request per key per day, as the PRD budgets.

**Legacy tests (Appendix B):** none.

**Tests**
- Passive tenant with 2 community keys, one revoked upstream (mock 401) → that key QUARANTINED and a notification created.
- Active tenant (≥ 50 requests) → no probe calls.

### WP-5.10 Truthful pool telemetry (v1 2.11)

**Depends on:** WP-5.5

**Findings:** `wProvider` float and wrong scale (8.33 vs 1.00×), `pool_utilization_percent` computed as communal share, provider health only refreshed on page views (stub table), D8/D9 display paths.

**Implementation**
- Coordinator alarm (hourly) computes per shard: `active`, `observation`, `quarantined`, `utilisation_pct = Σ day_count × 100 / Σ rpd_limit` over ACTIVE keys (true capacity utilisation), `p90_latency_ms` (from its own settle-time latency histogram, not a D1 scan per page view), and `w_provider_pct = active_ratio_pct × min(100, TARGET_P90_MS × 100 / p90) / 100` with `TARGET_P90_MS = 800`. Displayed as `w_provider_pct / 100` with two decimals (1.00× optimal).
- `/api/pool/telemetry` aggregates both shards' `stats()`; no D1 aggregate query, no `ctx.waitUntil` pushes from a GET handler.
- `get_keys.ts` and `/api/pool/contribution` read per-key counters from the coordinator; after this WP no code reads or writes `api_keys.dispatched_today`, `dispatched_communal` or `vesting_tier`; WP-7.4 drops them one release later (D-26).

**Legacy tests (Appendix B):** none.

**Tests**
- Seeded coordinator with known counters → endpoint returns exact integers.
- `w_provider` is 1.00× when p90 ≤ 800 ms and all keys active.
- No request to the endpoint mutates coordinator state.

### WP-5.11 Project hash lifecycle, rotation and deletion (v1 2.13)

**Depends on:** none

**Findings:** FR-08 (ROTATING / TOMBSTONED never used), AC-06, Flow D (rotate replaces the secret in place with no same-project check), revocation → tombstone.

**Implementation**
- Migration `0022_project_hash_vesting.sql`: `ALTER TABLE project_hash_registry ADD COLUMN vesting_started_at INTEGER;`.
- **Delete** (`DELETE /api/keys/:id`): mark the key `REVOKED` (soft delete, keeps history), remove from DO/coordinator, set its registry row to `ROTATING`, `rotating_until = now + 30 min`, and store `vesting_started_at` on the registry row.
- **Resubmission within 30 min** from the same tenant and same project (probe hash matches) → registry back to `ACTIVE`, new key inherits `vesting_started_at` (vesting preserved). Any other tenant → 409.
- **Expiry:** coordinator alarm (or lazy check at submission) turns expired `ROTATING` into `TOMBSTONED`, `tombstone_until = rotating_until + 14 d`.
- **Upstream permanent revocation** (repeated 401 after the canary) and **takedown** → `TOMBSTONED` directly.
- **Rotate** (`POST /api/keys/:id/rotate`) becomes: probe the new key (same project for Google, else 409 `project_mismatch`), proof-of-life, re-encrypt, update `key_hash`, prefix/suffix; vesting preserved.

**Legacy tests (Appendix B):** none.

**Tests**
- AC-06 (delete, wait 31 min → resubmission from the same project by anyone → 409 for 14 days, accepted after).
- In-window resubmission by owner keeps vesting.
- Rotate with a key from another project → 409.

### WP-5.12 Multiplier and quota jail (v1 2.4)

**Depends on:** WP-5.3, WP-5.10, WP-5.5, WP-5.1

**Findings:** FR-17, FR-26, Flow F / AC-03 (`quota_jail` never produced), evaluator ignoring the multiplier (`quota/tenant/evaluator.ts:66-70`), D-11.

**Implementation**
1. `multiplier_pct = min(vesting_cap, debt_cap, band_cap)`, all integers (100 = 1.00×):
   - `vesting_cap` (FR-17), from the age of the owner's oldest ACTIVE community key whose drain state is `OK` (D-16; `DRAINED` keys do not count): 0–2 h → 150; 2–12 h → 250; ≥ 12 h → 450 (500 if trusted). No counting community key → 100.
   - `debt_cap` (FR-03): `ratio_pct = debt * 100 / max(contributed_24h, 1)`; > 100 → 100 (HARD_JAIL); > 50 → 150 (SOFT_WARNING); else 450 / 500 trusted (PRISTINE).
   - `band_cap` (FR-26) from the coordinator's utilisation for the tenant's providers (WP-5.10): < 60 % → 450; < 80 % → 300; < 95 % → 150; else 100. The coordinator pushes band changes to a small `pool:bands` value that TenantQuotaDO reads on its alarm (not per request).
2. `evaluateQuota` uses `effective_limit = tier_limit * multiplier_pct / 100` for RPM and RPD. Tier limits stay the base (`contracts/v3_types.ts:36`).
3. **Jail.** When `commonsEnforcement('jail')` is `enforce`, `HARD_JAIL` tenants get `ownOnly=true` leases only; in `observe` mode they are served as before, the response carries `x-kc-commons-notice: quota_jail`, and `recordWouldDeny('jail', …)` is logged (WP-5.1). The multiplier itself only raises limits above the tier base, so it applies in both modes. When no own key is available, the response is the PRD Flow F body, in CU:
   ```json
   { "error": { "type": "quota_jail", "code": "quota_jail",
       "message": "Community debt limit reached. Only your own keys are available.",
       "community_debt_cu": 1420, "contributed_cu_24h": 1380, "multiplier": "1.00x",
       "recovery": { "debt_decay": "20% per day at 00:00 UTC", "estimated_days": 3 } } }
   ```
   `estimated_days` = smallest `n` with `debt × 0.8ⁿ ≤ contributed_24h`, computed with integers (loop, max 30).
4. Remove `determineJailStatus`'s dependency on `multiplierCeiling === 100` (fragile equality); jail status derives from `ratio_pct` directly.

**Legacy tests (Appendix B):** none.

**Tests**
- Table test of `multiplier_pct` across vesting × debt × band combinations.
- AC-03 (debt 101, contributed 100, own keys exhausted → 429 `quota_jail` body as above).
- SOFT_WARNING tenant's RPM ceiling equals `tier_rpm × 1.5`.
- Non-contributor stays at tier limits.
- An owner whose only community key is `DRAINED` has `vesting_cap` 100 (1.00×); after the key returns to `OK`, the cap is restored.
- In `observe` mode the AC-03 tenant is served from borrowed keys, the response carries `x-kc-commons-notice: quota_jail`, and one `would_deny` event for `jail` is recorded.

### Phase 5 gate
- AC-02, AC-03, AC-05, AC-06, AC-10, AC-11, AC-12, AC-14 pass in the Workers harness with `COMMONS_ENFORCEMENT=enforce`, and the observe-mode variants pass with `observe`.
- Staging soak: standing, debt and pool telemetry reconcile exactly with `cost_ledger` sums over 30 minutes of 5 synthetic tenants.
- Production: 7 days in observe mode, would-deny report reviewed, then enforcement switched on.

---

## Phase 6 — Frontend truth; stop using microdollars

**Release R6. User-visible changes:** the console shows only server data, the admin panel acts for real, the standing widget follows the PRD states, the navigation follows PRD section 4. The `x-kc-cost-microdollars` header is removed (announced since R2).

**Compatibility:** no migration. WP-6.5 stops every use of the µ$ columns so R7 can drop them.

**Rollback:** redeploy R5.

### WP-6.1 Remove invented data (v1 4.2)

**Depends on:** none

**Findings:** every row of the audit's "Hard-coded or invented data" table.

| Location | Replace with |
| --- | --- |
| `oauth/SybilMatrixSection.svelte:44,64` ("420 days", "84 commits", Turnstile always PASS, wrong thresholds) | `GET /api/session` → `identity.github.{account_age_days, public_repos, contributions_last_year, sybil_score, layer_results[]}` stored at link time (WP-3.1); PRD thresholds; "Not linked" state |
| `AdminView.svelte:147-200`, `CircuitBreakerControls.svelte:59-78` (client-built audit rows, fake `syncDurationMs`, fake bootstrap entries) | `GET /api/admin/audit?limit=50` from `admin_audit_logs`; delete `syncDurationMs` |
| `AdminView.svelte:191` ("Reset quota" demotes to builder) | `POST /api/admin/tenants/:id/reset-quota` → `TenantQuotaDO.reset()` (WP-6.2) |
| `CircuitBreakerControls.svelte:28-57` (latencies 242/118/82/380, DeepSeek) | `GET /api/admin/providers` from coordinator `stats()` + overrides (WP-4.6); only google/groq |
| `TelemetryLogs.svelte:125,150` (`gemini-1.5-pro`, 410/89 tokens) and `metrics_routes.ts:19` (`bytes_in = prompt_tokens × 4`) | Server returns `prompt_tokens`, `completion_tokens`, `cu`, `model`; UI shows "—" when absent; `bytes_in/out` removed |
| `TopNavBar.svelte:74,220-256` (trust 92, tier builder, name collective-dev) | Session fields; hide the badge when unknown |
| Standing defaults (`pool_routes.ts:222-231`, `DebtLedgerWidget.svelte:103-110`) | Live standing from TenantQuotaDO (WP-5.3); loading/error states |
| `oauth/EphemeralSandboxCard.svelte:23,42` ("15 RPM", "15-Min") | Values from `POST /api/demo/token` response (`rpm_limit`, `rpd_limit`, `expires_in`) |
| `KeysTable.svelte:182-185` (RPD 10,000 / RPM 60 fallbacks) | Row values are required by the schema; no fallback |
| `MetricCards.svelte:94` ($1.00 budget ring) | "CU used today / CU allowance today" from `/api/stats` (CU, WP-2.1) |
| `Workbench.svelte:225,246` (`assignedRpm` formula), `:916` (`UTC 2024-11-14 08:34:11`) | `projects.rpm_sub_cap` and live project RPM from TenantQuotaDO; clock renders only from `Date` |
| `App.svelte:69` (apex proxy endpoint) | `API_BASE_URL` (WP-2.7) |

Add a CI guard `scripts/check-ui-literals.mjs` that fails on numeric literals ≥ 10 inside `{…}` template expressions of `ui/src/lib/**/*.svelte` unless whitelisted (layout numbers are in `class`/SVG attributes and excluded).

**Legacy tests (Appendix B):** none.

**Tests**
- For each component in the table above, a render test with an empty API response shows no number or name from the old fallback.
- The same components rendered with an error response show an error state instead of fallback values.
- `scripts/check-ui-literals.mjs` passes on `ui/src/lib`.

### WP-6.2 Real admin panel (v1 4.3)

**Depends on:** none

**Findings:** F8, admin audit/reset rows, admin on console host (WP-2.7).

**Implementation.** Admin SPA served only on `admin.*`. Views: Tenants (live from D1 + DO standing), Keys (routing status, pool mode, delete via coordinator RPC), Providers (coordinator stats, override controls → WP-4.6), Kill switch (WP-4.6), Audit log (server). Every mutation shows the server's response and refreshes from the server.

**Legacy tests (Appendix B):** none.

**Tests**
- Admin tests run against the harness with a real admin session.
- Each action changes server state and writes an audit row.
- UI shows the server's audit list.

### WP-6.3 Standing and debt widget (v1 4.4)

**Depends on:** none

**Findings:** F6, "Standing card" IA row, Flow F card.

**Implementation.** Remove "Resolve debt" and `resolveDebt` entirely (no such concept in the PRD). The widget shows: multiplier with its three caps (vesting / debt / band) and which one binds; `community_debt_cu`, `contributed_cu_24h`, ratio bar with 50 % and 100 % marks; a state card with these states and colours (PRD section 4.2): PRISTINE (debt ≤ 50 % of contribution, green, full multiplier), SOFT_WARNING (> 50 %, yellow, multiplier capped at 1.50×), HARD_JAIL (> 100 %, red, 1.00× locked), TRUSTED (7-day debt-free streak, green with a gold star badge); trusted streak (`consecutive_debt_free_days` / 7); recovery estimate from the server.

**Legacy tests (Appendix B):** `ui/src/lib/DebtLedgerWidget.test.ts` (standing states, CU).

**Tests**
- Render per state (PRISTINE, SOFT_WARNING, HARD_JAIL, TRUSTED) from fixture standings.
- No network call on mount except `GET /api/pool/standing`.

### WP-6.4 Information architecture per PRD section 4 (v1 4.7)

**Depends on:** WP-6.3

**Findings:** every row of the audit's IA table.

**Implementation**

| PRD element | Implementation |
| --- | --- |
| Top tabs Dashboard / Keys / Pool / Analytics | `SideNavBar`/`TopNavBar` rebuilt with these four; Playground and Docs move under a "Developers" menu; Admin only on `admin.*`; "Commons" and "Workbench" tabs merged into Pool and Dashboard |
| Dashboard | Standing card (WP-6.3), today's activity (personal requests, burst used, requests served for community), quick access, credentials (endpoint = `API_BASE_URL`, API keys list with create/rotate) |
| Keys sub-tabs My Keys / Private / Observation | Filtered views of `GET /api/keys`; Observation shows a live countdown from `observation_until`; row expands to detail: pool mode, status, observation, vesting tier, drain state (whether the key counts toward the multiplier, and days until it counts again), 24 h dispatch `n / rpd_limit`, communal share (from coordinator via `/api/keys/:id/stats`), added date |
| Rotate modal | PRD Flow D text; explains the 30-minute same-project window (WP-5.11) |
| Pool toggle modal | Freeze-window message (FR-22) and CU debt settlement text (Flow E) |
| Pool sub-tabs Community / Provider / My Contribution | From `/api/pool/telemetry` and `/api/pool/contribution` (WP-5.10, WP-5.3). Google-only users see a locked Pool tab with a "Link GitHub to join the community pool" call to action (D-05) |
| Analytics sub-tabs Usage / Usage ledger / Multiplier history | Usage: requests and CU per day by model (from `daily_cu_rollup`); ledger: paginated `cost_ledger` (CU, tokens, latency, status, borrowed); multiplier history: `standing_history` rows written by WP-5.4 |
| Public `/report` page | `console…/report` route renders without sign-in, with the Turnstile widget |
| Notification toasts every 30 s | Poll `GET /api/notifications?since=` (WP-4.3); mark read on dismiss |

**Legacy tests (Appendix B):** none.

**Tests**
- Navigation test for the four tabs and sub-tabs.
- Each view renders from msw fixtures that match the contracts.
- `/report` renders signed-out.

### WP-6.5 Stop using microdollars

**Depends on:** none

**Findings:** N-03 (code half of the contract), D-02, D-26.

**Problem.** WP-7.3 drops the µ$ columns and the old rollup table. Migrations apply before the Worker deploys, so the release running at that moment must already have stopped reading and writing them. This WP is that release.

**Implementation**
1. Remove every read and write of `cost_ledger.cost_microdollars`, `auth_tokens.budget_microdollars` / `spent_microdollars`, `contributor_standing.community_debt_micro_cu` and the table `daily_spend_rollup` (those columns all have defaults, so inserts that omit them still succeed until WP-7.3 drops them).
2. Remove the `x-kc-cost-microdollars` response header (announced in the README changelog since WP-2.2).
3. Delete the deprecated µ$ price fields, `calculateCost` and `src/constants/financial.ts`.
4. Update `GEMINI.md` and `CONTEXT.md` invariant #4 to "Integer Credit Units: all capacity accounting is `bigint` CU; no floating point; no currency".

**HIVE:** code-deletion cards use `red: false`, except the header card.

**Legacy tests (Appendix B):** any remaining µ$ assertion.

**Tests**
- Non-streaming responses no longer carry `x-kc-cost-microdollars`.
- A completion writes a `cost_ledger` row with `cu` set and never names `cost_microdollars` in its SQL (checked by a statement-capturing test hook on the ledger repository).
- `grep -rniE "microdollar|dollar" src ui/src` returns nothing outside `migrations/`.

**Done when** no running code touches a µ$ column or the old rollup table.

### Phase 6 gate
- UI suite and `check-ui-literals` pass; `npm run gate` passes.
- Manual walkthrough of PRD Flows A–I on staging recorded in `docs/walkthrough.md`.

---

## Phase 7 — Contract: remove everything deprecated

**Release R7. User-visible changes:** old API URLs stop working (after the sunset and zero-traffic evidence); the console accepts only sessions; unclaimed legacy accounts are suspended.

**Compatibility:** each WP has a **Human** precondition proving that nothing uses what it removes. `0023` and `0024` drop columns that R6 no longer touches (D-26). If a precondition is not met, leave that WP pending and ship the rest.

**Rollback:** code rollback to R6 is safe for everything except the dropped columns; restore those from the pre-deploy D1 export (WP-1.3) only if R6 must run again.

### WP-7.1 Remove the legacy API routes

**Depends on:** none

**Findings:** N-02 (final), D-01, D-22.

**Human (before this WP runs):** confirm that the `Sunset` date set by WP-2.7 has passed **and** that `legacy_route_hit` has been zero for 14 consecutive days (Analytics Engine query in `docs/ops/deploy.md`). If traffic remains, contact the owners of the calling API keys or move the sunset date; do not run this WP.

**Implementation.** Delete `src/worker/api/legacy_routes.ts` and its wiring. The routing tables are now exactly section 2.1's: console and apex never serve `/v1/*`; aliases return 404; apex redirects with 301 (GET/HEAD) or 308 (other methods).

**Legacy tests (Appendix B):** none.

**Tests** (`test/integration/hosts.test.ts`)
- `POST https://console…/v1/chat/completions` → 404; `POST https://api…/chat/completions` → 404; `GET https://key-col.axe08.tech/v1/models` → 301 to the console.
- No response from any host carries a `Deprecation` header.

**Done when** the section 2.1 route matrix passes with no legacy rows.

### WP-7.2 Sessions only on the console; retire unclaimed legacy accounts

**Depends on:** none

**Findings:** D-08 (final), S9 (final), D-27.

**Human (before this WP runs):** the notice period (D-27, 30 days after WP-3.5 shipped) has ended; the operator has emailed or bannered the owners of unclaimed legacy accounts.

**Implementation**
1. Console `/api/*` accepts only `kc_session` (+ CSRF on mutations). The bearer branch added for the transition is deleted. `api.*` still accepts only API keys.
2. No migration. A maintenance route `POST /api/admin/maintenance/suspend-unclaimed-legacy` (admin session) marks every remaining `gh_*` / `usr_gh_*` user `SUSPENDED`, excludes their keys from routing, and writes one `admin_audit_logs` row with the count. **Human:** call it once, then WP-7.7 deletes it.

**Legacy tests (Appendix B):** none.

**Tests**
- A bearer token on console `/api/keys` → 401.
- After the maintenance call, a legacy account's keys are never leased, and a second call changes nothing.

**Done when** the console accepts no bearer credential.

### WP-7.3 Drop the microdollar columns

**Depends on:** none

**Findings:** N-03 (final), D-02.

**Why it is safe now.** WP-6.5 (phase 6, deployed) stopped every read and write of these columns and of `daily_spend_rollup`.

**Implementation.** Migration `0023_credit_units_contract.sql`:
```sql
UPDATE cost_ledger SET cu = 10 + ((prompt_tokens + 999) / 1000)
                          + (((completion_tokens + reasoning_tokens) * 4 + 999) / 1000)
 WHERE cu IS NULL;
ALTER TABLE cost_ledger DROP COLUMN cost_microdollars;
DROP INDEX IF EXISTS idx_daily_spend_rollup_tenant_day;
DROP TABLE daily_spend_rollup;
ALTER TABLE auth_tokens DROP COLUMN budget_microdollars;
ALTER TABLE auth_tokens DROP COLUMN spent_microdollars;
ALTER TABLE contributor_standing DROP COLUMN community_debt_micro_cu;
DROP VIEW IF EXISTS cost_ledger_events; DROP VIEW IF EXISTS daily_spend_rollups; DROP VIEW IF EXISTS model_defs;
```
Drop any other index that references a dropped column first (SQLite refuses otherwise). **Operator:** after this WP merges, add the forbid rule `microdollar|Microdollar` to `.hive/config.json`.

**Legacy tests (Appendix B):** none.

**Tests**
- Migration test: `0023` applies on the production-shaped fixture after `0013`, and every `cost_ledger` row has a non-NULL `cu`.
- The schema conformance test passes against the contracted schema.

**Done when** the database has no µ$ column or table.

### WP-7.4 Key schema contract

**Depends on:** none

**Findings:** D9 (final), D13 (final).

**Implementation**
1. Migration `0024_key_schema_contract.sql`: `ALTER TABLE api_keys DROP COLUMN dispatched_today; ALTER TABLE api_keys DROP COLUMN dispatched_communal; ALTER TABLE api_keys DROP COLUMN vesting_tier;` (drop dependent indexes first). WP-5.10 already stopped every read and write of these columns one release earlier.
2. `normaliseKeyStatus` keeps only the canonical values (the CHECK constraint from 0014 guarantees them); the legacy branches and `toEpochMs`'s seconds/ISO branches for `api_keys` and `projects` columns are deleted. `KeyPoolDO`'s load query becomes `WHERE status = 'HEALTHY'`.

**Legacy tests (Appendix B):** none.

**Tests**
- Migration test: `0024` applies after `0014` on the production-shaped fixture.
- `grep -rn "dispatched_today\|dispatched_communal\|vesting_tier" src` returns nothing.
- `normaliseKeyStatus('Healthy')` now throws (the value can no longer exist).

**Done when** the key schema has no legacy columns and no legacy value handling.

### WP-7.5 Retire the legacy routing engine

**Depends on:** none

**Findings:** PRD 9.3 (final), FR-02 (final), stale per-tenant snapshots.

**Human (before this WP runs):** production has run with `ROUTING_ENGINE=leases` for at least 7 days without a rollback (D-23).

**Implementation**
1. Delete the `ROUTING_ENGINE` switch and the legacy path in `CascadeRouter` (`keyPool.getKey()`), `selfKeyRouted`, `checkSelfKeyAvailable`.
2. `KeyPoolDO` shrinks to private keys: delete the D1 query that loads `pool_type='COMMUNITY'` keys into every tenant DO, and the stage-0 per-key D1 status re-check that only existed for those borrowed snapshots.
3. Remove the variable from `wrangler.jsonc` in every environment.

**Legacy tests (Appendix B):** any test that sets `ROUTING_ENGINE=legacy`.

**Tests**
- A tenant DO's key list contains only its PRIVATE keys.
- `grep -rn "ROUTING_ENGINE\|selfKeyRouted\|checkSelfKeyAvailable" src` returns nothing.

**Done when** the lease orchestrator is the only routing path.

### WP-7.6 Retire legacy global-key decryption

**Depends on:** none

**Findings:** R12 (final), audit HKDF row.

**Human (before this WP runs):** `SELECT COUNT(*) FROM api_keys WHERE hkdf_migrated = 0` returns 0 in production (WP-4.4's lazy migration and `ops/migrate_keys_hkdf.ts` have finished).

**Implementation.** Delete the legacy global-key path from `resolveLeasedKey` and `durable_objects/crypto.ts` `decryptKey`; a row with `hkdf_migrated = 0` is now a `KeyDecryptionError` (quarantine).

**Legacy tests (Appendix B):** `src/durable_objects/crypto.spec.ts` (delete).

**Tests**
- A row with `hkdf_migrated = 0` is quarantined, and the upstream is never called.

**Done when** only tenant subkeys can decrypt a key.

### WP-7.7 Dead code: wire or delete (v1 5.4)

**Depends on:** none

**Findings:** 39 unreachable files (4,085 lines), facades, KeyPoolDO HTTP RPC (N-01 follow-up).

| Path | Action | Reason / owner WP |
| --- | --- | --- |
| `storage/repositories/api_keys/*` (5 files) | **Wire** | Single SQL owner for `api_keys` (WP-3.6) |
| `auth/sybil/*` engine and scoring | **Wire** | GitHub link Sybil check (WP-3.1) |
| `utils/logger.ts` | **Wire** | WP-8.1 |
| `contracts/v4_types.ts` | **Wire** | Becomes part of `src/contracts/api/*` zod contracts shared with the UI (WP-1.5) |
| `contracts/keys.ts` | **Rewrite** | `KeyStatus`, `PoolType` enums (WP-2.6) |
| `auth/oauth/*` (6 files) | Delete | Superseded by `auth/github/link_flow.ts` (WP-3.1) |
| `storage/d1/*` (7 files), `storage/do.ts`, `storage/index.ts` | Delete | Parallel storage layer; repositories are the single layer |
| `storage/repositories/model_registry/*` (5 files) | Delete | Code catalog is the source (WP-1.4); drop the D1 table |
| `proxy/cost_calculator.ts`, `proxy/index.ts` | Delete | Replaced by `calculateCu` (WP-2.1) |
| `contracts/providers.ts` | Delete | Replaced by `src/providers/config.ts` (WP-1.4) |
| Unused barrels: `auth/index.ts`, `constants/index.ts`, `contracts/index.ts`, `durable_objects/index.ts`, `quota/index.ts`, `router/index.ts`, `types/index.ts` | Delete | No importers; direct imports only |
| `durable_objects/key_pool.ts`, `durable_objects/key_pool_do.ts` (facade), `worker/router/chat_handler.ts`, `worker/router/dashboard_handler.ts` (facades) | Delete | Import the real modules |
| `durable_objects/key_pool/rpc.ts` (HTTP RPC router) | Delete | Native DO RPC only (N-01) |
| `durable_objects/crypto.ts` `decryptKey` (legacy global-key path) | Delete after HKDF migration completes | WP-4.4 |
| `worker/router/core/key_resolver.ts` | Replace | `resolveLeasedKey` (WP-4.4) |
| `pool_routes.ts` D1 aggregate queries | Replace | Coordinator stats (WP-5.10) |
| `POST /api/admin/maintenance/backfill-key-hash` (stage 0) and `POST /api/admin/maintenance/suspend-unclaimed-legacy` (WP-7.2) | Delete | One-off routes; the operator has run them (WP-1.3, WP-7.2) |

**HIVE:** each card deletes one module group together with the tests that import it (see section 10.2), so the type check passes per card; these cards use `red: false`.

After deletion, rerun the reachability script (kept as `scripts/reachability.mjs`, added to `gate`) and require zero unreachable non-test files.

**Legacy tests (Appendix B):** `src/auth/oauth.test.ts`, `tests/auth/oauth.test.ts`, `src/storage/d1.spec.ts`, `src/storage/do.spec.ts` (delete with their modules).

### Phase 7 gate
- `npm run gate` passes; reachability script reports zero unreachable files.
- `grep` checks: no `ROUTING_ENGINE`, no `legacy_routes`, no µ$ identifiers, no `'Healthy'`.

---

## Phase 8 — Hardening and release

**Release R8. User-visible change: none.** Explicit error handling everywhere, strict types, the last legacy test rewrites, the acceptance-criteria and security suites, CI gates and documentation.

**Rollback:** redeploy R7.

### WP-8.1 Replace silent failures with explicit handling (v1 5.3)

**Depends on:** WP-7.7

**Findings:** 95 empty `catch` blocks in `src/` (of 191); stub rows for `POST /api/keys` DO sync and the takedown's swallowed UPDATEs; 15 `console.*` calls.

**Implementation**
1. Wire `src/utils/logger.ts` (currently unreachable) as the only logger: structured JSON with `trace_id`, `tenant_id` (hashed), `event`, `error_code`; never logs secrets (the sanitizer from v1 WP 0.6 (done) runs on every message).
2. Add ESLint with `typescript-eslint` (flat config) to root and UI: `no-empty` (error, `allowEmptyCatch: false`), `@typescript-eslint/no-explicit-any` (error), `no-console` (error, except in `logger.ts`), a small custom rule `kc/catch-must-handle` requiring a `catch` body to rethrow, return a typed error, or call `logger.*`.
3. Triage every existing empty catch into one of three buckets and fix accordingly:

   | Bucket | Examples | Fix |
   | --- | --- | --- |
   | Telemetry must not break the request | Analytics Engine `writeDataPoint`, `emitTelemetry` | `catch (e) { logger.debug("telemetry_drop", e) }` |
   | Hid a real failure | DO sync after key insert, takedown UPDATEs, `admin_audit_logs` inserts, KeyPoolDO D1 load, `pool_routes` coordinator calls, key resolver attempts | Remove the try/catch or map to a typed error with an HTTP status; covered by WP-3.6, 0.4, 0.9, 2.1, 3.6 |
   | Guarded optional features | JSON body parse | Return 400 with `invalid_json` |
4. Delete the 15 `console.*` calls (auth routes log raw OAuth errors today).

**Legacy tests (Appendix B):** `test/unit/utils/logger.test.ts` (logger wired; sanitizer assertion).

**Tests**
- Lint runs in `gate:fast` and passes.
- `grep -rc "catch {}" src` reports 0 everywhere.

**HIVE:** one card per top-level directory of `src/`; cards that only add logging use `red: false`.

### WP-8.2 Type safety and configuration hygiene (v1 5.5)

**Depends on:** WP-7.7

**Findings:** 27 `any` in `src/`, 32 in `ui/src/`; `this as any` passed to `handleAdminRequest` (`dashboard/handler.ts:307`); hard-coded GitHub client id and Firebase config; hard-coded admin emails (`admin@keycollective.io`, `admin@keycollective.ai`); dual package managers (`package-lock.json` and `pnpm-lock.yaml` both present, CI uses `npm ci`, `pnpm-workspace.yaml` modified in the working tree).

**Implementation**
- Remove every `any`: DO storage alarm calls use `DurableObjectStorage.getAlarm/setAlarm` from `@cloudflare/workers-types` (no casts); `TenantQuotaDO.ensureLoaded` uses a zod schema for stored data instead of `(stored as any)`.
- Config via `vars`/secrets only: `GITHUB_CLIENT_ID`, `FIREBASE_PROJECT_ID`, `VITE_FIREBASE_*`, `VITE_TURNSTILE_SITE_KEY`, `ADMIN_EMAILS`. The UI reads `import.meta.env`.
- Remove hard-coded emails and domains from UI and server (`admin_handler.ts`, `dashboard/handler.ts:239`, `CircuitBreakerControls.svelte:27`).
- Choose **npm** (CI already uses it): delete `pnpm-lock.yaml` and `pnpm-workspace.yaml` in root and `ui/`.
- `tsconfig`: add `"noUncheckedIndexedAccess": true` and `"exactOptionalPropertyTypes": true` in a follow-up PR once the codebase compiles cleanly.

**Legacy tests (Appendix B):** none.

**Tests**
- `eslint` reports zero warnings on `src` and `ui/src`.
- `tsc --noEmit` passes.
- `grep -rn "Ov23li\|keycollective.io\|keycollective.ai" src ui/src` returns nothing.
- Only one lockfile (`package-lock.json`) exists in the root and in `ui/`.

**HIVE:** one card per directory; these cards change no behaviour and use `red: false`.

### WP-8.3 Rewrite tests that pass without testing (v1 6.2)

**Depends on:** WP-7.7

**Findings:** T-01, T-02, T-04, T-05, T-07. In v2 most rows of section 10.2 are owned by the WP that changes the module (the **Owner** column). This WP covers only the rows still open after phase 7, plus `test/error_normalizer.test.ts`. Per-file actions are in section 10.2 (Appendix B). Principles:
- A handler or DO test runs against real D1 and real DOs in the Workers pool. Hand-rolled D1 mocks are removed (lint rule from v1 WP 1.0 (done)).
- A test that asserts only the echo of its own request body (e.g. circuit-breaker and kill-switch tests) is replaced by one that asserts a downstream effect (a later request's outcome, a DB row, a DO state).
- Tests for security-sensitive code use real inputs from the other side of the boundary: real-shaped Gemini error bodies, signed JWTs, real Turnstile siteverify responses (mocked at the HTTP layer only).
- Migration tests apply **all** migrations, not one.

**HIVE:** one card per test file or small group from section 10.2. Rewrites that keep behaviour use `red: false`; a rewrite that exposes a real bug keeps `red: true` and fixes the bug in the same card.

### WP-8.4 Acceptance-criteria suite (v1 6.3)

**Depends on:** none

**Findings:** T-09, AC-01…AC-15.

One file per criterion under `test/acceptance/`, each named `acNN_<slug>.test.ts`, each a black-box test through `SELF.fetch` on the real hosts:

| AC | Test file | Implemented by |
| --- | --- | --- |
| AC-01 own key first (extended to D-04 order) | `ac01_self_key_priority.test.ts` | WP-4.1 |
| AC-02 debt accrues and is repaid | `ac02_debt_ledger.test.ts` | WP-5.3 |
| AC-03 `quota_jail` 429 | `ac03_quota_jail.test.ts` | WP-5.12 |
| AC-04 same GCP project → 409 | `ac04_project_hash_sybil.test.ts` | WP-3.6 |
| AC-05 24 h observation | `ac05_observation.test.ts` | WP-5.2 |
| AC-06 14-day tombstone | `ac06_tombstone.test.ts` | WP-5.11 |
| AC-07 HKDF isolation | `ac07_hkdf_isolation.test.ts` | WP-4.4 |
| AC-08 no provider headers or project numbers | `ac08_error_normalizer.test.ts` | v1 WP 0.6 (done), WP-2.5 |
| AC-09 takedown timing | `ac09_takedown_timing.test.ts` | v1 WP 0.4 (done) |
| AC-10 hero classification | `ac10_hero_parasite.test.ts` | WP-5.5 |
| AC-11 eviction durability | `ac11_eviction.test.ts` | WP-5.5 |
| AC-12 midnight jitter | `ac12_jitter.test.ts` | WP-5.8 |
| AC-13 gate budget | CI timing check on `gate:fast` (< 10 s) | WP-8.6 |
| AC-14 cold-start cap | `ac14_share_cap.test.ts` | WP-5.7 |
| AC-15 consent 422 | `ac15_consent.test.ts` | WP-3.1 |

**Legacy tests (Appendix B):** none.

### WP-8.5 Security regression suite (v1 6.4)

**Depends on:** none

`test/integration/security/` keeps one file per finding from Phase 0 (S1, S2, S3, S4, S5, S7, S13, N-01, R2) plus S8 (OAuth state), S10 (master key not a credential), S11 (demo isolation), S12 (no query-string credentials). Each test documents the original exploit in a comment and asserts it now fails.

**Legacy tests (Appendix B):** none.

### WP-8.6 Gate and CI (v1 6.5)

**Depends on:** WP-8.1, WP-8.3

**Implementation**
- `package.json`:
  ```json
  "gate:fast": "npm run typecheck && npm run lint && npm run test:unit && node scripts/check-no-sql-mocks.mjs",
  "gate": "npm run gate:fast && npm run test:workers && npm run test:ui && (cd ui && npm run check) && node scripts/reachability.mjs"
  ```
- `Makefile gate` calls `npm run gate`. `.github/workflows/ci-dev.yml` runs `gate` (rename the job from "Fast Quality Gate (<10s)"), and a separate step times `gate:fast` and fails over 10 s (AC-13).
- `deploy-prod.yml`: keep the D1 backup step from WP-1.3 and run `npm run gate` before `wrangler deploy`.
- Coverage: `@vitest/coverage-v8` with thresholds on `src/router/leases`, `src/pool`, `src/quota`, `src/auth`, `src/worker/router/dashboard/keys` (≥ 90 % lines, ≥ 80 % branches); report uploaded as a CI artifact.
- README test badge generated from the CI run.

**Legacy tests (Appendix B):** none.

### WP-8.7 Documentation truth and runbooks (v1 5.6)

**Depends on:** WP-8.6

**Findings:** NFR-06 (secret rotation runbook missing), PRD section 1.2 "Implemented" table, README (304 tests, apex endpoints, µ$ header, aliases), CONTEXT.md (30-day trust, microdollar invariant, paths), `docs/data_contracts.go` and `.py`, the 1199/1199 claim in hive commits.

**Implementation**
- `docs/ops/secret-rotation.md`: dual-key period (`KC_MASTER_KEY` + `KC_MASTER_KEY_NEXT`), `api_keys.key_version` column, background re-encryption via an admin maintenance route in batches of 100, verification query, cutover, removal of the old secret, and rollback.
- `docs/ops/admin-access.md`: granting/revoking admin with `wrangler d1 execute`; break-glass `ADMIN_TOKEN` usage and rotation.
- `docs/ops/deploy.md`: before any migration that rebuilds a table (0014), take a D1 backup (`wrangler d1 export key-collective-d1 --remote --output backups/<date>.sql`) and note the D1 Time Travel restore point; document the backup step WP-1.3 added to `deploy-prod.yml`, the `legacy_route_hit` query used by WP-7.1, the `ROUTING_ENGINE` flip and rollback (D-23), and the `COMMONS_ENFORCEMENT` review (D-24).
- PRD section 1.2: status column reflects reality, updated per phase gate. PRD amendments: D-01 (hosts), D-02/03 (CU replaces µ$ in NFR-03, sections 5–10), D-05 (identity), D-06 (providers), D-14 (gate budget), D-15 (no `/v1beta`).
- README: endpoints (`api.key-col.axe08.tech/v1`), CU, providers, aliases, test count badge generated by CI (never hand-written).
- CONTEXT.md and GEMINI.md invariants: "Integer Credit Units", host topology, identity rules, "no SQL mocks in handler tests".
- Delete `docs/data_contracts.go`, `docs/data_contracts.py` (and `docs/data_contracts.ts` unless it is the generated source of the zod contracts).
- `docs/README.md`: index that labels documents as **normative** (PRD, this plan, INTENT_AUDIT, runbooks, specs) or **historical/generated** (study guide, codeflow, scorecards, hive traces), so agents stop treating generated docs as ground truth.

**Done when** a reviewer can follow README → sign in → create key → call the API without contradicting any document.

**Legacy tests (Appendix B):** none.

### Phase 8 gate (release)
All 15 AC tests, the security suite and `npm run gate` pass in CI; PRD section 1.2 reflects the verified status; README → sign in → create key → call the API works without contradicting any document.

---

## 9. Open questions for the owner

These are defaults in the decisions log. Each is safe as written; change any before its phase starts.

1. **D-22 sunset length.** 30 days after R2, plus 14 days of zero hits. Shorter if you know nobody outside the team calls the apex URL.
2. **D-24 observe period.** 7 days. Enforcement can also be switched on rule by rule.
3. **D-27 notice for GitHub-only accounts.** 30 days. If there are none in production (`SELECT COUNT(*) FROM users WHERE id LIKE 'gh_%' OR id LIKE 'usr_gh_%'`), WP-3.5 and the legacy part of WP-7.2 can be dropped.

---

## 10.1 Appendix A — Traceability matrix (v2 ids)

Every finding from `INTENT_AUDIT.md`, the owner's two concerns, and the issues found while writing this plan. Severity is the audit's rating (— where the audit listed the item without one). WP numbers are v2 ids; `S0` means fixed in stage 0 (v1 phase 0, done).

### New findings raised in this plan

| ID | Finding | Severity | WP |
| --- | --- | --- | --- |
| N-01 | `/v1/keys`, `/v1/metrics`, `/v1/capacity` forward any authenticated request into the tenant DO's HTTP RPC (list ciphertexts, inject keys, manipulate breakers) | Critical | S0, 7.7 |
| N-02 | OpenAI-compatible API reachable on apex, console, dev and via path aliases; UI and OpenAPI point at the apex | High | 2.7 |
| N-03 | Two units of account (µ$ and micro-CU) for a system where nobody pays | High | 2.1 |
| N-04 | Signed-in users receive every community key's id, label, 8-char prefix, 4-char suffix, limits and status from `GET /api/keys` (owner redacted; the full key is **not** exposed). Privacy and PRD section 12 boundary issue only; the key id also fed the S4 takedown-by-id path, fixed in v1 WP 0.4 (done) | Low | S0 |
| N-05 | `deploy-prod.yml` applies remote D1 migrations with no backup step. Harmless so far, but migrations 0012–0014 rename and rebuild tables | High | 8.7, 8.6 |
| N-06 | Both `package-lock.json` and `pnpm-lock.yaml` present; CI uses npm | Low | 8.2 |
| N-07 | `POOL_COORDINATOR` missing from `env.dev` and `env.production` DO bindings in `wrangler.jsonc` | Medium | 2.7 |

### Core economics

| Finding | Severity | WP |
| --- | --- | --- |
| FR-07 keys never leave OBSERVATION | Critical | 5.2 |
| FR-03 debt never accrues / lender never credited | Critical | 5.3 |
| FR-03 / Flow F no `quota_jail` | High | 5.12 |
| FR-17 / FR-26 multiplier never applied; no vesting or utilisation bands | High | 5.12 |
| FR-21 30 % decay unreachable, float decay, 7 vs 30 days | High | 5.4 |
| FR-21 contribution reset jails every debtor at midnight | High | 5.4 (D-12) |
| FR-03 display: `contributor_standing` never written; hard-coded standing | High | 5.3 |
| FR-02 `selfKeyRouted` always false | Medium | 4.1, 5.5 |
| PRD 9.3 coordinator does not pick keys; stale per-tenant snapshots | High | 4.1 |
| FR-04 shared-key limits per consumer DO | High | 4.1 |
| FR-16 hero/parasite counters never recorded; parasite rule conflicts with D-04 (redefined by D-16) | High | 5.5, 5.12 |
| FR-20 brake hits lone tenants and own-key traffic; in-memory volumes | Critical | 5.6 |
| FR-19 eye-for-eye is display-only | High | 5.7 |
| FR-12 cold-start share cap absent | High | 5.7 |
| FR-18 anti-cycling tier absent | Medium | 5.2 |
| FR-05 / FR-23 jitter and leaky bucket absent | Medium | 5.8 |
| FR-13 canary probe never fires | Medium | 5.9 |
| FR-22 midnight freeze (works) | OK | Regression test kept in 5.2 |
| `wProvider` float and wrong scale | — | 5.10 |
| `pool_utilization_percent` is a communal-share ratio | — | 5.10 |
| Communal priority fixed at DO load | — | 4.1 |

### Routing and proxy

| Finding | Severity | WP |
| --- | --- | --- |
| R1 model id used as key id | High | 4.2 |
| R2 upstream error text reaches clients | Critical | S0 |
| R3 normaliser dead; PRD headers missing | Medium | 2.5 |
| R4 secret regex misses `AIza`/`gsk_` | High | S0 |
| R5 Cerebras/SambaNova unroutable | High | 1.4 (D-06: dropped) |
| R6 catalog off-intent, missing aliases, unverified ids | Medium | 1.4 |
| R7 free-tier priced at paid rates | Medium | 2.1 |
| R8 tool calls dropped | High | 2.3 |
| R9 no quarantine on 401/429 | High | 4.3 |
| R10 `/v1beta` not routed | Medium | 2.7 (D-15: removed from scope) |
| R11 brake volume from prompt estimate | Low | 5.6 |
| R12 decryption falls back to key id | Medium | 4.4 |
| R13 shared-key limiter per consumer | High | 4.1 |
| R14 FR-24 passthrough drops fields | Medium | 2.3 |

### Security, auth, compliance

| Finding | Severity | WP |
| --- | --- | --- |
| S1 header-only impersonation | Critical | S0 |
| S2 unauthenticated token minting | Critical | S0, 3.1 |
| S3 user id accepted as admin token | Critical | S0 |
| S4 anyone can revoke community keys | Critical | S0 |
| S5 Turnstile fixtures in production | Critical | S0 |
| S6 error details leak | Critical | S0 |
| S7 `default`-key takeover | High | S0, 4.5 |
| S8 OAuth callback without state/Sybil | High | S0, 3.1 |
| S9 `gh_` vs `usr_gh_` prefix mismatch | High | 3.1 (D-10 makes it moot) |
| S10 master key as admin bearer | High | S0 |
| S11 demo consumes contributor keys | High | 4.5 |
| S12 credentials in query strings | High | S0 |
| S13 `INSERT OR REPLACE` wipes users | High | S0 |
| C1–C3 registration consent not recorded | — | 3.1 |
| K1/K2 consent insert broken; no IP/UA | — | 2.6, 3.6 |
| Takedown rate limit absent | — | S0 |
| Takedown tombstones the wrong hash | — | S0 |
| Proof-of-life probe absent | — | 3.6 |
| GCP probe may no-op on 404 | — | 3.6 |
| HKDF fallbacks weaken isolation | — | 4.4 |
| Secret rotation runbook missing | — | 8.7 |

### Data layer

| Finding | Severity | WP |
| --- | --- | --- |
| D1 consent insert columns do not exist | Critical | 2.6, 3.6 |
| D2 project-hash insert omits `provider` | Critical | 2.6, 3.6 |
| D3 three shapes for consent | Medium | 2.6 |
| D4 `admin_audit_logs` missing | High | S0 (0011), S0 |
| D5 `key_hash` column missing | High | S0 |
| D6 stub `keys` table | High | 3.7 |
| D7 project scope from client header | High | 3.7 |
| D8 standing never synced | High | 5.3 |
| D9 counter columns never written | High | 5.5, 2.6 |
| D10 purge migration in chain (intentional; low risk, tidy-up) | Low | 2.6 |
| D11 mixed timestamp types | Medium | 2.6 |
| D12 notifications keyed on `created_at` | High | 4.3 |
| D13 status value drift | Medium | 2.6 |
| D14 seed data in `default` tenant | Medium | 2.6 |
| D15 duplicate `0001` | Low | 2.6 |
| Float math in debt, standing, `wProvider`, token budgets | — | 2.1 |

### Frontend

| Finding | Severity | WP |
| --- | --- | --- |
| F1 identity in localStorage + header | Critical | S0, 3.1 |
| F2 no Turnstile widget; add key always 403 | Critical | 3.6 |
| F3 Firebase login trusted blindly | Critical | S0, 3.1 |
| F4 PKCE theatre; token in URL | High | S0, 3.1 |
| F5 delete reports success on failure | High | 1.5 |
| F6 "Resolve debt" hits a missing route | High | 6.3 |
| F7 token rotate route missing; project edits not persisted | High | 3.7, 3.9 |
| F8 admin overrides have no effect | High | 4.6, 6.2 |
| F9 Playground reads the wrong cost header | Medium | 3.10 |
| F10 docs list non-existent endpoints and providers | Medium | 3.10 |
| Invented data: Sybil matrix, admin audit log, reset quota, circuit defaults, request log, nav bar, standing, demo card, key table, spend ring, workbench, proxy endpoint (12 rows) | — | 6.1 (row-by-row table) |
| IA: tabs, Keys sub-tabs, Analytics, standing card, `/report`, rotate modal, notifications (7 rows) | — | 6.4 (+ 5.11, 4.3) |

### Stubs, dead code, hygiene

| Finding | WP |
| --- | --- |
| Circuit-breaker override stub | 4.6 |
| Kill-switch stub | 4.6 |
| Key test "syntax verified" stub | 3.8 |
| Takedown swallowed UPDATEs | S0 |
| Key submission DO sync swallowed | 3.6 |
| KeyPoolDO alarm without canary / suspension | 5.9, 5.5 |
| `accrueDebt` / `decrementDebt` unreachable | 5.3 |
| `toClientResponse` unreachable | 2.5 |
| `recordDispatch` unreachable | 5.5 |
| Coordinator `update-provider` only on page view | 5.10 |
| 39 unreachable files (7 module groups) | 7.7 |
| 59 `any` | 8.2 |
| Facade files | 7.7 |
| 15 `console.*` | 8.1 |
| Hard-coded GitHub client id, Firebase config, admin emails | 8.2 |
| `docs/data_contracts.go` / `.py` | 8.7 |
| 95 empty `catch` blocks | 8.1 |

### Tests and docs

| Finding | WP |
| --- | --- |
| T-01 SQL-accepting D1 mocks | S0, 8.3 |
| T-02 one migration tested | 2.6, 8.3 |
| T-03 386 src tests and 40 UI tests outside the gate | S0 |
| T-04 tests asserting stub echoes | 4.6, 8.3 |
| T-05 tests asserting fixture tokens | S0, 8.3 |
| T-06 duplicate / re-exported suites | S0 |
| T-07 tests of unreachable modules | 7.7, 8.3 |
| T-08 no end-to-end tests of critical flows | S0, 8.4 |
| T-09 9 of 15 ACs untested | 8.4 |
| README 304-test badge, "1199/1199" claim, PRD "Implemented" table | 8.7, 8.6 |

---

---

## 10.2 Appendix B — Disposition of every existing test file (with v2 owner)

Actions: **Keep** (valid as is, maybe relocated to `test/unit/pure/`), **Update** (valid intent, assertions change with the fix), **Rewrite** (move to the Workers harness with real D1/DOs), **Delete** (tests dead or duplicated code). "Encodes removed behaviour" lists what must be deleted from the file. **Owner (v2)** is the WP that migrates the file in the same release as the behaviour change (`S0` = done in stage 0, `—` = keep as is). Stage 0 already rewrote parts of several files to its new behaviour (commit `c9f0de2`); owners finish the move to the Workers harness.

| File | Tests | Action | Notes / encodes removed behaviour | Owner (v2) |
| --- | --- | --- | --- | --- |
| `src/auth/demo/demo.test.ts` | 6 | Rewrite | Real DemoDO; demo tenant becomes `sys_demo` (WP-4.5) | 4.5 |
| `src/auth/oauth.test.ts` | 27 | Delete | Identical to `tests/auth/oauth.test.ts`; module deleted (WP-7.7) | 7.7 |
| `src/auth/sybil.test.ts` | 20 | Update → merge | Merge with `tests/auth/sybil.test.ts`; PRD thresholds; no fixture tokens | 3.3 |
| `src/crypto/encryption.spec.ts` | 7 | Keep | Pure crypto | — |
| `src/durable_objects/crypto.spec.ts` | 27 | Delete (after WP-4.4) | Legacy global-key `decryptKey`; uses master key directly | 7.6 |
| `src/durable_objects/key_pool.spec.ts` | 17 | Rewrite | Private-only KeyPoolDO; microdollar assertions → CU | 4.1 |
| `src/proxy/sse_transformer.test.ts` | 40 | Update | Add `include_usage`, `kc.usage` event, estimation flag | 2.4 |
| `src/proxy/upstream_client.test.ts` | 48 | Update | Error messages no longer contain upstream text; only google/groq; µ$ → CU | 2.3 |
| `src/router/capability_filter.test.ts` | 44 | Update | Trimmed catalog; CU | 1.4 |
| `src/router/cascade_router.test.ts` | 29 | Rewrite | `LeaseProvider` instead of `keyPool.getKey`; no `selfKeyRouted` | 4.1 |
| `src/router/model_registry.test.ts` | 39 | Update | CU weights, aliases (`auto`, `smart-fast`, `coder-high`, `open-groq`) | 1.4 |
| `src/storage/d1.spec.ts` | 14 | Delete | Dead D1 adapter with SQL mock | 7.7 |
| `src/storage/do.spec.ts` | 20 | Delete | Dead `storage/do.ts` | 7.7 |
| `src/storage/repositories/auth_tokens/repository.spec.ts` | 5 | Rewrite | Real D1; merge into `authTokens` integration | 2.1 |
| `src/worker/index.test.ts` | 22 | Rewrite | Becomes `hosts.test.ts`; SQL mock removed | 2.7 |
| `src/worker/router/core/key_resolver.test.ts` | 4 | Rewrite | Strict decryption (WP-4.4); remove fallback-attempt tests | 4.4 |
| `src/worker/router_handler.test.ts` | 17 | Rewrite | Remove `requireAuth: false` and `MIDNIGHT_FREEZE` tests (→ kill switch, WP-4.6); master-key tests deleted | 2.7 |
| `test/abuse_routes.test.ts` | 5 | Rewrite | → `security/s4_takedown.test.ts`; SQL mock and ALWAYS_PASS token removed | S0 |
| `test/auth_middleware.test.ts` | (re-export) | Delete | Runs the 43 unit tests twice | S0 |
| `test/durable_objects/circuit_breaker.test.ts` | 23 | Keep/Update | State machine unit; update for `settle` outcomes | 4.1 |
| `test/durable_objects/index.test.ts` | 8 | Update | Export list; µ$ references | 2.1 |
| `test/durable_objects/key_pool_do.test.ts` | 36 | Rewrite | Private-only DO in the Workers pool | 4.1 |
| `test/durable_objects/key_selector.test.ts` | 34 | Update | Community priority moves to coordinator; µ$ → CU | 4.1 |
| `test/durable_objects/rate_limiter.test.ts` | 22 | Update | µ$ → CU | 2.1 |
| `test/env.test.ts` | 3 | Update | New bindings (`API_HOST`, `RATE_LIMITER`, …) | 2.7 |
| `test/error_normalizer.test.ts` | 8 | Rewrite | Unified sanitizer patterns; no `details` to clients | 8.3 |
| `test/integration/worker/index.test.ts` | 25 | Rewrite | Mock stubs + SQL mock → Workers harness; delete `/v1/capacity` forwarding tests (N-01) | 2.7 |
| `tests/admin/admin_router.test.ts` | 10 | Rewrite | Replace echo tests (T-04) with effect tests; admin via session, not master key | 4.6 |
| `tests/api_types.test.ts` | 16 | Update | CU fields | 2.1 |
| `tests/auth/oauth.test.ts` | 27 | Delete | Module deleted | 7.7 |
| `tests/auth/sybil.test.ts` | 38 | Update | Remove fixture-token tests (lines 62-80, 642, 670); PRD thresholds; engine now wired | 3.3 |
| `tests/auth/two_phase_auth.test.ts` | 38 | Rewrite | Split into `identity/*.test.ts` (WP-3.1) and `hosts.test.ts`; SQL mock removed; master-key paths removed | 3.3 |
| `tests/constants.test.ts` | 28 | Update | Microdollar constants → CU constants; master-key constant tests removed | 2.1 |
| `tests/crypto/encryption.test.ts` | 38 | Keep | Pure | — |
| `tests/crypto/hashing.test.ts` | 26 | Keep | Pure | — |
| `tests/crypto/utils.test.ts` | 44 | Keep | Pure | — |
| `tests/errors.test.ts` | 29 | Update | Client serialisation without `details`; CU | 2.2 |
| `tests/integration/coordinator_wiring.test.ts` | 2 | Rewrite | Lease orchestration (WP-4.1) | 4.1 |
| `tests/models_and_config_types.test.ts` | 27 | Update | CU weights; provider list | 2.1 |
| `tests/pool/coordinator_do.test.ts` | 13 | Rewrite | New coordinator in the Workers pool | 4.1 |
| `tests/smoke.test.ts` | 2 | Update | Hosts | 2.7 |
| `tests/storage/migrations.test.ts` | 2 | Rewrite | All migrations + prod-like fixture (WP-2.6) | 1.3 |
| `tests/storage/repositories/apiKeys.test.ts` | 37 | Rewrite | Real D1; repository now wired | 2.6 |
| `tests/storage/repositories/authTokens.test.ts` | 32 | Rewrite | Real D1; CU budgets; no master-key tokens | 2.1 |
| `tests/storage/repositories/costLedger.test.ts` | 40 | Rewrite | Real D1; CU columns, `borrowed`, `lender_tenant_id` | 2.1 |
| `tests/storage/repositories/modelRegistry.test.ts` | 46 | Delete | Repository and table deleted (WP-1.4) | 1.4 |
| `test/unit/quota/limits.test.ts` | 7 | Keep | Tier limits | — |
| `test/unit/quota/tenant_do.test.ts` | 19 | Rewrite | Debt/credit/multiplier/reset in the Workers pool | 5.3 |
| `test/unit/utils/logger.test.ts` | 6 | Keep/Update | Logger now wired; add sanitizer assertion | 8.1 |
| `test/unit/worker/auth_middleware.test.ts` | 43 | Rewrite | Real D1; remove master-key-as-admin and header-tenant tests | 3.1 |
| `test/unit/worker/dashboard_session_telemetry.test.ts` | 5 | Rewrite | Cookie sessions; µ$ → CU | 3.1 |
| `test/unit/worker/router_handler.test.ts` | 31 | Rewrite | Integration through `api.*`; delete `/v1/keys|metrics|capacity` tests | 2.7 |
| `test/unit/worker/telemetry_emitter.test.ts` | 29 | Update | CU doubles | 2.2 |
| `ui/src/lib/AddKeyModal.test.ts` | 15 | Rewrite | Turnstile widget, `x-turnstile-token` header, error codes | 3.6 |
| `ui/src/lib/DebtLedgerWidget.test.ts` | 8 | Rewrite | No resolve; standing states; CU | 6.3 |
| `ui/src/lib/PoolCommonsTab.test.ts` | 4 | Update | Live telemetry schema | 1.5 |
| `ui/src/lib/TelemetryCharts.test.ts` | 13 | Keep | Pure charting | — |

---

---

## 10.3 Appendix C — Migration sequence (v2)

Numbers follow execution order (P2-11). Every migration is compatible with the release running when it applies (D-26). `0010_purge_all_keys.sql` leaves the chain (WP-1.3); `0011` shipped in stage 0.

| # | File | Phase / WP | Kind | Contents |
| --- | --- | --- | --- | --- |
| 0012 | `0012_catalog_cleanup.sql` | 1 / WP-1.4 | Contract (unused table) | `DROP VIEW IF EXISTS model_defs; DROP TABLE model_registry` |
| 0013 | `0013_credit_units_expand.sql` | 2 / WP-2.1 | Expand | CU columns on `cost_ledger`, `auth_tokens`, `contributor_standing`; `daily_cu_rollup`; ledger `usage_estimated`, `borrowed`, `lender_tenant_id`; CU backfill |
| 0014 | `0014_schema_repair.sql` | 2 / WP-2.6 | Rewrite (readers tolerant since R1) | Recreate `consent_attestations`; rebuild `project_hash_registry`; rebuild `api_keys` (status enum, `pool_type` default PRIVATE, INTEGER times, `status_changed_at`, `sync_pending`, `key_version`) |
| 0015 | `0015_identity.sql` | 3 / WP-3.1 | Expand | `user_identities`, `sessions`, `users.community_eligible`, `sybil_assessed_at`, `registration_status`; google identity backfill |
| 0016 | `0016_projects.sql` | 3 / WP-3.7 | Expand + rewrite (tolerated) | `DROP TABLE keys` (stub); `auth_tokens.project_id`; `projects.rpm_sub_cap`, `is_archived`; timestamps ×1000 |
| 0017 | `0017_notifications.sql` | 4 / WP-4.3 | Expand | `notifications` |
| 0018 | `0018_anti_cycling.sql` | 5 / WP-5.2 | Expand | `api_keys.anti_cycling_until` |
| 0019 | `0019_standing.sql` | 5 / WP-5.3 | Expand | `contributor_standing.contributed_cu_24h`, `multiplier_pct`, `jail_status`, `last_reset_day` |
| 0020 | `0020_standing_history.sql` | 5 / WP-5.4 | Expand | `standing_history` |
| 0021 | `0021_key_daily_stats.sql` | 5 / WP-5.5 | Expand | `key_daily_stats`; `api_keys.drain_state` |
| 0022 | `0022_project_hash_vesting.sql` | 5 / WP-5.11 | Expand | `project_hash_registry.vesting_started_at` |
| 0023 | `0023_credit_units_contract.sql` | 7 / WP-7.3 | Contract | Drop µ$ columns and `daily_spend_rollup`; drop compatibility views |
| 0024 | `0024_key_schema_contract.sql` | 7 / WP-7.4 | Contract | Drop `api_keys.dispatched_today`, `dispatched_communal`, `vesting_tier` |

Every migration is covered by `test/integration/migrations.test.ts` (WP-1.3) against an empty database and the production-shaped fixture, and `deploy-prod.yml` exports D1 before applying any of them.
