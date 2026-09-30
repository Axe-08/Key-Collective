# Part 0: Preface and Syllabus

Welcome to the Key Collective University! If you're reading this, you're about to dive deep into the architecture, systems, and runtime physics of the Key Collective proxy infrastructure. 

This isn't your standard theoretical textbook. We build production systems here, and this guide is designed to bridge the gap between abstract computer science concepts and the concrete reality of deploying high-performance edge compute. 

## The Core Mental Model: Reciprocal Key Exchange

Before we get into the weeds of V8 isolates and byte manipulation, you need to understand the fundamental domain model of this system: the **Reciprocal Key Exchange**. 

In most systems, API keys are static bearers of authority. They are issued once, stored in a database (hopefully hashed), and checked on every request. 

The Key Collective operates differently. We treat keys not as static tokens, but as dynamic, stateful entities that participate in a continuous exchange of value. 

When a client makes a request through our proxy, they are essentially performing a transaction. They provide a key, and in return, they receive access to a downstream resource (an LLM inference endpoint, a database query, etc.). 

This exchange is reciprocal because both sides must agree on the terms of the transaction. The proxy evaluates the request against the key's state (quotas, rate limits, balances) and the tenant's configuration. 

### Why this matters

This mental model drives every architectural decision we make:

1. **Statefulness at the Edge**: Keys have state. They have balances that deplete, rate limits that fill, and circuit breakers that trip. This state must be globally consistent but locally fast. 
2. **Transactional Integrity**: Every proxy request is a financial transaction. We bill in microdollars. Dropped requests are lost revenue. Over-admitted requests are uncompensated costs. 
3. **Strict Isolation**: Tenants must never see each other's state or noisy-neighbor each other's compute. 

## Reading Roadmaps

Depending on your role and background, you might want to consume this guide differently.

### For the Beginner

If you're new to edge compute or TypeScript, don't rush. 
1. Start with **Part 1 (Language Primitives)**. Understand how V8 isolates differ from Node.js, and why we care so much about strict typing and branded types.
2. Spend time on the Web Crypto API chapter. It's fundamental to our security model. 
3. Move on to **Part 2 (State & Persistence)** to see how we use Durable Objects and D1.

### For the Systems Engineer

If you're already comfortable with TypeScript and basic distributed systems:
1. Skim the primitives, but pay close attention to the **Strict Typing and Domain Modeling** chapter. Our use of branded types and discriminated unions is non-negotiable. 
2. Dive deep into **Part 3 (The Proxy Hot Path)**. This is where the magic happens. 
3. Study the **Concurrency and Consistency** chapters. Understand how we use DO storage for transactional safety. 

### For the SRE

If your focus is on reliability, observability, and operability:
1. Start with the **Toolchain and Fast Quality Gates** chapter in Part 1. You need to know how we build and test. 
2. Jump to **Part 4 (Observability and Telemetry)**. Understand our non-blocking telemetry philosophy and how we use Workers Analytics Engine. 
3. Review the **Failure Modes and Circuit Breakers** chapter. 

## Local Environment Prerequisites

To follow along and actually build things, you need your local environment set up correctly. We don't use Docker for local development of edge workers. We emulate the edge. 

### 1. Node.js 20+

The Workers runtime supports modern JavaScript features. We mandate Node.js 20 or higher for local tooling compatibility. 

```bash
# Check your Node version
node --version
# Should output v20.x.x or higher
```

### 2. pnpm

We use `pnpm` for fast, disk-space-efficient package management and strict workspace isolation. Do not use `npm` or `yarn`. 

```bash
# Install pnpm if you don't have it
npm install -g pnpm

# Verify installation
pnpm --version
```

### 3. Wrangler CLI

Wrangler is the official Cloudflare Workers CLI. It's how we build, test, and deploy. 

```bash
# We prefer to run wrangler via pnpm to ensure version consistency
pnpm dlx wrangler --version
```

### 4. Code Editor

We strongly recommend VS Code with the following extensions:
- **ESLint**: For inline linting feedback.
- **Prettier**: For consistent code formatting.
- **TypeScript and JavaScript Language Features**: Built-in, but ensure it's using the workspace TS version. 

### Let's get building. 

Turn the page to Part 1, where we strip away the magic and look at the underlying physics of the V8 isolate. 
