# ADR-003: Adoption of Obsidian Edge Design System & Complete Frontend Restructuring

**Date:** 2026-09-10  
**Status:** Accepted (Approved by User & Inception Board)  
**Deciders:** Principal Systems Architect, Lead Architect (User), Product Engineer  

## Context
Key Collective's frontend frontend bundle previously suffered from styling inconsistency, missing visual depth, and architecture mismatch. The user evaluated 3 implementation routes:
- **Route A (Quick Patch):** Tweak existing Tailwind classes with standard utility cards. (Rejected: failed user quality review; lacked genuine glassmorphism, depth, and luxury aesthetic).
- **Route B (Heavy UI Component Library):** Introduce external full-blown libraries like Radix / Skeleton / DaisyUI. (Rejected: adds unnecessary dependencies, bundle bloat >400KB, violates Cloudflare Workers static asset speed).
- **Route C (Stitch-Native Obsidian Edge Token Architecture - Chosen):** Port the bespoke Stitch design system directly into pure CSS tokens and Svelte 5 components. Uses dual-layer frosted glass surfaces (`backdrop-blur-xl`, `rgba(12,15,23,0.70)`), directional specular hairline highlights (`rgba(255,255,255,0.08)`), native SVG glow rings, and direct Vite SPA bundling.

## Weighted Decision Matrix

| Evaluation Criteria | Weight | Route A (Patch) | Route B (Library) | Route C (Obsidian Edge) |
|---|:---:|:---:|:---:|:---:|
| **Aesthetic Luxury & Polish** | 5 | 2/5 (10) | 3/5 (15) | **5/5 (25)** |
| **Edge Bundle Size (<250KB)** | 5 | 4/5 (20) | 2/5 (10) | **5/5 (25)** |
| **Design Consistency across 4 Screens** | 4 | 2/5 (8) | 3/5 (12) | **5/5 (20)** |
| **Zero Runtime External Dependencies** | 4 | 5/5 (20) | 2/5 (8) | **5/5 (20)** |
| **Implementation Speed** | 3 | 4/5 (12) | 3/5 (9) | **4/5 (12)** |
| **Weighted Total** | -- | **70 / 105** | **54 / 105** | **102 / 105** |

## Decision Outcome
Adopt **Route C**. The frontend styling is codified into `ui/src/app.css` using custom properties and atomic utility classes matching the Stitch tokens. All four screens (Dashboard, Workbench, Sybil Gate, and API Docs) share identical surface lighting, typography, and interactive hover semantics.
