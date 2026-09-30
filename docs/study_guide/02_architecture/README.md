# Part 2: Architecture, High-Level Design, & Communal Economics


## Overview


Welcome to Part 2 of the Key Collective University Textbook.
In this module, we transition from the foundational concepts of the proxy API to the core architectural underpinnings of the entire system.
Key Collective is not merely a technical routing engine; it is a socio-technical system designed to solve a specific economic problem: stranded API capacity.
To solve this at a global edge scale, we must marry rigorous economic theory with distributed systems engineering.


The architecture described in this section forms the blueprint for a highly scalable, isolated, and secure multi-tenant environment.


## Module Objectives


By the end of this module, you will understand:
- The economic philosophy of reciprocal exchange that drives the system's credit/debt mechanics.
- The constraints of edge computing and why traditional distributed locking mechanisms fail.
- The Actor Model topology leveraging Cloudflare Durable Objects for single-threaded transactional consistency.
- The Non-Negotiable Architectural Invariants that guarantee security, isolation, and precision.
- The legal and compliance frameworks necessary to operate a communal API gateway safely.
- The complete High-Level Design (HLD) and the mathematical capacity planning models for scaling the platform.


## Chapter Map


### Chapter 2.1: Reciprocal Exchange and Pool Economics
We begin by defining the core problem: the tragedy of the commons in shared API pools and the inefficiency of stranded, pre-paid capacity.
We explore the mathematical equilibrium of credit and debt, and the game-theoretic mechanisms deployed to prevent free-riding behavior among tenants.


### Chapter 2.2: Distributed Actor Topology
Moving to the technical implementation, this chapter analyzes the failure modes of distributed Redis locks across 300+ edge Points of Presence (PoPs).
We introduce the Cloudflare Durable Object (DO) as our edge actor, explaining the 3-actor topology (KeyPoolDO, TenantQuotaDO, PoolCoordinatorDO) and the necessity of in-memory transactional storage (`this.ctx.storage`).


### Chapter 2.3: Architectural Invariants and Security
A deep dive into the five strict engineering invariants that protect the collective.
We cover AES-256-GCM encryption with 12-byte nonces for zero-plaintext keys, strict per-tenant DO isolation, fixed-point microdollar math (`int64`) for financial precision, hot state survival, and non-blocking telemetry design.


### Chapter 2.4: Legal Compliance, ToS, and Mediation
Architecture is not solely technical; it is legal.
This chapter unpacks the complexities of upstream provider Terms of Service (ToS).
We examine the C1-C3 and K1-K2 client attestation contracts, liability firewalls, and the automated dispute mediation protocol for resolving failed or degraded upstream requests.


### Chapter 2.5: High-Level Design and Capacity Planning
The capstone of Part 2.
We present the full Big-Tech High-Level Design (HLD), separating the edge data plane from the control plane.
We establish rigorous network latency budgets (<15ms routing overhead) and provide a comprehensive Cloudflare hosting cost model, featuring back-of-the-envelope calculations for Current Baseline, 10x Mid-Scale, and 100x Global Scale deployments.


## Study Guidelines


This part of the textbook is dense with both conceptual frameworks and strict technical constraints.
Pay special attention to the Mermaid architecture diagrams and the exact mathematical formulas provided for cost and quota calculations.
The invariants defined here are binding across all code implementations.


---
*Key Collective University Textbook (v4.0) - Part 2*
