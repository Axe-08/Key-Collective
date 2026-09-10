/**
 * scripts/profile_stress_test.mjs
 *
 * Comprehensive Profiling & Stress Testing Suite for Key Collective v2.1
 * Tests extremes: lightweight queries, multi-step logical reasoning, Knight/Knave puzzles,
 * deep reasoning / cryptographic proofs, streaming token latency, and adaptive timeout convergence.
 */

const BASE_URL = process.env.KC_BASE_URL || 'http://127.0.0.1:8787/v1/chat/completions';
const AUTH_TOKEN = process.env.KC_AUTH_TOKEN || 'kc_test_token_local_dev_12345';

const TEST_SCENARIOS = [
  {
    id: 'lightweight-gemini',
    name: 'Gemini 2.5 Flash: Minimal Latency / Terse Output',
    model: 'gemini-2.5-flash',
    messages: [
      { role: 'system', content: 'You are a precise, terse fact responder. Answer in under 10 words.' },
      { role: 'user', content: 'What is the speed of light in vacuum in meters per second?' }
    ],
    stream: false,
    expectedTokensRange: [5, 35],
    description: 'Validates cold/warm response latency on ultra-fast lightweight queries.'
  },
  {
    id: 'lightweight-groq',
    name: 'Groq Qwen 3.6 27B: Terse Output',
    model: 'qwen/qwen3.6-27b',
    messages: [
      { role: 'system', content: 'You are an ultra-fast knowledge retriever. Answer in one short sentence.' },
      { role: 'user', content: 'What is the primary chemical component of quartz?' }
    ],
    stream: false,
    expectedTokensRange: [5, 35],
    description: 'Tests Groq LPUs for rapid turnaround times.'
  },
  {
    id: 'streaming-gemini-3.8',
    name: 'Gemini 3.8 Flash: Streaming Multi-Step Logic',
    model: 'gemini-3.8-flash',
    messages: [
      {
        role: 'user',
        content: 'Solve this riddle step-by-step: A farmer has 17 sheep, and all but 9 die. How many are left? Then, if he sells 3 of the remaining, how many does he have? Show your thinking clearly.'
      }
    ],
    stream: true,
    expectedTokensRange: [50, 400],
    description: 'Tests streaming chunk extraction, time-to-first-token (TTFT), and thoughts/reasoning token usage parsing.'
  },
  {
    id: 'streaming-groq-gpt-oss',
    name: 'Groq GPT-OSS 120B: Streaming Code Generation',
    model: 'openai/gpt-oss-120b',
    messages: [
      {
        role: 'system',
        content: 'Write a TypeScript function that implements constant-time string comparison (timingSafeEqual) without external dependencies.'
      },
      { role: 'user', content: 'Show code and a 2-bullet explanation.' }
    ],
    stream: true,
    expectedTokensRange: [80, 500],
    description: 'Tests streaming high-parameter open-weights models on Groq.'
  },
  {
    id: 'heavy-logic-knights-knaves',
    name: 'Gemini 3.8 Flash: Heavy Logic (Knights and Knaves Island)',
    model: 'gemini-3.8-flash',
    messages: [
      {
        role: 'user',
        content: `You are on an island where inhabitants are either Knights (who always tell the truth) or Knaves (who always lie).
You encounter three inhabitants: Alice, Bob, and Charlie.
- Alice says: "Bob is a knave."
- Bob says: "Alice and Charlie are of the same type."
- Charlie says: "Exactly one of us is a knight."

Determine with formal deductive logic the exact identity (Knight or Knave) of Alice, Bob, and Charlie. Provide a sound, rigorous step-by-step proof with case elimination.`
      }
    ],
    stream: false,
    expectedTokensRange: [200, 1500],
    description: 'Demanding deductive elimination problem that exercises deep chain-of-thought and reasoning tokens.'
  },
  {
    id: 'cryptographic-extreme-reasoning',
    name: 'Gemini 3.8 Flash: Cryptographic Proof & Differential Attack Analysis',
    model: 'gemini-3.8-flash',
    messages: [
      {
        role: 'user',
        content: `Explain in mathematical detail why AES-GCM (Galois/Counter Mode) fails catastrophically if an initialization vector (nonce) is reused twice under the same key.
Derive the step where an attacker can authenticate arbitrary forged ciphertexts once the authentication subkey H is recovered via polynomial root finding over GF(2^128). Include the polynomial equations and why GHASH linearity causes this.`
      }
    ],
    stream: false,
    expectedTokensRange: [300, 2000],
    description: 'Extreme deep reasoning testing the generous 5-minute timeout ceiling and token budget bounds.'
  },
  {
    id: 'adaptive-ewma-convergence',
    name: 'Gemini 2.5 Flash: Adaptive EWMA Convergence Iteration 2',
    model: 'gemini-2.5-flash',
    messages: [
      { role: 'user', content: 'State the second law of thermodynamics in one sentence.' }
    ],
    stream: false,
    expectedTokensRange: [10, 60],
    description: 'Second run on the same model to observe EWMA moving average updating and latency settling.'
  }
];

async function parseSseStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let usage = null;
  let chunkCount = 0;
  let firstTokenTime = null;
  const startTime = Date.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed.startsWith('data: ')) {
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(dataStr);
          chunkCount++;
          if (!firstTokenTime) {
            firstTokenTime = Date.now() - startTime;
          }
          if (parsed.choices?.[0]?.delta?.content) {
            fullContent += parsed.choices[0].delta.content;
          }
          if (parsed.usage) {
            usage = parsed.usage;
          }
        } catch {
          // partial JSON line or non-JSON chunk
        }
      }
    }
  }

  return { fullContent, usage, chunkCount, firstTokenTime };
}

async function runScenario(scenario, index, total) {
  console.log(`\n================================================================================`);
  console.log(`[${index + 1}/${total}] 🧪 Running Scenario: ${scenario.name}`);
  console.log(`Model: ${scenario.model} | Stream: ${scenario.stream}`);
  console.log(`Description: ${scenario.description}`);
  console.log(`--------------------------------------------------------------------------------`);

  const startTime = Date.now();
  let status = 0;
  let responseData = null;
  let ttft = null;
  let tokensUsage = null;
  let textOutput = '';

  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`
      },
      body: JSON.stringify({
        model: scenario.model,
        messages: scenario.messages,
        stream: scenario.stream
      })
    });

    status = res.status;

    if (!res.ok) {
      const errText = await res.text();
      console.error(`❌ Request failed with HTTP ${status}:`, errText);
      return {
        id: scenario.id,
        name: scenario.name,
        model: scenario.model,
        success: false,
        status,
        error: errText,
        durationMs: Date.now() - startTime
      };
    }

    if (scenario.stream) {
      const sseResult = await parseSseStream(res);
      ttft = sseResult.firstTokenTime;
      textOutput = sseResult.fullContent;
      tokensUsage = sseResult.usage;
    } else {
      responseData = await res.json();
      textOutput = responseData.choices?.[0]?.message?.content || '';
      tokensUsage = responseData.usage;
    }

    const durationMs = Date.now() - startTime;
    const promptTokens = tokensUsage?.prompt_tokens ?? 'N/A';
    const completionTokens = tokensUsage?.completion_tokens ?? 'N/A';
    const totalTokens = tokensUsage?.total_tokens ?? 'N/A';
    const reasoningTokens = tokensUsage?.reasoning_tokens ?? tokensUsage?.thoughts_token_count ?? 'N/A';
    const tokensPerSec = typeof completionTokens === 'number' && durationMs > 0
      ? ((completionTokens / durationMs) * 1000).toFixed(1)
      : 'N/A';

    console.log(`✅ Success (HTTP ${status}) in ${durationMs}ms`);
    if (ttft !== null) console.log(`⏱️  Time to First Token (TTFT): ${ttft}ms`);
    console.log(`📊 Token Accounting:`);
    console.log(`   - Prompt Tokens:     ${promptTokens}`);
    console.log(`   - Completion Tokens: ${completionTokens}`);
    console.log(`   - Reasoning Tokens:  ${reasoningTokens}`);
    console.log(`   - Total Tokens:      ${totalTokens}`);
    console.log(`   - Throughput:        ${tokensPerSec} tokens/sec`);
    console.log(`💬 Snippet of Generated Response:`);
    const preview = textOutput.trim().slice(0, 250).replace(/\n/g, ' ');
    console.log(`   "${preview}${textOutput.length > 250 ? '...' : ''}"`);

    return {
      id: scenario.id,
      name: scenario.name,
      model: scenario.model,
      success: true,
      status,
      durationMs,
      ttft,
      promptTokens,
      completionTokens,
      reasoningTokens,
      totalTokens,
      tokensPerSec,
      responseLength: textOutput.length
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error(`💥 Unhandled error in scenario ${scenario.id}:`, err);
    return {
      id: scenario.id,
      name: scenario.name,
      model: scenario.model,
      success: false,
      status,
      error: err.message,
      durationMs
    };
  }
}

async function main() {
  console.log(`🚀 Key Collective Stress & Profiling Engine v2.1`);
  console.log(`🎯 Target Gateway: ${BASE_URL}`);
  console.log(`🔑 Testing against 22 pooled free-tier keys (Google & Groq)`);
  console.log(`⏱️  Adaptive Timeout Ceiling: 300,000ms (5 min initial reasoning buffer)`);

  console.log(`⚡ Executing ${TEST_SCENARIOS.length} scenarios concurrently in parallel across the key pool...\n`);

  const results = await Promise.all(
    TEST_SCENARIOS.map((scenario, i) => runScenario(scenario, i, TEST_SCENARIOS.length))
  );

  console.log(`\n================================================================================`);
  console.log(`📋 BENCHMARK SUMMARY & PROFILING SCORECARD`);
  console.log(`================================================================================`);
  console.table(
    results.map(r => ({
      Scenario: r.name.slice(0, 35),
      Model: r.model,
      Status: r.success ? `PASS (${r.status})` : `FAIL (${r.status})`,
      'Latency (ms)': r.durationMs,
      'TTFT (ms)': r.ttft ?? '-',
      'Reasoning Tokens': r.reasoningTokens ?? '-',
      'Tokens/s': r.tokensPerSec ?? '-'
    }))
  );

  const allPassed = results.every(r => r.success);
  if (allPassed) {
    console.log(`\n🎉 ALL ${results.length} STRESS TEST SCENARIOS PASSED WITH ZERO FAILURES!`);
  } else {
    console.log(`\n⚠️ Some scenarios encountered errors. Review scorecard above.`);
    process.exitCode = 1;
  }
}

main().catch(e => {
  console.error('Fatal crash running stress test:', e);
  process.exit(1);
});
