/**
 * Real provider error bodies recorded live (docs/specs/gcp_probe.md, 2026-10-03).
 * Tests must use these instead of invented shapes (RA-15).
 */

/**
 * Gemini answer to an invalid or revoked key ("Invalid key (RA-04)"):
 * HTTP 400, status INVALID_ARGUMENT, ErrorInfo.reason API_KEY_INVALID,
 * metadata.service generativelanguage.googleapis.com, no consumer.
 */
export const GEMINI_INVALID_KEY_STATUS = 400;
export const GEMINI_INVALID_KEY_BODY = JSON.stringify({
  error: {
    code: 400,
    message: "API key not valid. Please pass a valid API key.",
    status: "INVALID_ARGUMENT",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "API_KEY_INVALID",
        domain: "googleapis.com",
        metadata: { service: "generativelanguage.googleapis.com" },
      },
      {
        "@type": "type.googleapis.com/google.rpc.LocalizedMessage",
        locale: "en-US",
        message: "API key not valid. Please pass a valid API key.",
      },
    ],
  },
});

/**
 * Gemini answer to a model that is shut down or unknown (`gemini-2.0-flash`, `models/invalid-model`):
 * HTTP 404 NOT_FOUND, no details.
 */
export const GEMINI_MODEL_NOT_FOUND_STATUS = 404;
export const geminiModelNotFoundBody = (model: string): string =>
  JSON.stringify({
    error: {
      code: 404,
      message: `Model is not found: models/${model} for api version v1beta`,
      status: "NOT_FOUND",
    },
  });

/**
 * Groq answer to a retired or unknown model (`llama-3.1-8b-instant`):
 * HTTP 404 with `code: "model_not_found"`, `type: "invalid_request_error"`.
 */
export const GROQ_MODEL_NOT_FOUND_STATUS = 404;
export const groqModelNotFoundBody = (model: string): string =>
  JSON.stringify({
    error: {
      message: `The model \`${model}\` does not exist or you do not have access to it.`,
      type: "invalid_request_error",
      code: "model_not_found",
    },
  });
