# Part 4: End-to-End Execution Flows (The "Hows")

> Tracing execution journeys through `key-collective` from invocation to completion.

---

## 🌊 Flow 1: Primary Lifecycle Journey

```mermaid
sequenceDiagram
    autonumber
    actor Caller as Developer / Caller
    participant Entry as Entrypoint (CLI / API)
    participant Engine as Core Engine
    participant Handler as Domain Handler
    participant Storage as Persistence / State

    Caller->>Entry: Invoke command with arguments
    Entry->>Engine: Validate parameters & dispatch
    Engine->>Handler: Coordinate domain transformation
    Handler->>Storage: Persist verified artifacts
    Storage-->>Handler: Confirm write
    Handler-->>Engine: Return execution result
    Engine-->>Entry: Format output
    Entry-->>Caller: Render final result / exit code 0
```

---

[← Previous: Part 3 — Subsystem Tours](03_subsystem_tours/README.md) | [Next: Part 5 — Idioms, Patterns & Trade-offs →](05_idioms_patterns_and_tradeoffs.md)
