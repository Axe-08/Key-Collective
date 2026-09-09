# Unit 1: Data Contracts, Schemas & Domain Primitives

> **What this covers:** Deconstructs the foundational types, schemas, and boundary contracts that govern all inputs and internal state.  
> **Key Symbols:** `APIKey`, `RequestLog`, `ProxyStats`, `Provider`, `KeyStatus`, `APIKey`, `RequestLog`, `PoolStats`

---

## 🎯 What We Are Building & Why It Matters
This unit walks through how `key-collective` handles this part of the system. We will explore the real classes, see how data moves, and look at the key design decisions.

### 📂 Source Files in this Unit:
- [internal/domain/contracts.go](https://github.com/Axe-08/Key-Collective/blob/master/internal/domain/contracts.go)
- [ui/src/lib/types.ts](https://github.com/Axe-08/Key-Collective/blob/master/ui/src/lib/types.ts)
- [src/contracts/auth.ts](https://github.com/Axe-08/Key-Collective/blob/master/src/contracts/auth.ts)
- [src/contracts/index.ts](https://github.com/Axe-08/Key-Collective/blob/master/src/contracts/index.ts)
- [src/contracts/key_pool.ts](https://github.com/Axe-08/Key-Collective/blob/master/src/contracts/key_pool.ts)
- [src/contracts/router.ts](https://github.com/Axe-08/Key-Collective/blob/master/src/contracts/router.ts)
- [src/contracts/telemetry.ts](https://github.com/Axe-08/Key-Collective/blob/master/src/contracts/telemetry.ts)
- [src/router/model_registry.test.ts](https://github.com/Axe-08/Key-Collective/blob/master/src/router/model_registry.test.ts)
- [src/router/model_registry.ts](https://github.com/Axe-08/Key-Collective/blob/master/src/router/model_registry.ts)
- [src/storage/repositories/modelRegistry.ts](https://github.com/Axe-08/Key-Collective/blob/master/src/storage/repositories/modelRegistry.ts)

---

## 🔍 Code Walkthrough & Real-World Invariants
Here is how the main classes and functions in this area work, and what rules they follow:
1. **Clean Input Checks:** Before any real work happens, inputs get validated so broken data fails early.
2. **Separated Work:** Network calls, disk writes, and database operations are kept apart from pure logic.

---

## 🧠 Quick Check
1. **Question:** What is the primary role of this subsystem in the overall architecture?
   <details><summary><b>Reveal Answer</b></summary>
   It keeps domain responsibilities focused in one place, so changes to internal logic do not break external callers.
   </details>

---

[← Previous: Subsystem Index](README.md) | [Next: Unit 2 →](03_2_02_core_engine_and_logic.md)
