# Key Collective — Remediation & Implementation Plan

As of 2026-09-30 · revised for HIVE v3 execution · baseline: [`docs/INTENT_AUDIT.md`](INTENT_AUDIT.md) (commit `ba9151d`) and [`docs/PRD.md`](PRD.md) v4.0

This plan covers **every** finding in the intent audit, the two concerns raised after it (API host sprawl, microdollars vs credit units), and seven issues found while writing it (N-01 to N-07). Each finding maps to a work package (WP) with an implementation design, data migration, the tests that prove it, and a "done when" condition. Appendix A (section 10.1) is the full traceability matrix; Appendix B (section 10.2) gives a disposition for every existing test file. The plan is written to be executed by HIVE v3: see **HIVE execution (v3)** for the run configuration and **Plan review v2** for the problems fixed in this revision.

---

## Contents

0. [How to use this plan](#0-how-to-use-this-plan)
   - [HIVE execution (v3)](#hive-execution-v3)
   - [Plan review v2 — problems found and remediations](#plan-review-v2--problems-found-and-remediations)
1. [Decisions log](#1-decisions-log)
2. [Foundations (cross-cutting designs)](#2-foundations-cross-cutting-designs)
   - 2.1 Host topology: all API traffic on `api.key-col.axe08.tech/v1`
   - 2.2 Credit Units replace microdollars
   - 2.3 Identity, pool rights and sessions
   - 2.4 Communal routing through the coordinator
   - 2.5 Test strategy and harness
3. [Phase 0 — Security incident response](#phase-0--security-incident-response)
4. [Phase 1 — Foundations: harness, hosts, identity, CU, schema, key submission](#phase-1--foundations)
5. [Phase 2 — Commons economy](#phase-2--commons-economy)
6. [Phase 3 — Hot-path correctness](#phase-3--hot-path-correctness)
7. [Phase 4 — Frontend truth](#phase-4--frontend-truth)
8. [Phase 5 — Stubs, dead code, hygiene and docs](#phase-5--stubs-dead-code-hygiene-and-docs)
9. [Phase 6 — Tests and quality gate](#phase-6--tests-and-quality-gate)
10. [10.1 Appendix A — Traceability matrix (every finding → WP)](#101-appendix-a--traceability-matrix)
11. [10.2 Appendix B — Disposition of every existing test file](#102-appendix-b--disposition-of-every-existing-test-file)
12. [10.3 Appendix C — Migration sequence](#103-appendix-c--migration-sequence)

---

## 0. How to use this plan

- **Finding IDs** (`S1`, `R2`, `D1`, `F2`, `FR-07` …) refer to `INTENT_AUDIT.md`. New IDs introduced here: `N-01`…`N-07` (listed at the top of Appendix A; e.g. `N-01` DO RPC exposed on `/v1/keys`, `N-02` API host sprawl, `N-03` dual currency), plus test-suite findings `T-01`…`T-09` (section 2.5).
- **Every WP has the same shape:** Findings → Problem → Design / implementation steps → Data & migration → Tests → Done when.
- **Tests are written in the same PR as the fix, and must fail before the fix.** A WP is not done because the new test passes; it is done when the test failed on the old code and passes on the new.
- **Phase gates.** A phase is closed only when all its WPs meet "done when" and the phase gate at the end of the phase passes.
- **Ordering.** Phase 0 ships first and alone (hotfix branch). Phase 1 starts with WP-1.0 (test harness) because every later WP depends on real-D1 tests. Phases 2–5 may overlap once Phase 1 is merged; Phase 6 closes the gate.

| Phase | Theme | Blocks |
| --- | --- | --- |
| 0 | Stop the live security exposure | Everything |
| 1 | Test harness, host routing, identity, CU currency, schema, key submission | 2, 3, 4 |
| 2 | Commons economy (coordinator, debt, multiplier, observation, brake) | 4 (standing UI) |
| 3 | Hot-path correctness | — |
| 4 | Frontend shows only true data | — |
| 5 | Stubs, dead code, hygiene, docs | — |
| 6 | Gate and acceptance criteria | Release |

---

## HIVE execution (v3)

This plan is executed by the HIVE v3 skill (`~/.gemini/config/skills/hierarchical-hive`). The runner compiles every `### WP-…` section below into a work package; planners split each WP into task cards; builders implement cards in separate git worktrees; the runner gates, commits and merges. Text outside WP sections (this section, the decisions log, the review below, phase intros) is for the operator and is not shown to agents unless a WP cites a numbered section (for example "section 2.1").

### Run configuration

```bash
python3 ~/.gemini/config/skills/hierarchical-hive/scripts/hive_runner.py init \
  --plan docs/REMEDIATION_PLAN.md --stages "0|1|2,3,4,5|6" --max-width 6
```

Then set in `.hive/config.json` and run `compile`:

```json
{
  "stage_overrides": { "WP-1.0": 0, "WP-6.1": 0, "WP-3.4": 1,
                       "WP-5.3": 3, "WP-5.4": 3, "WP-5.5": 3, "WP-5.6": 3 },
  "review": { "phases": [0], "globs": ["migrations/*", "**/auth/**", "**/crypto/**", "**/security/**",
                                       "**/quota/**", "**/pool/**", "**/key_resolver*"] },
  "forbid": [
    { "pattern": "catch\\s*(\\([^)]*\\))?\\s*\\{\\s*\\}", "glob": "src/*", "message": "empty catch block" },
    { "pattern": "\\bas any\\b|:\\s*any\\b", "glob": "src/*", "message": "`any` in new code" },
    { "pattern": "\\b(it|test|describe)\\.only\\(", "glob": "*", "message": ".only left in a test" },
    { "pattern": "prepare\\s*:\\s*\\(", "glob": "test*/*", "message": "hand-rolled D1 mock (use the Workers harness)" },
    { "pattern": "x-tenant-id", "glob": "ui/src/*", "message": "client-chosen tenant header" },
    { "pattern": "microdollar|Microdollar", "glob": "*", "message": "microdollars were replaced by CU (D-02)" }
  ]
}
```

`gate.always` stays `npm run -s typecheck` (Worker typecheck, about 3 s). The microdollar rule is added only after WP-1.3 merges (it would block WP-1.3's own expand step). After WP-6.5 lands, set `gate.stage` to `npm run gate`.

### Stages

| Stage | Branch | Work packages | Runs after |
| --- | --- | --- | --- |
| 0 | `hive/stage-0` | WP-1.0 (harness), WP-6.1, then WP-0.1 … WP-0.10 in parallel | — (ships as the security hotfix) |
| 1 | `hive/stage-1` | WP-3.4, WP-1.1 … WP-1.6 | stage 0 sign-off |
| 2 | `hive/stage-2` | WP-2.0 … WP-2.13, WP-3.1 … WP-3.7 (except 3.4), WP-4.1 … WP-4.7, WP-5.1, WP-5.2 | stage 1 sign-off |
| 3 | `hive/stage-3` | WP-5.3 … WP-5.6, WP-6.2 … WP-6.5 | stage 2 sign-off |

Cross-cutting cleanup (WP-5.3 … 5.6) runs last because it touches files in every module; in stage 2 it would serialise behind, and conflict with, feature work.

### Operator (Human) steps

| When | Step | Needed by |
| --- | --- | --- |
| Before stage 0 | Install new dependencies in the main checkout and commit `package.json`/lockfiles on the base branch: root `npm i jose` and `npm i -D @cloudflare/vitest-pool-workers fast-check eslint typescript-eslint @vitest/coverage-v8`; `ui/`: `npm i -D msw`. Builders never install packages: worktrees share `node_modules` through symlinks, so an install inside a worktree would change every running task's dependencies. | WP-1.0, WP-0.2, WP-1.3, WP-4.1, WP-5.3, WP-6.5 |
| After stage 0 is deployed | Run the key-hash backfill route once, then remove it (WP-0.4 step 2). Carry out OP-0.11 (incident response and rotation). | WP-0.4, OP-0.11 |
| Before stage 1 | Confirm `consent_attestations` and `project_hash_registry` are empty in production. Run the GCP forced-error probe against a real free-tier Gemini key and record the raw response in `docs/specs/gcp_probe.md`. | WP-1.4, WP-1.5 |
| During stage 1, after WP-3.4 merges | Run `scripts/verify_catalog.mjs` with real Gemini and Groq keys; fix the catalog ids it reports before WP-1.3 starts (`hive pause` / `resume` if needed). | WP-3.4, WP-1.3 |
| Before stage 2 | Record each provider's daily quota reset time and timezone, with source links, in `docs/specs/provider_quotas.md`. | WP-2.9 |
| At every stage gate | Staging walkthrough listed in the plan's phase gate; sign off, then `advance`. | all |

### Conventions used in the WP text

- **Depends on:** lists the WPs that must be fully merged first. The runner applies it to every card of the WP. Other WP ids in the text are follow-up pointers, not dependencies.
- **Human** marks an operator step. Planners create no cards for it.
- **HIVE:** notes are instructions to planners (card grouping, red-check policy).
- **Red check.** Cards that change behaviour must add a test that fails before the change. Cards that only move, rewrite or delete existing tests or code without changing behaviour (large parts of WP-1.3, WP-5.3 … 5.5, WP-6.1, WP-6.2) use `"red": false`.
- **UI cards** add `cd ui && npm run check` and a targeted `cd ui && npx vitest run <file>` to `verify`, because `gate.always` typechecks only the Worker.
- **Migrations** are numbered per WP in section 10.3. A WP creates only its own migration file.
- **Expected serialisation.** Several stage-0 WPs edit the same files (`dashboard/handler.ts`: WP-0.1, WP-0.3; `core/dispatcher.ts`: WP-0.1, WP-0.8; `ui/src/lib/api.ts`: WP-0.1, WP-0.3; `auth_routes.ts`: WP-0.2, WP-0.10). The runner runs such tasks one after another; this is correct, not a stall.

## Plan review v2 — problems found and remediations

Checked by compiling the plan with the HIVE runner and reading every WP against the others. All remediations are applied in this revision.

| # | Problem | Impact if unfixed | Remediation (applied) |
| --- | --- | --- | --- |
| P-01 | Phase 0 security tests require the Workers test harness, which lived in WP-1.0 (Phase 1). | Stage 0 cards fail validation (dependency on a later stage) or ship without real tests. | WP-1.0 moved to stage 0; every Phase 0 WP declares `Depends on: WP-1.0`. |
| P-02 | WP-1.0's helpers assumed the Phase 1 identity model (`user_identities`, sessions) and created provider keys through `POST /api/keys`, which is broken until WP-1.5. | The harness cannot be built in stage 0. | Stage-0 helpers use the current schema and direct SQL; WP-1.2 and WP-1.5 extend them. |
| P-03 | WP-1.0 bound `RATE_LIMITER`, which WP-0.4 creates later. | WP-1.0 cannot pass its own gate. | WP-1.0 binds the existing four DOs; WP-0.4 adds `RATE_LIMITER` to every environment, including `test`. |
| P-04 | WP-0.4's takedown promised an owner notification, but the notifications table arrives with WP-3.2 (stage 2). | Unfulfillable test item. | Notification moved to WP-3.2; WP-0.4 test item replaced. |
| P-05 | WP-0.4 removed revoked keys "from the coordinator", which has no key registry until WP-2.1. Revoked community keys would keep being lent from other tenants' DO snapshots through stages 0–1. | A reported leaked key stays usable for weeks. | WP-0.4 adds a per-key D1 status re-check (cached 60 s) in `KeyPoolDO.getKey` for keys the tenant does not own. |
| P-06 | WP-0.4's migration comment attributed `admin_audit_logs` to WP-0.3; WP-0.9 is the writer. | Wrong dependency. | Comment fixed; WP-0.9 declares `Depends on: WP-0.4`. |
| P-07 | WP-0.11 is operational only (log searches, secret rotation, incident report). | Builders cannot do it and would file deviations. | Renamed OP-0.11, an operator task outside the WP set. |
| P-08 | Operator-only steps were embedded in WPs (production row counts, live GCP probe, catalog verification with real keys, provider documentation research, running the backfill). | Builders stall or invent results. | Marked **Human** and listed with timing in **HIVE execution (v3)**. |
| P-09 | Four WPs added npm dependencies from inside tasks. | An install in one worktree rewrites the shared `node_modules` under every running task. | All dependencies are pre-installed before stage 0 (operator step). |
| P-10 | WP-1.3 asked for "one mechanical PR" across 78 files. | Impossible under per-card limits (≤ 8 files, typecheck must pass per card). | Rewritten as expand → migrate per module group → contract. |
| P-11 | WP-1.3 assigned CU weights "for the models kept by WP-3.4", but WP-3.4 ran two stages later. | CU weights for models that are about to be deleted, then rework. | WP-3.4 moved to stage 1 and runs first; `/v1/models` CU fields moved from WP-3.4 to WP-1.3. |
| P-12 | WP-1.3 edited `coordinator_do.ts`, which WP-2.1 and WP-2.11 rewrite. | Wasted work and a guaranteed conflict. | Left to WP-2.11. |
| P-13 | WP-1.3's tests (from section 2.2) expected the streaming `kc.usage` event, which WP-3.3 implements in stage 2. | Unfulfillable test item in stage 1. | WP-1.3 tests the non-streaming path; the streaming event stays in WP-3.3. |
| P-14 | WP-1.4 dropped `api_keys.dispatched_*`/`vesting_tier`, still read by `/api/pool/*` and `get_keys.ts` until stage 2. | Pool and key APIs fail between stages. | Columns kept; WP-2.11 drops them (migration 0023) after switching readers. |
| P-15 | WP-1.4 renamed status values (`Healthy` → `HEALTHY` …) without updating the string literals in code, including KeyPoolDO's `status = 'Healthy'` load query. | All key routing stops after stage 1. | WP-1.4 names every file whose literals it must update, with a grep test. |
| P-16 | WP-1.5 called `Coordinator.upsertKey`, a Phase 2 API. | Stage 1 cannot compile or pass. | Stage 1 writes COMMUNITY keys to D1 (OBSERVATION) and to the owner's KeyPoolDO; WP-2.1's reconcile registers them. |
| P-17 | WP-1.5's repository adoption swept KeyPoolDO, `pool_routes.ts` and `admin_handler.ts`, all rewritten later. | Wasted work and conflicts. | Limited to `keys/*.ts` and `abuse_routes.ts`; the others adopt the repository when rewritten. |
| P-18 | WP-1.4 and WP-1.6 both wrote migration 0014; Phase 2 columns lived only in Appendix C's single `0015_commons.sql` that no WP owned. | Edit collisions; WP-2.3, 2.6, 2.2, 2.13 had no migration step. | One migration per WP, numbered 0011–0023 in section 10.3, and each WP names its file. |
| P-19 | Phase 2's test-clock requirement sat in the phase intro, which agents never see. | Time-based tests (observation, decay, brake, jitter) are unimplementable or flaky. | New WP-2.0 "Deterministic test clock"; time-based WPs depend on it. |
| P-20 | WP-4.7 (frontend) expected `standing_history` rows "written at each nightly reset" without owning that code. | Analytics tab has no data. | WP-2.5 writes `standing_history` (migration 0022). |
| P-21 | WP-2.6 contained the open decision D-16. | Planners cannot split an undecided design; builders would guess a penalty. | D-16 decided: no credit penalty; externally drained keys stop counting toward the vesting cap (WP-2.6, WP-2.4). |
| P-22 | Tests referenced by section number ("2.2 list", "(2.1)", "(2.5)") or in appendices. | Not visible to agents; coverage cannot be enforced. | Test bullets inlined into WP-1.1, WP-1.3, WP-1.4. |
| P-23 | WPs cited Appendix B/C, which the compiler does not include in briefs. | Planners for WP-0.5, WP-1.4, WP-6.1, WP-6.2 miss their inputs. | Appendices renumbered as sections 10.1–10.3 and cited by number. |
| P-24 | WP-4.4 relied on PRD section 4.2 colours, outside this plan. | Builders guess. | States and colours inlined. |
| P-25 | 40 WPs had inline test paragraphs; the compiler split some mid-sentence (e.g. WP-2.3). | Wrong or merged test items; weak coverage checks. | All test lists are bullets, one behaviour each. |
| P-26 | No WP declared dependencies. | Planners guess ordering from prose; forward mentions become false dependencies. | Every WP has a **Depends on:** line; the runner enforces it and rejects later-stage dependencies. |
| P-27 | Cleanup WPs (5.3–5.6) spanned every module while feature WPs were editing the same files. | Heavy serialisation and merge conflicts in stage 2. | Moved to stage 3. |
| P-28 | WP-6.1 (bring 386 excluded tests and the UI tests into the gate) was scheduled last. | Every stage gate ran without them. | Moved to stage 0. |
| P-29 | The red check would reject legitimate refactor and test-migration cards (their tests pass before the change too). | Blocked tasks in WP-1.3, 5.x, 6.x. | Red-check policy stated; those cards use `red: false`. |
| P-30 | Phase 0 security tests authenticate with bearer tokens, which WP-1.2 removes from console `/api/*`. | Stage 1 breaks the stage 0 regression suite. | WP-1.2 migrates those tests to session cookies. |
| P-31 | `gate.always` typechecks only the Worker. | UI cards pass the gate without their own type check. | UI cards add `svelte-check` and a targeted UI test to `verify`. |

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
| D-20 | HIVE stages: `0|1|2,3,4,5|6` with overrides WP-1.0 and WP-6.1 → stage 0, WP-3.4 → stage 1, WP-5.3, WP-5.4, WP-5.5, WP-5.6 → stage 3. | Default |
| D-17 | Key deletion is a soft delete (`status='REVOKED'`), so the 30-minute rotation grace and 14-day tombstone (FR-08) have a row to act on. | Default |

---

## 2. Foundations (cross-cutting designs)

### 2.1 Host topology: all API traffic on `api.key-col.axe08.tech/v1` (N-02, D-01)

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
-- model_registry is not migrated: the code catalog becomes the only source and the table is dropped in 0016 (WP-3.4).
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
- Integration: a non-streaming completion returns `x-kc-cu` equal to the recomputed value from `usage`; a streaming completion ends with a `kc.usage` event (added by WP-3.3); `cost_ledger.cu` matches.
- `test/integration/schema_conformance.test.ts` (see 2.5) covers the renamed columns.

**Done when** no identifier, column, header, or UI string mentions dollars or microdollars, and the ledger/standing/budget code paths all use CU.

---

### 2.3 Identity, pool rights and sessions (D-05, D-08, D-10; audit S2, S3, S8, S9, S10, S12, F1, F3, F4, C1–C3)

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
6. **Playground and demo tokens.** `POST /api/playground/token` (session) mints a `kc_live_` key scoped to the user, TTL 15 min, `rpm_limit = 10`. `POST /api/demo/token` (no session, Turnstile) mints a `kc_demo_` key (existing DemoDO limits 3 RPM / 25 RPD per IP) bound to the demo pool (WP-2.12).
7. **Admin.** Admin role is granted only by `wrangler d1 execute` (documented in the runbook), never by an API. `admin.*` requires a `kc_admin_session` created by the same Google flow, plus `users.role = 'admin'`, plus the email in `ADMIN_EMAILS`. `ADMIN_TOKEN` remains only for CLI break-glass calls with `x-kc-admin-token`, and is rejected if the request carries a browser `Origin`.

**Data migration of existing accounts**
- `usr_goog_*` users: keep; insert their `google` identity row; set `registration_status = 'PENDING_CONSENT'` so they re-attest C1–C3 on next login.
- `gh_*` and `usr_gh_*` users: cannot be mapped to a Google account. Mark `registration_status = 'SUSPENDED'`. Their `api_keys` rows are left intact but excluded from routing; a one-time claim flow (`POST /api/auth/claim-legacy` after Google sign-in + GitHub link with the same GitHub id) re-parents keys to the new `usr_goog_*` id and re-encrypts them under the new tenant subkey.
- All existing `auth_tokens` are revoked (S2 means any of them could have been forged). Users create new API keys after signing in.

**Tests**
- See WP-0.2, WP-1.2.

---

### 2.4 Communal routing through the coordinator (D-04, D-13; audit 9.3, FR-04, R13, FR-02, FR-16, FR-19, FR-12, FR-20, FR-05/23)

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
2. Drop owners over the share cap (FR-12, WP-2.8).
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
- See WP-2.1.

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

**Harness** (WP-1.0 implements it):

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

**Gate** (WP-6.5): `gate:fast` (typecheck root + UI `svelte-check`, unit tests, lint rule) < 10 s; `gate` = `gate:fast` + workers integration + UI tests, run in CI on every PR.

---
## Phase 0 — Security incident response

**Goal:** close every unauthenticated or cross-tenant path within one hotfix release, before any feature work. These WPs deliberately use the *existing* token model (bearer tokens in the console) so they can ship fast; Phase 1 replaces that model with cookie sessions.

**Branch:** `hotfix/security-p0`. Deploy to production as soon as the Phase 0 gate passes.

### WP-0.1 Remove header-based tenant resolution

**Depends on:** WP-1.0

**Findings:** S1, F1, part of S7.

**Problem.** `DashboardHandler.handle` assigns `tenantId` from the `x-tenant-id` header whenever the request has no token (`dashboard/handler.ts:131-133`), when a GET carries an invalid token (auth failure is swallowed for GETs, lines 112-128), and when a valid token resolves to `default` or `anonymous` (lines 109-111). The frontend sends that header on every request (`ui/src/lib/api.ts:38-44`), so the backend was built to trust it.

**Implementation**
1. `src/worker/router/dashboard/handler.ts`
   - Delete lines 109-111 and 131-133.
   - Replace the swallow-on-GET `catch` with: every `/api/*` route is **authenticated by default**; a small allow-list is public: `GET /api/session` (returns `{ user: null }` when unauthenticated), `POST /api/abuse/report-key`, `POST /api/auth/*`. Anything else without a valid credential → `401`.
   - Remove the `headerTenant` parameter from every handler signature (`handlePostKeys`, `handleDeleteKey`, `handleRotateKeySecret`, `handleTestKey`, `handleGetLogs`, `handleGetStats`). Admin actions on another tenant's resources move to explicit admin routes under `/api/admin/tenants/:tenantId/...` (they already exist for tier/quarantine; add `DELETE /api/admin/keys/:id` which already exists).
2. `src/worker/router/core/dispatcher.ts`: delete the `options.requireAuth === false` branch that builds a context from `x-tenant-id` (lines ~208-232). Tests that relied on it construct a real token instead (harness helper `createApiKey(tenant)`).
3. Keep the `/v1` mismatch check (`x-tenant-id` present and different from the token tenant → 403), but document that the header is optional and informational.
4. UI: delete the `x-tenant-id` injection in `ui/src/lib/api.ts:38-44`, `Playground.svelte:200-207`, and any other `headers['x-tenant-id']` (grep). Delete `getTenantId()`.

**Tests** (`test/integration/security/s1_header_impersonation.test.ts`, real D1 + DOs)
- No credentials + `x-tenant-id: admin` → `POST /api/admin/pool/manage {action:"PURGE_ALL_KEYS"}` returns 401 and `SELECT COUNT(*) FROM api_keys` is unchanged.
- No credentials + `x-tenant-id: usr_goog_victim` → `GET /api/keys` returns 401.
- Invalid bearer + GET `/api/keys` → 401 (previously fell through).
- Valid token for tenant A + `x-tenant-id: B` on `/api/*` → acts as A (header ignored) and returns only A's data.
- `DELETE /api/keys/<B's key>` with A's token → 404 and the row still exists.

**Done when** `grep -rn "x-tenant-id" src/worker/router/dashboard ui/src` returns nothing and the tests above pass.

### WP-0.2 Replace `sync-session` with verified Google sign-in

**Depends on:** WP-1.0

**Findings:** S2, F3.

**Problem.** `POST /api/auth/sync-session` (`dashboard/auth_routes.ts:170-230`) mints a bearer token for any `id` in the JSON body. `{ "id": "admin" }` produces a token that `verifyAdminRequest` accepts as admin (`admin_verifier.ts:108`). The client computes that id itself from Firebase (`OAuthModal.svelte:259`).

**Implementation**
1. Delete `handleSyncSession` and its route. Return 404 for the path.
2. Use `jose` (pre-installed before the run). New `src/auth/google/verify_id_token.ts`:
   ```ts
   const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
   export async function verifyFirebaseIdToken(idToken: string, projectId: string) {
     const { payload } = await jwtVerify(idToken, JWKS, {
       issuer: `https://securetoken.google.com/${projectId}`, audience: projectId, algorithms: ["RS256"] });
     if (!payload.sub || payload.email_verified !== true) throw new AuthenticationError("unverified_google_identity");
     return { uid: payload.sub, email: String(payload.email ?? "") };
   }
   ```
   `FIREBASE_PROJECT_ID` becomes a `vars` entry (`key-collective-568f8` today).
3. New route `POST /api/auth/google { idToken }`: verify, upsert `users(id = "usr_goog_" + uid)` with `tier = 'builder'` **only on insert** (never from the request), issue a token as today (Phase 1 swaps this for a cookie session).
4. Reserved identifiers: a shared `isReservedTenantId(id)` rejects `admin`, `default`, `demo`, `anonymous`, `guest`, `system`, and anything not matching `^usr_goog_[A-Za-z0-9_-]{10,128}$`. `AuthTokensRepository.create` asserts it.
5. UI `OAuthModal.svelte`: send `await result.user.getIdToken()` instead of a self-built id.

**Tests** (`test/integration/security/s2_token_minting.test.ts`; Google JWKS served via `fetchMock` from a key pair generated in the test)
- `POST /api/auth/sync-session {id:"admin"}` → 404; no `auth_tokens` row created.
- `POST /api/auth/google` with an unsigned JWT, wrong `aud`, wrong `iss`, expired, or `email_verified:false` → 401 each.
- Valid JWT → token whose tenant is `usr_goog_<sub>`; a body field `id: "admin"` is ignored.
- Existing user's `tier` is not changed by signing in again.

### WP-0.3 Harden admin authentication

**Depends on:** WP-1.0

**Findings:** S3, S10, S12.

**Implementation**
1. `gateway/admin_verifier.ts`: delete the "check users table directly with the raw token" block (lines ~141-170). Delete the `tokenRow.tenant_id === "admin"` shortcut; admin is decided only by `users.role = 'admin'` (plus `ADMIN_EMAILS` when set) for the token's tenant.
2. Remove `KC_MASTER_KEY` as a credential: `dashboard/handler.ts:97, 236, 292` and `worker/auth/middleware.ts:199-226`. The master key is an encryption secret only.
3. Remove `?token=` / `?admin_token=` acceptance: `admin_verifier.ts:30-38`, `dashboard/handler.ts:77-85`, `ui/src/lib/api.ts:25-31`, `ui/src/App.svelte:~294`.
4. `ADMIN_TOKEN` (break-glass) is accepted only via `x-kc-admin-token` header, only when there is no `Origin` header, compared with `timingSafeEqualStrings`.
5. `/api/admin/*` on the console host is removed (admin APIs live only on `admin.*`, WP-1.1); in the hotfix, the console path simply calls the same `verifyAdminRequest`.

**Tests** (`security/s3_admin_auth.test.ts`)
- Bearer = an admin's `users.id` → 404 on `admin.*`.
- Bearer = `KC_MASTER_KEY` → 401 on `/v1` and 404 on `admin.*`.
- `?admin_token=<ADMIN_TOKEN>` → 404.
- `x-kc-admin-token` with `Origin: https://evil.test` → 404.
- Genuine admin session → 200.

### WP-0.4 Lock down abuse takedown and key listing

**Depends on:** WP-1.0

**Findings:** S4, D5, FR-11 compliance rows (rate limit, tombstone), PRD section 12 information boundary.

**Implementation**
1. Migration `0011_security_hotfix.sql`:
   ```sql
   ALTER TABLE api_keys ADD COLUMN key_hash TEXT;               -- SHA-256 hex of plaintext key
   CREATE UNIQUE INDEX idx_api_keys_key_hash ON api_keys(key_hash) WHERE key_hash IS NOT NULL;
   ALTER TABLE api_keys ADD COLUMN revoked_at INTEGER;          -- epoch ms
   CREATE TABLE admin_audit_logs (                               -- D4, written by WP-0.9 and later admin actions
     id TEXT PRIMARY KEY, admin_user_id TEXT, admin_email TEXT, action TEXT NOT NULL,
     target TEXT, details_json TEXT NOT NULL DEFAULT '{}', ip_address TEXT,
     created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000));
   CREATE INDEX idx_admin_audit_created ON admin_audit_logs(created_at);
   ```
2. Backfill `key_hash` for existing rows: one-off maintenance route `POST /api/admin/maintenance/backfill-key-hash` (admin host, break-glass header) that decrypts each key in memory, hashes it, writes the hash, and never logs plaintext. **Human:** run it once after deploying stage 0, then remove the route in a follow-up commit.
3. `POST /api/keys` writes `key_hash` at insert (WP-1.5 finalises this).
4. Rewrite `abuse_routes.ts`:
   - Always verify Turnstile (WP-0.5). Rate limit 5 per IP per hour through a new tiny DO `RATE_LIMITER` (`idFromName("abuse:" + ip)`), sliding window in DO storage. Exceeded → 429 (still padded to 200 ms).
     `RateLimiterDO` is a new class: add it to `durable_objects.bindings` in every `wrangler.jsonc` environment and a migration tag `{ "tag": "v6", "new_sqlite_classes": ["RateLimiterDO"] }`; export it from `src/index.ts`.
   - Accept only `leaked_key`. Delete the `keyId` and prefix branches.
   - `UPDATE api_keys SET status='REVOKED', community_routing_status='REVOKED', revoked_at=? WHERE key_hash = ? RETURNING id, tenant_id, provider_project_hash`.
   - On match: `UPDATE project_hash_registry SET state='TOMBSTONED', tombstone_until = now + 14 d WHERE project_hash = <row.provider_project_hash>`; remove the key from its owner's `KeyPoolDO` (`DELETE /keys/<id>` RPC). The owner notification is added later by WP-3.2.
   - Until WP-2.1 replaces per-tenant snapshots, other tenants' `KeyPoolDO` instances still hold copies of community keys. `KeyPoolDO.getKey` therefore re-checks the D1 status of any key the tenant does not own before returning it (`SELECT status FROM api_keys WHERE id = ?`, cached 60 s per key, TTL configurable for tests) and drops keys that are `REVOKED`.
   - Always return `200 { "message": "Report received. Thank you for keeping the commons safe." }` after padding to exactly 200 ms measured from request start (PRD FR-11 text).
5. `GET /api/keys` (`keys/get_keys.ts`): unauthenticated → 401. Authenticated non-admin → **only the caller's own keys** (today it also returns every community key with label and prefix). Mask to first 6 + last 4 characters. `tenant_id` omitted from the response.

**Tests** (`security/s4_takedown.test.ts`)
- Seed two Gemini keys `AIzaSyAB…1`, `AIzaSyAB…2`; report `AIzaSyAB` + garbage → neither revoked.
- Report by `keyId` field → no effect.
- Report the exact plaintext of key 1 → only key 1 revoked; its project hash tombstoned for 14 days.
- After key 1 is revoked, another tenant's `KeyPoolDO` that holds a copy of it no longer returns it (status cache TTL set to 0 in the test environment).
- Hit vs miss timing: 20 of each, mean difference < 10 ms (AC-09), bodies byte-identical.
- 6th report from one IP within an hour → 429.
- Anonymous `GET /api/keys` → 401; tenant A never sees tenant B's labels or prefixes.

### WP-0.5 Remove Turnstile test fixtures from production code

**Depends on:** WP-1.0

**Findings:** S5, T-05.

**Implementation.** Delete the fixture short-circuits from `src/auth/sybil/turnstile.ts:28-55` and `TURNSTILE_TEST_TOKENS` from `constants.ts`. `verifyTurnstileToken` requires `secretKey`; if it is missing, throw `ConfigurationError` (fail closed, 500). For local and staging use Cloudflare's published test **secret** keys through `.dev.vars`, so real siteverify calls return deterministic results. `abuse_routes.ts:40` must call verification unconditionally.

**Tests**
- Unit: `verifyTurnstileToken` with a `fetchFn` stub for siteverify handles success, failure and `timeout-or-duplicate`, and throws `ConfigurationError` when the secret is missing.
- Integration: with siteverify mocked through `fetchMock`, `POST /api/keys` carrying the token `valid_turnstile_response` returns 403.
- `tests/auth/sybil.test.ts` lines 62-80, 642 and 670 use the siteverify stub instead of fixture tokens (section 10.2).

### WP-0.6 Stop upstream error leakage

**Depends on:** WP-1.0

**Findings:** R2, S6, R4, NFR-04.

**Implementation**
1. `worker/router/errors.ts` `formatRouterError`: the client body is always `{ error: { message, type, code } }` plus `x-kc-request-id`. `details` is never serialised to clients. Full details go to the server logger keyed by trace id.
2. `proxy/upstream/errors.ts`: keep the upstream body only on an internal `upstreamBody` property (not in `message`). Messages become fixed strings: `"Upstream rate limit"`, `"Upstream authentication failed"`, `"Upstream unavailable"`, `"Upstream timeout"`.
3. `FallbackExhaustedError` public message: `"All upstream routes failed"`; `attemptedRoutes` kept internally for logs and for the `x-kc-attempts` count header only.
4. `error_normalizer.ts`: one `sanitize(text)` used for every string that can reach a client, with patterns for `AIza[0-9A-Za-z_\-]{35}`, `gsk_[A-Za-z0-9]{20,}`, `sk-[A-Za-z0-9_\-]{20,}`, `Bearer\s+\S+`, `projects/\d{6,}`, `"consumer"\s*:\s*"[^"]+"`, `billingAccounts/[A-Z0-9-]+`, `key=[^&\s"]+`, IPv4. Delete the weaker `sanitizeErrorMessage`.

**Tests** (`security/r2_error_leakage.test.ts`)
- Upstream Gemini 400 with a real-shaped `google.rpc.ErrorInfo` containing `projects/123456789012` and `AIzaSy…` → client body contains neither, contains no `details`.
- Same for 401, 429 and timeout.
- A fallback-exhausted response has no provider error text.
- Unit table test covering every sanitizer pattern.

### WP-0.7 Remove `'default'`-tenant takeover

**Depends on:** WP-1.0

**Findings:** S7.

**Implementation.** In `keys/ops.ts` remove `OR tenant_id = 'default'` (pool-mode line 104, rotate lines 232 and 255) and never assign `tenant_id` in an UPDATE. Keys currently owned by `default` are operator keys: WP-2.12 moves them to the reserved tenant `sys_operator`.

**Forensics.** A key that a user claimed from `default` is still encrypted under the `default` subkey. Run a maintenance check: for each `api_keys` row, try `deriveTenantKey(master, row.tenant_id)`; if that fails and `deriveTenantKey(master, "default")` succeeds, the row was claimed. List those rows for the incident report (WP-0.11) and return them to `sys_operator`.

**Tests** (`security/s7_default_takeover.test.ts`)
- Seed a `default` key.
- Tenant A PATCHes its pool mode and rotates it → both 404.
- Row's `tenant_id` unchanged.

### WP-0.8 Remove raw DO RPC exposure on `/v1/keys`, `/v1/metrics`, `/v1/capacity` (new finding N-01)

**Depends on:** WP-1.0

**Problem (new).** `dispatcher.ts:247-258` forwards any authenticated `/v1/keys*`, `/v1/metrics*`, `/v1/capacity*` request, method and body intact, into the tenant's `KeyPoolDO` HTTP RPC (`durable_objects/key_pool/rpc.ts`). A tenant can therefore `GET /v1/keys` (returns ciphertext and nonce of every community key copied into its DO), `POST`/`PUT /v1/keys` (inject arbitrary keys, bypassing Turnstile, consent, probe and hashing), `DELETE`, and `POST /v1/keys/usage|result|status-code` (manipulate circuit breakers and limiters).

**Implementation.** Delete `forwardToDO` and the three route branches. Convert KeyPoolDO's public surface to typed native RPC methods and delete its HTTP `fetch` router (Phase 5, WP-5.4), so nothing can reach it by URL.

**Tests** (`security/n01_do_rpc.test.ts`)
- Every method on `/v1/keys`, `/v1/keys/usage`, `/v1/metrics`, `/v1/capacity` → 404 on every host.

### WP-0.9 Stop user-row clobbering on quarantine

**Depends on:** WP-1.0, WP-0.4

**Findings:** S13.

**Implementation.** `gateway/admin_handler.ts:671-690`: delete the `INSERT OR IGNORE` / `INSERT OR REPLACE` fallbacks. If the UPDATE changes 0 rows, return 404 `tenant_not_found`. Write an `admin_audit_logs` row for every admin mutation.

**Tests**
- Quarantine an existing user → email, tier and role unchanged.
- Quarantine an unknown id → 404 and no row created.

### WP-0.10 Disable the GitHub callback until the link flow exists

**Depends on:** none

**Findings:** S8 (immediate part), F4 (token in URL).

**Implementation.** `GET /api/auth/github/callback` returns `410 Gone` until WP-1.2 ships the link-only flow. Remove the HTML that posts the token with `postMessage(…, "*")` and the `/?token=` redirect. The UI hides the GitHub button until WP-1.2. Under D-05 GitHub is never a base account, so no user loses access by this.

### OP-0.11 Incident response and rotation (operator task, not a HIVE work package)

**Human:** every step below is done by the operator after stage 0 is deployed.

1. After deploy: `UPDATE auth_tokens SET expires_at = datetime('now')` — every existing token could have been forged via S2. Users sign in again and create new API keys.
2. Rotate `ADMIN_TOKEN` and `GITHUB_CLIENT_SECRET`. `KC_MASTER_KEY` was compared as a bearer but never returned or logged; rotation is not required now, but NFR-06's runbook (WP-5.6) must exist before the next rotation.
3. Search Cloudflare logs (Workers Logs / Logpush) since first deploy of `sync-session` for: `POST /api/auth/sync-session` bodies with reserved ids; any `/api/admin/*` request without an `Authorization` header; `/api/abuse/report-key` volume; `/v1/keys` calls with `PUT`/`POST`.
4. D1 checks: `auth_tokens` with reserved or unknown tenants; `api_keys` where `status='invalid' AND community_routing_status='REVOKED'` (possible griefing via S4 — review and restore); rows found by the WP-0.7 forensic decrypt; `users` rows with `role='admin'` or `tier IN ('admin','ultra')`.
5. Write `docs/incidents/2026-10-auth-bypass.md` with timeline, blast radius and actions.

### Phase 0 gate
- All `test/integration/security/*.test.ts` pass (they run under the new harness; WP-1.0's harness is built **first** inside this hotfix branch if needed — it has no product dependencies).
- `npm run gate` passes.
- Manual verification on staging of the S1, S2, S4 exploit requests returns 401/404.
- Incident report written.

---

## Phase 1 — Foundations

**Goal:** a test harness that runs real SQL and real DOs, one API host, a real identity model, one unit of account, a schema the code actually matches, and a key-submission flow that works end to end.

### WP-1.0 Workers-runtime test harness

**Depends on:** none

**Findings:** T-01, T-02, T-03, T-08.

**Implementation**
1. **Human:** `@cloudflare/vitest-pool-workers` is pre-installed before stage 0 (pinned to a release compatible with Vitest 2.x). Add `env.test` to `wrangler.jsonc` with local-only bindings (D1 `key-collective-d1-test` and the four existing DOs; WP-0.4 adds `RATE_LIMITER` to every environment, including `test`).
2. Create `vitest.workers.config.ts` and `test/setup/apply-migrations.ts` exactly as in 2.5.
3. Helpers in `test/helpers/`:
   - `world.ts` (stage-0 version, current schema): `createUser({ tier })` inserts a `users` row with a `usr_goog_` id; `createApiKey(user, opts)` inserts an `auth_tokens` row and returns the plaintext token; `addProviderKey(user, { provider, pool, plaintext })` encrypts with the tenant subkey and inserts the `api_keys` row directly with SQL (the `POST /api/keys` handler is broken until WP-1.5). WP-1.2 adds `createSession` and identity options; WP-1.5 switches `addProviderKey` to the real handler.
   - `upstream.ts`: `mockGemini({ status, body | sse, usage })`, `mockGroq(...)`, `mockGeminiErrorInfo(projectNumber)`, `mockTurnstile(success)`, `mockGoogleJwks()` + `signFirebaseIdToken(claims)`, `mockGithub(profile, contributions)`. All built on `fetchMock` from `cloudflare:test` with `fetchMock.disableNetConnect()` in `beforeAll`.
   - `hosts.ts`: `api(path)`, `console(path)`, `admin(path)` URL builders.
4. `scripts/check-no-sql-mocks.mjs`: fails if any file under `src/`, `test/`, `tests/` (excluding `test/unit/pure/**`) contains an object literal with a `prepare` key cast to `D1Database`.
5. `package.json` scripts: `test:unit` (root Vitest, node env, pure functions only), `test:workers` (`vitest run -c vitest.workers.config.ts`), `test:ui`, `gate:fast`, `gate` (WP-6.5).

**Done when** a trivial integration test (`SELF.fetch("https://api.test/v1/health")` → 200) and the schema conformance skeleton run in CI.

### WP-1.1 Single API host and route tables

**Depends on:** none

**Findings:** N-02, R10 (dropped by D-15), part of R3.

**Implementation:** exactly section 2.1, steps 1–7. Also:
- `ui/.env.production`: `VITE_API_BASE_URL=https://api.key-col.axe08.tech/v1`; `ui/.env.development`: `http://api.localhost:8787/v1`.
- README quickstart uses `https://api.key-col.axe08.tech/v1/chat/completions` and a `kc_live_` key; local section uses `http://api.localhost:8787/v1`.
- `docs/PRD.md` (proxy and inference gateway table): remove the two `/v1beta` rows and note D-15.

**Tests** (`test/integration/hosts.test.ts`)
- Route matrix: every host × path in the section 2.1 tables returns its exact status; in particular `POST https://console…/v1/chat/completions` → 404, `POST https://key-col.axe08.tech/v1/chat/completions` → 301 to the console, `POST https://api…/chat/completions` → 404, `GET https://api…/api/keys` → 404, `GET https://api…/v1/keys` → 404.
- CORS: a preflight on `api.*` returns `Access-Control-Allow-Origin: *`; a preflight on `console.*` returns no CORS headers.
- `openapi.json` lists exactly one server, `https://api.key-col.axe08.tech/v1`.
- UI unit test: `Playground`, `ApiDocs`, `CodePlayground` snippets and the copy-endpoint button all render `API_BASE_URL`.

### WP-1.2 Identity, pool rights, consent, sessions

**Depends on:** WP-1.1

**Findings:** S8 (full), S9, F3, F4, C1–C3 (FR-15, AC-15), D-05, D-08, D-10.

**Implementation:** section 2.3 in full. Specific code changes:
- New modules: `src/auth/google/verify_id_token.ts` (from WP-0.2), `src/auth/github/link_flow.ts` (start + callback, state cookie signing with `crypto.subtle` HMAC-SHA256), `src/auth/session/store.ts` (create/lookup/revoke sessions, CSRF token), `src/auth/rights.ts`.
- Wire the existing Sybil engine: `src/auth/sybil/engine.ts` becomes the only scorer; its inputs come from the GitHub profile + GraphQL contributions + `cf.asn` / `cf-connecting-ip`. Change thresholds to the PRD's (account age ≥ 30 days, ≥ 1 public repo, ≥ 5 contributions; pass ≥ 65; probationary 40–64).
- Delete `dashboard/auth_routes.ts` (the old callback and sync-session) and the unused `src/auth/oauth/*` client (its PKCE helpers are superseded by `link_flow.ts`).
- Client-held `GITHUB_CLIENT_ID` (`Ov23lijtT90CwzFc8jcy`, hard-coded in `auth_routes.ts:55` and `OAuthModal.svelte:94`) moves to `vars`; the browser no longer builds the authorize URL at all (the server's `/start` does).
- Console UI: `OAuthModal` → `SignIn` (Google only) + `ConsentScreen` (C1–C3 with PRD texts verbatim, submit disabled until all three are ticked) + `Settings → Link GitHub` card that shows the Sybil result (real data, replaces `SybilMatrixSection` fabrications, see WP-4.2).
- `App.svelte` stops writing `kc_user` / `kc_auth_token` to `localStorage`; identity comes from `GET /api/session` on load.
- Legacy account handling and token revocation as in 2.3.
- Update the Phase 0 security tests (`test/integration/security/*.test.ts`) and the harness helpers (`test/helpers/world.ts`: add `createSession` and `google`/`github`/`eligible` identity options) so console `/api/*` calls authenticate with a session cookie and CSRF header instead of a bearer token.

**Tests** (`test/integration/identity/*.test.ts`)
- Google sign-in happy path creates user + identity + `PENDING_CONSENT`; `/api/keys` → 403 `consent_required` until consent.
- `POST /api/auth/consent` missing C2 → 422 listing `C2`; full → 3 `consent_attestations` rows with IP and UA, status `ACTIVE`, `kc_session` cookie set with `HttpOnly; Secure; SameSite=Lax`.
- GitHub start → callback with wrong `state`, tampered cookie, expired cookie → 400 each; GitHub id already linked elsewhere → 409; Sybil score 30 → link refused; 50 → linked, `community_eligible=0`; 80 → eligible.
- Rights matrix: Google-only user may add PRIVATE (201) but not COMMUNITY (403 `github_link_required`); Google+GitHub eligible may add COMMUNITY; Google-only user gets 403 `github_link_required` on `GET /api/pool/telemetry` and `/api/pool/contribution`, eligible user gets 200.
- CSRF: `POST /api/keys` with a valid cookie but no `x-kc-csrf` → 403.
- Session cookie is never sent to `api.*` (host test) and a cookie alone on `api.*` → 401.

### WP-1.3 Credit Units everywhere

**Depends on:** WP-3.4

**Findings:** N-03, R7, fixed-point violations (`debt.ts:52`, `pool_routes.ts:227`, `coordinator_do.ts:124`, `auth_tokens/repository.ts:379,409`).

**Implementation:** section 2.2 in full, executed as an expand → migrate → contract sequence so every card passes the type check on its own:
1. **Expand:** add `src/constants/credits.ts` (`CU`, `ceilDiv`, `formatCu`), the CU fields on the catalog model type, `calculateCu`, and migration `0012_credit_units.sql`, keeping the old µ$ names as deprecated aliases.
2. **Migrate** one module group per card, in parallel: `src/router/registry` and `src/proxy`; `src/storage` (repositories, ledger, rollups, auth tokens); `src/quota`; `src/worker` (handlers, response headers, telemetry); `ui/src` (formatters, MetricCards, Workbench, PricingTable). Each group's tests move with it.
3. **Contract:** delete the aliases and `src/constants/financial.ts`.

**HIVE:** expand and contract cards change no behaviour; they use `red: false`.

Also:
- `debt.ts`: all ratios as scaled integers: `ratio_pct = debt * 100n / max(contributed, 1n)`; decay `debt - (debt * DECAY_PCT) / 100n`.
- `pool_routes.ts`: no float division; `jail_status` comes from TenantQuotaDO (WP-2.3), not recomputed.
- Leave `coordinator_do.ts` alone: WP-2.11 rewrites it with an integer `w_provider_pct`.
- `auth_tokens/repository.ts`: bind `bigint` values as strings (`budget_cu.toString()`), never `Number(bigint)`; D1 stores INTEGER and returns numbers ≤ 2^53, which CU values never approach, but the conversion path must be lossless by construction.
- Catalog: WP-3.4 has already reduced it to Gemini and Groq models. Replace their µ$ price fields with the CU weights in section 2.2, and serve them from `/v1/models` as `kc: { cu_base, cu_in_per_1k, cu_cached_per_1k, cu_out_per_1k }`.
- The streaming `kc.usage` event is added by WP-3.3, not here.

**Tests**
- `test/unit/credits/request_cu.test.ts`: table-driven over every catalog model; boundaries (0 tokens → `cu_base`; 999, 1000 and 1001 tokens); `ceilDiv` correctness; every result is a `bigint`.
- Property test (fast-check): `request_cu` is monotonic in each token count.
- Integration: a non-streaming completion returns `x-kc-cu` equal to the value recomputed from `usage`, and `cost_ledger.cu` matches it.
- `/v1/models` entries carry `kc.cu_base`, `kc.cu_in_per_1k`, `kc.cu_cached_per_1k` and `kc.cu_out_per_1k`.
- `test/unit/pure/no_float_finance.test.ts` scans `src/quota`, `src/pool`, `src/router/registry`, `src/storage` for `parseFloat`, `toFixed`, `Math.round(` on CU identifiers and `Number(` applied to identifiers ending in `Cu`/`_cu`.
- `grep -rniE "microdollar|dollar" src ui/src` returns nothing outside migration history.

### WP-1.4 Schema repair and migration hygiene

**Depends on:** WP-1.3

**Findings:** D1, D2, D3, D4 (created in 0011), D10, D11, D13, D14, D15.

**Human (before stage 1):** confirm that `consent_attestations` and `project_hash_registry` are empty in production (every insert has failed since migrations 0006/0007). If either has rows, stop and amend this WP before it runs.

**Implementation** — migration `0014_schema_repair.sql` (section 10.3 gives the full order):
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
   Align `contracts/v4_types.ts` `ConsentAttestationSchema` with these columns and **use it** at the insert site (parse before bind).
2. **`project_hash_registry` (D2).** Code fix: include `provider` in every insert. Schema: add `rotating_until`/`tombstone_until` as INTEGER epoch ms (rebuild table; emptiness is confirmed by the Human step above).
3. **`api_keys` rebuild (D13, D11).** SQLite cannot add CHECK constraints via ALTER, so rebuild:
   - `status TEXT NOT NULL CHECK (status IN ('HEALTHY','COOLDOWN','QUARANTINED','REVOKED'))`, mapping `Healthy/healthy → HEALTHY`, `invalid → REVOKED` if `community_routing_status='REVOKED'` else `QUARANTINED`, `quarantined → QUARANTINED`, `exhausted/rate_limited → COOLDOWN`.
   - `pool_type` NOT NULL CHECK, default `'PRIVATE'` (today the column default is `'COMMUNITY'`, the opposite of the safe choice).
   - Time columns as INTEGER epoch ms: `observation_until`, `circuit_open_until`, `last_used_at`, `revoked_at`, `status_changed_at` (new, for notifications), `created_at`.
   - Keep `key_hash`, `provider_project_hash`, `hkdf_migrated`, and for now `dispatched_today`, `dispatched_communal`, `vesting_tier`: `/api/pool/*` and `get_keys.ts` still read them. WP-2.11 drops them (migration 0023) after switching those readers to the coordinator.
   - New columns: `sync_pending INTEGER NOT NULL DEFAULT 0` (used by WP-1.5) and `key_version INTEGER NOT NULL DEFAULT 1` (secret rotation, WP-5.6).
   - Recreate indexes.
   - A TypeScript enum `KeyStatus` and `PoolType` in `src/contracts/keys.ts` (today a 1-line file) are the only way code refers to these values. Update every status literal in this WP so routing keeps working after the rebuild: `src/durable_objects/key_pool/key_pool_do.ts` (the D1 load query `status = 'Healthy'`), `src/worker/router/dashboard/keys/get_keys.ts` (status normalisation), `src/worker/router/dashboard/keys/post_key.ts`, `src/worker/router/dashboard/abuse_routes.ts`, `src/worker/gateway/admin_handler.ts`, `src/worker/pool_routes.ts`, and `src/storage/repositories/api_keys/*`.
4. **Timestamp convention (D11).** All machine timestamps are INTEGER epoch milliseconds (`projects` timestamps are converted by WP-1.6's migration). Formatting for people happens only in the UI.
5. **Purge migration (D10).** The purge was intentional (clearing the owner's preloaded real keys for manual testing), and it is harmless on a fresh database because `api_keys` is empty when it runs. The remaining risk is a database that has keys and has not yet applied 0010 (e.g. a new staging copy). Tidy-up: move it to `scripts/qa/purge_all_keys.sql` as an explicit, opt-in reset tool with a guard that refuses the production database name, and delete it from `migrations/` (already-applied databases are unaffected). Low priority.
6. **Duplicate migrations (D15).** Delete `src/storage/migrations/` entirely; `migrations/` is the only source (wrangler default).
7. **Seed data (D14).** `scripts/seed.sql` → `scripts/dev/seed.sql`; it seeds `usr_goog_dev_alice`, `usr_goog_dev_bob` with Google+GitHub identities, no `default` tenant rows; `seed_local.mjs` refuses to run with `--remote`.

**Tests**
- `test/integration/schema_conformance.test.ts` (section 2.5): every repository method and every SQL-writing handler runs against the migrated database without error and produces the expected row.
- `test/integration/migrations.test.ts`: all migrations apply cleanly to an empty database.
- The same migrations applied to a fixture that mimics current production data (mixed status casing, epoch-second project timestamps, `default` rows) produce the normalised values described above.
- After the rebuild, `KeyPoolDO` still loads and serves a `HEALTHY` key, and `grep -rn "'Healthy'\|'invalid'\|'quarantined'" src` returns nothing.

### WP-1.5 Key submission end to end

**Depends on:** WP-1.2, WP-1.4

**Findings:** F2, D1, D2, K1/K2 audit rows (IP, UA), proof-of-life (Flow B phase 2), GCP probe verification (FR-06, IR-09), transactional writes, silent DO-sync failure (`post_key.ts:132-158`), inline SQL drift root cause.

**Implementation**
1. **Turnstile widget (UI).** Add `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` to `ui/index.html`; component `Turnstile.svelte` renders the widget with `VITE_TURNSTILE_SITE_KEY`, exposes the token via a bindable prop and resets after each submission. `AddKeyModal` and `ReportKeyModal` use it; submit stays disabled until a token exists. The API client sends it in `x-turnstile-token` (the header the server reads).
2. **Handler rewrite** (`keys/post_key.ts`), in this order, each failure mapped to a precise error code:
   1. Session + CSRF + rights (`privatePool`; `communityPool` if `pool_type=COMMUNITY`).
   2. Rate limit: 10 key submissions per user per day (`RATE_LIMITER`).
   3. Turnstile.
   4. Body validated with zod: `provider ∈ {google, groq}` (D-06), `key` format per provider (`^AIza[0-9A-Za-z_-]{35}$`, `^gsk_[A-Za-z0-9]{20,}$`), `label ≤ 64`, `k1 === true && k2 === true`, `pool_type`.
   5. Duplicate check: `key_hash` exists → 409 `key_already_registered`.
   6. **GCP probe** (Google only): see step 3 below → `project_hash`. Registry state ACTIVE → 409; TOMBSTONED and `tombstone_until > now` → 409 `project_tombstoned`; ROTATING by the same tenant within 30 min → allowed (rotation completion, WP-2.13); revoked within 24 h → FR-18 observation tier flag.
   7. **Proof of life**: one minimal call per provider (Gemini: `generateContent` on the cheapest model with `maxOutputTokens: 1`; Groq: `chat/completions` on `llama-3.1-8b-instant` with `max_tokens: 1`). 200 → OK; 429 → 400 `key_no_quota`; 401/403 → 400 `key_invalid`; 5xx/timeout → 503 `provider_unavailable` (retryable).
   8. Encrypt with the tenant HKDF subkey, compute `key_hash`.
   9. **One `DB.batch([...])`** (atomic in D1): insert `api_keys` (via `ApiKeysRepository`), insert `project_hash_registry` (with `provider`), insert K1 and K2 `consent_attestations` (with `key_id`, `consent_version`, IP, UA).
   10. After commit, add the key to its owner's `KeyPoolDO` (PRIVATE and COMMUNITY alike, as today). COMMUNITY keys are written to D1 with `community_routing_status='OBSERVATION'` and `observation_until = now + 24 h`; the coordinator's D1 reconcile registers them once WP-2.1 lands (until then they serve only their owner, which is what OBSERVATION requires). If the DO call fails, mark the row `sync_pending=1` (column from WP-1.4) and let the KeyPoolDO reconcile on its next load repair it; return 201 with `"sync": "pending"`. No `catch {}`.
3. **GCP probe verification (FR-06).** **Human (before stage 1):** run the probe against a real free-tier key in staging and record the raw response (status and `details[]`) in `docs/specs/gcp_probe.md`; builders implement against that recorded response and use it as a test fixture. Implement `forceErrorGcpProbe` to accept 400 **and** 404 responses, search every `details[]` entry of type `google.rpc.ErrorInfo` for `metadata.consumer` (`projects/<n>`) and also `google.rpc.Help`/`ResourceInfo` fallbacks, and return `{ projectNumber } | { unavailable: reason }`. If the probe cannot extract a project for a Google key, **reject COMMUNITY submission** (PRIVATE is allowed) — the Sybil guard must fail closed for the community pool.
4. **Repository adoption.** All `api_keys` SQL goes through `src/storage/repositories/api_keys/repository.ts` (currently unreachable dead code). In this WP, `keys/*.ts` and `abuse_routes.ts` stop embedding SQL for this table. `KeyPoolDO` (WP-2.1), `pool_routes.ts` (WP-2.11) and `admin_handler.ts` (WP-5.1) adopt the repository when they are rewritten. The repository's queries are covered by the schema conformance test.

**Tests** (`test/integration/keys/submit.test.ts`)
- Happy path PRIVATE (Groq) and COMMUNITY (Gemini): 201; rows in `api_keys`, `project_hash_registry` (with provider), two consent rows with IP/UA; the COMMUNITY row is `OBSERVATION` with `observation_until` 24 h ahead; the owner's KeyPoolDO lists both keys.
- Each gate returns its code: missing K2 → 400; bad Turnstile → 403; Google-only user + COMMUNITY → 403; malformed key → 400; duplicate plaintext → 409; same GCP project from another user → 409 (AC-04); tombstoned project → 409; probe 429 → 400 `key_no_quota`; probe unavailable + COMMUNITY → 422 `project_unverifiable`.
- Atomicity: force the consent insert to fail (invalid checkbox via test hook) → no `api_keys` row remains.
- DO sync failure (the KeyPoolDO call fails) → 201 with `sync: pending`, and the next KeyPoolDO load picks the key up.
- `test/helpers/world.ts`: `addProviderKey` now goes through `POST /api/keys` with mocked probes.
- UI (`AddKeyModal.test.ts` rewrite): submit disabled until K1, K2 and a Turnstile token; the request carries `x-turnstile-token`; server error codes render human messages.

### WP-1.6 Projects and project-scoped API keys

**Depends on:** WP-1.2

**Findings:** D6, D7, server side of F7.

**Implementation**
- Migration `0015_projects.sql`: `DROP TABLE keys;` (the stub from 0002). `ALTER TABLE auth_tokens ADD COLUMN project_id TEXT REFERENCES projects(id);` `ALTER TABLE projects ADD COLUMN rpm_sub_cap INTEGER; ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;`; `UPDATE projects SET created_at = created_at * 1000, updated_at = updated_at * 1000;` (epoch seconds → milliseconds, D11).
- API keys (`POST /api/tokens`) take an optional `project_id` owned by the caller. The auth context carries `projectId` from the token row; `x-project-id` is no longer read (`auth/middleware.ts:374`). Sub-cap comes from `projects.rpm_sub_cap`.
- `PATCH /api/projects/:id` persists `name`, `description`, `rpm_sub_cap` (bounded by tier), `is_archived`; archived projects' tokens are rejected with 403 `project_archived`.
- `POST /api/tokens/:id/rotate` is implemented (the UI already calls it): new secret, same id and project, old hash replaced, response shows the secret once.

**Tests**
- Token bound to project P with sub-cap 2 → third request in a minute returns 429 `project_sub_cap_exceeded` even with `x-project-id` omitted or set to another project.
- Archived project → 403.
- Token rotate returns a new working secret and the old one → 401.

### Phase 1 gate
- Harness, host matrix, identity, CU, schema conformance, key submission and project tests pass.
- `grep` checks: no `x-tenant-id` in UI; no `microdollar` in `src`/`ui/src`; no `localStorage` use for credentials.
- Staging: a new user can sign in with Google, consent, add a PRIVATE Groq key, create an API key and call `https://api-dev…/v1/chat/completions` successfully; after linking GitHub the same user can add a COMMUNITY Gemini key.

---

## Phase 2 — Commons economy

**Goal:** the reciprocal commons works as the PRD intends. Contributors earn CU and burst, borrowers accrue debt, jail and decay behave, new keys join after 24 hours, and shared keys respect their real limits.

Time-dependent tests use the deterministic clock from WP-2.0.

### WP-2.0 Deterministic test clock for Durable Objects

**Depends on:** none

**Findings:** prerequisite for the time-based tests of FR-05, FR-07, FR-13, FR-20, FR-21, AC-05, AC-06 and AC-12.

**Implementation**
1. `src/utils/clock.ts`: `export interface Clock { now(): number }` and `systemClock`. `KeyPoolDO`, `TenantQuotaDO`, `PoolCoordinatorDO`, `DemoDO` and the lease orchestrator receive a `Clock` and never call `Date.now()` directly in lease, window, backoff or alarm code.
2. When `env.KC_ENV === "test"`, each of those DOs exposes an RPC method `setClockForTest(ms: number)` that switches it to a fixed clock; in any other environment the method throws.
3. Test helper `test/helpers/clock.ts`: `advance(stub, ms)` sets the clock and then calls `runDurableObjectAlarm(stub)` from `cloudflare:test`.
4. `vitest.workers.config.ts` binds `KC_ENV: "test"`; `wrangler.jsonc` never sets it.

**Tests** (`test/do/clock.test.ts`)
- A DO in the test environment reports the time set by `setClockForTest`.
- `setClockForTest` throws when `KC_ENV` is not `test`.
- `advance()` fires a DO alarm scheduled for the new time.

### WP-2.1 Coordinator key registry and leases

**Depends on:** WP-2.0

**Findings:** PRD 9.3 (`getNextCommunityKey` absent), FR-04 / R13 (shared-key limits tracked per consumer), stale per-tenant snapshots (`key_pool_do.ts:198-260`), priority fixed at first load (`key_pool_do.ts:225-240`), part of FR-02.

**Implementation**
1. **Coordinator rewrite** as specified in 2.4 (SQLite tables, typed RPC `lease/settle/upsertKey/removeKey/setStatus/stats/reconcile`, 60 s alarm, 5 min D1 reconcile). Delete the HTTP `fetch` endpoints (`/coordinator/health`, `/report-volume`, `/update-provider`, `/brake-status/*`).
2. **KeyPoolDO shrinks to private keys.** Delete the D1 query that loads `pool_type='COMMUNITY'` keys into every tenant DO. KeyPoolDO loads the tenant's PRIVATE keys from D1 on first access and whenever `reconcile()` is called (after add/delete/pool-mode). Its circuit breaker and limiter keep working for private keys only. New RPC: `leasePrivate(provider, estimateCu)`, `settle(leaseId, outcome)`.
3. **Lease orchestrator** `src/router/leases/orchestrator.ts`, implementing the request sequence in 2.4. It exposes `acquire(provider, ctx): Lease | null` with `Lease = { leaseId, keyId, source: "private" | "own_community" | "borrowed", ownerTenantId }` and `settle(lease, outcome)`.
4. **CascadeRouter** stops calling `keyPool.getKey()` directly. `executeCascadeRouting` receives a `LeaseProvider`; for each candidate model it asks for a lease on that provider, dispatches, then settles. `selfKeyRouted` and `checkSelfKeyAvailable` are deleted (replaced by `lease.source`).
5. **Priority is computed at lease time**, not at load: owner debt boost `min(5000, owner_debt_cu / 10)` (a debtor's key is lent first so they pay down debt), `PARASITE` +2000, `HERO` −1000, then headroom. Owner debt is pushed to the coordinator by TenantQuotaDO whenever it changes (`coordinator.setOwnerDebt(owner, cu)`), so no cross-DO read on the hot path.

**Tests** (`test/integration/commons/leases.test.ts`)
- Order (AC-01 generalised): tenant T with a PRIVATE Gemini key, a COMMUNITY Gemini key, and access to U's COMMUNITY key → first request uses PRIVATE; after PRIVATE hits its RPM, the next uses T's COMMUNITY key (no debt); after that is exhausted, U's key (debt accrues). Assert `lease.source` via `cost_ledger.borrowed` and `lender_tenant_id`.
- Global limit: U's key `rpm_limit=2`; tenants A and B each send 2 requests in the same minute → exactly 2 are served by U's key and the rest go elsewhere or 429.
- Revocation visibility: revoke U's key via takedown → the very next lease never returns it (no stale snapshot).
- Idempotency: calling `settle` twice with the same lease id changes counters and debt once.
- Concurrency: 50 parallel leases against a key with `rpm_limit=10` → exactly 10 granted.

### WP-2.2 Observation lifecycle and anti-cycling

**Depends on:** WP-2.1

**Findings:** FR-07 (keys never leave OBSERVATION), FR-18 (60-minute anti-cycling tier), AC-05.

**Implementation**
- Coordinator alarm: `UPDATE keys SET status='ACTIVE' WHERE status='OBSERVATION' AND observation_until <= now`, and the same transition in D1 (`api_keys.community_routing_status='ACTIVE'`, `status_changed_at`) in one batch per alarm run. Owners get a notification "Your key joined the community pool" (WP-3.2).
- During OBSERVATION the key is leasable only with `ownOnly=true` (owner's own traffic), per FR-07.
- Pool mode PRIVATE→COMMUNITY always starts a fresh 24 h observation; COMMUNITY→PRIVATE removes it from the coordinator immediately (FR-22 freeze still applies, already correct in `ops.ts:66-76`).
- FR-18: when a submission's project hash had an upstream-revocation tombstone in the prior 24 h, set `api_keys.anti_cycling_until = now + 60 min` (column added by migration `0019_anti_cycling.sql`). Until then the owner's vesting cap is 100 (1.00×) and the key earns no contribution credit.
- Admin "promote all observation" (`admin_handler.ts:213`) stays as an operator override but goes through the coordinator RPC, not raw SQL.

**Tests**
- AC-05: a key submitted at T=0 is not leasable by another tenant at T+23h59m and is at T+24h after one alarm.
- The owner can use it at T+1 min.
- Switching back to COMMUNITY restarts the clock.
- FR-18 case yields multiplier 1.00× for 60 minutes and zero credit.

### WP-2.3 Debt and contribution accounting

**Depends on:** WP-2.1

**Findings:** FR-03 (no callers of `accrueDebt`/`decrementDebt`), D8 (`contributor_standing` never written), AC-02, the hard-coded 1.5×/4.5×/PRISTINE fallbacks (`pool_routes.ts:222-231`, `DebtLedgerWidget.svelte:103-110`).

**Implementation**
1. `TenantQuotaDO` RPC: `accrueDebt(cu, leaseId)`, `credit(cu, leaseId)` (both idempotent on `leaseId`), `standing()`. `credit` first reduces debt, then adds to contribution (PRD: debt "decrements when the contributor's own key serves another user"). Contribution is kept in 24 hourly buckets so `contributed_24h` is a sliding window (D-12).
2. The orchestrator calls both on every `borrowed` settlement (4 in 2.4).
3. **Standing mirror.** Migration `0017_standing.sql` adds `contributor_standing.contributed_cu_24h INTEGER NOT NULL DEFAULT 0`, `multiplier_pct INTEGER NOT NULL DEFAULT 100`, `jail_status TEXT NOT NULL DEFAULT 'PRISTINE'` and `last_reset_day TEXT`. A registration-time `INSERT INTO contributor_standing (tenant_id) VALUES (?)`. TenantQuotaDO marks itself dirty on change; its alarm (every 60 s while dirty) upserts `community_debt_cu`, `contributed_cu_24h`, `multiplier_pct`, `jail_status`, `trusted_contributor`, `consecutive_debt_free_days`, `updated_at`.
4. `GET /api/pool/standing` reads the caller's live standing from their TenantQuotaDO (authoritative); the D1 mirror is used only for admin lists and analytics. Both hard-coded fallbacks are deleted; a missing standing is a 500, not "PRISTINE".
5. `GET /api/pool/contribution` computes `requests_served_for_community_today`, `personal_requests_today`, `cu_contributed_24h`, `cu_borrowed_24h`, `net_cu` from the coordinator (per-owner counters) and TenantQuotaDO.

**Tests**
- AC-02 with a test catalog override where every request costs exactly 1 CU: 100 borrowed requests → borrower debt 100, lender contribution 100.
- Then the borrower's own community key serves 100 requests for others → borrower debt 0.
- After the alarm, the `contributor_standing` mirror row equals the DO state.
- The standing endpoint for a brand-new user returns debt 0 and multiplier 1.00× from the DO, not from a constant.

### WP-2.4 Multiplier and quota jail

**Depends on:** WP-2.3, WP-2.11, WP-2.6

**Findings:** FR-17, FR-26, Flow F / AC-03 (`quota_jail` never produced), evaluator ignoring the multiplier (`quota/tenant/evaluator.ts:66-70`), D-11.

**Implementation**
1. `multiplier_pct = min(vesting_cap, debt_cap, band_cap)`, all integers (100 = 1.00×):
   - `vesting_cap` (FR-17), from the age of the owner's oldest ACTIVE community key whose drain state is `OK` (D-16; `DRAINED` keys do not count): 0–2 h → 150; 2–12 h → 250; ≥ 12 h → 450 (500 if trusted). No counting community key → 100.
   - `debt_cap` (FR-03): `ratio_pct = debt * 100 / max(contributed_24h, 1)`; > 100 → 100 (HARD_JAIL); > 50 → 150 (SOFT_WARNING); else 450 / 500 trusted (PRISTINE).
   - `band_cap` (FR-26) from the coordinator's utilisation for the tenant's providers (WP-2.11): < 60 % → 450; < 80 % → 300; < 95 % → 150; else 100. The coordinator pushes band changes to a small `pool:bands` value that TenantQuotaDO reads on its alarm (not per request).
2. `evaluateQuota` uses `effective_limit = tier_limit * multiplier_pct / 100` for RPM and RPD. Tier limits stay the base (`contracts/v3_types.ts:36`).
3. **Jail.** `HARD_JAIL` tenants get `ownOnly=true` leases only. When no own key is available, the response is the PRD Flow F body, in CU:
   ```json
   { "error": { "type": "quota_jail", "code": "quota_jail",
       "message": "Community debt limit reached. Only your own keys are available.",
       "community_debt_cu": 1420, "contributed_cu_24h": 1380, "multiplier": "1.00x",
       "recovery": { "debt_decay": "20% per day at 00:00 UTC", "estimated_days": 3 } } }
   ```
   `estimated_days` = smallest `n` with `debt × 0.8ⁿ ≤ contributed_24h`, computed with integers (loop, max 30).
4. Remove `determineJailStatus`'s dependency on `multiplierCeiling === 100` (fragile equality); jail status derives from `ratio_pct` directly.

**Tests**
- Table test of `multiplier_pct` across vesting × debt × band combinations.
- AC-03 (debt 101, contributed 100, own keys exhausted → 429 `quota_jail` body as above).
- SOFT_WARNING tenant's RPM ceiling equals `tier_rpm × 1.5`.
- Non-contributor stays at tier limits.
- An owner whose only community key is `DRAINED` has `vesting_cap` 100 (1.00×); after the key returns to `OK`, the cap is restored.

### WP-2.5 Nightly reset: decay, trust, streaks

**Depends on:** WP-2.3

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
- Each reset inserts a `standing_history(tenant_id, day, multiplier_pct, debt_cu, contributed_cu_24h, jail_status)` row (migration `0022_standing_history.sql`); the Analytics tab (WP-4.7) reads it.

**Tests**
- Trusted tenant decays 30 %, untrusted 20 %.
- Seven debt-free resets → trusted, 500 ceiling.
- Debt 60 with `contributed_24h` 100 across midnight → SOFT_WARNING, not jailed (the old code jailed).
- Three missed alarms apply three decays.

### WP-2.6 Dispatch counters, hero/parasite, self-key accounting

**Depends on:** WP-2.1, WP-3.2

**Findings:** FR-16, FR-02 (`selfKeyRouted` always false), D9 (counter columns never written), AC-10, AC-11, `recordDispatch` missing from the RPC client.

**Implementation**
- Counters live where the key's state lives: coordinator `keys.dispatched_today`/`dispatched_communal` (community keys, incremented in `settle`; `communal` only when `borrowed`), KeyPoolDO for private keys. Both are SQLite-backed DO storage, so they survive eviction (AC-11).
- `recordDispatch` and `selfKeyRouted` are deleted from contracts and code.
- **Classification (FR-16, as decided in D-16).** No credit or debt penalty exists; the only consequence of draining is that a drained key stops earning its owner a multiplier.
  - Counters are kept per key **and model** (Gemini free-tier quotas are per project and per model). On an RPD-exhaustion 429 (detected by WP-3.2), compute `kc_seen_pct = (own + communal dispatches through KC today for that model) × 100 / daily limit` (the model's known limit, else the key's `rpd_limit`) and `communal_pct = communal × 100 / total`.
  - `kc_seen_pct ≥ 50`: a clean exhaustion. Classify `HERO` when `communal_pct ≥ 80` (badge and telemetry only), otherwise `NORMAL`.
  - `kc_seen_pct < 50`: a **drained day**. Store `effective_rpd` (rolling 7-day median of dispatches at exhaustion) and lend at most `min(rpd_limit, effective_rpd)` from then on.
  - A key with drained days on 5 of the last 7 days becomes `DRAINED` (coordinator `keys.drain_state`, mirrored to `api_keys.drain_state` by migration `0018_key_daily_stats.sql`). The owner receives one notification (WP-3.2's table) explaining that the key no longer counts toward their multiplier and how to recover.
  - A day without a drained exhaustion is clean. After 3 consecutive clean days the key returns to `OK` and counts again; the owner is notified.
  - Telemetry event `key_classification` records `kc_seen_pct`, `communal_pct` and the result for every exhaustion.
- At the coordinator's midnight run, per-key daily totals are written to a new D1 table `key_daily_stats(key_id, day, dispatched, communal, cu_served, classification)` (migration `0018_key_daily_stats.sql`) and counters reset.

**Tests**
- AC-10: a key with 85 % communal share that hits its daily limit with `kc_seen_pct ≥ 50` is classified `HERO`; its owner's credit and multiplier are unchanged.
- A key used mostly by its owner through Key Collective and exhausted with `kc_seen_pct ≥ 50` is not a drained day and triggers no notification.
- A key exhausted with `kc_seen_pct < 50` records a drained day and stores `effective_rpd`, which then caps lending.
- Drained days on 5 of 7 days mark the key `DRAINED` and create exactly one notification; the owner's credit, debt and own use of the key are unchanged.
- 3 consecutive clean days return a `DRAINED` key to `OK` with one notification.
- Counters are per model: exhausting the key's Flash quota does not count against its Pro quota.
- AC-11: evicting the coordinator mid-day (via `runInDurableObject` + abort) leaves counters and drain state intact.
- A `key_daily_stats` row per key and model is written at the midnight run.

### WP-2.7 Surge brake

**Depends on:** WP-2.1

**Findings:** FR-20 (lone tenant braked after one request, own-key traffic braked, volumes in memory only), R11 (volume = prompt estimate).

**Implementation**
- Remove the pre-dispatch `brake-status` call and the fire-and-forget `report-volume` call from `chat/handler.ts:117-206`.
- The coordinator records **borrowed CU at settle time** (actual CU, fixing R11) into `borrower_window(tenant, minute, cu)`.
- In `lease(ownOnly=false)`: compute the 5-minute window. A brake triggers only when `pool_cu_5min ≥ BRAKE_MIN_POOL_CU` (default 2,000), `active_borrowers ≥ 3`, and `tenant_cu_5min × 100 > 35 × pool_cu_5min`. Brake = refuse borrowed leases for 60 s (`brakes` table). Own keys are never braked.
- Constants in `src/constants/commons.ts`, overridable via `vars` for tuning.

**Tests**
- Single borrower sending 1,000 CU in 5 min → never braked.
- Three borrowers with shares 60/20/20 over the minimum → the 60 % tenant is braked for 60 s, still served by its own keys, and unbraked at +61 s.
- State survives coordinator eviction.

### WP-2.8 Eye-for-eye firewall and cold-start share cap

**Depends on:** WP-2.1

**Findings:** FR-19 (display flag only), FR-12 (absent), AC-14.

**Implementation**
- FR-19: `lease(ownOnly=false)` requires that the borrower owns at least one `ACTIVE` community key **in this provider shard**. Otherwise `null` with reason `eye_for_eye`; the final 429 says which provider needs a contribution. `eye_for_eye_accessible` in `/api/pool/telemetry` is computed from the same function.
- FR-12: coordinator tracks each owner's share of CU served to borrowers over the trailing 24 h. With `N` = distinct owners with ACTIVE keys in the shard, cap = 40 % if `N ≤ 5`, else `max(20 %, 200/N %)`. Owners at or above the cap are excluded from borrowed-lease candidates (hard ceiling).

**Tests**
- Gemini-only contributor cannot borrow Groq (429 `eye_for_eye`).
- AC-14 with N = 4 owners and skewed priority → no owner exceeds 40 % of served CU over 1,000 simulated leases.
- N = 10 → cap 20 %.

### WP-2.9 Reset jitter and leaky-bucket queue

**Depends on:** WP-2.1, WP-3.2

**Findings:** FR-05, FR-23, AC-12; `MIDNIGHT_FREEZE` is an unrelated kill switch (`dispatcher.ts:89`).

**Implementation**
- Provider reset policy in `src/providers/config.ts`: `{ google: { dailyResetTz: "America/Los_Angeles" }, groq: { dailyResetTz: "UTC" } }` — values come from `docs/specs/provider_quotas.md`, which the operator records before stage 2 (**Human**).
- On an RPD-exhaustion 429, the coordinator sets `status='COOLDOWN'`, `reactivate_at = next_reset(provider) + uniform(0, 300 s)` using `crypto.getRandomValues`. The alarm reactivates keys whose `reactivate_at` has passed.
- Leaky bucket: when `lease` returns `null` because every candidate is in COOLDOWN and `now` is within ±5 minutes of that provider's reset, the orchestrator retries with 250 ms backoff for up to 5 s total before returning 429.
- `MIDNIGHT_FREEZE` is renamed `MAINTENANCE_MODE` and folded into the kill switch (WP-5.1).

**Tests**
- AC-12: exhaust 100 keys at 23:59:30 provider time → all `reactivate_at` within [reset, reset+300 s], spread > 240 s, Kolmogorov–Smirnov statistic against uniform below the 0.05 critical value.
- A request at reset−2 s waits and succeeds when a key reactivates within 5 s.

### WP-2.10 Passive contributor canary

**Depends on:** WP-2.1, WP-3.2

**Findings:** FR-13 (alarm only classifies).

**Implementation.** KeyPoolDO's 00:00 UTC alarm (it already runs) asks TenantQuotaDO for yesterday's personal request count. If `< 50`, it asks the coordinator for the tenant's community keys and runs the shared proof-of-life probe (WP-1.5) on each: 200 → `HEALTHY`; 401/403 → quarantine flow (WP-3.2); 429 → no action. One request per key per day, as the PRD budgets.

**Tests**
- Passive tenant with 2 community keys, one revoked upstream (mock 401) → that key QUARANTINED and a notification created.
- Active tenant (≥ 50 requests) → no probe calls.

### WP-2.11 Truthful pool telemetry

**Depends on:** WP-2.1, WP-2.6

**Findings:** `wProvider` float and wrong scale (8.33 vs 1.00×), `pool_utilization_percent` computed as communal share, provider health only refreshed on page views (stub table), D8/D9 display paths.

**Implementation**
- Coordinator alarm (hourly) computes per shard: `active`, `observation`, `quarantined`, `utilisation_pct = Σ day_count × 100 / Σ rpd_limit` over ACTIVE keys (true capacity utilisation), `p90_latency_ms` (from its own settle-time latency histogram, not a D1 scan per page view), and `w_provider_pct = active_ratio_pct × min(100, TARGET_P90_MS × 100 / p90) / 100` with `TARGET_P90_MS = 800`. Displayed as `w_provider_pct / 100` with two decimals (1.00× optimal).
- `/api/pool/telemetry` aggregates both shards' `stats()`; no D1 aggregate query, no `ctx.waitUntil` pushes from a GET handler.
- `get_keys.ts` and `/api/pool/contribution` read per-key counters from the coordinator; then migration `0023_drop_key_counters.sql` drops `api_keys.dispatched_today`, `dispatched_communal` and `vesting_tier`.

**Tests**
- Seeded coordinator with known counters → endpoint returns exact integers.
- `w_provider` is 1.00× when p90 ≤ 800 ms and all keys active.
- No request to the endpoint mutates coordinator state.

### WP-2.12 Demo pool isolation

**Depends on:** WP-2.1

**Findings:** S11 / FR-25 (demo traffic consumes contributor keys), `default`-tenant operator keys (S7 follow-up).

**Implementation.** Reserve tenant `sys_operator` for operator-owned keys (move all `default` rows there after WP-0.7 forensics). Demo tokens authenticate as tenant `sys_demo`; the orchestrator, for `sys_demo`, leases only from `KeyPoolDO("sys_operator")` private keys and never calls the coordinator. Demo requests are excluded from multiplier, debt and pool telemetry.

**Tests**
- Community keys exist, operator pool empty → demo request 503 `demo_unavailable`, coordinator counters unchanged.
- With an operator key → served, no `cost_ledger` row marked `borrowed`.

### WP-2.13 Project hash lifecycle, rotation and deletion

**Depends on:** WP-2.1

**Findings:** FR-08 (ROTATING / TOMBSTONED never used), AC-06, Flow D (rotate replaces the secret in place with no same-project check), revocation → tombstone.

**Implementation**
- Migration `0020_project_hash_vesting.sql`: `ALTER TABLE project_hash_registry ADD COLUMN vesting_started_at INTEGER;`.
- **Delete** (`DELETE /api/keys/:id`): mark the key `REVOKED` (soft delete, keeps history), remove from DO/coordinator, set its registry row to `ROTATING`, `rotating_until = now + 30 min`, and store `vesting_started_at` on the registry row.
- **Resubmission within 30 min** from the same tenant and same project (probe hash matches) → registry back to `ACTIVE`, new key inherits `vesting_started_at` (vesting preserved). Any other tenant → 409.
- **Expiry:** coordinator alarm (or lazy check at submission) turns expired `ROTATING` into `TOMBSTONED`, `tombstone_until = rotating_until + 14 d`.
- **Upstream permanent revocation** (repeated 401 after the canary) and **takedown** → `TOMBSTONED` directly.
- **Rotate** (`POST /api/keys/:id/rotate`) becomes: probe the new key (same project for Google, else 409 `project_mismatch`), proof-of-life, re-encrypt, update `key_hash`, prefix/suffix; vesting preserved.

**Tests**
- AC-06 (delete, wait 31 min → resubmission from the same project by anyone → 409 for 14 days, accepted after).
- In-window resubmission by owner keeps vesting.
- Rotate with a key from another project → 409.

### Phase 2 gate
- AC-01, AC-02, AC-03, AC-05, AC-06, AC-10, AC-11, AC-12, AC-14 pass in the Workers harness.
- A staging soak test (`scripts/soak/commons.mjs`): 5 synthetic tenants with mixed contribution run for 30 minutes; standing, debt and pool telemetry reconcile exactly with `cost_ledger` sums.

---

## Phase 3 — Hot-path correctness

**Goal:** every request is accounted to the right key, upstream failures change key state, OpenAI-compatible responses are complete, and decryption can only ever yield the right tenant's key.

### WP-3.1 Account usage to the key, not the model

**Depends on:** WP-2.1

**Findings:** R1.

**Problem.** `chat/stream.ts:64,74` and `chat/non_streaming.ts:31,40` pass `cascadeRes.modelDef.id` (a model name) where a key id is required. `KeyPoolDO.recordUsage` throws `KeyNotFound` (swallowed) and every `cost_ledger.key_id` holds a model name.

**Implementation.** With leases (WP-2.1) the response carries `lease.keyId`; both handlers pass it to `settle` and to the ledger. Delete the separate `recordUsage` calls from the response handlers (settlement is the single accounting point). Add a `NOT NULL` foreign-key-style check in the ledger repository: `key_id` must match `^key_`.

**Tests**
- Non-streaming and streaming completions write `cost_ledger.key_id` equal to the leased key's id.
- The key's minute counter in its DO increments by exactly 1 per request in both modes.

### WP-3.2 Upstream status handling, quarantine and notifications

**Depends on:** WP-2.1

**Findings:** R9 (401/429 only call `recordResult(false)`), `recordStatusCode` has no callers, Flow G, D12 (notifications query `created_at`).

**Implementation**
1. `src/proxy/upstream/classify.ts` maps an upstream response to an outcome:

   | Upstream | Outcome | Key action |
   | --- | --- | --- |
   | 200 | `ok` | counters, breaker success |
   | 401, 403 (`API_KEY_INVALID`, `PERMISSION_DENIED`) | `key_invalid` | `QUARANTINED`, notify owner, canary re-checks nightly; 3 consecutive nightly 401s → `REVOKED` + project `TOMBSTONED` (WP-2.13) |
   | 429 with Gemini `QuotaFailure.violations[].quotaId` containing `PerDay`, or Groq `x-ratelimit-remaining-requests: 0` with a reset > 1 h | `rpd_exhausted` | `COOLDOWN` until next reset + jitter (WP-2.9); FR-16 classification (WP-2.6) |
   | other 429 | `rpm_limited` | `COOLDOWN` for `retry-after` (default 60 s) |
   | 5xx, timeout | `upstream_error` | breaker failure; open after 5 consecutive, half-open after 60 s |
   | 400 | `request_error` | no key action; return 400 to the client (sanitised), do not fall back |
2. The status goes to the lease owner (`KeyPoolDO` or coordinator) through `settle(leaseId, outcome)`; D1 `api_keys.status` and `status_changed_at` are updated in the same settle for `key_invalid`, `rpd_exhausted`, and recoveries.
3. Migration `0021_notifications.sql`: `CREATE TABLE notifications (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, type TEXT NOT NULL, key_id TEXT, message TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER); CREATE INDEX idx_notif_tenant_created ON notifications(tenant_id, created_at);`
4. Add the owner notification to the abuse takedown (`abuse_routes.ts`: "Your key was revoked after an abuse report"), deferred from WP-0.4.
5. `GET /api/notifications?since=<ms>` reads that table (tenant-scoped). `POST /api/notifications/:id/read` marks read. Messages use the PRD Flow G text with the key label and provider.
6. Delete `recordResult` and `recordStatusCode` from `KeyPoolContract`; `settle` replaces both.

**Tests**
- For each row of the table, a mocked upstream response produces the stated key state, D1 status, and (where listed) exactly one notification.
- A 400 does not trigger fallback.
- Breaker opens on the 5th consecutive 5xx and half-opens after 60 s of test clock.

### WP-3.3 Complete OpenAI-compatible responses and parameter passthrough

**Depends on:** none

**Findings:** R8 (tool calls dropped, `finish_reason` hard-coded), R14 (FR-24 passthrough).

**Implementation**
1. **Request.** `ChatHandler` builds the upstream body as a copy of the client body minus KC-only fields (`modelAlias`, `estimatedPromptTokens`), with `model` replaced by the resolved upstream id. Unknown fields (`safetySettings`, `generationConfig`, `extra_body` contents merged by SDKs, `seed`, `top_p`, `logprobs`, …) pass through unchanged. For `stream: true`, set `stream_options: { include_usage: true }` unless the client set it.
2. **Response (non-stream).** Both supported providers speak the OpenAI format through their OpenAI-compatible endpoints, so return the upstream JSON with only these edits: `id` → `chatcmpl-<kc request id>`, `model` → the resolved model id, `usage.kc_cu` added. `choices[].message.tool_calls`, `finish_reason`, `logprobs` survive untouched. Delete `extractContentFromPayload` from the response path (keep it only if a provider without OpenAI format is re-added later).
3. **Streaming.** Pass SSE chunks through; after upstream `[DONE]`, emit `event: kc.usage` + `data: {"cu": …}` then `data: [DONE]`. Mid-stream upstream errors are sanitised (WP-0.6) before being forwarded as an SSE error event.

**Tests**
- Tool-call response (mocked Groq and Gemini fixtures) round-trips `tool_calls` and `finish_reason: "tool_calls"`.
- An arbitrary field `{"foo": 1}` and `safetySettings` reach the mocked upstream body.
- Streaming request carries `include_usage`.
- Final events are `kc.usage` then `[DONE]`.

### WP-3.4 Providers and model catalog

**Depends on:** none

**Findings:** R5, R6, D-06; README aliases that do not exist.

**Implementation**
1. `src/providers/config.ts` becomes the single provider list: `google` (base `https://generativelanguage.googleapis.com/v1beta/openai`) and `groq` (`https://api.groq.com/openai/v1`). Delete `openai`, `anthropic`, `deepseek`, `cohere`, `mistral`, `together` from `DEFAULT_PROVIDER_BASE_URLS` and the fallback URL guess in `upstream/urls.ts` (`https://api.${provider}.com/v1`). Unknown provider → configuration error.
2. Catalog (`router/registry/catalog.ts`) keeps only models callable with free-tier Gemini and Groq keys, keeping their current price fields (this WP runs before WP-1.3, which converts them to CU weights). Remove `gpt-4o*`, `claude-*`, `deepseek-chat`.
3. **Model id verification.** `scripts/verify_catalog.mjs` calls each provider's models endpoint with a staging key and fails if any catalog id is missing (e.g. `gemini-3.8-flash`, `qwen/qwen3.8-27b` flagged in the audit). Add a weekly, non-blocking CI job that runs it with a secret key. **Human:** run it with real keys after this WP merges and before WP-1.3 starts, and correct any ids it reports.
4. **Aliases** defined in the catalog and documented in README: `auto` (cheapest capable model across providers the tenant can get a lease for), `smart-fast` (Gemini Flash → Groq 70B), `coder-high` (Gemini Pro → Groq gpt-oss-120b), `open-groq` (Groq 70B → Groq 8B). `cerebras-speed` is removed.
5. Migration `0016_catalog_cleanup.sql`: `DROP TABLE model_registry;`. Delete `src/storage/repositories/model_registry/*` and `tests/storage/repositories/modelRegistry.test.ts` in the same card. The code catalog is the only source; WP-1.3 adds the CU fields to `/v1/models`.
6. UI: provider selector already shows only Gemini and Groq; PricingTable becomes a CU weight table fed by `/v1/models` (WP-4.6).

**Tests**
- `/v1/models` lists only google/groq models.
- Every alias resolves to at least one catalog model.
- `auto` with a tenant holding only a Groq key routes to Groq without trying Gemini.
- Submission of `provider: "cerebras"` → 400.

### WP-3.5 Response headers

**Depends on:** WP-3.3

**Findings:** R3.

**Implementation.** One `applyKcHeaders(res, ctx)` used by every `/v1` response: `x-kc-request-id: kc_req_<uuid>`, `x-kc-model-used`, `x-kc-provider`, `x-kc-cu` (non-stream), `x-kc-attempts`. Remove `x-kc-tenant-id` and `x-kc-trace-id` from responses (PRD section 12 information boundary: users do not see routing internals). Delete `UpstreamClient.toClientResponse`; header allow-listing already happens because responses are constructed, and a test guards it.

**Tests**
- A mocked upstream response carrying `x-goog-*`, `server`, `alt-svc`, `x-envoy-*` and `cf-ray` produces a client response with none of them (AC-08, headers half).
- Every `/v1` response carries `x-kc-request-id` (`kc_req_<uuid>`), `x-kc-model-used` and `x-kc-provider`, non-streaming responses also `x-kc-cu`, and none carry `x-kc-tenant-id` or `x-kc-trace-id`.

### WP-3.6 Strict key decryption

**Depends on:** WP-2.1

**Findings:** R12, audit HKDF row (AC-07 weakened by fallbacks).

**Implementation**
1. `core/key_resolver.ts` is replaced by `resolveLeasedKey(lease)`: load the row by `lease.keyId`, assert `row.tenant_id === lease.ownerTenantId`, decrypt with `deriveTenantKey(master, row.tenant_id)` only. If `hkdf_migrated = 0`, use the legacy global key path once, then re-encrypt with the tenant subkey and set `hkdf_migrated = 1` in the same step (lazy migration). Any failure → `KeyDecryptionError` → key `QUARANTINED`, alert logged; the key id is never returned as a credential.
2. Delete the "looks like a raw key" fast path and the caller-tenant and `default` fallback attempts.
3. Cache per key id with the row's nonce in the cache key (so rotation invalidates naturally), TTL 5 min; replace `clearDecryptedKeyCache()` (global) with `evict(keyId)`.
4. `ops/migrate_keys_hkdf.ts`: finish the bulk migration, then remove the legacy path in a follow-up release once `SELECT COUNT(*) FROM api_keys WHERE hkdf_migrated = 0` is 0.

**Tests**
- AC-07 (ciphertext of tenant A with tenant B's subkey → `KeyDecryptionError`, key quarantined, upstream never called).
- Corrupted ciphertext → quarantine.
- Legacy row decrypts once and is re-encrypted with `hkdf_migrated=1`.

### WP-3.7 Streaming usage capture

**Depends on:** WP-3.3

**Findings:** support for 2.2 settlement; R11 via WP-2.7.

**Implementation.** `proxy/sse/usage_extractor.ts` reads the final usage chunk that `include_usage` produces (both providers' OpenAI-compatible streams). If absent, count streamed `delta.content` characters and estimate `ceil(chars / 4)`, flag `usage_estimated = 1`. Settlement runs in `flush`/`cancel` exactly once (existing `finalized` guard kept).

**Tests**
- Stream with usage chunk → exact CU.
- Without → estimated CU and `usage_estimated = 1`.
- Client abort mid-stream → settlement with partial usage, once.

### Phase 3 gate
- AC-07 and AC-08 pass; R-series tests pass; `grep -rn "toClientResponse\|extractContentFromPayload\|recordStatusCode\|clearDecryptedKeyCache" src` returns nothing.

---

## Phase 4 — Frontend truth

**Goal:** the console shows only data the server returned, surfaces every failure, and follows the PRD's information architecture.

### WP-4.1 Typed API client, honest errors

**Depends on:** none

**Findings:** F5, F1 follow-through, client-side stat recomputation (`api.ts:136-183`).

**Implementation**
- Shared contracts: `src/contracts/api/*.ts` (zod schemas for every `/api/*` response). The UI imports them (`ui/tsconfig` path alias) and validates responses in dev builds.
- New `ui/src/lib/api/client.ts`: `request<T>(schema, path, init)` with `credentials: "same-origin"`, `x-kc-csrf` on mutations, and a thrown `ApiError { status, code, message }` on any non-2xx. No function returns success on failure; `deleteKey`, `testKey`, `getKeys`, `getLogs` lose their fallbacks and `memoryKeys` / `INITIAL_MOCK_KEYS` are deleted.
- `getStats` stops recomputing health, RPM headroom and quota on the client; the server's `/api/stats` is authoritative. `App.svelte`'s `daily_quota_limit: 50000` initial value is replaced by a loading state.
- A global `ErrorToast` shows `ApiError.message`; optimistic updates roll back on error.

**Tests**
- Component tests with `msw` handlers built from the same zod schemas: delete failure (500) keeps the row and shows an error.
- Schema-violating responses fail tests in CI.

### WP-4.2 Remove invented data

**Depends on:** WP-4.1, WP-2.3, WP-5.1

**Findings:** every row of the audit's "Hard-coded or invented data" table.

| Location | Replace with |
| --- | --- |
| `oauth/SybilMatrixSection.svelte:44,64` ("420 days", "84 commits", Turnstile always PASS, wrong thresholds) | `GET /api/session` → `identity.github.{account_age_days, public_repos, contributions_last_year, sybil_score, layer_results[]}` stored at link time (WP-1.2); PRD thresholds; "Not linked" state |
| `AdminView.svelte:147-200`, `CircuitBreakerControls.svelte:59-78` (client-built audit rows, fake `syncDurationMs`, fake bootstrap entries) | `GET /api/admin/audit?limit=50` from `admin_audit_logs`; delete `syncDurationMs` |
| `AdminView.svelte:191` ("Reset quota" demotes to builder) | `POST /api/admin/tenants/:id/reset-quota` → `TenantQuotaDO.reset()` (WP-4.3) |
| `CircuitBreakerControls.svelte:28-57` (latencies 242/118/82/380, DeepSeek) | `GET /api/admin/providers` from coordinator `stats()` + overrides (WP-5.1); only google/groq |
| `TelemetryLogs.svelte:125,150` (`gemini-1.5-pro`, 410/89 tokens) and `metrics_routes.ts:19` (`bytes_in = prompt_tokens × 4`) | Server returns `prompt_tokens`, `completion_tokens`, `cu`, `model`; UI shows "—" when absent; `bytes_in/out` removed |
| `TopNavBar.svelte:74,220-256` (trust 92, tier builder, name collective-dev) | Session fields; hide the badge when unknown |
| Standing defaults (`pool_routes.ts:222-231`, `DebtLedgerWidget.svelte:103-110`) | Live standing from TenantQuotaDO (WP-2.3); loading/error states |
| `oauth/EphemeralSandboxCard.svelte:23,42` ("15 RPM", "15-Min") | Values from `POST /api/demo/token` response (`rpm_limit`, `rpd_limit`, `expires_in`) |
| `KeysTable.svelte:182-185` (RPD 10,000 / RPM 60 fallbacks) | Row values are required by the schema; no fallback |
| `MetricCards.svelte:94` ($1.00 budget ring) | "CU used today / CU allowance today" from `/api/stats` (CU, WP-1.3) |
| `Workbench.svelte:225,246` (`assignedRpm` formula), `:916` (`UTC 2024-11-14 08:34:11`) | `projects.rpm_sub_cap` and live project RPM from TenantQuotaDO; clock renders only from `Date` |
| `App.svelte:69` (apex proxy endpoint) | `API_BASE_URL` (WP-1.1) |

Add a CI guard `scripts/check-ui-literals.mjs` that fails on numeric literals ≥ 10 inside `{…}` template expressions of `ui/src/lib/**/*.svelte` unless whitelisted (layout numbers are in `class`/SVG attributes and excluded).

**Tests**
- For each component in the table above, a render test with an empty API response shows no number or name from the old fallback.
- The same components rendered with an error response show an error state instead of fallback values.
- `scripts/check-ui-literals.mjs` passes on `ui/src/lib`.

### WP-4.3 Real admin panel

**Depends on:** WP-4.1, WP-5.1

**Findings:** F8, admin audit/reset rows, admin on console host (WP-1.1).

**Implementation.** Admin SPA served only on `admin.*`. Views: Tenants (live from D1 + DO standing), Keys (routing status, pool mode, delete via coordinator RPC), Providers (coordinator stats, override controls → WP-5.1), Kill switch (WP-5.1), Audit log (server). Every mutation shows the server's response and refreshes from the server.

**Tests**
- Admin tests run against the harness with a real admin session.
- Each action changes server state and writes an audit row.
- UI shows the server's audit list.

### WP-4.4 Standing and debt widget

**Depends on:** WP-4.1, WP-2.4

**Findings:** F6, "Standing card" IA row, Flow F card.

**Implementation.** Remove "Resolve debt" and `resolveDebt` entirely (no such concept in the PRD). The widget shows: multiplier with its three caps (vesting / debt / band) and which one binds; `community_debt_cu`, `contributed_cu_24h`, ratio bar with 50 % and 100 % marks; a state card with these states and colours (PRD section 4.2): PRISTINE (debt ≤ 50 % of contribution, green, full multiplier), SOFT_WARNING (> 50 %, yellow, multiplier capped at 1.50×), HARD_JAIL (> 100 %, red, 1.00× locked), TRUSTED (7-day debt-free streak, green with a gold star badge); trusted streak (`consecutive_debt_free_days` / 7); recovery estimate from the server.

**Tests**
- Render per state (PRISTINE, SOFT_WARNING, HARD_JAIL, TRUSTED) from fixture standings.
- No network call on mount except `GET /api/pool/standing`.

### WP-4.5 Workbench and projects

**Depends on:** WP-4.1

**Findings:** F7, Workbench rows of WP-4.2.

**Implementation.** All project and token actions go through the typed client (cookie + CSRF). Token rotate uses the endpoint from WP-1.6 and shows the new secret once. Archive and RPM sub-cap edits are pessimistic (update after 200). Project cards show real `rpm_sub_cap` and live RPM.

**Tests**
- Rotate shows secret once and old token fails.
- Archive persists after reload.
- Sub-cap above tier maximum → server 400 shown inline.

### WP-4.6 Playground and API docs

**Depends on:** WP-4.1

**Findings:** F9, F10.

**Implementation.** Playground obtains a playground token (`POST /api/playground/token`) and calls `API_BASE_URL`; reads `x-kc-cu`, `x-kc-model-used`, and the `kc.usage` SSE event; no `x-tenant-id`. API Docs render from `GET https://api…/v1/openapi.json` (single source; delete hand-written `api_docs/generators.ts` endpoint list and the `/v1/projects`, `/v1/telemetry` examples). PricingTable → "CU weights" from `/v1/models`.

**Tests**
- Playground shows CU from the header.
- Docs page lists exactly the OpenAPI paths.
- No model outside `/v1/models` appears in the weights table.

### WP-4.7 Information architecture per PRD section 4

**Depends on:** WP-4.1, WP-4.4, WP-2.11, WP-3.2, WP-2.5

**Findings:** every row of the audit's IA table.

**Implementation**

| PRD element | Implementation |
| --- | --- |
| Top tabs Dashboard / Keys / Pool / Analytics | `SideNavBar`/`TopNavBar` rebuilt with these four; Playground and Docs move under a "Developers" menu; Admin only on `admin.*`; "Commons" and "Workbench" tabs merged into Pool and Dashboard |
| Dashboard | Standing card (WP-4.4), today's activity (personal requests, burst used, requests served for community), quick access, credentials (endpoint = `API_BASE_URL`, API keys list with create/rotate) |
| Keys sub-tabs My Keys / Private / Observation | Filtered views of `GET /api/keys`; Observation shows a live countdown from `observation_until`; row expands to detail: pool mode, status, observation, vesting tier, drain state (whether the key counts toward the multiplier, and days until it counts again), 24 h dispatch `n / rpd_limit`, communal share (from coordinator via `/api/keys/:id/stats`), added date |
| Rotate modal | PRD Flow D text; explains the 30-minute same-project window (WP-2.13) |
| Pool toggle modal | Freeze-window message (FR-22) and CU debt settlement text (Flow E) |
| Pool sub-tabs Community / Provider / My Contribution | From `/api/pool/telemetry` and `/api/pool/contribution` (WP-2.11, WP-2.3). Google-only users see a locked Pool tab with a "Link GitHub to join the community pool" call to action (D-05) |
| Analytics sub-tabs Usage / Usage ledger / Multiplier history | Usage: requests and CU per day by model (from `daily_cu_rollup`); ledger: paginated `cost_ledger` (CU, tokens, latency, status, borrowed); multiplier history: `standing_history` rows written by WP-2.5 |
| Public `/report` page | `console…/report` route renders without sign-in, with the Turnstile widget |
| Notification toasts every 30 s | Poll `GET /api/notifications?since=` (WP-3.2); mark read on dismiss |

**Tests**
- Navigation test for the four tabs and sub-tabs.
- Each view renders from msw fixtures that match the contracts.
- `/report` renders signed-out.

### Phase 4 gate
- UI test suite (in `gate`) passes; `check-ui-literals` passes; manual walkthrough of PRD Flows A–I on staging recorded in `docs/walkthrough.md` (replacing the current file).

---

## Phase 5 — Stubs, dead code, hygiene and docs

### WP-5.1 Make admin circuit override and kill switch real

**Depends on:** WP-2.1, WP-2.0

**Findings:** stub rows "`POST /api/admin/circuit-breaker`" and "`POST /api/admin/kill-switch`", F8, `MIDNIGHT_FREEZE` (`dispatcher.ts:89`).

**Implementation**
- **Provider override:** coordinator RPC `setProviderOverride(state: "TRIPPED" | "NORMAL", until?, reason, adminUserId)`. While TRIPPED, `lease` returns no keys for that shard and the orchestrator skips the provider; KeyPoolDO checks the same flag (pushed from the coordinator) for private keys. Visible in `/api/admin/providers`.
- **Kill switch:** new singleton `CONTROL` (a coordinator instance named `"control"` is enough) storing `{ maintenance: boolean, reason, since }`. `ApiHost` reads it with a 10-second isolate cache and returns `503 { error: { code: "maintenance" } }` with `Retry-After: 60` while on. `MIDNIGHT_FREEZE` env handling is deleted.
- Both write `admin_audit_logs` (table exists from 0011) and return the stored state, not an echo of the request.

**Tests** (replace `tests/admin/admin_router.test.ts:161-188`, T-04)
- Trip `groq` → a Groq-only request returns 503 `provider_unavailable` and the upstream mock is not called.
- Resetting the override → the same request is served again.
- Engaging the kill switch → `/v1/chat/completions` returns 503 within 10 s of test clock, while console `/api/*` keeps working.
- Each override and kill-switch change writes an `admin_audit_logs` row.

### WP-5.2 Truthful key tests

**Depends on:** none

**Findings:** stub row "`POST /api/keys/:id/test` … returns success without any network call" (`keys/ops.ts:192-196`).

**Implementation.** `handleTestKey` calls the shared proof-of-life probe (WP-1.5) for the key's provider and returns `{ ok, status: "healthy" | "no_quota" | "invalid" | "unavailable", latency_ms }`. With D-06 there is no "other provider" branch; an unknown provider is a 500 configuration error. The result also updates key status through `settle`-equivalent logic (a `key_invalid` result quarantines).

**Tests**
- 200/429/401/timeout from the mocked provider map to the four statuses.
- The key's D1 status follows.

### WP-5.3 Replace silent failures with explicit handling

**Depends on:** WP-5.4

**Findings:** 95 empty `catch` blocks in `src/` (of 191); stub rows for `POST /api/keys` DO sync and the takedown's swallowed UPDATEs; 15 `console.*` calls.

**Implementation**
1. Wire `src/utils/logger.ts` (currently unreachable) as the only logger: structured JSON with `trace_id`, `tenant_id` (hashed), `event`, `error_code`; never logs secrets (the sanitizer from WP-0.6 runs on every message).
2. Add ESLint with `typescript-eslint` (flat config) to root and UI: `no-empty` (error, `allowEmptyCatch: false`), `@typescript-eslint/no-explicit-any` (error), `no-console` (error, except in `logger.ts`), a small custom rule `kc/catch-must-handle` requiring a `catch` body to rethrow, return a typed error, or call `logger.*`.
3. Triage every existing empty catch into one of three buckets and fix accordingly:

   | Bucket | Examples | Fix |
   | --- | --- | --- |
   | Telemetry must not break the request | Analytics Engine `writeDataPoint`, `emitTelemetry` | `catch (e) { logger.debug("telemetry_drop", e) }` |
   | Hid a real failure | DO sync after key insert, takedown UPDATEs, `admin_audit_logs` inserts, KeyPoolDO D1 load, `pool_routes` coordinator calls, key resolver attempts | Remove the try/catch or map to a typed error with an HTTP status; covered by WP-1.5, 0.4, 0.9, 2.1, 3.6 |
   | Guarded optional features | JSON body parse | Return 400 with `invalid_json` |
4. Delete the 15 `console.*` calls (auth routes log raw OAuth errors today).

**Tests**
- Lint runs in `gate:fast` and passes.
- `grep -rc "catch {}" src` reports 0 everywhere.

**HIVE:** one card per top-level directory of `src/`; cards that only add logging use `red: false`.

### WP-5.4 Dead code: wire or delete

**Depends on:** none

**Findings:** 39 unreachable files (4,085 lines), facades, KeyPoolDO HTTP RPC (N-01 follow-up).

| Path | Action | Reason / owner WP |
| --- | --- | --- |
| `storage/repositories/api_keys/*` (5 files) | **Wire** | Single SQL owner for `api_keys` (WP-1.5) |
| `auth/sybil/*` engine and scoring | **Wire** | GitHub link Sybil check (WP-1.2) |
| `utils/logger.ts` | **Wire** | WP-5.3 |
| `contracts/v4_types.ts` | **Wire** | Becomes part of `src/contracts/api/*` zod contracts shared with the UI (WP-4.1) |
| `contracts/keys.ts` | **Rewrite** | `KeyStatus`, `PoolType` enums (WP-1.4) |
| `auth/oauth/*` (6 files) | Delete | Superseded by `auth/github/link_flow.ts` (WP-1.2) |
| `storage/d1/*` (7 files), `storage/do.ts`, `storage/index.ts` | Delete | Parallel storage layer; repositories are the single layer |
| `storage/repositories/model_registry/*` (5 files) | Delete | Code catalog is the source (WP-3.4); drop the D1 table |
| `proxy/cost_calculator.ts`, `proxy/index.ts` | Delete | Replaced by `calculateCu` (WP-1.3) |
| `contracts/providers.ts` | Delete | Replaced by `src/providers/config.ts` (WP-3.4) |
| Unused barrels: `auth/index.ts`, `constants/index.ts`, `contracts/index.ts`, `durable_objects/index.ts`, `quota/index.ts`, `router/index.ts`, `types/index.ts` | Delete | No importers; direct imports only |
| `durable_objects/key_pool.ts`, `durable_objects/key_pool_do.ts` (facade), `worker/router/chat_handler.ts`, `worker/router/dashboard_handler.ts` (facades) | Delete | Import the real modules |
| `durable_objects/key_pool/rpc.ts` (HTTP RPC router) | Delete | Native DO RPC only (N-01) |
| `durable_objects/crypto.ts` `decryptKey` (legacy global-key path) | Delete after HKDF migration completes | WP-3.6 |
| `worker/router/core/key_resolver.ts` | Replace | `resolveLeasedKey` (WP-3.6) |
| `pool_routes.ts` D1 aggregate queries | Replace | Coordinator stats (WP-2.11) |

**HIVE:** each card deletes one module group together with the tests that import it (see section 10.2), so the type check passes per card; these cards use `red: false`.

After deletion, rerun the reachability script (kept as `scripts/reachability.mjs`, added to `gate`) and require zero unreachable non-test files.

### WP-5.5 Type safety and configuration hygiene

**Depends on:** WP-5.4

**Findings:** 27 `any` in `src/`, 32 in `ui/src/`; `this as any` passed to `handleAdminRequest` (`dashboard/handler.ts:307`); hard-coded GitHub client id and Firebase config; hard-coded admin emails (`admin@keycollective.io`, `admin@keycollective.ai`); dual package managers (`package-lock.json` and `pnpm-lock.yaml` both present, CI uses `npm ci`, `pnpm-workspace.yaml` modified in the working tree).

**Implementation**
- Remove every `any`: DO storage alarm calls use `DurableObjectStorage.getAlarm/setAlarm` from `@cloudflare/workers-types` (no casts); `TenantQuotaDO.ensureLoaded` uses a zod schema for stored data instead of `(stored as any)`.
- Config via `vars`/secrets only: `GITHUB_CLIENT_ID`, `FIREBASE_PROJECT_ID`, `VITE_FIREBASE_*`, `VITE_TURNSTILE_SITE_KEY`, `ADMIN_EMAILS`. The UI reads `import.meta.env`.
- Remove hard-coded emails and domains from UI and server (`admin_handler.ts`, `dashboard/handler.ts:239`, `CircuitBreakerControls.svelte:27`).
- Choose **npm** (CI already uses it): delete `pnpm-lock.yaml` and `pnpm-workspace.yaml` in root and `ui/`.
- `tsconfig`: add `"noUncheckedIndexedAccess": true` and `"exactOptionalPropertyTypes": true` in a follow-up PR once the codebase compiles cleanly.

**Tests**
- `eslint` reports zero warnings on `src` and `ui/src`.
- `tsc --noEmit` passes.
- `grep -rn "Ov23li\|keycollective.io\|keycollective.ai" src ui/src` returns nothing.
- Only one lockfile (`package-lock.json`) exists in the root and in `ui/`.

**HIVE:** one card per directory; these cards change no behaviour and use `red: false`.

### WP-5.6 Documentation truth and runbooks

**Depends on:** WP-6.5

**Findings:** NFR-06 (secret rotation runbook missing), PRD section 1.2 "Implemented" table, README (304 tests, apex endpoints, µ$ header, aliases), CONTEXT.md (30-day trust, microdollar invariant, paths), `docs/data_contracts.go` and `.py`, the 1199/1199 claim in hive commits.

**Implementation**
- `docs/ops/secret-rotation.md`: dual-key period (`KC_MASTER_KEY` + `KC_MASTER_KEY_NEXT`), `api_keys.key_version` column, background re-encryption via an admin maintenance route in batches of 100, verification query, cutover, removal of the old secret, and rollback.
- `docs/ops/admin-access.md`: granting/revoking admin with `wrangler d1 execute`; break-glass `ADMIN_TOKEN` usage and rotation.
- `docs/ops/deploy.md`: before any migration that rebuilds a table (0014), take a D1 backup (`wrangler d1 export key-collective-d1 --remote --output backups/<date>.sql`) and note the D1 Time Travel restore point; the `deploy-prod.yml` workflow gains this step before `wrangler d1 migrations apply --remote`.
- PRD section 1.2: status column reflects reality, updated per phase gate. PRD amendments: D-01 (hosts), D-02/03 (CU replaces µ$ in NFR-03, sections 5–10), D-05 (identity), D-06 (providers), D-14 (gate budget), D-15 (no `/v1beta`).
- README: endpoints (`api.key-col.axe08.tech/v1`), CU, providers, aliases, test count badge generated by CI (never hand-written).
- CONTEXT.md and GEMINI.md invariants: "Integer Credit Units", host topology, identity rules, "no SQL mocks in handler tests".
- Delete `docs/data_contracts.go`, `docs/data_contracts.py` (and `docs/data_contracts.ts` unless it is the generated source of the zod contracts).
- `docs/README.md`: index that labels documents as **normative** (PRD, this plan, INTENT_AUDIT, runbooks, specs) or **historical/generated** (study guide, codeflow, scorecards, hive traces), so agents stop treating generated docs as ground truth.

**Done when** a reviewer can follow README → sign in → create key → call the API without contradicting any document.

### Phase 5 gate
- Lint, reachability (0 unreachable files), and doc checks pass; runbooks reviewed.

---

## Phase 6 — Tests and quality gate

### WP-6.1 Test configuration and inflation

**Depends on:** WP-1.0

**Findings:** T-03, T-06.

**Implementation**
- Root `vitest.config.ts` (unit, node): `include: ["test/**/*.test.ts", "tests/**/*.test.ts", "src/**/*.test.ts", "src/**/*.spec.ts"]`, `exclude: ["test/integration/**", "test/do/**", "ui/**", "node_modules/**"]`, `passWithNoTests: false` — brings the 17 excluded co-located files (386 tests) under the gate without dropping any existing suite; section 10.2 (Appendix B) then relocates or deletes each. Every `*.test.ts` outside `ui/` must be matched by exactly one of the two configs.
- Delete `test/auth_middleware.test.ts` (a re-export that runs 43 tests twice) and one of the two identical OAuth suites (both go when `auth/oauth/*` is deleted).
- UI tests join the gate (`test:ui`).

**HIVE:** configuration and test-deletion cards use `red: false`.

### WP-6.2 Rewrite tests that pass without testing

**Depends on:** WP-5.4

**Findings:** T-01, T-02, T-04, T-05, T-07. Per-file actions are in section 10.2 (Appendix B). Principles:
- A handler or DO test runs against real D1 and real DOs in the Workers pool. Hand-rolled D1 mocks are removed (lint rule from WP-1.0).
- A test that asserts only the echo of its own request body (e.g. circuit-breaker and kill-switch tests) is replaced by one that asserts a downstream effect (a later request's outcome, a DB row, a DO state).
- Tests for security-sensitive code use real inputs from the other side of the boundary: real-shaped Gemini error bodies, signed JWTs, real Turnstile siteverify responses (mocked at the HTTP layer only).
- Migration tests apply **all** migrations, not one.

**HIVE:** one card per test file or small group from section 10.2. Rewrites that keep behaviour use `red: false`; a rewrite that exposes a real bug keeps `red: true` and fixes the bug in the same card.

### WP-6.3 Acceptance-criteria suite

**Depends on:** none

**Findings:** T-09, AC-01…AC-15.

One file per criterion under `test/acceptance/`, each named `acNN_<slug>.test.ts`, each a black-box test through `SELF.fetch` on the real hosts:

| AC | Test file | Implemented by |
| --- | --- | --- |
| AC-01 own key first (extended to D-04 order) | `ac01_self_key_priority.test.ts` | WP-2.1 |
| AC-02 debt accrues and is repaid | `ac02_debt_ledger.test.ts` | WP-2.3 |
| AC-03 `quota_jail` 429 | `ac03_quota_jail.test.ts` | WP-2.4 |
| AC-04 same GCP project → 409 | `ac04_project_hash_sybil.test.ts` | WP-1.5 |
| AC-05 24 h observation | `ac05_observation.test.ts` | WP-2.2 |
| AC-06 14-day tombstone | `ac06_tombstone.test.ts` | WP-2.13 |
| AC-07 HKDF isolation | `ac07_hkdf_isolation.test.ts` | WP-3.6 |
| AC-08 no provider headers or project numbers | `ac08_error_normalizer.test.ts` | WP-0.6, WP-3.5 |
| AC-09 takedown timing | `ac09_takedown_timing.test.ts` | WP-0.4 |
| AC-10 hero classification | `ac10_hero_parasite.test.ts` | WP-2.6 |
| AC-11 eviction durability | `ac11_eviction.test.ts` | WP-2.6 |
| AC-12 midnight jitter | `ac12_jitter.test.ts` | WP-2.9 |
| AC-13 gate budget | CI timing check on `gate:fast` (< 10 s) | WP-6.5 |
| AC-14 cold-start cap | `ac14_share_cap.test.ts` | WP-2.8 |
| AC-15 consent 422 | `ac15_consent.test.ts` | WP-1.2 |

### WP-6.4 Security regression suite

**Depends on:** none

`test/integration/security/` keeps one file per finding from Phase 0 (S1, S2, S3, S4, S5, S7, S13, N-01, R2) plus S8 (OAuth state), S10 (master key not a credential), S11 (demo isolation), S12 (no query-string credentials). Each test documents the original exploit in a comment and asserts it now fails.

### WP-6.5 Gate and CI

**Depends on:** WP-5.3, WP-6.2

**Implementation**
- `package.json`:
  ```json
  "gate:fast": "npm run typecheck && npm run lint && npm run test:unit && node scripts/check-no-sql-mocks.mjs",
  "gate": "npm run gate:fast && npm run test:workers && npm run test:ui && (cd ui && npm run check) && node scripts/reachability.mjs"
  ```
- `Makefile gate` calls `npm run gate`. `.github/workflows/ci-dev.yml` runs `gate` (rename the job from "Fast Quality Gate (<10s)"), and a separate step times `gate:fast` and fails over 10 s (AC-13).
- `deploy-prod.yml`: add the D1 backup step (WP-5.6) and run `npm run gate` before `wrangler deploy`.
- Coverage: `@vitest/coverage-v8` with thresholds on `src/router/leases`, `src/pool`, `src/quota`, `src/auth`, `src/worker/router/dashboard/keys` (≥ 90 % lines, ≥ 80 % branches); report uploaded as a CI artifact.
- README test badge generated from the CI run.

### Phase 6 gate (release)
All 15 AC tests, the security suite, and `npm run gate` pass in CI; PRD section 1.2 is updated to the verified status.

---

## 10.1 Appendix A — Traceability matrix

Every finding from `INTENT_AUDIT.md`, the owner's two concerns, and the issues found while writing this plan. Severity is the audit's rating (— where the audit listed the item without one).

### New findings raised in this plan

| ID | Finding | Severity | WP |
| --- | --- | --- | --- |
| N-01 | `/v1/keys`, `/v1/metrics`, `/v1/capacity` forward any authenticated request into the tenant DO's HTTP RPC (list ciphertexts, inject keys, manipulate breakers) | Critical | 0.8, 5.4 |
| N-02 | OpenAI-compatible API reachable on apex, console, dev and via path aliases; UI and OpenAPI point at the apex | High | 1.1 |
| N-03 | Two units of account (µ$ and micro-CU) for a system where nobody pays | High | 1.3 |
| N-04 | Signed-in users receive every community key's id, label, 8-char prefix, 4-char suffix, limits and status from `GET /api/keys` (owner redacted; the full key is **not** exposed). Privacy and PRD section 12 boundary issue only; the key id also fed the S4 takedown-by-id path, fixed in WP-0.4 | Low | 0.4 |
| N-05 | `deploy-prod.yml` applies remote D1 migrations with no backup step. Harmless so far, but migrations 0012–0014 rename and rebuild tables | High | 5.6, 6.5 |
| N-06 | Both `package-lock.json` and `pnpm-lock.yaml` present; CI uses npm | Low | 5.5 |
| N-07 | `POOL_COORDINATOR` missing from `env.dev` and `env.production` DO bindings in `wrangler.jsonc` | Medium | 1.1 |

### Core economics

| Finding | Severity | WP |
| --- | --- | --- |
| FR-07 keys never leave OBSERVATION | Critical | 2.2 |
| FR-03 debt never accrues / lender never credited | Critical | 2.3 |
| FR-03 / Flow F no `quota_jail` | High | 2.4 |
| FR-17 / FR-26 multiplier never applied; no vesting or utilisation bands | High | 2.4 |
| FR-21 30 % decay unreachable, float decay, 7 vs 30 days | High | 2.5 |
| FR-21 contribution reset jails every debtor at midnight | High | 2.5 (D-12) |
| FR-03 display: `contributor_standing` never written; hard-coded standing | High | 2.3 |
| FR-02 `selfKeyRouted` always false | Medium | 2.1, 2.6 |
| PRD 9.3 coordinator does not pick keys; stale per-tenant snapshots | High | 2.1 |
| FR-04 shared-key limits per consumer DO | High | 2.1 |
| FR-16 hero/parasite counters never recorded; parasite rule conflicts with D-04 (redefined by D-16) | High | 2.6, 2.4 |
| FR-20 brake hits lone tenants and own-key traffic; in-memory volumes | Critical | 2.7 |
| FR-19 eye-for-eye is display-only | High | 2.8 |
| FR-12 cold-start share cap absent | High | 2.8 |
| FR-18 anti-cycling tier absent | Medium | 2.2 |
| FR-05 / FR-23 jitter and leaky bucket absent | Medium | 2.9 |
| FR-13 canary probe never fires | Medium | 2.10 |
| FR-22 midnight freeze (works) | OK | Regression test kept in 2.2 |
| `wProvider` float and wrong scale | — | 2.11 |
| `pool_utilization_percent` is a communal-share ratio | — | 2.11 |
| Communal priority fixed at DO load | — | 2.1 |

### Routing and proxy

| Finding | Severity | WP |
| --- | --- | --- |
| R1 model id used as key id | High | 3.1 |
| R2 upstream error text reaches clients | Critical | 0.6 |
| R3 normaliser dead; PRD headers missing | Medium | 3.5 |
| R4 secret regex misses `AIza`/`gsk_` | High | 0.6 |
| R5 Cerebras/SambaNova unroutable | High | 3.4 (D-06: dropped) |
| R6 catalog off-intent, missing aliases, unverified ids | Medium | 3.4 |
| R7 free-tier priced at paid rates | Medium | 1.3 |
| R8 tool calls dropped | High | 3.3 |
| R9 no quarantine on 401/429 | High | 3.2 |
| R10 `/v1beta` not routed | Medium | 1.1 (D-15: removed from scope) |
| R11 brake volume from prompt estimate | Low | 2.7 |
| R12 decryption falls back to key id | Medium | 3.6 |
| R13 shared-key limiter per consumer | High | 2.1 |
| R14 FR-24 passthrough drops fields | Medium | 3.3 |

### Security, auth, compliance

| Finding | Severity | WP |
| --- | --- | --- |
| S1 header-only impersonation | Critical | 0.1 |
| S2 unauthenticated token minting | Critical | 0.2, 1.2 |
| S3 user id accepted as admin token | Critical | 0.3 |
| S4 anyone can revoke community keys | Critical | 0.4 |
| S5 Turnstile fixtures in production | Critical | 0.5 |
| S6 error details leak | Critical | 0.6 |
| S7 `default`-key takeover | High | 0.7, 2.12 |
| S8 OAuth callback without state/Sybil | High | 0.10, 1.2 |
| S9 `gh_` vs `usr_gh_` prefix mismatch | High | 1.2 (D-10 makes it moot) |
| S10 master key as admin bearer | High | 0.3 |
| S11 demo consumes contributor keys | High | 2.12 |
| S12 credentials in query strings | High | 0.3 |
| S13 `INSERT OR REPLACE` wipes users | High | 0.9 |
| C1–C3 registration consent not recorded | — | 1.2 |
| K1/K2 consent insert broken; no IP/UA | — | 1.4, 1.5 |
| Takedown rate limit absent | — | 0.4 |
| Takedown tombstones the wrong hash | — | 0.4 |
| Proof-of-life probe absent | — | 1.5 |
| GCP probe may no-op on 404 | — | 1.5 |
| HKDF fallbacks weaken isolation | — | 3.6 |
| Secret rotation runbook missing | — | 5.6 |

### Data layer

| Finding | Severity | WP |
| --- | --- | --- |
| D1 consent insert columns do not exist | Critical | 1.4, 1.5 |
| D2 project-hash insert omits `provider` | Critical | 1.4, 1.5 |
| D3 three shapes for consent | Medium | 1.4 |
| D4 `admin_audit_logs` missing | High | 0.4 (0011), 0.9 |
| D5 `key_hash` column missing | High | 0.4 |
| D6 stub `keys` table | High | 1.6 |
| D7 project scope from client header | High | 1.6 |
| D8 standing never synced | High | 2.3 |
| D9 counter columns never written | High | 2.6, 1.4 |
| D10 purge migration in chain (intentional; low risk, tidy-up) | Low | 1.4 |
| D11 mixed timestamp types | Medium | 1.4 |
| D12 notifications keyed on `created_at` | High | 3.2 |
| D13 status value drift | Medium | 1.4 |
| D14 seed data in `default` tenant | Medium | 1.4 |
| D15 duplicate `0001` | Low | 1.4 |
| Float math in debt, standing, `wProvider`, token budgets | — | 1.3 |

### Frontend

| Finding | Severity | WP |
| --- | --- | --- |
| F1 identity in localStorage + header | Critical | 0.1, 1.2 |
| F2 no Turnstile widget; add key always 403 | Critical | 1.5 |
| F3 Firebase login trusted blindly | Critical | 0.2, 1.2 |
| F4 PKCE theatre; token in URL | High | 0.10, 1.2 |
| F5 delete reports success on failure | High | 4.1 |
| F6 "Resolve debt" hits a missing route | High | 4.4 |
| F7 token rotate route missing; project edits not persisted | High | 1.6, 4.5 |
| F8 admin overrides have no effect | High | 5.1, 4.3 |
| F9 Playground reads the wrong cost header | Medium | 4.6 |
| F10 docs list non-existent endpoints and providers | Medium | 4.6 |
| Invented data: Sybil matrix, admin audit log, reset quota, circuit defaults, request log, nav bar, standing, demo card, key table, spend ring, workbench, proxy endpoint (12 rows) | — | 4.2 (row-by-row table) |
| IA: tabs, Keys sub-tabs, Analytics, standing card, `/report`, rotate modal, notifications (7 rows) | — | 4.7 (+ 2.13, 3.2) |

### Stubs, dead code, hygiene

| Finding | WP |
| --- | --- |
| Circuit-breaker override stub | 5.1 |
| Kill-switch stub | 5.1 |
| Key test "syntax verified" stub | 5.2 |
| Takedown swallowed UPDATEs | 0.4 |
| Key submission DO sync swallowed | 1.5 |
| KeyPoolDO alarm without canary / suspension | 2.10, 2.6 |
| `accrueDebt` / `decrementDebt` unreachable | 2.3 |
| `toClientResponse` unreachable | 3.5 |
| `recordDispatch` unreachable | 2.6 |
| Coordinator `update-provider` only on page view | 2.11 |
| 39 unreachable files (7 module groups) | 5.4 |
| 59 `any` | 5.5 |
| Facade files | 5.4 |
| 15 `console.*` | 5.3 |
| Hard-coded GitHub client id, Firebase config, admin emails | 5.5 |
| `docs/data_contracts.go` / `.py` | 5.6 |
| 95 empty `catch` blocks | 5.3 |

### Tests and docs

| Finding | WP |
| --- | --- |
| T-01 SQL-accepting D1 mocks | 1.0, 6.2 |
| T-02 one migration tested | 1.4, 6.2 |
| T-03 386 src tests and 40 UI tests outside the gate | 6.1 |
| T-04 tests asserting stub echoes | 5.1, 6.2 |
| T-05 tests asserting fixture tokens | 0.5, 6.2 |
| T-06 duplicate / re-exported suites | 6.1 |
| T-07 tests of unreachable modules | 5.4, 6.2 |
| T-08 no end-to-end tests of critical flows | 1.0, 6.3 |
| T-09 9 of 15 ACs untested | 6.3 |
| README 304-test badge, "1199/1199" claim, PRD "Implemented" table | 5.6, 6.5 |

---

## 10.2 Appendix B — Disposition of every existing test file

Actions: **Keep** (valid as is, maybe relocated to `test/unit/pure/`), **Update** (valid intent, assertions change with the fix), **Rewrite** (move to the Workers harness with real D1/DOs), **Delete** (tests dead or duplicated code). "Encodes removed behaviour" lists what must be deleted from the file.

| File | Tests | Action | Notes / encodes removed behaviour |
| --- | --- | --- | --- |
| `src/auth/demo/demo.test.ts` | 6 | Rewrite | Real DemoDO; demo tenant becomes `sys_demo` (WP-2.12) |
| `src/auth/oauth.test.ts` | 27 | Delete | Identical to `tests/auth/oauth.test.ts`; module deleted (WP-5.4) |
| `src/auth/sybil.test.ts` | 20 | Update → merge | Merge with `tests/auth/sybil.test.ts`; PRD thresholds; no fixture tokens |
| `src/crypto/encryption.spec.ts` | 7 | Keep | Pure crypto |
| `src/durable_objects/crypto.spec.ts` | 27 | Delete (after WP-3.6) | Legacy global-key `decryptKey`; uses master key directly |
| `src/durable_objects/key_pool.spec.ts` | 17 | Rewrite | Private-only KeyPoolDO; microdollar assertions → CU |
| `src/proxy/sse_transformer.test.ts` | 40 | Update | Add `include_usage`, `kc.usage` event, estimation flag |
| `src/proxy/upstream_client.test.ts` | 48 | Update | Error messages no longer contain upstream text; only google/groq; µ$ → CU |
| `src/router/capability_filter.test.ts` | 44 | Update | Trimmed catalog; CU |
| `src/router/cascade_router.test.ts` | 29 | Rewrite | `LeaseProvider` instead of `keyPool.getKey`; no `selfKeyRouted` |
| `src/router/model_registry.test.ts` | 39 | Update | CU weights, aliases (`auto`, `smart-fast`, `coder-high`, `open-groq`) |
| `src/storage/d1.spec.ts` | 14 | Delete | Dead D1 adapter with SQL mock |
| `src/storage/do.spec.ts` | 20 | Delete | Dead `storage/do.ts` |
| `src/storage/repositories/auth_tokens/repository.spec.ts` | 5 | Rewrite | Real D1; merge into `authTokens` integration |
| `src/worker/index.test.ts` | 22 | Rewrite | Becomes `hosts.test.ts`; SQL mock removed |
| `src/worker/router/core/key_resolver.test.ts` | 4 | Rewrite | Strict decryption (WP-3.6); remove fallback-attempt tests |
| `src/worker/router_handler.test.ts` | 17 | Rewrite | Remove `requireAuth: false` and `MIDNIGHT_FREEZE` tests (→ kill switch, WP-5.1); master-key tests deleted |
| `test/abuse_routes.test.ts` | 5 | Rewrite | → `security/s4_takedown.test.ts`; SQL mock and ALWAYS_PASS token removed |
| `test/auth_middleware.test.ts` | (re-export) | Delete | Runs the 43 unit tests twice |
| `test/durable_objects/circuit_breaker.test.ts` | 23 | Keep/Update | State machine unit; update for `settle` outcomes |
| `test/durable_objects/index.test.ts` | 8 | Update | Export list; µ$ references |
| `test/durable_objects/key_pool_do.test.ts` | 36 | Rewrite | Private-only DO in the Workers pool |
| `test/durable_objects/key_selector.test.ts` | 34 | Update | Community priority moves to coordinator; µ$ → CU |
| `test/durable_objects/rate_limiter.test.ts` | 22 | Update | µ$ → CU |
| `test/env.test.ts` | 3 | Update | New bindings (`API_HOST`, `RATE_LIMITER`, …) |
| `test/error_normalizer.test.ts` | 8 | Rewrite | Unified sanitizer patterns; no `details` to clients |
| `test/integration/worker/index.test.ts` | 25 | Rewrite | Mock stubs + SQL mock → Workers harness; delete `/v1/capacity` forwarding tests (N-01) |
| `tests/admin/admin_router.test.ts` | 10 | Rewrite | Replace echo tests (T-04) with effect tests; admin via session, not master key |
| `tests/api_types.test.ts` | 16 | Update | CU fields |
| `tests/auth/oauth.test.ts` | 27 | Delete | Module deleted |
| `tests/auth/sybil.test.ts` | 38 | Update | Remove fixture-token tests (lines 62-80, 642, 670); PRD thresholds; engine now wired |
| `tests/auth/two_phase_auth.test.ts` | 38 | Rewrite | Split into `identity/*.test.ts` (WP-1.2) and `hosts.test.ts`; SQL mock removed; master-key paths removed |
| `tests/constants.test.ts` | 28 | Update | Microdollar constants → CU constants; master-key constant tests removed |
| `tests/crypto/encryption.test.ts` | 38 | Keep | Pure |
| `tests/crypto/hashing.test.ts` | 26 | Keep | Pure |
| `tests/crypto/utils.test.ts` | 44 | Keep | Pure |
| `tests/errors.test.ts` | 29 | Update | Client serialisation without `details`; CU |
| `tests/integration/coordinator_wiring.test.ts` | 2 | Rewrite | Lease orchestration (WP-2.1) |
| `tests/models_and_config_types.test.ts` | 27 | Update | CU weights; provider list |
| `tests/pool/coordinator_do.test.ts` | 13 | Rewrite | New coordinator in the Workers pool |
| `tests/smoke.test.ts` | 2 | Update | Hosts |
| `tests/storage/migrations.test.ts` | 2 | Rewrite | All migrations + prod-like fixture (WP-1.4) |
| `tests/storage/repositories/apiKeys.test.ts` | 37 | Rewrite | Real D1; repository now wired |
| `tests/storage/repositories/authTokens.test.ts` | 32 | Rewrite | Real D1; CU budgets; no master-key tokens |
| `tests/storage/repositories/costLedger.test.ts` | 40 | Rewrite | Real D1; CU columns, `borrowed`, `lender_tenant_id` |
| `tests/storage/repositories/modelRegistry.test.ts` | 46 | Delete | Repository and table deleted (WP-3.4) |
| `test/unit/quota/limits.test.ts` | 7 | Keep | Tier limits |
| `test/unit/quota/tenant_do.test.ts` | 19 | Rewrite | Debt/credit/multiplier/reset in the Workers pool |
| `test/unit/utils/logger.test.ts` | 6 | Keep/Update | Logger now wired; add sanitizer assertion |
| `test/unit/worker/auth_middleware.test.ts` | 43 | Rewrite | Real D1; remove master-key-as-admin and header-tenant tests |
| `test/unit/worker/dashboard_session_telemetry.test.ts` | 5 | Rewrite | Cookie sessions; µ$ → CU |
| `test/unit/worker/router_handler.test.ts` | 31 | Rewrite | Integration through `api.*`; delete `/v1/keys|metrics|capacity` tests |
| `test/unit/worker/telemetry_emitter.test.ts` | 29 | Update | CU doubles |
| `ui/src/lib/AddKeyModal.test.ts` | 15 | Rewrite | Turnstile widget, `x-turnstile-token` header, error codes |
| `ui/src/lib/DebtLedgerWidget.test.ts` | 8 | Rewrite | No resolve; standing states; CU |
| `ui/src/lib/PoolCommonsTab.test.ts` | 4 | Update | Live telemetry schema |
| `ui/src/lib/TelemetryCharts.test.ts` | 13 | Keep | Pure charting |

---

## 10.3 Appendix C — Migration sequence

One migration file per WP (D-19). Numbers are fixed in advance, so application order does not depend on merge order.

| # | File | Stage / WP | Contents | Backup before prod apply |
| --- | --- | --- | --- | --- |
| 0011 | `0011_security_hotfix.sql` | 0 / WP-0.4 | `api_keys.key_hash` (+ unique partial index), `api_keys.revoked_at`, `admin_audit_logs` | No |
| 0012 | `0012_credit_units.sql` | 1 / WP-1.3 | µ$ → CU renames on `cost_ledger`, `daily_spend_rollup` (→ `daily_cu_rollup`), `auth_tokens`, `contributor_standing`; ledger `usage_estimated`, `borrowed`, `lender_tenant_id`; recompute historical CU; reset budgets; drop compatibility views | Yes |
| 0013 | `0013_identity.sql` | 1 / WP-1.2 | `user_identities`, `sessions`, `users.community_eligible`, `users.sybil_assessed_at`, `users.registration_status`; backfill Google identities; suspend `gh_*`/`usr_gh_*`; expire all `auth_tokens` | Yes |
| 0014 | `0014_schema_repair.sql` | 1 / WP-1.4 | Recreate `consent_attestations` (append-only triggers); rebuild `project_hash_registry` (INTEGER times); rebuild `api_keys` (status enum, `pool_type` default PRIVATE, INTEGER times, `status_changed_at`, `sync_pending`, `key_version`; counter columns kept) | **Yes — table rebuilds** |
| 0015 | `0015_projects.sql` | 1 / WP-1.6 | `DROP TABLE keys`; `auth_tokens.project_id`; `projects.rpm_sub_cap`, `projects.is_archived`; `projects` timestamps ×1000 | No |
| 0016 | `0016_catalog_cleanup.sql` | 1 / WP-3.4 | `DROP TABLE model_registry` | No |
| 0017 | `0017_standing.sql` | 2 / WP-2.3 | `contributor_standing.contributed_cu_24h`, `multiplier_pct`, `jail_status`, `last_reset_day` | No |
| 0018 | `0018_key_daily_stats.sql` | 2 / WP-2.6 | `key_daily_stats` (per key and model); `api_keys.drain_state` | No |
| 0019 | `0019_anti_cycling.sql` | 2 / WP-2.2 | `api_keys.anti_cycling_until` | No |
| 0020 | `0020_project_hash_vesting.sql` | 2 / WP-2.13 | `project_hash_registry.vesting_started_at` | No |
| 0021 | `0021_notifications.sql` | 2 / WP-3.2 | `notifications` | No |
| 0022 | `0022_standing_history.sql` | 2 / WP-2.5 | `standing_history` | No |
| 0023 | `0023_drop_key_counters.sql` | 2 / WP-2.11 | drop `api_keys.dispatched_today`, `dispatched_communal`, `vesting_tier` | Yes |

Removed from the chain: `0010_purge_all_keys.sql` (moved to `scripts/qa/`). Every migration is covered by `test/integration/migrations.test.ts` against both an empty database and a production-shaped fixture, and `deploy-prod.yml` exports a D1 backup before applying any migration marked "Yes".
