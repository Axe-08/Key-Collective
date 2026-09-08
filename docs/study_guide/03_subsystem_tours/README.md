# Key Collective Subsystem Tours

Welcome to the internal plumbing of Key Collective. This sequence maps the landscape of our intelligent API routing tier, highlighting the architectural forces that allow us to multiplex upstream AI endpoints while preserving rigid request quotas and fault tolerance.

We divide the exploration into four interconnected districts. You can traverse them sequentially to build a cumulative mental model.

## Tour Roadmap

1.  **[Data Contracts and Models](03_1_01_data_contracts_and_models.md)**
    We begin with the structural backbone. This module inspects the shared domain types acting as the lingua franca across system boundaries. We dissect `APIKey`, `Provider`, and telemetry shapes like `ProxyStats` and `PoolStats` to understand how runtime telemetry bridges to static database rows.

2.  **[Core Engine and Logic](03_2_02_core_engine_and_logic.md)**
    The pulsating heart of the proxy. Here we observe `ProxyServer` orchestrating the reverse proxy mechanics and intercepting streams. We also inspect the cryptographic primitives ensuring `APIKey` material never touches persistent storage in plaintext.

3.  **[Interfaces and Gateways](03_3_03_interfaces_and_gateways.md)**
    Moving outward, we hit the boundary layer. We examine how the REST controllers embodied in `Handler` shape HTTP traffic using `CreateKeyRequest`, `KeyResponse`, and `TestKeyResponse`. We also highlight the integration points allowing the Svelte frontend to consume these services.

4.  **[Observability and Infrastructure](03_4_04_observability_and_infrastructure.md)**
    Finally, we evaluate the substrate keeping the system resilient. The `KeyManager` operates as a localized traffic controller applying circuit breaking and load balancing algorithms. Simultaneously, the `DB` struct leveraging SQLite's WAL mode anchors telemetry and state mutations durably to disk.

By absorbing these chapters, you acquire a mechanical sympathy for how Key Collective manages upstream AI volatility. Proceed to the data contracts to begin the journey.
## Architectural Context

Before diving into the individual subsystem components, it is crucial to recognize the holistic design philosophy powering Key Collective. At its core, the system acts as a high-performance multiplexer. The proliferation of AI providers introduces a fragmented ecosystem where rate limits, network volatility, and secret management pose constant threats to stability. Key Collective solves this by interposing a resilient proxy tier that standardizes these anomalies.

The architecture fundamentally splits into two operational modes:
1.  **The Control Plane**: This encompasses the administrative web interface and the RESTful gateways. It handles human-driven configurations, visualizing metrics, and distributing API keys into the persistent database.
2.  **The Data Plane**: This is the ultra-fast reverse proxy engine. Once configured by the control plane, the data plane routes thousands of requests per minute, applying cryptography and sliding-window quota checks in nanoseconds.

By keeping these planes logically distinct within a single deployed binary, Key Collective achieves both the ergonomics of a modern web application and the sheer throughput required by an enterprise-grade AI gateway.

## Navigation Advice

As you read through the provided markdown chapters, keep an eye on how state mutates. You will observe data transition from a static SQLite row in the infrastructure tier, morph into a highly volatile struct in the proxy engine, and eventually serialize into a sanitized JSON response at the API gateway layer. Pay close attention to the structural tagging (`json:"-"`) which serves as our primary defense mechanism against secret leakage.

This guide is designed for maintainers and architects. By the end of this tour, you will understand not just how Key Collective functions, but why its subsystems are carved along these specific boundaries.

## Pre-requisites and Recommended Reading

Before consuming these units, readers should have a baseline understanding of:
- Go 1.22's updated HTTP routing patterns and standard library constructs.
- Basic cryptographic principles, specifically AES-256-GCM and nonces.
- Svelte 5 component architecture and reactive data flow.
- SQLite WAL mode mechanics and concurrency limitations.

Enjoy the tour of the subsystem internals. The architectural decisions presented here prioritize fault tolerance and high availability above all else.
