/**
 * Key Collective — Deterministic Clock Abstraction
 *
 * Provides a single `Clock` interface used across Durable Objects so that
 * lease, window, backoff, and alarm-scheduling logic never calls
 * `Date.now()` directly. In production, `systemClock` delegates to the
 * real wall clock. In tests, a DO's `clock` field can be swapped for a
 * fixed clock via the `setClockForTest` RPC method (test-env only).
 */

export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};
