# Key Collective — Engineering Handover Document (2026-10-03)

> This file was found empty (0 bytes) on 2026-10-03. It was restored by Claude from the copy read earlier that session, with the resume section below added.

## 0. RESUME HERE (end of the Claude session, 2026-10-03)

> **PAUSED by the owner (2026-10-03).** All Phase F agents are stopped. Committed progress (19 of 47 tasks):
>
> | Branch | Committed tasks | Remaining tasks |
> |---|---|---|
> | `wp/WP-F.1-rest` (contains `wp/WP-F.1`) | T-F.1.1–1.4 | none |
> | `wp/WP-F.2` | T-F.2.1–2.3 | none |
> | `wp/WP-F.3` | none | T-F.3.1–3.5, T-F.4.1 |
> | `wp/WP-F.5` | T-F.5.1–5.2 | T-F.5.3–5.5, T-F.6.1–6.2 |
> | `wp/WP-F.7` | T-F.7.1–7.3 | T-F.7.4–7.8 |
> | `wp/WP-F.8` | T-F.8.1–8.2, T-F.9.1 | T-F.9.2–9.4 |
> | `wp/WP-F.10` | T-F.10.1–10.3 | T-F.10.4–10.13 |
>
> **Uncommitted work-in-progress** is left in the agents' worktrees under `.claude/worktrees/agent-*`:
> - WP-F.3: 25 files (the catalog rebuild);
> - WP-F.5: 11 files;
> - WP-F.7: 6 files;
> - WP-F.8: 2 files.
>
> Review it with `git -C <worktree> diff`. Keep it only if its tests pass, and commit it per task. Otherwise discard it with `git -C <worktree> checkout -- .`.
>
> Each worktree's `.wp/red.log` is local to that worktree; keep it for `wp.sh finish`. Nothing is merged or pushed.

- **Plan:** `docs/PHASEF_PLAN.md`. It contains the re-audit (RA-01 to RA-15), the verified model lists, 10 work packages and the owner QA list (§5). Live provider evidence is in `docs/specs/gcp_probe.md`.
- **Phase F is running in parallel.** Each work package (or pair) is built by a background agent in its own git worktree under `.claude/worktrees/`, on its own branch starting from `5113788`. **None are merged.**

  | Branch | Work packages |
  |---|---|
  | `wp/WP-F.1` | T-F.1.1 done at `43fdd07`. T-F.1.2–1.4 are on `wp/WP-F.1` or `wp/WP-F.1-rest`. |
  | `wp/WP-F.2` | classification |
  | `wp/WP-F.3` | catalog and probes, plus T-F.4.1 |
  | `wp/WP-F.5` | identity, plus WP-F.6 add-key modal |
  | `wp/WP-F.7` | workbench truth |
  | `wp/WP-F.8` | CORS and errors, plus WP-F.9 admin and report |
  | `wp/WP-F.10` | AU fixes |

- **Next steps:**
  1. `git branch --list 'wp/WP-F*'` and `git log --oneline 5113788..<branch>` for each branch.
  2. For each branch in the order F.1 → F.2 → F.3 → F.5 → F.7 → F.8 → F.10, merge into `docs/intent-audit-and-remediation` with `git merge --no-ff`.
     - Resolve conflicts (likely in `docs/PROGRESS.md`, `App.svelte`, `auth_routes.ts`, `handler.ts`, `scripts/baselines.json`).
     - Run `npm run gate` after each merge.
  3. `.wp/red.log` is per worktree. If `wp.sh finish` rejects a branch for missing red entries, merge manually after the gate passes, and note it in the merge commit.
  4. An unfinished branch: continue its unticked tasks from `docs/PROGRESS.md` with `scripts/wp.sh`.
- **Corrections to §4 below:**
  - **QA-12:** do NOT use `gemini-2.5-flash` (Google limits it to past users). Use `gemini-3.5-flash-lite` and Groq `openai/gpt-oss-20b`; `llama-3.1-8b-instant` is gone.
  - **Catalog:** Groq does not offer `llama-3.3-70b-versatile` to our key (live check).
- **Owner decisions:**
  - QA-15 uses option A, a separate `kc_admin_session`.
  - QA-02: `sybil_score` stays NULL until GitHub is linked.
  - Proof-of-life models come from the live research.

## 1. Executive Summary & Current Position

We are executing `docs/REMEDIATION_PLAN_V3.md`.

| Phase | Status |
|---|---|
| Phases 0–6 | Complete, merged in `docs/intent-audit-and-remediation` |
| Phase 7 (WP-7.1–7.7) | Merged (`9b4ef6a`). The re-audit found T-7.7.9 incomplete (RA-09, fixed in WP-F.3). |
| Phase G (WP-G.1–G.2) | Complete (`3fab5fc`) |
| Phase D (D.1, D.2) | Complete. `7a34e02` was pushed to `origin/develop` and `origin/docs/intent-audit-and-remediation`. |
| Phase D (D.3 pass 1) | Complete, 16 findings in `docs/specs/dev_smoke_2026-10-03.md` |
| Phase F | In progress (see §0 and `docs/PHASEF_PLAN.md`) |
| Phase D (D.3 pass 2, D.4) | After Phase F, using `docs/PHASEF_PLAN.md` §5 |
| Phase 8 | Planned in `docs/PHASE8_PLAN.md` |

## 2. Git, Environment & Infrastructure

- **Branches:** the base branch is `docs/intent-audit-and-remediation`. `develop` deploys dev and `master` deploys production. Push only with the owner's confirmation (STOP).
- **Backups:** `backups/prod-2026-10-03.sql` and `backups/dev-2026-10-03.sql` (git-ignored).
- **Remote dev D1:** always pass `--env dev --remote`, for example:
  ```
  npx wrangler d1 execute key-collective-d1-dev --env dev --remote --command "SELECT ..."
  ```
  Without `--env dev` the call fails with Cloudflare error 10000.
- **D.1 results:**
  - `hkdf_migrated = 0` count is 0 on dev and prod.
  - Legacy GitHub-only accounts: 0 on prod.
  - All 6 dev secrets are set: `ADMIN_TOKEN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `KC_MASTER_KEY`, `SESSION_SIGNING_KEY`, `TURNSTILE_SECRET`.
  - Migrations 0001–0024 are applied on dev.
- **Firebase:** project `key-collective-568f8`. Its authorised domains include `console-dev.`, `admin-dev.` and `admin.key-col.axe08.tech`.
- **Models:** `gemini-3.8-flash` is a real released model; keep it.

## 3. Workflow rules (`scripts/wp.sh`)

1. `./scripts/wp.sh start WP-F.x` creates `wp/WP-F.x`.
2. `./scripts/wp.sh red T-F.x.y <test>` must fail before the fix, and records the task in `.wp/red.log`. `finish` rejects `feat`/`fix` commits that have no red entry.
3. One commit per task id, and tick `docs/PROGRESS.md` in the same commit. `./scripts/wp.sh verify-tasks WP-F.x` checks the alignment.
4. `./scripts/wp.sh check` runs the forbid rules (`any`, ts suppressions, `void err;`, `.catch(() => {})`, skip/todo, D1 mocks), the typecheck, and the given tests. Ratchet baselines are in `scripts/baselines.json`: counts may only go down.
   - UI tests (`ui/src/**`) are routed to the UI vitest configs.
5. `./scripts/wp.sh finish WP-F.x` runs check, verify-tasks and the gate, merges `--no-ff`, and deletes the branch.
6. D-30: never carry out or tick a STOP step without the owner.

## 4. Dev smoke findings QA-01 – QA-16

The full root causes, files and lines are in `docs/specs/dev_smoke_2026-10-03.md`. They map to Phase F as follows:

| Work package | Findings |
|---|---|
| WP-F.5 / F.6 | Identity and add-key: QA-01, 02, 03, 09, 10, 11 |
| WP-F.3 | Proof-of-life: QA-12 (corrected models; see §0) |
| WP-F.7 | Workbench: QA-04, 05, 06, 13, 14 |
| WP-F.8 | Gateway: QA-07, 08 |
| WP-F.9 | Admin and report: QA-15 (option A), QA-16 |

## 5. Roadmap

1. Finish and merge Phase F (§0).
2. **STOP (owner):** push to `develop`; run the operator steps in `docs/PROGRESS.md` (purge login bearer tokens, `verify_catalog.mjs`); then D.3 pass 2 with `docs/PHASEF_PLAN.md` §5 Q-01–Q-16, and D.4.
3. Phase 8 per `docs/PHASE8_PLAN.md`, then the release gate. Merging to `master` is an owner step.
