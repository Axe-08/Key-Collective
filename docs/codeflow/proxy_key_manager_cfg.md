# Codeflow: `KeyManager.GetBestKey()`

**Purity Badge:** 🟡 I/O / Mutating (Stateful locks, modifies request counts)
**Path:** `internal/proxy/manager.go`

## Control Flow Graph (CFG)
```mermaid
flowchart TD
    Start[GetBestKey(preferredProvider)] --> Lock[Acquire RWMutex.Lock()]
    Lock --> CheckGlobal[Total requests today >= dailyLimit?]
    CheckGlobal -- Yes --> Err1[Return Error: Quota ceiling reached]
    CheckGlobal -- No --> Loop1[Iterate all keys]
    
    Loop1 --> CheckWindow{60s passed since WindowStart?}
    CheckWindow -- Yes --> Reset[Reset RequestsThisMin = 0]
    CheckWindow -- No --> CheckCooldown{Status == RateLimited && cooldown expired?}
    CheckCooldown -- Yes --> Restore[Status = Healthy]
    CheckCooldown -- No --> Loop1Next[Next Key]
    Reset --> CheckCooldown
    Restore --> Loop1Next
    
    Loop1Next --> Filter[Filter available keys]
    Filter --> HasAvailable{len(available) > 0?}
    HasAvailable -- No --> CheckFallback{preferredProvider != ""}
    HasAvailable -- Yes --> Sort[Sort by Provider -> Priority -> Headroom -> Latency]
    
    CheckFallback -- Yes --> Fallback[Filter available ignoring provider]
    Fallback --> FallbackAvailable{len(available) > 0?}
    CheckFallback -- No --> Err2[Return Error: All keys exhausted]
    FallbackAvailable -- No --> Err2
    FallbackAvailable -- Yes --> Sort
    
    Sort --> Increment[bestKey.RequestsThisMin++, bestKey.RequestsToday++]
    Increment --> Unlock[Unlock Mutex]
    Unlock --> End[Return bestKey]
    Err1 --> UnlockErr1[Unlock] --> End
    Err2 --> UnlockErr2[Unlock] --> End
```

## Def-Use Matrix

| Variable | Defined At | Mutated At | Used At | Sink |
|:---------|:-----------|:-----------|:--------|:-----|
| `km.mu` | Init | `GetBestKey:22` (Lock), `57` (Unlock) | | Synchronization |
| `now` | `GetBestKey:25` | - | Window resets | Local scope |
| `available` | `GetBestKey:40` | `GetBestKey:44` (append) | `GetBestKey:61` (sort) | Return object |
| `k.RequestsThisMin` | Pointer struct | `GetBestKey:31` (reset), `GetBestKey:97` (increment) | RPM Headroom check | Memory |
