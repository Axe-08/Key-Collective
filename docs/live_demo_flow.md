# Live Demo & Simulation Script

## Objective
Demonstrate the circuit breaker and automatic failover in real-time.

## Preparation
1. Start `key-collective` server locally.
2. Ensure 2 Gemini keys and 1 Groq key are loaded.
3. Open Dashboard side-by-side with Terminal.

## Execution Steps
1. **Normal Load:** Run a script `test_load.py` sending 5 requests/min.
   - *UI Expectation:* Keys pulse green. RPM increments slowly.
2. **Spike Load:** Run `python trigger_spike.py --concurrency 20`.
   - *UI Expectation:* Gemini Key 1 hits 15/15 RPM. Turns `🔴 Cooldown`.
   - *Terminal:* The Python script does NOT crash. It experiences a tiny ~50ms delay as Key Collective instantly fails over to Gemini Key 2.
3. **Provider Exhaustion:** Keep the spike running until Gemini Key 2 also hits 15/15.
   - *UI Expectation:* Both Gemini keys are red.
   - *Terminal:* Key Collective crosses the provider boundary and starts serving requests using the Groq key (assuming model translation is handled or agnostic).
4. **Recovery:** Wait 60 seconds.
   - *UI Expectation:* Gemini keys flip back to `🟢 Healthy`.
