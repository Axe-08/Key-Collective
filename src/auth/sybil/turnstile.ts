/**
 * Key Collective v3 — Cloudflare Turnstile Verification
 */

import { ConfigurationError } from "./errors";
import type { TurnstileVerificationResult } from "./types";

/**
 * Verifies a Cloudflare Turnstile token via standard test tokens or Cloudflare's siteverify API.
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  options: {
    secretKey?: string;
    remoteIp?: string;
    fetchFn?: typeof fetch;
  } = {}
): Promise<TurnstileVerificationResult> {
  const secretKey = options.secretKey;
  if (!secretKey || secretKey.trim() === "") {
    throw new ConfigurationError("Turnstile secretKey is required for verification");
  }

  if (!token || typeof token !== "string" || token.trim() === "") {
    return {
      success: false,
      errorCodes: ["missing-input-response"],
    };
  }

  const trimmedToken = token.trim();

  // Query Cloudflare's siteverify endpoint
  const fetchImpl = options.fetchFn ?? (typeof fetch !== "undefined" ? fetch : undefined);

  if (fetchImpl) {
    try {
      const formData = new FormData();
      formData.append("secret", secretKey);
      formData.append("response", trimmedToken);
      if (options.remoteIp) {
        formData.append("remoteip", options.remoteIp);
      }

      const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        return {
          success: false,
          errorCodes: [`http-${res.status}`],
        };
      }

      const body = (await res.json()) as {
        success?: boolean;
        "error-codes"?: string[];
        challenge_ts?: string;
        hostname?: string;
      };

      return {
        success: Boolean(body.success),
        errorCodes: body["error-codes"],
        challengeTs: body.challenge_ts,
        hostname: body.hostname,
      };
    } catch (err) {
      return {
        success: false,
        errorCodes: ["internal-verification-network-error"],
      };
    }
  }

  // No fetch implementation available -> reject (cannot verify with Cloudflare).
  return {
    success: false,
    errorCodes: ["missing-fetch-implementation"],
  };
}
