# Product Requirements Document

## Problem
Multi-tenant SaaS LLM router needs to efficiently manage and route requests across various LLM providers while maintaining strict tenant isolation, low latency, and low operational costs.

## Persona
Indie developers AND teams with multiple LLM API keys who want a unified, reliable gateway.

## Vision
"Your own globally-distributed OpenRouter, running on your keys"

## In Scope v2
- All smart router features (cost-optimal routing, capability filter, cascade routing, logical aliases, canary pings, sunset detection, per-tenant budget caps, streaming usage injection, cache token tracking)
- Cloudflare-native stack
- Multi-tenant auth
- Cost ledger (int64 microdollars)
- Dashboard v2

## Out of Scope v2
- Route C DO coordinator
- Multi-region D1 replicas
- Monetization/marketplace
- Mobile clients
