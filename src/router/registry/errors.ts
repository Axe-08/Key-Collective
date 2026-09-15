/**
 * Key Collective v2 — Model Registry Errors
 *
 * Conforms to:
 * - LLD 2.1: Context window and model registry error types.
 * - GEMINI.md Constitution: TypeScript strict mode, no `any`.
 */

import { DomainError, DomainErrorOptions } from "../../errors";

/**
 * Options for ContextWindowExceededError.
 */
export interface ContextWindowExceededErrorOptions
  extends Omit<DomainErrorOptions, "statusCode" | "code"> {
  modelId: string;
  contextWindow: number;
  requestedTokens: number;
}

/**
 * ContextWindowExceededError (HTTP 400)
 * Thrown when requested prompt tokens or total estimated tokens exceed the model's maximum context window.
 */
export class ContextWindowExceededError extends DomainError {
  public override readonly name = "ContextWindowExceededError";
  public readonly modelId: string;
  public readonly contextWindow: number;
  public readonly requestedTokens: number;

  constructor(
    modelId: string,
    contextWindow: number,
    requestedTokens: number,
    message?: string,
    options: Omit<
      ContextWindowExceededErrorOptions,
      "modelId" | "contextWindow" | "requestedTokens"
    > = {}
  ) {
    const msg =
      message ??
      `Prompt tokens (${requestedTokens}) exceed model '${modelId}' context window (${contextWindow})`;
    super(msg, {
      ...options,
      statusCode: 400,
      code: "CONTEXT_WINDOW_EXCEEDED",
      details: {
        modelId,
        contextWindow,
        requestedTokens,
        ...options.details,
      },
    });
    this.modelId = modelId;
    this.contextWindow = contextWindow;
    this.requestedTokens = requestedTokens;
    Object.setPrototypeOf(this, ContextWindowExceededError.prototype);
  }
}

/**
 * Type guard for ContextWindowExceededError.
 */
export function isContextWindowExceededError(
  value: unknown
): value is ContextWindowExceededError {
  return (
    value instanceof ContextWindowExceededError ||
    (typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).name === "ContextWindowExceededError")
  );
}
