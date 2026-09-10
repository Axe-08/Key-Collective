/**
 * Key Collective v3 — Multi-Project, Anti-Sybil & Tiered Developer Platform
 * Unit Tests for 5-Layer Anti-Sybil Scoring & Ingress Defense Engine
 *
 * Conforms to:
 * - docs/research/v3_landscape.md (Section 2: Anti-Sybil Defense)
 * - docs/architecture/lld_pod-auth-sybil.md (Section 4.2: Sybil Defense)
 * - docs/architecture/state_machine.mmd (1. Developer Ingress & Anti-Sybil Triage)
 * - docs/golden_tests/v3_cases.yaml (tc-v3-01 & tc-v3-02)
 * - micro_tasks_pod-auth-sybil.json (Task auth-sybil-02)
 * - src/contracts/v3_types.ts (AntiSybilAssessment, SybilScore, UserTier)
 *
 * Acceptance Criteria Verified:
 * 1. Tests cover all 5 layers of anti-sybil protection.
 * 2. Tests successfully mock/simulate bot and legitimate user behaviors.
 * 3. All tests pass with deterministic assertions.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AntiSybilInput,
  BUILDER_MIN_ACCOUNT_AGE_DAYS,
  BUILDER_MIN_CONTRIBUTIONS,
  BUILDER_MIN_PUBLIC_REPOS,
  DATACENTER_ASNS,
  DISPOSABLE_EMAIL_DOMAINS,
  InMemorySubnetTracker,
  MAX_REGISTRATIONS_PER_SUBNET,
  SUBNET_VELOCITY_WINDOW_MS,
  SYBIL_SCORE_BUILDER_THRESHOLD,
  SYBIL_SCORE_PROBATIONARY_THRESHOLD,
  TURNSTILE_TEST_TOKENS,
  evaluateAntiSybil,
  extractSubnet,
  isDatacenterAsn,
  isDisposableEmail,
  toSybilScore,
  verifyTurnstileToken,
} from "../../src/auth/sybil";
import { TIER_LIMITS_MAP } from "../../src/contracts/v3_types";

describe("Anti-Sybil 5-Layer Ingress Defense & Scoring Engine (auth-sybil-02)", () => {
  let tracker: InMemorySubnetTracker;
  const REF_NOW = new Date("2026-09-10T12:00:00.000Z"); // Canonical benchmark timestamp

  beforeEach(() => {
    tracker = new InMemorySubnetTracker();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Layer 1: Edge Bot Barrier (Cloudflare Turnstile)
  // ==========================================================================
  describe("Layer 1: Edge Bot Barrier (Cloudflare Turnstile)", () => {
    it("should accept valid turnstile token and pass siteverify", async () => {
      const result = await verifyTurnstileToken(TURNSTILE_TEST_TOKENS.ALWAYS_PASS);
      expect(result.success).toBe(true);
      expect(result.hostname).toBe("localhost");
      expect(result.challengeTs).toBeDefined();
    });

    it("should accept golden test fixture token 'valid_turnstile_response'", async () => {
      const result = await verifyTurnstileToken(TURNSTILE_TEST_TOKENS.VALID_FIXTURE);
      expect(result.success).toBe(true);
    });

    it("should reject standard failure test token '2x0000000000000000000000000000000AB'", async () => {
      const result = await verifyTurnstileToken(TURNSTILE_TEST_TOKENS.ALWAYS_FAIL);
      expect(result.success).toBe(false);
      expect(result.errorCodes).toContain("invalid-input-response");
    });

    it("should reject token fixture 'invalid_turnstile_response'", async () => {
      const result = await verifyTurnstileToken(TURNSTILE_TEST_TOKENS.INVALID_FIXTURE);
      expect(result.success).toBe(false);
      expect(result.errorCodes).toContain("invalid-input-response");
    });

    it("should reject spent / duplicate tokens", async () => {
      const result = await verifyTurnstileToken(TURNSTILE_TEST_TOKENS.TOKEN_ALREADY_SPENT);
      expect(result.success).toBe(false);
      expect(result.errorCodes).toContain("timeout-or-duplicate");
    });

    it("should reject missing or empty turnstile tokens", async () => {
      const resUndefined = await verifyTurnstileToken(undefined);
      expect(resUndefined.success).toBe(false);
      expect(resUndefined.errorCodes).toContain("missing-input-response");

      const resEmpty = await verifyTurnstileToken("   ");
      expect(resEmpty.success).toBe(false);
      expect(resEmpty.errorCodes).toContain("missing-input-response");
    });

    it("should verify against Cloudflare siteverify HTTP endpoint with mock fetch", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            "error-codes": [],
            challenge_ts: "2026-09-10T12:00:00Z",
            hostname: "key-col.axe08.tech",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const result = await verifyTurnstileToken("custom_live_token_abc123", {
        secretKey: "0x4AAAAAAtestsecret",
        remoteIp: "198.51.100.42",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
      expect(result.success).toBe(true);
      expect(result.hostname).toBe("key-col.axe08.tech");
    });

    it("should handle Cloudflare siteverify HTTP 400/500 errors gracefully", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response("Bad Request", { status: 400 })
      );

      const result = await verifyTurnstileToken("some_token", {
        secretKey: "0x4AAAAAAtestsecret",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.success).toBe(false);
      expect(result.errorCodes).toContain("http-400");
    });

    it("should handle network exceptions during siteverify gracefully", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Connection reset by peer"));

      const result = await verifyTurnstileToken("some_token", {
        secretKey: "0x4AAAAAAtestsecret",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.success).toBe(false);
      expect(result.errorCodes).toContain("internal-verification-network-error");
    });

    it("should cause evaluateAntiSybil to immediately reject bot with score 0 and tier suspended", async () => {
      const input: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_FAIL,
        clientIp: "203.0.113.10",
        githubProfile: {
          primaryEmail: "bot@gmail.com",
          isEmailVerified: true,
          createdAt: "2020-01-01T00:00:00Z",
          publicRepos: 10,
          contributionsCount: 50,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(input, { subnetTracker: tracker });
      expect(assessment.passed).toBe(false);
      expect(assessment.score).toBe(0);
      expect(assessment.tier).toBe("suspended");
      expect(assessment.checks.turnstileValid).toBe(false);
      expect(assessment.auditReasons.some((r) => r.includes("Turnstile"))).toBe(true);
    });
  });

  // ==========================================================================
  // Layer 2: Network Ingress (IP & Subnet Velocity / ASN Throttling)
  // ==========================================================================
  describe("Layer 2: Network Ingress (Subnet Velocity & ASN Reputation)", () => {
    it("should correctly extract /24 subnets for IPv4 addresses", () => {
      expect(extractSubnet("192.168.1.55")).toBe("192.168.1.0/24");
      expect(extractSubnet("203.0.113.195")).toBe("203.0.113.0/24");
      expect(extractSubnet("10.0.0.1")).toBe("10.0.0.0/24");
      expect(extractSubnet("127.0.0.1")).toBe("127.0.0.0/24");
    });

    it("should correctly extract /48 prefix for IPv6 addresses", () => {
      expect(extractSubnet("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe("2001:0db8:85a3::/48");
      expect(extractSubnet("2606:4700:4700::1111")).toBe("2606:4700:4700::/48");
    });

    it("should handle malformed or empty IP strings safely without crashing", () => {
      expect(extractSubnet("")).toBe("0.0.0.0/24");
      expect(extractSubnet("invalid-ip-string")).toBe("invalid-ip-string/24");
    });

    it("should allow the first registration from a /24 subnet", async () => {
      const input: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "198.51.100.10",
        githubProfile: {
          primaryEmail: "alice@example.com",
          isEmailVerified: true,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 5,
          contributionsCount: 20,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(input, { subnetTracker: tracker });
      expect(assessment.passed).toBe(true);
      expect(assessment.checks.subnetRegistrationCount).toBe(0);
      expect(assessment.tier).toBe("builder");

      // Verify the tracker now has 1 recorded registration in that subnet
      const count = await tracker.getSubnetRegistrationCount("198.51.100.0/24", SUBNET_VELOCITY_WINDOW_MS, REF_NOW.getTime());
      expect(count).toBe(1);
    });

    it("should penalize second registration from the same /24 subnet within 30 days", async () => {
      const firstInput: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "198.51.100.10",
        githubProfile: {
          primaryEmail: "alice@example.com",
          isEmailVerified: true,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 5,
          contributionsCount: 20,
        },
        now: REF_NOW,
      };
      await evaluateAntiSybil(firstInput, { subnetTracker: tracker });

      // Second user from different host in SAME /24 subnet
      const secondInput: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "198.51.100.99",
        githubProfile: {
          primaryEmail: "bob@example.com",
          isEmailVerified: true,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 5,
          contributionsCount: 20,
        },
        now: new Date(REF_NOW.getTime() + 2 * 24 * 60 * 60 * 1000), // 2 days later
      };

      const assessment2 = await evaluateAntiSybil(secondInput, { subnetTracker: tracker });
      expect(assessment2.checks.subnetRegistrationCount).toBe(1);
      expect(assessment2.auditReasons.some((r) => r.includes("Subnet velocity limit exceeded"))).toBe(true);
      // Because subnet velocity exceeded, Builder tier requirements are not satisfied -> quarantined to probationary
      expect(assessment2.tier).toBe("probationary");
    });

    it("should permit signup from same subnet after 30-day velocity window has elapsed", async () => {
      const firstInput: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "198.51.100.10",
        githubProfile: {
          primaryEmail: "alice@example.com",
          isEmailVerified: true,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 5,
          contributionsCount: 20,
        },
        now: REF_NOW,
      };
      await evaluateAntiSybil(firstInput, { subnetTracker: tracker });

      // Subsequent signup 31 days later
      const futureNow = new Date(REF_NOW.getTime() + 31 * 24 * 60 * 60 * 1000);
      const subsequentInput: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "198.51.100.88",
        githubProfile: {
          primaryEmail: "carol@example.com",
          isEmailVerified: true,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 5,
          contributionsCount: 20,
        },
        now: futureNow,
      };

      const assessment = await evaluateAntiSybil(subsequentInput, { subnetTracker: tracker });
      expect(assessment.checks.subnetRegistrationCount).toBe(0);
      expect(assessment.tier).toBe("builder");
    });

    it("should isolate separate /24 subnets from throttling each other", async () => {
      const inputA: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "198.51.100.1",
        githubProfile: {
          primaryEmail: "userA@example.com",
          isEmailVerified: true,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 5,
          contributionsCount: 20,
        },
        now: REF_NOW,
      };
      const inputB: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "198.51.101.1", // Different /24
        githubProfile: {
          primaryEmail: "userB@example.com",
          isEmailVerified: true,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 5,
          contributionsCount: 20,
        },
        now: REF_NOW,
      };

      await evaluateAntiSybil(inputA, { subnetTracker: tracker });
      const assessmentB = await evaluateAntiSybil(inputB, { subnetTracker: tracker });

      expect(assessmentB.checks.subnetRegistrationCount).toBe(0);
      expect(assessmentB.tier).toBe("builder");
    });

    it("should identify and flag datacenter ASNs (AWS, Hetzner, DO, OVH)", () => {
      expect(isDatacenterAsn(16509)).toBe(true); // AWS
      expect(isDatacenterAsn(24940)).toBe(true); // Hetzner
      expect(isDatacenterAsn(14061)).toBe(true); // DigitalOcean
      expect(isDatacenterAsn(16276)).toBe(true); // OVH
      expect(isDatacenterAsn("AS16509")).toBe(true); // String format
      expect(isDatacenterAsn(7922)).toBe(false);  // Comcast (Residential)
      expect(isDatacenterAsn(undefined)).toBe(false);
    });

    it("should penalize datacenter ASN ingress in sybil evaluation", async () => {
      const input: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "3.5.140.2",
        asn: 16509, // AWS
        githubProfile: {
          primaryEmail: "user@example.com",
          isEmailVerified: true,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 5,
          contributionsCount: 20,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(input, { subnetTracker: tracker });
      expect(assessment.auditReasons.some((r) => r.includes("Datacenter ASN"))).toBe(true);
      expect(assessment.score).toBeLessThan(100);
    });

    it("should flag and penalize Tor exit nodes (country T1 or isTor flag)", async () => {
      const input: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "185.220.101.5",
        country: "T1",
        isTor: true,
        githubProfile: {
          primaryEmail: "toruser@example.com",
          isEmailVerified: true,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 5,
          contributionsCount: 20,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(input, { subnetTracker: tracker });
      expect(assessment.auditReasons.some((r) => r.includes("Tor exit node"))).toBe(true);
    });
  });

  // ==========================================================================
  // Layer 3: Email Verification (Disposable Domain Blocklist)
  // ==========================================================================
  describe("Layer 3: Email Verification (Disposable Domain Blocklist)", () => {
    it("should recognize legitimate email domains", () => {
      expect(isDisposableEmail("dev@gmail.com")).toBe(false);
      expect(isDisposableEmail("engineer@github.com")).toBe(false);
      expect(isDisposableEmail("student@lnmiit.ac.in")).toBe(false);
      expect(isDisposableEmail("user@proton.me")).toBe(false);
      expect(isDisposableEmail("developer@company.org")).toBe(false);
    });

    it("should detect and block known disposable burner email domains", () => {
      expect(isDisposableEmail("bot@temp-mail.org")).toBe(true);
      expect(isDisposableEmail("scam@mailinator.com")).toBe(true);
      expect(isDisposableEmail("anon@guerrillamail.com")).toBe(true);
      expect(isDisposableEmail("burner@10minutemail.com")).toBe(true);
      expect(isDisposableEmail("test@sharklasers.com")).toBe(true);
      expect(isDisposableEmail("user@dispostable.com")).toBe(true);
      expect(isDisposableEmail("fake@burnermail.io")).toBe(true);
      expect(isDisposableEmail("hacker@yopmail.com")).toBe(true);
    });

    it("should detect subdomains of disposable providers", () => {
      expect(isDisposableEmail("user@mail.temp-mail.org")).toBe(true);
      expect(isDisposableEmail("bot@xyz.mailinator.com")).toBe(true);
    });

    it("should treat malformed emails as disposable/invalid safely", () => {
      expect(isDisposableEmail("")).toBe(true);
      expect(isDisposableEmail("no-at-sign")).toBe(true);
      expect(isDisposableEmail("user@")).toBe(true);
    });

    it("should reject disposable email with score < 40 and tier suspended", async () => {
      const input: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "203.0.113.5",
        githubProfile: {
          primaryEmail: "bot992@temp-mail.org",
          isEmailVerified: true,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 10,
          contributionsCount: 50,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(input, { subnetTracker: tracker });
      expect(assessment.passed).toBe(false);
      expect(assessment.score).toBeLessThan(SYBIL_SCORE_PROBATIONARY_THRESHOLD);
      expect(assessment.tier).toBe("suspended");
      expect(assessment.checks.emailNonDisposable).toBe(false);
      expect(assessment.auditReasons.some((r) => r.includes("Disposable email domain rejected"))).toBe(true);
    });

    it("should penalize unverified GitHub emails", async () => {
      const input: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "203.0.113.5",
        githubProfile: {
          primaryEmail: "legit@example.com",
          isEmailVerified: false, // Unverified on GitHub
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 5,
          contributionsCount: 20,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(input, { subnetTracker: tracker });
      expect(assessment.auditReasons.some((r) => r.includes("Primary GitHub email address is unverified"))).toBe(true);
      expect(assessment.score).toBeLessThan(100);
    });
  });

  // ==========================================================================
  // Layer 4: GitHub Account Maturity Gate
  // ==========================================================================
  describe("Layer 4: GitHub Account Maturity Gate", () => {
    it("should verify mature account meets all thresholds (age >= 30d, repos >= 1, contributions >= 5)", async () => {
      const input: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "203.0.113.20",
        githubProfile: {
          primaryEmail: "senior@example.com",
          isEmailVerified: true,
          createdAt: new Date(REF_NOW.getTime() - 100 * 24 * 60 * 60 * 1000), // 100 days old
          publicRepos: 8,
          contributionsCount: 45,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(input, { subnetTracker: tracker });
      expect(assessment.checks.accountAgeDays).toBe(100);
      expect(assessment.checks.publicRepos).toBe(8);
      expect(assessment.checks.contributionsCount).toBe(45);
      expect(assessment.score).toBeGreaterThanOrEqual(SYBIL_SCORE_BUILDER_THRESHOLD);
      expect(assessment.tier).toBe("builder");
    });

    it("should detect young account (< 30 days old) and record audit reason", async () => {
      const input: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "203.0.113.20",
        githubProfile: {
          primaryEmail: "newbie@example.com",
          isEmailVerified: true,
          createdAt: new Date(REF_NOW.getTime() - 10 * 24 * 60 * 60 * 1000), // 10 days old
          publicRepos: 2,
          contributionsCount: 10,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(input, { subnetTracker: tracker });
      expect(assessment.checks.accountAgeDays).toBe(10);
      expect(assessment.auditReasons.some((r) => r.includes("GitHub account age (10d) is less than required 30 days"))).toBe(true);
      expect(assessment.tier).toBe("probationary");
    });

    it("should detect 0 public repositories and record audit reason", async () => {
      const input: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "203.0.113.20",
        githubProfile: {
          primaryEmail: "dev@example.com",
          isEmailVerified: true,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 0,
          contributionsCount: 15,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(input, { subnetTracker: tracker });
      expect(assessment.checks.publicRepos).toBe(0);
      expect(assessment.auditReasons.some((r) => r.includes("0 public repositories"))).toBe(true);
      expect(assessment.tier).toBe("probationary");
    });

    it("should detect < 5 lifetime contributions and record audit reason", async () => {
      const input: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "203.0.113.20",
        githubProfile: {
          primaryEmail: "dev@example.com",
          isEmailVerified: true,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 2,
          contributionsCount: 3, // Less than required 5
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(input, { subnetTracker: tracker });
      expect(assessment.checks.contributionsCount).toBe(3);
      expect(assessment.auditReasons.some((r) => r.includes("GitHub contributions count (3) is less than required 5"))).toBe(true);
      expect(assessment.tier).toBe("probationary");
    });

    it("should accept totalContributions alias if contributionsCount is omitted", async () => {
      const input: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "203.0.113.20",
        githubProfile: {
          primaryEmail: "dev@example.com",
          isEmailVerified: true,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 3,
          totalContributions: 25,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(input, { subnetTracker: tracker });
      expect(assessment.checks.contributionsCount).toBe(25);
    });
  });

  // ==========================================================================
  // Layer 5: Probationary Fallback & Tier Triage
  // ==========================================================================
  describe("Layer 5: Probationary Fallback Sandboxing vs Hard Rejection", () => {
    it("should sandbox legitimate junior developer to probationary tier (Zero false-positive lockout)", async () => {
      // Junior developer with brand new GitHub account (<30d, 0 repos) but real residential IP,
      // verified email, and valid Turnstile human check
      const juniorDevInput: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "98.12.34.56", // Residential IP
        githubProfile: {
          primaryEmail: "junior.engineer@gmail.com",
          isEmailVerified: true,
          createdAt: new Date(REF_NOW.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 days old
          publicRepos: 0,
          contributionsCount: 1,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(juniorDevInput, { subnetTracker: tracker });

      // Must NOT be blocked/suspended
      expect(assessment.passed).toBe(true);
      expect(assessment.tier).toBe("probationary");
      expect(assessment.score).toBeGreaterThanOrEqual(SYBIL_SCORE_PROBATIONARY_THRESHOLD);
      expect(assessment.score).toBeLessThan(SYBIL_SCORE_BUILDER_THRESHOLD);

      // Verify probationary tier limits align with TIER_LIMITS_MAP
      const limits = TIER_LIMITS_MAP[assessment.tier];
      expect(limits.rpmLimit).toBe(2);
      expect(limits.rpdLimit).toBe(50);
      expect(limits.maxProjects).toBe(1);
    });

    it("should assign builder tier to authentic mature developer", async () => {
      const matureDevInput: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "98.12.34.56",
        githubProfile: {
          primaryEmail: "core.maintainer@gmail.com",
          isEmailVerified: true,
          createdAt: "2023-01-01T00:00:00Z",
          publicRepos: 12,
          contributionsCount: 250,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(matureDevInput, { subnetTracker: tracker });

      expect(assessment.passed).toBe(true);
      expect(assessment.tier).toBe("builder");
      expect(assessment.score).toBeGreaterThanOrEqual(SYBIL_SCORE_BUILDER_THRESHOLD);

      // Verify builder tier limits align with TIER_LIMITS_MAP
      const limits = TIER_LIMITS_MAP[assessment.tier];
      expect(limits.rpmLimit).toBe(20);
      expect(limits.rpdLimit).toBe(2000);
      expect(limits.maxProjects).toBe(3);
    });

    it("should hard-reject disposable identity burner bot with HTTP 403 suspension", async () => {
      const disposableBotInput: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "185.220.101.5",
        asn: 24940, // Hetzner
        githubProfile: {
          primaryEmail: "temp99@guerrillamail.com",
          isEmailVerified: false,
          createdAt: new Date(REF_NOW.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day old
          publicRepos: 0,
          contributionsCount: 0,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(disposableBotInput, { subnetTracker: tracker });

      expect(assessment.passed).toBe(false);
      expect(assessment.tier).toBe("suspended");
      expect(assessment.score).toBeLessThan(SYBIL_SCORE_PROBATIONARY_THRESHOLD);
    });
  });

  // ==========================================================================
  // Golden Evaluation Benchmark Test Cases (docs/golden_tests/v3_cases.yaml)
  // ==========================================================================
  describe("Golden Benchmark Test Cases (docs/golden_tests/v3_cases.yaml)", () => {
    it("tc-v3-01: GitHub OAuth Happy Path & Anti-Sybil Verification", async () => {
      // Golden Input Fixture from docs/golden_tests/v3_cases.yaml
      const goldenCase01: AntiSybilInput = {
        turnstileToken: "valid_turnstile_response",
        clientIp: "198.51.100.25",
        githubProfile: {
          createdAt: "2025-01-01T00:00:00Z",
          publicRepos: 4,
          primaryEmail: "developer@example.com",
          isEmailVerified: true,
          total_contributions: 42,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(goldenCase01, { subnetTracker: tracker });

      // Golden assertions
      expect(assessment.passed).toBe(true);
      expect(assessment.tier).toBe("builder");
      expect(assessment.score).toBeGreaterThanOrEqual(65);

      const limits = TIER_LIMITS_MAP[assessment.tier];
      expect(limits.rpmLimit).toBe(20);
      expect(limits.rpdLimit).toBe(2000);
      expect(limits.maxProjects).toBe(3);
    });

    it("tc-v3-02: Anti-Sybil Quarantine (Young Account / Burner Email)", async () => {
      // Golden Input Fixture from docs/golden_tests/v3_cases.yaml
      const goldenCase02: AntiSybilInput = {
        turnstileToken: "valid_turnstile_response",
        clientIp: "198.51.100.26",
        githubProfile: {
          createdAt: "2026-09-01T00:00:00Z", // 9 days old relative to 2026-09-10
          publicRepos: 0,
          primaryEmail: "bot992@temp-mail.org",
          isEmailVerified: false,
          total_contributions: 0,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(goldenCase02, { subnetTracker: tracker });

      // Golden assertions: disposable email flagged, quarantine/rejection
      expect(assessment.checks.emailNonDisposable).toBe(false);
      expect(assessment.checks.accountAgeDays).toBeLessThan(30);
      expect(assessment.checks.publicRepos).toBe(0);
      expect(assessment.checks.contributionsCount).toBe(0);
      expect(assessment.score).toBeLessThan(40);
      expect(assessment.passed).toBe(false);
      expect(assessment.tier).toBe("suspended");
    });
  });

  // ==========================================================================
  // Data Contract Adapter: toSybilScore
  // ==========================================================================
  describe("toSybilScore Contract Adapter", () => {
    it("should transform AntiSybilAssessment into SybilScore with correct riskLevel and flags", async () => {
      const input: AntiSybilInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "198.51.100.12",
        asn: 16509, // AWS
        isTor: false,
        githubProfile: {
          primaryEmail: "dev@example.com",
          isEmailVerified: true,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 5,
          contributionsCount: 20,
        },
        now: REF_NOW,
      };

      const assessment = await evaluateAntiSybil(input, { subnetTracker: tracker });
      const sybilScore = toSybilScore(assessment, input);

      expect(sybilScore.passed).toBe(assessment.passed);
      expect(sybilScore.tier).toBe(assessment.tier);
      expect(sybilScore.ip).toBe("198.51.100.12");
      expect(sybilScore.flags?.isVpnOrProxy).toBe(true);
      expect(sybilScore.flags?.isTor).toBe(false);
      expect(sybilScore.flags?.isDisposableEmail).toBe(false);
      expect(sybilScore.details?.accountAgeDays).toBeDefined();
    });

    it("should flag critical risk when score is low", () => {
      const dummyAssessment = {
        passed: false,
        score: 15,
        tier: "suspended" as const,
        checks: {
          turnstileValid: false,
          emailNonDisposable: false,
          accountAgeDays: 0,
          publicRepos: 0,
          contributionsCount: 0,
          subnetRegistrationCount: 0,
        },
        auditReasons: ["Bot detected"],
      };

      const dummyInput: AntiSybilInput = {
        clientIp: "1.2.3.4",
        githubProfile: {
          primaryEmail: "bot@temp-mail.org",
          isEmailVerified: false,
          createdAt: 0,
          publicRepos: 0,
        },
      };

      const sybilScore = toSybilScore(dummyAssessment, dummyInput);
      expect(sybilScore.riskLevel).toBe("critical");
      expect(sybilScore.score).toBe(85); // Risk score = 100 - assessment.score
      expect(sybilScore.passed).toBe(false);
    });
  });
});
