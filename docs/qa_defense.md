# QA Defense Plan: Key Collective v4.0

**Date:** 2026-09-14  
**Gate Command:** `make gate` (must pass in <10s before any merge)

---

## 1. Test Matrix Coverage Targets

| Layer | Target Coverage | Priority |
|---|---|---|
| **Unit Tests** | 90% on core logic (HKDF, debt math, leaky bucket, state transitions) | 🔴 Critical |
| **Integration Tests** | 80% on DO state transitions, D1 interactions, router cascade logic | 🔴 Critical |
| **E2E Tests** | 100% on 8 critical user journeys | 🔴 Critical |
| **Security Tests** | 100% on all attack vectors from threat model | 🔴 Critical |
| **Performance Regression** | All SLIs must pass before merge | 🟡 High |

---

## 2. Critical Path Tests (MUST PASS Before v4.0 Launch)

### Registration & Key Ingestion
1. **E2E-01:** Full registration flow: GitHub OAuth → 5-layer anti-sybil → C1/C2/C3 consent → account created
2. **E2E-02:** Key submission: Add key → Turnstile verify → K1/K2 attestation → forced-error probe → HKDF encrypt → D1 commit → OBSERVATION state
3. **E2E-03:** Duplicate key rejection: Submit same GCP project hash → 409 Conflict within 1s

### Pool Mechanics
4. **E2E-04:** Observation buffer: Verify key <24h old cannot serve communal requests
5. **E2E-05:** Pool toggle freeze: Attempt PRIVATE→COMMUNITY toggle at 23:45 UTC → HTTP 403
6. **E2E-06:** Pool toggle success: Toggle at 02:00 UTC → OBSERVING state

### Routing & Quota
7. **E2E-07:** Self-key priority: Request routes via own key when available; zero CU debt incurred
8. **E2E-08:** Community pool routing: All own keys exhausted; eligible debt; routes via community pool; debt incremented
9. **E2E-09:** Quota jail enforcement: Debt >1.0× → HTTP 429 with `X-Quota-Jail: hard` header

### Debt Ledger
10. **E2E-10:** Debt decay cron: Trigger midnight cron; verify 30% decay on all tenants with >0 debt

### Takedown Portal
11. **E2E-11:** Takedown timing shield: POST to /report → response time 200±10ms for both hash match and miss
12. **E2E-12:** Rate limit: 6th request from same IP within 1h → HTTP 429

---

## 3. Performance Regression Suite

| Test | Metric | SLO | Measurement Method |
|---|---|---|---|
| Proxy P95 Latency | Total overhead excluding upstream LLM | **< 100ms** | Load test 1000 req with k6; measure P95 excluding upstream time |
| Routing Overhead | Time in router logic (self-key + community check) | **< 5ms P95** | WAE `routing_overhead_ms` histogram |
| Takedown Response | POST /report response time | **200ms ±10ms** | Vitest: mock DB hit + miss, verify timing |
| HKDF Derivation | WebCrypto HKDF call latency | **< 10ms P99** | `performance.now()` around derivation; 1000 iterations |
| Debt Decay Accuracy | (before × 0.70) within ±1 CU | **100%** | Unit test 1000 random debt values; verify integer rounding |
| Observation Buffer | No communal dispatch for exactly 24h ±30s | **100%** | Integration test with time injection |

---

## 4. Security Test Suite

### HKDF Correctness
```typescript
test('HKDF produces unique keys per tenant', async () => {
  const keyA = await deriveKey('tenant-aaa');
  const keyB = await deriveKey('tenant-bbb');
  expect(bufferToHex(keyA)).not.toBe(bufferToHex(keyB));
});

test('HKDF produces stable key for same tenant', async () => {
  const key1 = await deriveKey('tenant-aaa');
  const key2 = await deriveKey('tenant-aaa');
  expect(bufferToHex(key1)).toBe(bufferToHex(key2));
});
```

### Debt Ledger Tamper Resistance
```typescript
test('Concurrent debt increments are atomic', async () => {
  // Fire 50 concurrent requests to same DO
  const results = await Promise.all(
    Array.from({length: 50}).map(() => incrementDebt('tenant-test', 10))
  );
  const finalDebt = await getDebt('tenant-test');
  expect(finalDebt).toBe(500); // Exactly 50 × 10, no lost updates
});
```

### Midnight Freeze Enforcement
```typescript
test('Pool toggle blocked at 23:45 UTC', async () => {
  MockDate.set('2026-09-14T23:45:00Z');
  const res = await togglePoolMode('tenant-test', 'COMMUNITY');
  expect(res.status).toBe(403);
  expect(res.error).toBe('MIDNIGHT_FREEZE_ACTIVE');
});

test('Pool toggle allowed at 01:00 UTC', async () => {
  MockDate.set('2026-09-14T01:00:00Z');
  const res = await togglePoolMode('tenant-test', 'COMMUNITY');
  expect(res.status).toBe(200);
});
```

### Pool Toggle Freeze (Anti-Gaming)
```typescript
test('GCP project hash tombstone blocks 14-day re-registration', async () => {
  await tombstoneHash('gcp-hash-abc', 'tenant-test');
  const res = await submitKey('tenant-test', {gcpProjectHash: 'gcp-hash-abc'});
  expect(res.status).toBe(409);
  expect(res.error).toBe('PROJECT_HASH_TOMBSTONED');
});
```

---

## 5. `make gate` Composition

The existing `make gate` must be extended to include:

```makefile
gate:
  @echo "Running TypeScript typecheck..."
  pnpm -C ui typecheck
  @echo "Running unit + integration tests..."
  pnpm test --timeout 10000
  @echo "Running security assertion tests..."
  pnpm test:security
  @echo "Gate passed ✅"
```

Target: Total gate time **< 10 seconds** (current baseline: <10s confirmed ✅).
