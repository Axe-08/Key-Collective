/**
 * Key Collective v3 — Anti-Sybil Domain Errors
 */

import { DomainError } from "../../errors/domain_error";

export class SybilBotDetectedError extends DomainError {
  public override readonly name = "SybilBotDetectedError";
  constructor(message = "Bot detected: Cloudflare Turnstile challenge failed", details?: Record<string, unknown>) {
    super(message, {
      statusCode: 403,
      code: "BOT_DETECTED",
      details,
    });
    Object.setPrototypeOf(this, SybilBotDetectedError.prototype);
  }
}

export class SybilDisposableIdentityError extends DomainError {
  public override readonly name = "SybilDisposableIdentityError";
  constructor(message = "Disposable identity rejected: disposable email domain not permitted", details?: Record<string, unknown>) {
    super(message, {
      statusCode: 403,
      code: "DISPOSABLE_IDENTITY_REJECTED",
      details,
    });
    Object.setPrototypeOf(this, SybilDisposableIdentityError.prototype);
  }
}

export class SubnetQuotaExceededError extends DomainError {
  public override readonly name = "SubnetQuotaExceededError";
  constructor(message = "Subnet quota exceeded: maximum 1 registration per /24 subnet per 30 days", details?: Record<string, unknown>) {
    super(message, {
      statusCode: 429,
      code: "SUBNET_QUOTA_EXCEEDED",
      details,
    });
    Object.setPrototypeOf(this, SubnetQuotaExceededError.prototype);
  }
}
