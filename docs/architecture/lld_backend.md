# Backend LLD
- `internal/db/sqlite.go`: Initializes `keys.db` in WAL mode. Provides `InsertLog`, `GetKeys`, `AddKey`.
- `internal/proxy/manager.go`: In-memory `KeyManager` struct with `sync.RWMutex`.
- `internal/proxy/handler.go`: HTTP handler that validates auth token, gets a key from manager, and proxies to upstream.
