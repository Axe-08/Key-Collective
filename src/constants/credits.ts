/**
 * Key Collective v2 — Credit Units System Constants & Math
 *
 * Invariants (GEMINI.md Constitution):
 * - Fixed-Point / Integer Math: All Credit Units (CU) are BigInt.
 * - Zero floating-point arithmetic.
 */

export type CU = bigint;

/**
 * Integer ceiling division for BigInt: ceil(a / b).
 * Formula: (a + b - 1n) / b for non-negative a and positive b.
 */
export function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/**
 * Formats Credit Units for presentation/display.
 */
export function formatCu(cu: bigint): string {
  return cu.toLocaleString("en-US");
}
