# Part 1: Language Primitives & Toolchain

Welcome to Part 1. Before we can build complex distributed proxies, we need to agree on the fundamental building blocks of our universe. 

In this section, we strip away the abstractions and look at the raw materials we use to construct the Key Collective system. 

## The 4 Runtime Units

This part is divided into four critical chapters. Do not skip these, even if you think you know TypeScript. Our environment is unique, and our constraints are severe. 

### 1. V8 Isolates and the Edge Runtime

You are not in Node.js anymore. You are not in a Docker container. You are running inside a V8 isolate. 

This chapter explains the physics of the edge: cold starts, the fetch event lifecycle, and why standard Node.js APIs won't save you here. We'll explore the Web Standard Streams API, which is the backbone of our proxy implementation. 

### 2. Strict Typing and Domain Modeling

TypeScript is our shield against chaos. But default TypeScript is too loose. 

Here we cover our zero-`any` mandate, how to configure the compiler for maximum strictness, and our specific domain modeling patterns. You'll learn how to use branded types to prevent mixing microdollars with milliseconds, and how to use discriminated unions to model state machines that the compiler can exhaustively check. 

### 3. Web Crypto and Byte Manipulation

We handle raw, encrypted keys. We cannot rely on Node's `crypto` module. 

This chapter is a comprehensive tour of the Web Crypto API (`crypto.subtle`), ArrayBuffers, and constant-time operations. If you don't know the difference between base64 and base64url, you will after this. 

### 4. Toolchain and Fast Quality Gates

Speed is a feature, both in production and in development. 

We explore our `pnpm` workspace setup, local emulation with Miniflare, and most importantly, our `< 10s` quality gate contract. If your tests take longer than 10 seconds to run, you break the build. 

---

Dive into Chapter 1.1 to begin.

## 🗺️ Learning Objectives for Part 1

By the conclusion of this part, you will be able to:
1. Explain the architectural distinctions between Node.js long-running processes and Cloudflare V8 isolates.
2. Structure TypeScript domain models using branded types and discriminated unions without using the `any` keyword.
3. Perform cryptographic hashing, byte encoding, and constant-time comparisons using the standard Web Crypto API.
4. Execute Miniflare local emulation harnesses and satisfy the rigid `<10s` verification quality gate (`make gate`).

---

## 🧭 Suggested Reading Order
- **If you are new to edge computing:** Read strictly sequentially from Unit 1.1 through Unit 1.4.
- **If you are an experienced TypeScript engineer:** Review Unit 1.1 for isolate execution physics, then skim Unit 1.3 for Web Crypto specifics.
