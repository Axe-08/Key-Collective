---
file: docs/codeflow/web_crypto_encryption_cfg.md
project: Key Collective
purity: [🟢 Pure]
cyclomatic_avg: 2
date: 2026-09-10
tags: [type/codeflow, Key Collective]
---

# 📄 Codeflow: `docs/codeflow/web_crypto_encryption_cfg.md`

> **Module Responsibility:** AES-256-GCM encryption via Web Crypto API with timing-safe operations.
> **Purity Profile:** `🟢 Pure`

---

## 1. 🕸️ Inbound & Outbound Dependency Graph
```mermaid
graph LR
    subgraph Callers
        TokenRepo[Token Repository]
        KeyRepo[Key Repository]
    end
    subgraph `web_crypto_encryption`
        encryptKey[encryptKey]
        decryptKey[decryptKey]
        generateNonce[generateNonce]
        timingSafeEqual[timingSafeEqual]
        deriveMasterKey[deriveMasterKey]
    end
    subgraph Callees
        WebCrypto[crypto.subtle]
        Random[crypto.getRandomValues]
    end

    TokenRepo --> encryptKey
    TokenRepo --> decryptKey
    KeyRepo --> encryptKey
    KeyRepo --> decryptKey
    encryptKey --> generateNonce
    encryptKey --> deriveMasterKey
    decryptKey --> deriveMasterKey
    generateNonce --> Random
    encryptKey --> WebCrypto
    decryptKey --> WebCrypto
```

---

## 2. 🔍 Function Logic & Control Flow Deep Dive

### `def encryptKey(plaintext, masterKey) -> EncryptedPayload`
* **Purity:** `🟢 Pure`
* **Complexity:** Cyclomatic: `2` | Cognitive: `2`

#### Control Flow Graph (CFG)
```mermaid
flowchart TD
    Start[Start: encryptKey] --> GenNonce[generateNonce 12-byte]
    GenNonce --> Derive[deriveMasterKey]
    Derive --> Encode[TextEncoder encode plaintext]
    Encode --> Encrypt[crypto.subtle.encrypt AES-GCM]
    Encrypt --> Base64[Base64 encode ciphertext & nonce]
    Base64 --> Return[Return Object]
```

#### Def-Use Data Flow Matrix
| Parameter / Variable | Origin | Transformations | Mutation / Sinks |
|---|---|---|---|
| `plaintext` | Argument | UTF-8 Encoded | Encrypted |
| `masterKey` | Argument | Imported as CryptoKey | Used for encryption |

#### Edge Cases & Exception Audit
- ⚠️ **Edge Case 1:** Empty plaintext.
- ⚠️ **Edge Case 2:** Missing or weak master key.

---

### `def timingSafeEqual(a, b) -> boolean`
* **Purity:** `🟢 Pure`
* **Complexity:** Cyclomatic: `3` | Cognitive: `3`

#### Control Flow Graph (CFG)
```mermaid
flowchart TD
    Start[Start: timingSafeEqual] --> LengthCheck{Lengths match?}
    LengthCheck -- No --> ReturnFalse[Return False]
    LengthCheck -- Yes --> BitwiseXor[XOR characters in loop]
    BitwiseXor --> AccSum[Accumulate sum of XORs]
    AccSum --> ReturnResult{Sum == 0?}
    ReturnResult -- Yes --> ReturnTrue[Return True]
    ReturnResult -- No --> ReturnFalse2[Return False]
```

#### Def-Use Data Flow Matrix
| Parameter / Variable | Origin | Transformations | Mutation / Sinks |
|---|---|---|---|
| `a`, `b` | Argument | Length checked | XORed to detect differences |

#### Edge Cases & Exception Audit
- ⚠️ **Edge Case 1:** Strings of different lengths (mitigated by early return, though could leak length).

---

## 3. 🛠️ Code Review & Optimization Notes
- **Refactoring:** Ensure master key is kept in secure memory.
- **Strengths:** Utilizes native Web Crypto API, avoiding expensive JS-based crypto.

## 🔗 Related Workflows & MOC
- [[codebase-scribe-workflow]]
- [[Templates-Index]]
