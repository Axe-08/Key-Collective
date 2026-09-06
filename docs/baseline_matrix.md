# Baseline Comparison Matrix

| Metric | Naive (.env hardcoded) | LiteLLM (Self-hosted) | Key Collective (Go) |
|:-------|:-----------------------|:----------------------|:--------------------|
| **Setup** | Fast, manual | Medium (Docker, Postgres) | Fast (Single Binary) |
| **Idle Memory** | 0MB | ~150MB+ | **~15MB** |
| **Multi-Key Pooling** | ❌ No | ⚠️ Partial (Complex config) | ✅ **Native** |
| **Circuit Breaking** | ❌ App crashes on 429 | ✅ Yes | ✅ **Yes (60s slide)** |
| **Cost to Host** | $0 | Requires larger VPS | **$0 (Railway Free)** |
| **Privacy** | High | High | High (Self-hosted, AES) |
