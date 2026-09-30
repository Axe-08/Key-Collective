# 1.4 Toolchain and Fast Quality Gates

A brilliant architecture is useless if the developer experience is miserable. If it takes 5 minutes to run tests, developers will stop running tests. If local emulation is flakey, developers will push broken code to production. 

In the Key Collective, we enforce a strict, fast, and deterministic toolchain. 

## The `pnpm` Workspace

We manage multiple packages (proxy worker, durable objects, shared libraries, cli tools) in a single monorepo. We use `pnpm` workspaces for this. 

`pnpm` is superior to `npm` because it uses a content-addressable store and hard links. It is significantly faster and enforces strict dependency boundaries. If package A depends on package B, package A cannot secretly import dependencies that only package B declared. 

Our `pnpm-workspace.yaml` looks like this:

```yaml
packages:
  - 'packages/*'
  - 'workers/*'
  - 'tools/*'
```

To run a command across all packages:
```bash
# Run the typecheck script in every workspace package concurrently
pnpm -r run typecheck
```

## Wrangler and Miniflare

Wrangler is the CLI we use to configure, build, and deploy to Cloudflare. 

However, under the hood, local development is powered by **workerd** (the open-source Cloudflare Workers runtime) and **Miniflare** (the local simulator for storage, KV, D1, etc.). 

Your `wrangler.toml` is the source of truth for the environment. It defines your D1 database bindings, your Durable Object classes, and your environment variables. 

When you run `pnpm wrangler dev`, Miniflare spins up a local instance of `workerd` that mimics the production edge environment almost perfectly. 

## Vitest: Edge-Native Mock Execution

We use **Vitest** for testing, not Jest. Vitest is native to the Vite ecosystem, natively supports TypeScript without compilation plugins, and is incredibly fast. 

More importantly, Cloudflare provides `@cloudflare/vitest-pool-workers`. This tool allows Vitest to run your unit tests *inside* a local `workerd` isolate, rather than in a standard Node.js environment. 

This means you can test your Web Crypto code, your D1 queries, and your Durable Object state transitions with production-equivalent fidelity. 

```typescript
// example.test.ts
import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import worker from "./index";

test("Proxy handles missing API key with 401", async () => {
  // Construct a raw Web Standard Request
  const request = new Request("http://localhost/proxy", {
    method: "POST",
    body: JSON.stringify({ prompt: "Hello" })
  });

  // Execute the worker fetch handler locally
  const response = await worker.fetch(request, env, {} as ExecutionContext);
  
  expect(response.status).toBe(401);
  const data = await response.json();
  expect(data.error).toContain("Missing API Key");
});
```

Notice we are importing from `cloudflare:test`. This is a virtual module provided by the test runner that gives us access to our mock Miniflare bindings (like `env.DB` for a local D1 database). 

## The `< 10s` Quality Gate Contract

We have a non-negotiable architectural invariant: **All changes must pass `make gate` in less than 10 seconds before merge.**

What does `make gate` do? It runs the entire fast feedback loop:
1. `pnpm typecheck`: Strict TypeScript compiler check across all packages.
2. `pnpm lint`: ESLint rules enforcement. 
3. `pnpm test`: Execution of all unit and integration tests via Vitest. 

If this takes longer than 10 seconds, the build is considered broken. 

### Why 10 seconds?

If a quality gate takes 10 seconds, you run it on every save. It becomes part of your breathing. 
If it takes 1 minute, you run it before you commit. 
If it takes 5 minutes, you let CI run it, and you context switch to Hacker News while you wait. 

We maintain the 10-second contract through:
- Using `esbuild` (under the hood via Wrangler/Vite) instead of Webpack.
- Mocking slow network calls in Vitest. 
- Keeping our dependencies fiercely minimal. 

Here is a simplified view of our Makefile:

```makefile
.PHONY: gate typecheck lint test

typecheck:
	pnpm -r run typecheck

lint:
	pnpm -r run lint

test:
	pnpm -r run test

# The mandatory quality gate
gate: typecheck lint test
	@echo "✅ Quality Gate Passed"
```

You do not push code that fails `make gate`. You do not push code that slows down `make gate`. 

The toolchain serves you, but you must respect its constraints.

### 4. Continuous Verification Makefile Recipe

The `<10s` verification contract is codified directly into the project Makefile:

```makefile
# Fast verification quality gate (<10s)
.PHONY: gate test typecheck lint

gate: lint typecheck test
	@echo "ALL QUALITY GATES PASSED IN <10s"

lint:
	pnpm ruff check . || pnpm eslint .

typecheck:
	pnpm tsc --noEmit

test:
	pnpm vitest run --coverage.enabled=false
```

Running `make gate` before every commit guarantees that broken imports, type regressions, or failing unit tests are trapped at the developer machine before reaching staging.


### 5. Hermetic Miniflare Mock Harness Execution

To ensure local tests run without contacting external network endpoints, Miniflare isolates are instantiated hermetically:

```typescript
// Hermetic Miniflare environment bootstrap in Vitest
import { Miniflare } from "miniflare";

export async function createTestMiniflare(): Promise<Miniflare> {
  return new Miniflare({
    modules: true,
    scriptPath: "dist/index.js",
    d1Databases: ["DB"],
    durableObjects: {
      KEY_POOL: "KeyPoolDO",
      TENANT_QUOTA: "TenantQuotaDO",
      POOL_COORDINATOR: "PoolCoordinatorDO"
    },
    bindings: {
      ENVIRONMENT: "test",
      MAX_OVERDRAFT_MICRODOLLARS: "50000000" // 50 USD
    }
  });
}
```

This local sandbox mirrors Cloudflare production behavior with 100% determinism.
