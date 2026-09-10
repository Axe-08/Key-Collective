# Threat Model & Chaos Defense (v3.5)
## Key Collective: Frontend Attack Vectors & Sybil Mitigations

**Author:** Red-Team Critic (Inception Board)  
**Status:** Approved by User  

---

## 1. Attack Vectors & Defensive Mitigations

### 1.1 Sybil Key Farming & Multi-Account Rotation
- **Threat:** Automated botnets spawn thousands of fresh GitHub accounts to bypass the 1-Person-1-Account quota limit and aggregate free tier calls.
- **Defense:** 
  - Mandatory minimum GitHub account age (>90 days).
  - Minimum 15 public contributions in the preceding 12 months.
  - Cloudflare Turnstile token validation on both client and server before key minting.
  - Per-subnet and per-IP velocity ratelimiting (max 1 registration per IP per 24 hours).

### 1.2 Client-Side Injection & XSS in Code Snippets
- **Threat:** Malicious payload injected into the interactive API sandbox response pane causes XSS execution in the developer's browser.
- **Defense:** 
  - Strict DOM text escaping in Svelte 5.
  - No use of raw `{@html}` on untrusted API responses.
  - Content Security Policy (CSP) headers disallowing unsafe inline eval.

### 1.3 Ephemeral Sandbox Resource Exhaustion (DemoDO Bombing)
- **Threat:** An attacker hammers the "Launch Ephemeral Sandbox" button to instantiate millions of Durable Object isolates.
- **Defense:**
  - IP-based singleton mapping for DemoDO instances.
  - Hard 15-minute `storage.setAlarm` self-destruction.
  - 15 RPM rate ceiling per demo session.

### 1.4 API Doc Exfiltration & PDF Denial of Service
- **Threat:** Abusing the PDF export button to crash the browser tab with deep recursive rendering.
- **Defense:**
  - Pure native CSS `@media print` styling triggering the browser's native print engine. Zero server roundtrips, zero client memory leaks.
