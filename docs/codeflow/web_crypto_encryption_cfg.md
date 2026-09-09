---
file: docs/codeflow/web_crypto_encryption_cfg.md
project: Key Collective v2
purity: [🟢 Pure]
cyclomatic_avg: 5
date: 2026-09-10
tags: [type/codeflow, Key Collective v2]
---

# 📄 Codeflow: `docs/codeflow/web_crypto_encryption_cfg.md`

> **Module Responsibility:** Handles high-performance encryption/decryption of keys using AES-256-GCM via Web Crypto API with strict nonce management.
> **Purity Profile:** `🟢 Pure`

---

## 1. 🕸️ Inbound & Outbound Dependency Graph
```mermaid
graph LR
    subgraph Callers
        KeyPoolDO[KeyPoolDO]
        AdminAPI[Admin API]
    end
    subgraph `src/crypto/`
        Encryption[encryption.ts]
        Utils[utils.ts]
    end
    subgraph Callees
        WebCrypto[Web Crypto API]
    end
    KeyPoolDO --> Encryption
    AdminAPI --> Encryption
    Encryption --> WebCrypto
    Encryption --> Utils
```

---

## 2. 🔍 Function Logic & Control Flow Deep Dive

### `def encryptKey(plaintext: string, masterKey: CryptoKey) -> Promise<string>`
* **Purity:** `🟢 Pure`
* **Complexity:** Cyclomatic: `4` | Cognitive: `4`

#### Control Flow Graph (CFG)
```mermaid
flowchart TD
    A[Master key derivation] --> B[12-byte random nonce generation]
    B --> C[AES-256-GCM encryption]
    C --> D[Append nonce to ciphertext]
    D --> E[Base64 conversion]
    E --> F[Return encrypted string]
```

### `def compareHashes(a: string, b: string) -> boolean`
#### Control Flow Graph (CFG)
```mermaid
flowchart TD
    A[Decode Base64 to ArrayBuffer] --> B{Lengths match?}
    B -- No --> C[Return false]
    B -- Yes --> D[crypto.subtle.timingSafeEqual]
    D --> E[Return boolean]
```

#### Def-Use Data Flow Matrix
| Parameter / Variable | Origin | Transformations | Mutation / Sinks |
|---|---|---|---|
| `plaintext_key` | Input | Encoded to Uint8Array | Web Crypto encrypt |
| `nonce` | crypto.getRandomValues | Appended | Returned in payload |

#### Edge Cases & Exception Audit
- ⚠️ **Edge Case 1:** Nonce reuse (prevented by strict 12-byte random generation per operation).
- ⚠️ **Edge Case 2:** Timing attacks during comparison (prevented by `timingSafeEqual`).

---

## 3. 🛠️ Code Review & Optimization Notes
- **Refactoring:** Ensure `masterKey` caching avoids re-derivation overhead per request.
- **Strengths:** Strict adherence to Web Crypto AES-256-GCM standards, zero plaintext leaks.

## 🔗 Related Workflows & MOC
- [[codebase-scribe-workflow]] — Used in Codebase Scribe & Cartographer
- [[Templates-Index]] — Master Index of Workflows
