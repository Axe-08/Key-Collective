/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Circuit Breaker Subsystem: State Machine & Transition Logic
 *
 * Invariants (GEMINI.md Constitution):
 * - Strict TypeScript (no `any`).
 * - Deterministic Transitions: CLOSED -> OPEN -> HALF_OPEN -> CLOSED.
 * - Integer Math: Millisecond timestamps only, zero floating point.
 */

import type { CircuitBreakerData, CircuitBreakerState } from "./types";
import { createDefaultCircuitBreakerData } from "./types";

export interface StateTransitionResult {
  transitioned: boolean;
  data: CircuitBreakerData;
}

/**
 * Evaluates whether the cooldown has elapsed for an OPEN breaker.
 * If elapsed, transitions state in-place to HALF_OPEN.
 */
export function evaluateCooldown(
  data: CircuitBreakerData,
  now: number,
  cooldownMs: number
): boolean {
  if (data.state === "OPEN" && data.openedAt !== null) {
    const elapsed = now - data.openedAt;
    if (elapsed >= cooldownMs) {
      data.state = "HALF_OPEN";
      data.consecutiveSuccesses = 0;
      return true;
    }
  }
  return false;
}

/**
 * Applies a trip transition: moves breaker to OPEN.
 */
export function applyTrip(
  data: CircuitBreakerData,
  now: number,
  failureThreshold: number
): void {
  data.state = "OPEN";
  data.openedAt = now;
  data.lastFailureTime = now;
  data.consecutiveFailures = Math.max(data.consecutiveFailures, failureThreshold);
  data.consecutiveSuccesses = 0;
}

/**
 * Applies a reset transition: moves breaker to CLOSED and resets counters.
 */
export function applyReset(data: CircuitBreakerData): void {
  const fresh = createDefaultCircuitBreakerData();
  data.state = fresh.state;
  data.consecutiveFailures = fresh.consecutiveFailures;
  data.consecutiveSuccesses = fresh.consecutiveSuccesses;
  data.lastFailureTime = fresh.lastFailureTime;
  data.lastSuccessTime = fresh.lastSuccessTime;
  data.openedAt = fresh.openedAt;
}

/**
 * Applies a recorded success transition.
 */
export function applySuccess(
  data: CircuitBreakerData,
  now: number,
  halfOpenSuccessThreshold: number
): void {
  data.lastSuccessTime = now;

  if (data.state === "HALF_OPEN") {
    data.consecutiveSuccesses += 1;
    if (data.consecutiveSuccesses >= halfOpenSuccessThreshold) {
      data.state = "CLOSED";
      data.consecutiveFailures = 0;
      data.consecutiveSuccesses = 0;
      data.openedAt = null;
    }
  } else if (data.state === "CLOSED") {
    data.consecutiveFailures = 0;
  } else if (data.state === "OPEN") {
    data.state = "CLOSED";
    data.consecutiveFailures = 0;
    data.consecutiveSuccesses = 0;
    data.openedAt = null;
  }
}

/**
 * Applies a recorded failure transition.
 */
export function applyFailure(
  data: CircuitBreakerData,
  now: number,
  failureThreshold: number
): void {
  data.lastFailureTime = now;

  if (data.state === "CLOSED") {
    data.consecutiveFailures += 1;
    if (data.consecutiveFailures >= failureThreshold) {
      data.state = "OPEN";
      data.openedAt = now;
      data.consecutiveSuccesses = 0;
    }
  } else if (data.state === "HALF_OPEN") {
    data.state = "OPEN";
    data.openedAt = now;
    data.consecutiveSuccesses = 0;
    data.consecutiveFailures += 1;
  } else if (data.state === "OPEN") {
    data.consecutiveFailures += 1;
  }
}
