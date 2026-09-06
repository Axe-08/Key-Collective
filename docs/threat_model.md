# Threat Model & Mitigation

## 1. Volume Compromise (Data at Rest)
**Threat:** Attacker downloads the `keys.db` SQLite file from Railway.
**Mitigation:** `EncryptedKey` column uses AES-256-GCM. Without the `KC_MASTER_KEY` environment variable, the keys are mathematically unreadable.

## 2. Token Leakage
**Threat:** User commits the `kc_master_token` to GitHub.
**Mitigation:** Attacker can route traffic through the proxy, but cannot extract the underlying provider keys (endpoints only support proxying, not key extraction).
*Future Fix:* Add IP whitelisting to the proxy.

## 3. Denial of Wallet
**Threat:** Malicious script loops 1M requests to the proxy.
**Mitigation:** Upstream RPD (Requests Per Day) limits are enforced natively. The proxy will cut off traffic once the daily pool quota is exhausted, preventing runaway bills.

## 4. Concurrency Panic
**Threat:** 1,000 parallel requests cause race conditions on key selection.
**Mitigation:** The Key Pool is protected by `sync.RWMutex`. Selection logic operates in `<0.1ms`, making lock contention a non-issue even at 10,000 RPS.
