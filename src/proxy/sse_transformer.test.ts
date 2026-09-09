/**
 * Key Collective v2 — Cloudflare-Native LLM Router
 * Unit Tests: SSEStreamTransformer (proxy-sse-transformer)
 *
 * Conforms to:
 * - LLD 3.1 & 4.0: Unit tests for Web TransformStream SSE chunk parsing,
 *   partial chunk handling, and multi-provider usage block extraction.
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * - TypeScript (strict mode, no `any`).
 * - Zero floating-point math: token counts are verified as integers.
 * - Non-blocking hot path: raw chunks flow through immediately without corruption.
 */

import { describe, it, expect, vi } from "vitest";
import {
  SSEStreamTransformer,
  extractUsageFromPayload,
  StreamUsage,
  SSEEvent,
  StreamMetadata,
} from "./sse_transformer";

describe("SSEStreamTransformer", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  /**
   * Helper to pipe chunks through SSEStreamTransformer and collect output text.
   */
  async function streamThrough(
    transformer: SSEStreamTransformer<Uint8Array | string>,
    chunks: (Uint8Array | string)[]
  ): Promise<string> {
    const readable = new ReadableStream<Uint8Array | string>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    const transformed = readable.pipeThrough(transformer);
    const reader = transformed.getReader();
    let result = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (typeof value === "string") {
        result += value;
      } else {
        result += decoder.decode(value, { stream: true });
      }
    }
    result += decoder.decode();
    return result;
  }

  describe("Unit: extractUsageFromPayload helper", () => {
    it("returns null for non-object or null payloads", () => {
      expect(extractUsageFromPayload(null)).toBeNull();
      expect(extractUsageFromPayload(undefined)).toBeNull();
      expect(extractUsageFromPayload("string")).toBeNull();
      expect(extractUsageFromPayload(123)).toBeNull();
      expect(extractUsageFromPayload([])).toBeNull();
      expect(extractUsageFromPayload({})).toBeNull();
    });

    it("extracts OpenAI standard usage block", () => {
      const payload = {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        usage: {
          prompt_tokens: 15,
          completion_tokens: 35,
          total_tokens: 50,
          prompt_tokens_details: {
            cached_tokens: 5,
          },
          completion_tokens_details: {
            reasoning_tokens: 10,
          },
        },
      };

      const usage = extractUsageFromPayload(payload);
      expect(usage).toEqual({
        promptTokens: 15,
        completionTokens: 35,
        totalTokens: 50,
        cachedTokens: 5,
        reasoningTokens: 10,
      });
    });

    it("extracts Groq x_groq usage extension", () => {
      const payload = {
        id: "groq-1",
        x_groq: {
          usage: {
            prompt_tokens: 22,
            completion_tokens: 44,
            total_tokens: 66,
          },
        },
      };

      const usage = extractUsageFromPayload(payload);
      expect(usage).toEqual({
        promptTokens: 22,
        completionTokens: 44,
        totalTokens: 66,
      });
    });

    it("extracts Google Gemini usageMetadata format (camelCase)", () => {
      const payload = {
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 250,
          totalTokenCount: 350,
          cachedContentTokenCount: 20,
        },
      };

      const usage = extractUsageFromPayload(payload);
      expect(usage).toEqual({
        promptTokens: 100,
        completionTokens: 250,
        totalTokens: 350,
        cachedTokens: 20,
      });
    });

    it("extracts Google Gemini usageMetadata format (snake_case)", () => {
      const payload = {
        usageMetadata: {
          prompt_token_count: 80,
          candidates_token_count: 120,
          total_token_count: 200,
          cached_content_token_count: 15,
        },
      };

      const usage = extractUsageFromPayload(payload);
      expect(usage).toEqual({
        promptTokens: 80,
        completionTokens: 120,
        totalTokens: 200,
        cachedTokens: 15,
      });
    });

    it("extracts Anthropic message_start usage block", () => {
      const payload = {
        type: "message_start",
        message: {
          id: "msg-123",
          role: "assistant",
          usage: {
            input_tokens: 45,
            output_tokens: 1,
            cache_read_input_tokens: 12,
          },
        },
      };

      const usage = extractUsageFromPayload(payload);
      expect(usage).toEqual({
        promptTokens: 45,
        completionTokens: 1,
        cachedTokens: 12,
      });
    });

    it("extracts Anthropic message_delta usage block", () => {
      const payload = {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: {
          output_tokens: 78,
        },
      };

      const usage = extractUsageFromPayload(payload);
      expect(usage).toEqual({
        completionTokens: 78,
      });
    });

    it("extracts Cohere meta.tokens format", () => {
      const payload = {
        meta: {
          tokens: {
            input_tokens: 30,
            output_tokens: 60,
          },
        },
      };

      const usage = extractUsageFromPayload(payload);
      expect(usage).toEqual({
        promptTokens: 30,
        completionTokens: 60,
      });
    });

    it("extracts Cohere meta.billed_units format", () => {
      const payload = {
        meta: {
          billed_units: {
            input_tokens: 12,
            output_tokens: 24,
          },
        },
      };

      const usage = extractUsageFromPayload(payload);
      expect(usage).toEqual({
        promptTokens: 12,
        completionTokens: 24,
      });
    });

    it("extracts Amazon Bedrock invocation metrics", () => {
      const payload = {
        "amazon-bedrock-invocationMetrics": {
          inputTokenCount: 55,
          outputTokenCount: 110,
        },
      };

      const usage = extractUsageFromPayload(payload);
      expect(usage).toEqual({
        promptTokens: 55,
        completionTokens: 110,
      });
    });

    it("extracts direct root tokens", () => {
      const payload = {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      };

      const usage = extractUsageFromPayload(payload);
      expect(usage).toEqual({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      });
    });
  });

  describe("Chunk Parsing & Standard SSE Events", () => {
    it("parses single complete SSE chunk and yields unmodified raw chunks in passthrough", async () => {
      const events: SSEEvent[] = [];
      const transformer = new SSEStreamTransformer({
        onEvent: (e) => events.push(e),
      });

      const chunk = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n';
      const output = await streamThrough(transformer, [chunk]);

      expect(output).toBe(chunk);
      expect(events).toHaveLength(1);
      expect(events[0]?.data).toBe('{"choices":[{"delta":{"content":"Hello"}}]}');
      expect(transformer.events).toHaveLength(1);
    });

    it("parses multiple SSE events in a single stream", async () => {
      const events: SSEEvent[] = [];
      const transformer = new SSEStreamTransformer({
        onEvent: (e) => events.push(e),
      });

      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        "data: [DONE]\n\n",
      ];

      await streamThrough(transformer, chunks);

      expect(events).toHaveLength(3);
      expect(events[0]?.data).toBe('{"choices":[{"delta":{"content":"Hello"}}]}');
      expect(events[1]?.data).toBe('{"choices":[{"delta":{"content":" world"}}]}');
      expect(events[2]?.data).toBe("[DONE]");
      expect(transformer.metadata.eventCount).toBe(3);
      expect(transformer.metadata.chunkCount).toBe(3);
    });

    it("parses named events with id and retry fields", async () => {
      const events: SSEEvent[] = [];
      const transformer = new SSEStreamTransformer({
        onEvent: (e) => events.push(e),
      });

      const payload =
        "event: message_start\n" +
        "id: evt_001\n" +
        "retry: 5000\n" +
        'data: {"type":"message_start"}\n\n';

      await streamThrough(transformer, [payload]);

      expect(events).toHaveLength(1);
      expect(events[0]?.event).toBe("message_start");
      expect(events[0]?.id).toBe("evt_001");
      expect(events[0]?.retry).toBe(5000);
      expect(events[0]?.data).toBe('{"type":"message_start"}');
    });

    it("handles SSE comments without treating them as data", async () => {
      const events: SSEEvent[] = [];
      const transformer = new SSEStreamTransformer({
        onEvent: (e) => events.push(e),
      });

      const payload =
        ": ping - keepalive comment\n" +
        'data: {"content":"test"}\n\n' +
        ": another comment\n";

      await streamThrough(transformer, [payload]);

      expect(events).toHaveLength(1);
      expect(events[0]?.data).toBe('{"content":"test"}');
    });

    it("handles multiline data fields concatenated with newlines", async () => {
      const events: SSEEvent[] = [];
      const transformer = new SSEStreamTransformer({
        onEvent: (e) => events.push(e),
      });

      const payload =
        "data: line 1\n" +
        "data: line 2\n" +
        "data: line 3\n\n";

      await streamThrough(transformer, [payload]);

      expect(events).toHaveLength(1);
      expect(events[0]?.data).toBe("line 1\nline 2\nline 3");
    });

    it("handles CRLF (\\r\\n\\r\\n) delimiters", async () => {
      const events: SSEEvent[] = [];
      const transformer = new SSEStreamTransformer({
        onEvent: (e) => events.push(e),
      });

      const payload =
        'data: {"text":"crlf test"}\r\n\r\n' +
        'data: {"text":"second"}\r\n\r\n';

      await streamThrough(transformer, [payload]);

      expect(events).toHaveLength(2);
      expect(events[0]?.data).toBe('{"text":"crlf test"}');
      expect(events[1]?.data).toBe('{"text":"second"}');
    });

    it("handles binary Uint8Array chunks", async () => {
      const transformer = new SSEStreamTransformer();
      const rawString = 'data: {"chunk":"binary"}\n\n';
      const chunk = encoder.encode(rawString);

      const output = await streamThrough(transformer, [chunk]);

      expect(output).toBe(rawString);
      expect(transformer.events).toHaveLength(1);
      expect(transformer.events[0]?.data).toBe('{"chunk":"binary"}');
    });
  });

  describe("Partial Chunk Handling (Fragmentation & Boundaries)", () => {
    it("handles an event split across multiple chunk boundaries", async () => {
      const events: SSEEvent[] = [];
      const transformer = new SSEStreamTransformer({
        onEvent: (e) => events.push(e),
      });

      // Split right inside the JSON payload and delimiter
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hel',
        'lo, "}}]}\n',
        '\ndata: {"choices":[{"delta":{"content":"world!"}}]}\n\n',
      ];

      await streamThrough(transformer, chunks);

      expect(events).toHaveLength(2);
      expect(events[0]?.data).toBe('{"choices":[{"delta":{"content":"Hello, "}}]}');
      expect(events[1]?.data).toBe('{"choices":[{"delta":{"content":"world!"}}]}');
    });

    it("handles a chunk split right at the CRLF boundary (\\r in chunk 1, \\n in chunk 2)", async () => {
      const events: SSEEvent[] = [];
      const transformer = new SSEStreamTransformer({
        onEvent: (e) => events.push(e),
      });

      const chunks = [
        'data: {"msg":"test"}\r\n\r',
        '\ndata: [DONE]\r\n\r\n',
      ];

      await streamThrough(transformer, chunks);

      expect(events).toHaveLength(2);
      expect(events[0]?.data).toBe('{"msg":"test"}');
      expect(events[1]?.data).toBe("[DONE]");
    });

    it("handles byte-by-byte fragmented streaming without dropping data or failing", async () => {
      const events: SSEEvent[] = [];
      const transformer = new SSEStreamTransformer({
        onEvent: (e) => events.push(e),
      });

      const fullStream =
        'data: {"choices":[{"delta":{"content":"Byte by byte"}}]}\n\n' +
        'data: {"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}\n\n';

      // Feed one byte at a time as Uint8Array
      const rawBytes = encoder.encode(fullStream);
      const singleByteChunks: Uint8Array[] = [];
      for (let i = 0; i < rawBytes.length; i++) {
        singleByteChunks.push(rawBytes.subarray(i, i + 1));
      }

      const output = await streamThrough(transformer, singleByteChunks);

      expect(output).toBe(fullStream);
      expect(events).toHaveLength(2);
      expect(transformer.usage).toEqual({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        raw: {
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        },
      });
    });

    it("handles multi-byte UTF-8 character split across chunk boundaries", async () => {
      const events: SSEEvent[] = [];
      const transformer = new SSEStreamTransformer({
        onEvent: (e) => events.push(e),
      });

      // Rocket emoji 🚀 is 4 bytes: [240, 159, 154, 128]
      const fullText = 'data: {"emoji":"🚀"}\n\n';
      const encoded = encoder.encode(fullText);

      // Split right in the middle of the 4-byte emoji
      const splitPoint = 17; // Within the emoji bytes
      const chunk1 = encoded.subarray(0, splitPoint);
      const chunk2 = encoded.subarray(splitPoint);

      await streamThrough(transformer, [chunk1, chunk2]);

      expect(events).toHaveLength(1);
      expect(events[0]?.data).toBe('{"emoji":"🚀"}');
    });

    it("dispatches pending un-delimited event upon stream flush", async () => {
      const events: SSEEvent[] = [];
      const transformer = new SSEStreamTransformer({
        onEvent: (e) => events.push(e),
      });

      // Stream ends without trailing newline
      const chunk = 'data: {"final":"flush_test"}';

      await streamThrough(transformer, [chunk]);

      expect(events).toHaveLength(1);
      expect(events[0]?.data).toBe('{"final":"flush_test"}');
    });
  });

  describe("Usage Block Extraction Across Major Providers", () => {
    it("extracts terminal OpenAI usage chunk (tc-02 conformance)", async () => {
      let capturedUsage: StreamUsage | undefined;
      const onUsage = vi.fn((u: StreamUsage) => {
        capturedUsage = u;
      });

      const transformer = new SSEStreamTransformer({ onUsage });

      const stream = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":25,"total_tokens":37}}\n\n',
        "data: [DONE]\n\n",
      ];

      await streamThrough(transformer, stream);

      const usage = await transformer.getUsage();
      expect(usage).not.toBeNull();
      expect(usage?.promptTokens).toBe(12);
      expect(usage?.completionTokens).toBe(25);
      expect(usage?.totalTokens).toBe(37);

      // Verify snake_case compatibility for golden test assertions
      expect(usage?.prompt_tokens).toBe(12);
      expect(usage?.completion_tokens).toBe(25);
      expect(usage?.total_tokens).toBe(37);

      expect(onUsage).toHaveBeenCalledTimes(1);
      expect(capturedUsage).toEqual(usage);
    });

    it("extracts OpenAI cached tokens and reasoning tokens details", async () => {
      const transformer = new SSEStreamTransformer();

      const stream = [
        'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150,"prompt_tokens_details":{"cached_tokens":30},"completion_tokens_details":{"reasoning_tokens":20}}}\n\n',
      ];

      await streamThrough(transformer, stream);

      const usage = await transformer.getUsage();
      expect(usage?.promptTokens).toBe(100);
      expect(usage?.completionTokens).toBe(50);
      expect(usage?.cachedTokens).toBe(30);
      expect(usage?.reasoningTokens).toBe(20);
      expect(usage?.cached_tokens).toBe(30);
      expect(usage?.reasoning_tokens).toBe(20);
    });

    it("extracts Google Gemini usageMetadata embedded in SSE", async () => {
      const transformer = new SSEStreamTransformer();

      const stream = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}],"usageMetadata":{"promptTokenCount":50,"candidatesTokenCount":120,"totalTokenCount":170,"cachedContentTokenCount":10},"modelVersion":"gemini-2.0-flash"}\n\n',
      ];

      await streamThrough(transformer, stream);

      const usage = await transformer.getUsage();
      expect(usage).toEqual({
        promptTokens: 50,
        completionTokens: 120,
        totalTokens: 170,
        cachedTokens: 10,
        prompt_tokens: 50,
        completion_tokens: 120,
        total_tokens: 170,
        cached_tokens: 10,
        raw: {
          candidates: [{ content: { parts: [{ text: "Hello" }] } }],
          usageMetadata: {
            promptTokenCount: 50,
            candidatesTokenCount: 120,
            totalTokenCount: 170,
            cachedContentTokenCount: 10,
          },
          modelVersion: "gemini-2.0-flash",
        },
      });
    });

    it("accumulates Anthropic multi-event usage (message_start + message_delta)", async () => {
      const transformer = new SSEStreamTransformer();

      const stream = [
        "event: message_start\n" +
          'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-3-5-sonnet","usage":{"input_tokens":42,"output_tokens":1,"cache_read_input_tokens":15}}}\n\n',
        "event: content_block_delta\n" +
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
        "event: message_delta\n" +
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":85}}\n\n',
      ];

      await streamThrough(transformer, stream);

      const usage = await transformer.getUsage();
      expect(usage?.promptTokens).toBe(42);
      expect(usage?.completionTokens).toBe(85);
      expect(usage?.totalTokens).toBe(127);
      expect(usage?.cachedTokens).toBe(15);
    });

    it("extracts Cohere stream meta tokens", async () => {
      const transformer = new SSEStreamTransformer();

      const stream = [
        'data: {"text":"Hello"}\n\n',
        'data: {"is_finished":true,"meta":{"tokens":{"input_tokens":18,"output_tokens":36}}}\n\n',
      ];

      await streamThrough(transformer, stream);

      const usage = await transformer.getUsage();
      expect(usage?.promptTokens).toBe(18);
      expect(usage?.completionTokens).toBe(36);
      expect(usage?.totalTokens).toBe(54);
    });

    it("extracts Amazon Bedrock invocation metrics", async () => {
      const transformer = new SSEStreamTransformer();

      const stream = [
        'data: {"amazon-bedrock-invocationMetrics":{"inputTokenCount":25,"outputTokenCount":75}}\n\n',
      ];

      await streamThrough(transformer, stream);

      const usage = await transformer.getUsage();
      expect(usage?.promptTokens).toBe(25);
      expect(usage?.completionTokens).toBe(75);
      expect(usage?.totalTokens).toBe(100);
    });

    it("returns null when stream contains no usage blocks", async () => {
      const transformer = new SSEStreamTransformer();

      const stream = [
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        "data: [DONE]\n\n",
      ];

      await streamThrough(transformer, stream);

      const usage = await transformer.getUsage();
      expect(usage).toBeNull();
      expect(transformer.usage).toBeNull();
    });
  });

  describe("Metadata & Telemetry Interception", () => {
    it("intercepts model ID, system fingerprint, and finish reason", async () => {
      const onMetadata = vi.fn();
      const transformer = new SSEStreamTransformer({ onMetadata });

      const stream = [
        'data: {"id":"chatcmpl-1","model":"gemini-2.0-flash","system_fingerprint":"fp_abc123","choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":10}}\n\n',
      ];

      await streamThrough(transformer, stream);

      const meta = await transformer.getMetadata();
      expect(meta.model).toBe("gemini-2.0-flash");
      expect(meta.systemFingerprint).toBe("fp_abc123");
      expect(meta.finishReason).toBe("stop");
      expect(meta.chunkCount).toBe(2);
      expect(meta.eventCount).toBe(2);
      expect(meta.timeToFirstTokenMs).toBeGreaterThanOrEqual(0);
      expect(meta.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(onMetadata).toHaveBeenCalledWith(meta);
    });

    it("tracks TTFT using custom startedAt timestamp", async () => {
      const pastStartedAt = Date.now() - 50;
      const transformer = new SSEStreamTransformer({ startedAt: pastStartedAt });

      await streamThrough(transformer, ['data: {"text":"fast"}\n\n']);

      expect(transformer.metadata.startedAt).toBe(pastStartedAt);
      expect(transformer.metadata.timeToFirstTokenMs).toBeGreaterThanOrEqual(50);
    });
  });

  describe("Lifecycle & Asynchronous Consumption", () => {
    it("resolves getUsage() after stream flush", async () => {
      const transformer = new SSEStreamTransformer();

      const writeStream = async () => {
        const writer = transformer.writable.getWriter();
        await writer.write('data: {"choices":[{"delta":{"content":"Async"}}]}\n\n');
        await writer.write('data: {"usage":{"prompt_tokens":30,"completion_tokens":60}}\n\n');
        await writer.close();
      };

      const readStream = async () => {
        const reader = transformer.readable.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      };

      await Promise.all([writeStream(), readStream()]);

      const usage = await transformer.getUsage();
      expect(usage?.promptTokens).toBe(30);
      expect(usage?.completionTokens).toBe(60);
      expect(usage?.totalTokens).toBe(90);
    });

    it("fires onDone callback when stream cleanly closes", async () => {
      const onDone = vi.fn();
      const transformer = new SSEStreamTransformer({ onDone });

      await streamThrough(transformer, ['data: {"status":"ok"}\n\n']);

      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("handles getUsage(timeoutMs) timeout rejection if stream hangs", async () => {
      const transformer = new SSEStreamTransformer();

      await expect(transformer.getUsage(10)).rejects.toThrow(
        "Timed out waiting for stream usage after 10ms"
      );
    });

    it("handles getMetadata(timeoutMs) timeout rejection if stream hangs", async () => {
      const transformer = new SSEStreamTransformer();

      await expect(transformer.getMetadata(10)).rejects.toThrow(
        "Timed out waiting for stream metadata after 10ms"
      );
    });
  });

  describe("Operating Modes & Memory Flags", () => {
    it("respects bufferEvents: false to save memory on long-running streams", async () => {
      const transformer = new SSEStreamTransformer({ bufferEvents: false });

      await streamThrough(transformer, [
        'data: {"event":1}\n\n',
        'data: {"event":2}\n\n',
      ]);

      expect(transformer.events).toHaveLength(0);
      expect(transformer.metadata.eventCount).toBe(2);
    });

    it("supports mode: 'events' yielding normalized SSE format", async () => {
      const transformer = new SSEStreamTransformer({ mode: "events" });

      const fragmentedInput = [
        "data: first chunk\n",
        "data: second chunk\n\n",
      ];

      const output = await streamThrough(transformer, fragmentedInput);

      expect(output).toBe("data: first chunk\ndata: second chunk\n\n");
    });
  });

  describe("Resilience & Error Handling", () => {
    it("does not throw or drop chunks when event data contains non-JSON text", async () => {
      const events: SSEEvent[] = [];
      const transformer = new SSEStreamTransformer({
        onEvent: (e) => events.push(e),
      });

      const chunks = [
        "data: Not a valid JSON payload at all\n\n",
        'data: {"valid":"json"}\n\n',
      ];

      const output = await streamThrough(transformer, chunks);

      expect(output).toBe(chunks.join(""));
      expect(events).toHaveLength(2);
      expect(events[0]?.data).toBe("Not a valid JSON payload at all");
      expect(events[1]?.data).toBe('{"valid":"json"}');
      expect(transformer.usage).toBeNull();
    });

    it("handles empty stream without crashing", async () => {
      const transformer = new SSEStreamTransformer();

      const output = await streamThrough(transformer, []);

      expect(output).toBe("");
      expect(transformer.metadata.chunkCount).toBe(0);
      expect(transformer.metadata.eventCount).toBe(0);
      expect(await transformer.getUsage()).toBeNull();
    });
  });
});
