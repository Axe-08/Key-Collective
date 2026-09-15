/**
 * Key Collective v2 — Cost Ledger Domain Errors
 *
 * Conforms to:
 * - GEMINI.md Constitution: TypeScript strict mode, no `any`.
 * - Per-Tenant Isolation: Domain errors enforce explicit tenant boundary checks.
 */

import { DomainError, DomainErrorOptions } from "../../../errors/domain_error";

/**
 * Domain error raised on cost ledger database operations.
 */
export class CostLedgerError extends DomainError {
  public override readonly name: string = "CostLedgerError";

  constructor(message: string, options: DomainErrorOptions = {}) {
    super(message, {
      statusCode: options.statusCode ?? 500,
      code: options.code ?? "COST_LEDGER_ERROR",
      ...options,
    });
    Object.setPrototypeOf(this, CostLedgerError.prototype);
  }
}

/**
 * Domain error raised when cost ledger input validation fails.
 */
export class InvalidCostLedgerEventError extends CostLedgerError {
  public override readonly name = "InvalidCostLedgerEventError";

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      statusCode: 400,
      code: "INVALID_COST_LEDGER_EVENT",
      details,
    });
    Object.setPrototypeOf(this, InvalidCostLedgerEventError.prototype);
  }
}

/**
 * Domain error raised when tenant isolation invariant is violated.
 */
export class TenantIsolationViolationError extends CostLedgerError {
  public override readonly name = "TenantIsolationViolationError";

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      statusCode: 403,
      code: "TENANT_ISOLATION_VIOLATION",
      details,
    });
    Object.setPrototypeOf(this, TenantIsolationViolationError.prototype);
  }
}
