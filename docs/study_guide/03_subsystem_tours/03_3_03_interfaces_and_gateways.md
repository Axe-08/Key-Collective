# Unit 3: Interfaces, Adapters & External Gateways

> **What this covers:** Examines entrypoints, CLI parsing, API controllers, and external system adapters.  
> **Key Symbols:** `KeyResponse`, `CreateKeyRequest`, `ErrorResponse`, `MessageResponse`, `TestKeyResponse`, `Handler`, `CircuitBreakerState`, `CircuitBreakerData`

---

## 🎯 What We Are Building & Why It Matters
This unit walks through how `key-collective` handles this part of the system. We will explore the real classes, see how data moves, and look at the key design decisions.

### 📂 Source Files in this Unit:
- [internal/api/handler.go](https://github.com/Axe-08/Key-Collective/blob/master/internal/api/handler.go)
- [internal/api/handler_test.go](https://github.com/Axe-08/Key-Collective/blob/master/internal/api/handler_test.go)
- [ui/svelte.config.js](https://github.com/Axe-08/Key-Collective/blob/master/ui/svelte.config.js)
- [ui/ui.go](https://github.com/Axe-08/Key-Collective/blob/master/ui/ui.go)
- [ui/vite.config.ts](https://github.com/Axe-08/Key-Collective/blob/master/ui/vite.config.ts)
- [ui/src/main.ts](https://github.com/Axe-08/Key-Collective/blob/master/ui/src/main.ts)
- [ui/src/lib/api.ts](https://github.com/Axe-08/Key-Collective/blob/master/ui/src/lib/api.ts)
- [src/durable_objects/circuit_breaker.ts](https://github.com/Axe-08/Key-Collective/blob/master/src/durable_objects/circuit_breaker.ts)
- [src/proxy/upstream_client.test.ts](https://github.com/Axe-08/Key-Collective/blob/master/src/proxy/upstream_client.test.ts)
- [src/proxy/upstream_client.ts](https://github.com/Axe-08/Key-Collective/blob/master/src/proxy/upstream_client.ts)

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

[← Previous: Unit 2](03_2_02_core_engine_and_logic.md) | [Next: Unit 4 →](03_4_04_observability_and_infrastructure.md)
