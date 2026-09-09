# Budget & Economics Model (v2.0)

## Cloudflare Native Financial Budget (Monthly)
Based on 10,000,000 requests per month.

*   **Cloudflare Workers (Auth / Routing):**
    *   First 10M requests: Included in $5/mo Workers Paid plan.
    *   Cost: $5.00
*   **Cloudflare Durable Objects:**
    *   10M Requests: $0.15/M = $1.50
    *   Compute time: negligible.
    *   Cost: $1.50
*   **Cloudflare D1 (Database):**
    *   Reads (10M): $0.001/M = $0.01
    *   Writes (100k batched): < $0.01
    *   Storage: Included.
    *   Cost: $0.01
*   **Cloudflare Containers (Proxy):**
    *   Assuming 3 instances constantly running at 1/16 vCPU, 256MB RAM.
    *   Cost: estimated ~$5-10/mo depending on exact serverless container offering. Let's estimate $10.00.
*   **Total Cloudflare Setup:** ~$16.51 / month.

*(Contrast to Railway: Hobby plan is $5/mo but hard memory/CPU caps might throttle at 10M requests, requiring a Pro plan at $20+)*

## Latency Budget (Target: < 50ms P95)

| Component | P50 (ms) | P95 (ms) | Notes |
| :--- | :--- | :--- | :--- |
| CF Worker Auth | 2 | 10 | Uses local cache or D1 edge read |
| Worker -> DO RPC | 3 | 15 | Intra-colo RPC |
| DO State Check | 1 | 2 | In-memory lookup |
| DO -> Container | 3 | 15 | Intra-colo HTTP |
| AES Decryption | <1 | 2 | 1/16 vCPU bound |
| **Total Overhead** | **~10ms** | **~44ms** | **Excludes upstream LLM network time** |

## Break-Even Analysis

### Railway vs Cloudflare
*   **Railway Hobby ($5/mo):** Sufficient for prototyping up to ~1-2M requests/month. Starts failing hard when memory hits 500MB or CPU throttles.
*   **Cloudflare Workers Paid ($5/mo baseline):** Includes 10M requests. DOs and D1 add incremental usage-based costs.
*   **Break-Even Point:** 
    At roughly **3M requests/month**, a monolithic Railway Go app would likely require upgrading to the $20/mo Pro plan to handle memory spikes and SSE connection limits.
    At 3M requests, Cloudflare costs are: $5 (Workers) + $0.45 (DO) + $0.01 (D1) + container costs ($5) = ~$10.46.
    Cloudflare becomes the more economical choice at scale, specifically past 3-5M requests per month, while offering infinitely better global distribution and edge termination.

## Red-Team Blockers & Recommendations
*   **Blocker:** The multi-hop architecture (Worker -> DO -> Container) consumes the entire 50ms latency budget. 
*   **Recommendation:** Move the AES-256-GCM decryption and proxy logic directly into the Cloudflare Worker using WebAssembly (Wasm) compiled from Rust or Go, or use Web Crypto API in TS. This eliminates the Container hop entirely, dropping P95 latency by ~15-20ms and saving container hosting costs. 
*   **Action for Lead Architect:** Investigate compiling the Go proxy logic to Wasm for Cloudflare Workers, or port the proxy to TypeScript, utilizing Web Crypto for AES-GCM.
