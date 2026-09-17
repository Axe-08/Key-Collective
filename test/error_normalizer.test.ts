/**
 * Key Collective v4.0 — Error Normalizer & Body Sanitizer Tests (task-2-error-sanitizer)
 *
 * Invariants Tested:
 * 1. Strict TypeScript: Zero any.
 * 2. createErrorSanitizerTransform: returns a TransformStream that sanitizes error body chunks.
 * 3. normalizeUpstreamResponse:
 *    - Pipes body through createErrorSanitizerTransform when upstream.status >= 400.
 *    - Leaves body intact when upstream.status < 400.
 *    - Handles null body gracefully.
 *    - Deletes content-length when upstream.status >= 400 to prevent mismatch.
 *    - Retains allowed response headers and sets x-kc-* metadata.
 */

import { describe, expect, it } from "vitest";
import {
  createErrorSanitizerTransform,
  normalizeUpstreamResponse,
  sanitizeErrorBody,
  sanitizeResponseHeaders,
  ALLOWED_RESPONSE_HEADERS,
} from "../src/worker/error_normalizer";

describe("Error Normalizer: createErrorSanitizerTransform", () => {
  it("creates a TransformStream instance", () => {
    const transform = createErrorSanitizerTransform();
    expect(transform).toBeInstanceOf(TransformStream);
    expect(transform.readable).toBeDefined();
    expect(transform.writable).toBeDefined();
  });

  it("sanitizes GCP project numbers in streamed chunks", async () => {
    const transform = createErrorSanitizerTransform();
    const input = JSON.stringify({
      error: "Permission denied for projects/123456789012/models/gemini-pro",
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(input));
        controller.close();
      },
    });

    const transformedStream = stream.pipeThrough(transform);
    const response = new Response(transformedStream);
    const text = await response.text();

    expect(text).toContain("[PROJECT_REDACTED]");
    expect(text).not.toContain("projects/123456789012");
  });

  it("sanitizes billing accounts and cloud trace IDs", async () => {
    const transform = createErrorSanitizerTransform();
    const raw = "Error at billingAccounts/012345-ABCDEF-678901 with trace 4bf92f3577b34da6a3ce929d0e0e4736/12345";

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(raw));
        controller.close();
      },
    });

    const transformed = stream.pipeThrough(transform);
    const result = await new Response(transformed).text();

    expect(result).toBe("Error at [BILLING_REDACTED] with trace [TRACE_REDACTED]");
  });

  it("handles chunked streaming across multiple chunks", async () => {
    const transform = createErrorSanitizerTransform();
    const chunk1 = "Failed to access ";
    const chunk2 = "projects/987654321098/secrets/key";

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(chunk1));
        controller.enqueue(new TextEncoder().encode(chunk2));
        controller.close();
      },
    });

    const transformed = stream.pipeThrough(transform);
    const result = await new Response(transformed).text();

    expect(result).toBe("Failed to access [PROJECT_REDACTED]/secrets/key");
  });
});

describe("Error Normalizer: normalizeUpstreamResponse", () => {
  it("sanitizes body and deletes content-length when status >= 400", async () => {
    const rawError = JSON.stringify({
      code: 403,
      message: "Caller does not have access to projects/112233445566 or billingAccounts/ABC-123-XYZ",
    });

    const headers = new Headers({
      "content-type": "application/json",
      "content-length": String(rawError.length),
      "x-goog-request-id": "goog-secret-req-123",
      "x-ratelimit-limit-requests": "100",
    });

    const upstream = new Response(rawError, {
      status: 403,
      headers,
    });

    const normalized = normalizeUpstreamResponse(
      upstream,
      "kc-req-999",
      "gemini-2.0-flash",
      "google"
    );

    expect(normalized.status).toBe(403);
    // x-goog-* stripped by allow-list
    expect(normalized.headers.get("x-goog-request-id")).toBeNull();
    // Allowed headers retained
    expect(normalized.headers.get("content-type")).toBe("application/json");
    expect(normalized.headers.get("x-ratelimit-limit-requests")).toBe("100");
    // x-kc-* metadata added
    expect(normalized.headers.get("x-kc-request-id")).toBe("kc-req-999");
    expect(normalized.headers.get("x-kc-model-used")).toBe("gemini-2.0-flash");
    expect(normalized.headers.get("x-kc-provider")).toBe("google");

    // content-length deleted to prevent mismatch after sanitization
    expect(normalized.headers.get("content-length")).toBeNull();

    // Body content sanitized
    const bodyText = await normalized.text();
    expect(bodyText).toContain("[PROJECT_REDACTED]");
    expect(bodyText).toContain("[BILLING_REDACTED]");
    expect(bodyText).not.toContain("projects/112233445566");
    expect(bodyText).not.toContain("billingAccounts/ABC-123-XYZ");
  });

  it("does not transform or delete content-length when status < 400", async () => {
    const okBody = JSON.stringify({
      id: "chatcmpl-123",
      content: "Hello from projects/12345678 (legitimate output)",
    });

    const headers = new Headers({
      "content-type": "application/json",
      "content-length": String(okBody.length),
    });

    const upstream = new Response(okBody, {
      status: 200,
      headers,
    });

    const normalized = normalizeUpstreamResponse(upstream, "kc-req-100");

    expect(normalized.status).toBe(200);
    expect(normalized.headers.get("content-length")).toBe(String(okBody.length));
    expect(normalized.headers.get("x-kc-request-id")).toBe("kc-req-100");

    const text = await normalized.text();
    // Body is untouched for 200 OK
    expect(text).toBe(okBody);
  });

  it("handles null body gracefully for >= 400 responses", async () => {
    const upstream = new Response(null, {
      status: 404,
      headers: { "x-request-id": "req-404" },
    });

    const normalized = normalizeUpstreamResponse(upstream, "kc-req-404");
    expect(normalized.status).toBe(404);
    expect(normalized.body).toBeNull();
    expect(normalized.headers.get("x-kc-request-id")).toBe("kc-req-404");
  });

  it("sanitizes 500 internal server error responses with cloud trace", async () => {
    const errorBody = "Internal error 500 at 0123456789abcdef0123456789abcdef/42";
    const upstream = new Response(errorBody, {
      status: 500,
      headers: { "content-type": "text/plain" },
    });

    const normalized = normalizeUpstreamResponse(upstream, "kc-req-500");
    const text = await normalized.text();

    expect(normalized.status).toBe(500);
    expect(text).toBe("Internal error 500 at [TRACE_REDACTED]");
  });
});
