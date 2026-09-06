# QA & Executive Defense

**Q1: Why build this instead of using LiteLLM?**
**A1:** LiteLLM is heavy (Python/Postgres/Redis), consumes ~150MB+ RAM at idle, and is overkill. Our Go binary uses 15MB, runs entirely free on Railway, and treats multi-key pooling for the *same* provider as a first-class feature, which LiteLLM struggles with cleanly.

**Q2: What happens if Railway restarts the container and wipes the in-memory rate limits?**
**A2:** We accept the ephemeral nature of the minute window. If we restart, the system assumes 0 RPM used. If a burst occurs, the upstream returns a 429, which triggers our robust 60s circuit breaker. The system self-heals within a minute.

**Q3: How do you handle database contention with SQLite?**
**A3:** We use Write-Ahead Logging (WAL) mode. The hot proxy path never writes to the database directly; it pushes to a non-blocking Go channel. A background worker batches the writes every 5 seconds. Proxy latency remains < 1ms regardless of DB lock state.
