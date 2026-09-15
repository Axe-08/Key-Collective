/**
 * @file token_extractor.ts
 * Extraction and syntax validation of Bearer tokens from incoming HTTP requests.
 */

import { AuthenticationError } from "../../errors/auth_errors";

/**
 * Extracts and validates the Bearer token string from a Request, Headers, or raw string.
 *
 * @throws AuthenticationError if missing, malformed, or empty.
 */
export function extractBearerToken(
  input: Request | Headers | string | null | undefined
): string {
  if (input === null || input === undefined) {
    throw new AuthenticationError("Missing Authorization header", {
      reason: "missing_token",
    });
  }

  let authHeader: string | null = null;

  if (typeof input === "string") {
    authHeader = input.trim();
  } else if ("headers" in input && typeof input.headers.get === "function") {
    authHeader = input.headers.get("authorization");
  } else {
    authHeader = (input as unknown as Headers).get("authorization");
  }

  if (!authHeader || authHeader.trim().length === 0) {
    throw new AuthenticationError("Missing Authorization header", {
      reason: "missing_token",
    });
  }

  const trimmed = authHeader.trim();
  const bearerRegex = /^bearer\s*(.*)$/i;
  const match = bearerRegex.exec(trimmed);

  if (!match) {
    throw new AuthenticationError(
      "Malformed Authorization header: Bearer scheme required",
      { reason: "malformed_header" }
    );
  }

  const token = match[1] ? match[1].trim() : "";
  if (token.length === 0) {
    throw new AuthenticationError("Bearer token cannot be empty", {
      reason: "missing_token",
    });
  }

  return token;
}
