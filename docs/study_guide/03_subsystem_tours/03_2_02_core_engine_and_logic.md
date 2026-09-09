# Unit 2: Core Engine & Computational Pipelines

> **What this covers:** Walks through the primary algorithmic workflows, internal state machines, and transactional execution paths.  
> **Key Symbols:** `ProxyServer`

---

## 🎯 What We Are Building & Why It Matters
This unit walks through how `key-collective` handles this part of the system. We will explore the real classes, see how data moves, and look at the key design decisions.

### 📂 Source Files in this Unit:
- [cmd/key-collective/main.go](https://github.com/Axe-08/Key-Collective/blob/master/cmd/key-collective/main.go)
- [internal/proxy/crypto.go](https://github.com/Axe-08/Key-Collective/blob/master/internal/proxy/crypto.go)
- [internal/proxy/handler.go](https://github.com/Axe-08/Key-Collective/blob/master/internal/proxy/handler.go)

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

[← Previous: Unit 1](03_1_01_data_contracts_and_models.md) | [Next: Unit 3 →](03_3_03_interfaces_and_gateways.md)
