# 🗺️ Codeflow: HKDF Per-Tenant Key Derivation & Web Crypto Encryption

> **Subsystem:** `src/crypto/encryption/`  
> **Source Files:** `src/crypto/encryption/aes.ts`, `src/crypto/encryption/keys.ts`, `src/crypto/encryption/digest.ts`  
> **Security Invariant:** AES-256-GCM · 12-byte random nonces · Ephemeral $K_{\text{tenant}}$ · Zero plaintext storage  

---

## 1. Subsystem Overview
The cryptographic subsystem guarantees tenant key isolation. Even in the catastrophic event of a raw D1 database snapshot leak, individual keys cannot be decrypted without both the Cloudflare Worker master secret and the tenant-specific HKDF derivation parameters:
- **Master Secret:** $K_{\text{master}}$ held exclusively in Cloudflare Worker secret environment bindings.
- **Tenant Key Derivation:** Ephemeral 256-bit symmetric key derived via HKDF-SHA256:
  $$K_{\text{tenant}} = \text{HKDF-SHA256}(K_{\text{master}}, \text{salt}=\text{tenantId}, \text{info}=\text{"key-collective-aes-key"})$$
- **AES-256-GCM:** Encrypts raw API keys using hardware-accelerated Web Crypto with 12-byte nonces generated via `crypto.getRandomValues`.

---

## 2. Control Flow Graph (CFG)

```mermaid
flowchart TD
    IngressEncrypt([encryptKey(rawKey, tenantId, masterSecret)]) --> ValidateRaw[Assert rawKey Non-Empty String]
    ValidateRaw --> ImportMaster[crypto.subtle.importKey('raw', masterSecret, 'HKDF')]
    ImportMaster --> DeriveTenantKey[crypto.subtle.deriveKey(HKDF params, salt=tenantId, info='aes-256-gcm-key')]
    DeriveTenantKey --> GenNonce[crypto.getRandomValues(new Uint8Array(12))]
    GenNonce --> AESEncrypt[crypto.subtle.encrypt(AES-GCM, nonce, derivedTenantKey, encodedRawKey)]
    AESEncrypt --> FormatHex[Encode Ciphertext & Nonce to Base64/Hex]
    FormatHex --> ReturnCiphertext[Return { ciphertext, nonce }]

    IngressDecrypt([decryptKey(ciphertext, nonce, tenantId, masterSecret)]) --> ImportMasterDec[crypto.subtle.importKey('raw', masterSecret, 'HKDF')]
    ImportMasterDec --> DeriveTenantKeyDec[crypto.subtle.deriveKey(HKDF params, salt=tenantId)]
    DeriveTenantKeyDec --> AESDecrypt[crypto.subtle.decrypt(AES-GCM, nonce, derivedTenantKey, ciphertextBytes)]
    AESDecrypt --> CheckSuccess{Decryption Successful?}
    CheckSuccess -->|No - Tag Mismatch| ThrowCryptoError[Throw DecryptionFailedError / Invalid Nonce or Key]
    CheckSuccess -->|Yes| DecodeUTF8[TextDecoder.decode(decryptedBytes)]
    DecodeUTF8 --> ReturnPlaintext[Return Ephemeral Plaintext Key]
```

---

## 3. Def-Use Variable Lifecycle Matrix

| Variable | Scope / Type | Def Site | Use Sites | Purity Badge |
|---|---|---|---|---|
| `masterSecret` | `string` | Environment Secret | `importKey` | 🟢 Pure |
| `tenantId` | `string` | Authenticated Session | HKDF `salt` | 🟢 Pure |
| `derivedTenantKey` | `CryptoKey` | `deriveKey` | `AES-GCM encrypt / decrypt` | 🔴 State Mutating |
| `nonce` | `Uint8Array(12)` | `getRandomValues` | `AES-GCM params`, D1 column | 🔴 State Mutating |
| `ciphertext` | `string` | Base64 Encoding | D1 storage, Upstream Decrypt | 🟢 Pure |
