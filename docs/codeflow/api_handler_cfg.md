# Codeflow: `APIHandler.HandleCreateKey()` & `HandleGetKeys()`

**Purity Badge:** 🔴 I/O Mutating (HTTP parsing, AES encryption, SQLite insertion, KeyManager mutation)
**Path:** `internal/api/handler.go`

## Control Flow Graph (CFG): Key Creation
```mermaid
flowchart TD
    Start[POST /api/keys] --> Decode[Decode JSON Request Body into CreateKeyRequest]
    Decode --> Validate{Validation Checks:<br/>Key empty? Label empty? Valid provider?}
    Validate -- Invalid --> Err400[HTTP 400 Bad Request with error msg]
    Validate -- Valid --> PrefixSuffix[Extract Prefix first 6 chars & Suffix last 4 chars]
    
    PrefixSuffix --> Encrypt[proxy.Encrypt key using KC_MASTER_KEY via AES-256-GCM]
    Encrypt -- Fail --> Err500[HTTP 500 Internal Server Error]
    Encrypt -- Success --> GenUUID[Generate new UUID for key]
    
    GenUUID --> ConstructKey[Construct domain.APIKey with Status: healthy]
    ConstructKey --> DBInsert[db.InsertKey key, ciphertext into SQLite]
    DBInsert -- Fail --> Err500DB[HTTP 500: Database write failed]
    
    DBInsert -- Success --> DecryptMem[Set key.Decrypted = rawKey in memory]
    DecryptMem --> KMAdd[km.AddKey key with Thread-Safe RWMutex]
    KMAdd --> Response[Serialize Masked Key Metadata to JSON]
    Response --> HTTP201[HTTP 201 Created]
```

## Control Flow Graph (CFG): Key Retrieval
```mermaid
flowchart TD
    StartGet[GET /api/keys] --> DBQuery[db.GetKeys from SQLite]
    DBQuery -- Fail --> Err500Get[HTTP 500: DB read error]
    DBQuery -- Success --> Iterate[Iterate retrieved keys]
    
    Iterate --> SyncKM[Query km.GetStats / key status from memory]
    SyncKM --> Mask[Map to KeyResponse:<br/>Prefix, Suffix, Provider, Label, Limits, Status]
    Mask --> OmitPlaintext[Guarantee plaintext & encrypted blobs omitted]
    OmitPlaintext --> WriteJSON[Encode JSON array & write HTTP 200]
```

## Def-Use Data Flow Matrix

| Variable | Definition Point | Mutation Points | Usage Sinks | Security / Lifetime Sink |
| :--- | :--- | :--- | :--- | :--- |
| `req.Key` | JSON Unmarshal | None | `proxy.Encrypt()`, `key.Decrypted` | Zeroized from response payload |
| `ciphertext` | `proxy.Encrypt()` | Sealed with nonce | `db.InsertKey()` | Persisted to SQLite BLOB |
| `masterKey` | Env `KC_MASTER_KEY` | None | AES-GCM Key generation | Never logged or returned |
| `key.Decrypted` | `req.Key` string | Cleared on eviction | `km.AddKey()` | Maintained strictly in process RAM |
