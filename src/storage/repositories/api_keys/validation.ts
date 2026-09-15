/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * API Key Input Validation Helpers
 */

import {
  MAX_RPM_LIMIT,
  MIN_RPM_LIMIT,
  isValidRpmLimit,
} from "../../../constants/limits";
import { InvalidKeyError } from "../../../errors/key_errors";
import { isKeyStatus, isModelProvider } from "../../../types/models";
import type { CreateApiKeyInput } from "./types";

/**
 * Validates creation input parameters.
 */
export function validateCreateApiKeyInput(input: CreateApiKeyInput): void {
  if (!input.tenantId || input.tenantId.trim().length === 0) {
    throw new InvalidKeyError("Tenant ID cannot be empty", {
      reason: "missing_tenant_id",
    });
  }
  if (!input.plaintextKey || input.plaintextKey.trim().length === 0) {
    throw new InvalidKeyError("Plaintext API key cannot be empty", {
      reason: "missing_plaintext_key",
    });
  }
  if (!input.provider || !isModelProvider(input.provider)) {
    throw new InvalidKeyError(`Invalid model provider: '${input.provider}'`, {
      provider: String(input.provider),
      reason: "invalid_provider",
    });
  }
  if (!input.label || input.label.trim().length === 0) {
    throw new InvalidKeyError("Key label cannot be empty", {
      reason: "missing_label",
    });
  }
  if (input.rpmLimit !== undefined && !isValidRpmLimit(input.rpmLimit)) {
    throw new InvalidKeyError(
      `Invalid RPM limit: ${input.rpmLimit}. Must be an integer between ${MIN_RPM_LIMIT} and ${MAX_RPM_LIMIT}.`,
      { reason: "invalid_rpm_limit" }
    );
  }
  if (
    input.rpdLimit !== undefined &&
    (!Number.isInteger(input.rpdLimit) || input.rpdLimit < 1)
  ) {
    throw new InvalidKeyError(
      `Invalid RPD limit: ${input.rpdLimit}. Must be a positive integer.`,
      { reason: "invalid_rpd_limit" }
    );
  }
  if (input.status !== undefined && !isKeyStatus(input.status)) {
    throw new InvalidKeyError(`Invalid key status: '${input.status}'`, {
      reason: "invalid_status",
    });
  }
}
