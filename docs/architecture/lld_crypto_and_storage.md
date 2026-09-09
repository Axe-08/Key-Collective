# Low-Level Design: Crypto and Storage Pod

## 1. Overview
The Crypto and Storage Pod is responsible for securely managing sensitive information (such as API keys and auth tokens) and interacting with the D1 database for persistent storage.

## 2. Cryptographic Standards
Strict adherence to `GEMINI.md` invariants:
- **No Plaintext Keys**: All sensitive credentials must be encrypted at rest.
- **Encryption Algorithm**: AES-256-GCM via the Web Crypto API.
- **Nonces**: A unique 12-byte random nonce is generated for every encryption operation and stored alongside the ciphertext in the D1 database.
- **Hashing**: SHA-256 is used for secure hashing, particularly for lookup indices (e.g., token hashes).
- **Comparison**: Timing-safe equality functions must be used when comparing hashes or secrets to prevent timing attacks.

## 3. Storage Architecture (D1)
The storage layer utilizes Cloudflare D1.

### 3.1. Schemas
- **Auth Tokens**: Stores hashed auth tokens for lookup, and encrypted token details.
- **API Keys**: Stores encrypted vendor API keys (OpenAI, Anthropic, etc.), along with the 12-byte nonce used for encryption.
- **Model Registry**: Stores available AI models, routing configurations, and base pricing.
- **Cost Ledger & Rollups**: Tracks usage financials. **Financials must be stored as int64 microdollars** (1 USD = 1,000,000 microdollars) to avoid floating-point inaccuracies.

### 3.2. Repository Layer
Each entity has a corresponding repository in `src/storage/repositories/` to abstract D1 queries:
- Automatically handles encryption/decryption on read/write (for `apiKeys.ts` and `authTokens.ts`).
- Casts database rows into strictly typed TypeScript objects.

## 4. Error Handling and Edge Cases
- **Decryption Failures**: Throws specific errors that are caught by the proxy layer.
- **Unique Constraints**: D1 unique constraints on hashed values handle concurrent insertions safely.
