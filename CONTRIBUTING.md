# Contributing to Key Collective 🔑

Thank you for your interest in contributing to Key Collective! We are building an open, edge-native communal capacity exchange and high-throughput AI router on Cloudflare Workers and Durable Objects.

---

## 🏛️ Architectural Invariants (Non-Negotiable)

All contributions to Key Collective must adhere strictly to our **AI Constitution**:

1. **Strict TypeScript Mode (Zero `any`):** Zero use of `any`, zero `@ts-ignore` or `@ts-expect-error` without maintainer justification. Strict compiler mode is enforced on all files.
2. **Zero Plaintext Keys at Rest:** All provider API keys must be encrypted using AES-256-GCM via the Web Crypto API with unique 12-byte CSPRNG nonces and HKDF/PBKDF2 derivation. Plaintext keys exist only in ephemeral V8 isolate memory during active upstream dispatch.
3. **Per-Tenant Durable Object Isolation:** Compute and state boundaries are isolated by `env.KEY_POOL.idFromName(tenantId)`. Zero cross-tenant state leakage is permitted.
4. **Integer Credit Units (`bigint` CU):** All capacity accounting uses 64-bit integer Capacity Units (`bigint` CU). Floating-point math and fractional currency arithmetic are strictly prohibited.
5. **DO Transactional Storage for Hot State:** In-memory sliding-window rate counters and circuit breaker states must persist to `this.ctx.storage` to survive edge worker eviction. D1 SQLite is reserved for durability, rollups, and user metadata.
6. **Non-Blocking Telemetry:** High-frequency telemetry logging, Analytics Engine streaming, and credit consumption writes must run asynchronously via `ctx.waitUntil(promise)`. Never block the proxy hot-path on D1 queries.
7. **Strict Quality Gate:** All changes must pass `make gate` in **< 10 seconds** before merging.

---

## 🛠️ Local Development Setup

### 1. Prerequisites
- **Node.js**: `>= 20.12.0` (LTS recommended)
- **Package Manager**: `npm` (or `pnpm`)
- **Cloudflare Wrangler CLI**: Installed locally or globally via `npm install -g wrangler`

### 2. Quickstart
```bash
# Clone the repository
git clone https://github.com/Axe-08/Key-Collective.git
cd Key-Collective

# Install root worker and frontend UI dependencies
make setup

# Initialize local environment variables
cp .dev.vars.example .dev.vars

# Run the strict quality gate
make gate
```

### 3. Local Development Servers
```bash
# Terminal 1: Start local Cloudflare Workers + Durable Objects runtime (Miniflare)
npm run dev

# Terminal 2: Start Svelte 5 frontend developer console
cd ui && npm run dev
```

---

## 🧪 Testing Standards & Quality Gates

Key Collective maintains an eval-driven, multi-tier testing harness:

| Command | Suite | Purpose |
|---|---|---|
| `make gate` | **Fast Quality Gate** | Strict typecheck + Worker unit tests + UI tests in < 10s |
| `npm run typecheck` | TypeScript Compiler | Validates `tsconfig.json` with zero errors |
| `npm run test:unit` | Vitest Unit Tests | Fast in-memory unit tests across crypto, router, pool, and quota |
| `npm run test:ui` | Vitest Frontend Tests | Svelte 5 component unit tests and DOM interaction assertions |
| `node scripts/reachability.mjs` | Reachability Scanner | Ensures zero orphaned or unreferenced TypeScript files in `src/` |

Before opening a pull request, verify:
```bash
make gate
```

---

## 🌿 Git & Pull Request Guidelines

### Branching Strategy
- `master`: Production branch, deployed to `*.key-col.axe08.tech`.
- `develop`: Primary staging and integration branch.
- Feature/bugfix branches: Branch off `develop` using standard naming:
  - `feat/<feature-name>`
  - `fix/<bug-description>`
  - `perf/<optimization>`
  - `docs/<documentation-update>`

### Commit Conventions (Conventional Commits)
All commit messages must follow standard Conventional Commits formatting:
- `feat(proxy): support streaming reasoning chunks for groq-deepseek`
- `fix(pool): prevent cold coordinator state overwrite on worker restart`
- `perf(router): make non-streaming telemetry async via waitUntil`
- `test(ui): add DOM assertions for metric refresh button spin state`
- `docs: update deployment checklist and contributing guide`

### Pull Request Checklist
1. [ ] Branch created from the latest `develop`.
2. [ ] `make gate` executes locally and passes in < 10s.
3. [ ] No plaintext keys, credentials, or `.dev.vars` committed.
4. [ ] Invariants respected: zero `any`, integer `bigint` CU accounting, non-blocking telemetry.
5. [ ] Tests added or updated covering the new logic or bug fix.
6. [ ] Pull request description outlines rationale, approach, and blast-radius.

---

## 🔒 Security & Vulnerability Reporting

Security is the core foundation of Key Collective:
- **Do NOT create public GitHub issues for security vulnerabilities, cryptographic flaws, or key exposure.**
- Send a responsible disclosure report directly to the core maintainers with a reproduction script or proof-of-concept.
- All valid vulnerability reports will be addressed with emergency patches and credited in our release notes.

Thank you for helping build a fairer, communal AI future! 🚀
