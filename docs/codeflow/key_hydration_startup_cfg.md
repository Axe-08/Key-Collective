# Codeflow: Server Boot & Zero-Knowledge Key Hydration

**Purity Badge:** 🟡 Stateful Initialization (Disk reading, AES decryption, In-memory state priming)
**Path:** `cmd/key-collective/main.go`

## Control Flow Graph (CFG)
```mermaid
flowchart TD
    Boot[Server Boot: main()] --> LoadEnv[godotenv.Load() & Read KC_MASTER_KEY]
    LoadEnv --> CheckSecret{KC_MASTER_KEY present?}
    CheckSecret -- Missing --> Fatal[log.Fatal: KC_MASTER_KEY is required]
    
    CheckSecret -- Present --> OpenDB[db.InitDB keys.db in WAL mode]
    OpenDB --> SchemaCheck[Execute idempotent DDL schema migrations]
    SchemaCheck --> Hydrate[db.GetKeys: Load all active keys from SQLite]
    
    Hydrate --> LoopKeys[Iterate stored keys]
    LoopKeys --> Decrypt{proxy.Decrypt ciphertext with masterKey}
    Decrypt -- Corrupt/Wrong Key --> SkipKey[Log Warning & skip key]
    Decrypt -- Success --> PrimeState[Assign key.Decrypted = raw<br/>Reset MinuteWindowStart = now]
    
    SkipKey --> NextKey[Next Key]
    PrimeState --> NextKey
    NextKey --> HasMore{More keys?}
    HasMore -- Yes --> LoopKeys
    HasMore -- No --> InitKM[Initialize proxy.NewKeyManager with hydrated pool]
    
    InitKM --> MountAPI[Mount REST API & Reverse Proxy Routes]
    MountAPI --> EmbedUI[Mount ui.Handler() serving embedded Svelte 5 SPA]
    EmbedUI --> StartLogger[Spawn background goroutine for async log flushing]
    StartLogger --> Listen[http.ListenAndServe on :PORT]
```
