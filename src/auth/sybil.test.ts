/**
 * Unit Tests for Unified calculateSybilScore(user, req) Engine (AUTH-02)
 *
 * Verifies the 5-layer sybil scoring function:
 * Layer 1: Turnstile bot score & token verification
 * Layer 2: IP velocity (/24 subnet sliding window & Datacenter ASN)
 * Layer 3: Disposable email domain denylist
 * Layer 4: GitHub account age (>30 days)
 * Layer 5: GitHub activity (>5 repos or >20 contributions)
 * GitHub API: Upstream profile fetch via fetch API
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  calculateSybilScore,
  globalSubnetTracker,
  TURNSTILE_TEST_TOKENS,
  SYBIL_MIN_ACCOUNT_AGE_DAYS,
  SYBIL_MIN_ACTIVITY_REPOS,
  SYBIL_MIN_ACTIVITY_CONTRIBUTIONS,
  type SybilUserInput,
  type SybilRequestInput,
} from "./sybil";

describe("Unified calculateSybilScore(user, req) 5-Layer Defense (AUTH-02)", () => {
  const originalFetch = globalThis.fetch;
  const REF_NOW = new Date("2026-09-11T12:00:00.000Z");

  beforeEach(() => {
    vi.restoreAllMocks();
    globalSubnetTracker.reset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ==========================================================================
  // Layer 1: Cloudflare Turnstile Bot Score & Challenge
  // ==========================================================================
  describe("Layer 1: Turnstile bot score & challenge verification", () => {
    it("accepts valid Turnstile token and awards Layer 1 score", async () => {
      const user: SybilUserInput = {
        username: "testdev",
        primaryEmail: "testdev@gmail.com",
        createdAt: "2025-01-01T00:00:00Z",
        publicRepos: 10,
        contributionsCount: 50,
        now: REF_NOW,
      };
      const req: SybilRequestInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        clientIp: "198.51.100.10",
      };

      const result = await calculateSybilScore(user, req);

      expect(result.details.turnstileValid).toBe(true);
      expect(result.flags.turnstileFailed).toBe(false);
      expect(result.score).toBe(100);
      expect(result.passed).toBe(true);
      expect(result.tier).toBe("builder");
    });

    it("detects bot and immediately sets score to 0 with suspended tier for invalid token", async () => {
      const user: SybilUserInput = {
        username: "botuser",
        primaryEmail: "bot@gmail.com",
        createdAt: "2024-01-01T00:00:00Z",
        publicRepos: 10,
        contributionsCount: 50,
        now: REF_NOW,
      };
      const req: SybilRequestInput = {
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_FAIL,
        clientIp: "198.51.100.11",
      };

      const result = await calculateSybilScore(user, req);

      expect(result.details.turnstileValid).toBe(false);
      expect(result.flags.turnstileFailed).toBe(true);
      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.tier).toBe("suspended");
      expect(result.reasons.some((r) => r.includes("Turnstile"))).toBe(true);
    });

    it("detects bot when Cloudflare bot management score is < 30", async () => {
      const user: SybilUserInput = {
        username: "lowbotscore",
        primaryEmail: "lowbot@gmail.com",
        createdAt: "2024-01-01T00:00:00Z",
        publicRepos: 10,
        contributionsCount: 50,
        now: REF_NOW,
      };
      const req: SybilRequestInput = {
        cf: {
          botManagement: {
            score: 15, // Score < 30 is bot
          },
        },
        clientIp: "198.51.100.12",
      };

      const result = await calculateSybilScore(user, req);

      expect(result.details.turnstileValid).toBe(false);
      expect(result.flags.turnstileFailed).toBe(true);
      expect(result.score).toBe(0);
      expect(result.tier).toBe("suspended");
    });

    it("parses cf-bot-score header when cf object is omitted", async () => {
      const user: SybilUserInput = {
        username: "botheader",
        primaryEmail: "headerbot@gmail.com",
        createdAt: "2024-01-01T00:00:00Z",
        publicRepos: 10,
        contributionsCount: 50,
        now: REF_NOW,
      };
      const req = new Request("https://api.key-col.axe08.tech/v1/auth", {
        headers: {
          "cf-bot-score": "10",
          "cf-connecting-ip": "198.51.100.13",
        },
      });

      const result = await calculateSybilScore(user, req);

      expect(result.details.turnstileValid).toBe(false);
      expect(result.tier).toBe("suspended");
    });
  });

  // ==========================================================================
  // Layer 2: Network Ingress & IP Velocity
  // ==========================================================================
  describe("Layer 2: Network Ingress & IP Velocity", () => {
    it("permits initial registration from a /24 subnet", async () => {
      const user: SybilUserInput = {
        username: "user1",
        primaryEmail: "user1@example.com",
        createdAt: "2024-01-01T00:00:00Z",
        publicRepos: 8,
        contributionsCount: 30,
        now: REF_NOW,
      };
      const req: SybilRequestInput = {
        clientIp: "203.0.113.5",
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
      };

      const result = await calculateSybilScore(user, req);

      expect(result.flags.ipVelocityExceeded).toBe(false);
      expect(result.passed).toBe(true);
      expect(result.details.subnetRegistrationCount).toBe(0);
    });

    it("throttles subsequent registration from same /24 subnet within 30 days", async () => {
      const user1: SybilUserInput = {
        username: "user1",
        primaryEmail: "user1@example.com",
        createdAt: "2024-01-01T00:00:00Z",
        publicRepos: 8,
        contributionsCount: 30,
        now: REF_NOW,
      };
      const req1: SybilRequestInput = {
        clientIp: "203.0.113.10",
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
      };
      await calculateSybilScore(user1, req1);

      // Second user on same /24 subnet
      const user2: SybilUserInput = {
        username: "user2",
        primaryEmail: "user2@example.com",
        createdAt: "2024-01-01T00:00:00Z",
        publicRepos: 8,
        contributionsCount: 30,
        now: REF_NOW,
      };
      const req2: SybilRequestInput = {
        clientIp: "203.0.113.99",
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
      };
      const result2 = await calculateSybilScore(user2, req2);

      expect(result2.flags.ipVelocityExceeded).toBe(true);
      expect(result2.details.subnetRegistrationCount).toBe(1);
      expect(result2.tier).toBe("probationary"); // Not builder due to subnet velocity
    });

    it("penalizes datacenter ASN (e.g. AWS 16509)", async () => {
      const user: SybilUserInput = {
        username: "awsuser",
        primaryEmail: "awsuser@example.com",
        createdAt: "2024-01-01T00:00:00Z",
        publicRepos: 8,
        contributionsCount: 30,
        now: REF_NOW,
      };
      const req: SybilRequestInput = {
        clientIp: "198.51.100.50",
        cf: { asn: 16509 }, // AWS ASN
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
      };

      const result = await calculateSybilScore(user, req);

      expect(result.flags.isVpnOrProxy).toBe(true);
      expect(result.score).toBeLessThan(100);
    });
  });

  // ==========================================================================
  // Layer 3: Disposable Email Domain Check
  // ==========================================================================
  describe("Layer 3: Disposable Email Domain Denylist", () => {
    it("permits standard consumer and custom domain emails", async () => {
      const user: SybilUserInput = {
        username: "validemail",
        primaryEmail: "engineer@company.co",
        createdAt: "2024-01-01T00:00:00Z",
        publicRepos: 8,
        contributionsCount: 30,
        now: REF_NOW,
      };
      const req: SybilRequestInput = {
        clientIp: "198.51.100.60",
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
      };

      const result = await calculateSybilScore(user, req);

      expect(result.flags.disposableEmail).toBe(false);
      expect(result.flags.isDisposableEmail).toBe(false);
      expect(result.score).toBe(100);
      expect(result.tier).toBe("builder");
    });

    it("hard-rejects disposable domains like temp-mail.org and mailinator.com", async () => {
      const domains = ["temp-mail.org", "mailinator.com", "guerrillamail.com", "sub.mailinator.com"];

      for (const domain of domains) {
        const user: SybilUserInput = {
          username: `bot_${domain.replace(/[^a-z0-9]/g, "")}`,
          primaryEmail: `spammer@${domain}`,
          createdAt: "2024-01-01T00:00:00Z",
          publicRepos: 10,
          contributionsCount: 50,
          now: REF_NOW,
        };
        const req: SybilRequestInput = {
          clientIp: "198.51.100.70",
          turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
        };

        const result = await calculateSybilScore(user, req);

        expect(result.flags.disposableEmail).toBe(true);
        expect(result.passed).toBe(false);
        expect(result.tier).toBe("suspended");
        expect(result.score).toBeLessThanOrEqual(20);
      }
    });

    it("penalizes unverified email address", async () => {
      const user: SybilUserInput = {
        username: "unverified",
        primaryEmail: "unverified@example.com",
        isEmailVerified: false,
        createdAt: "2024-01-01T00:00:00Z",
        publicRepos: 8,
        contributionsCount: 30,
        now: REF_NOW,
      };
      const req: SybilRequestInput = {
        clientIp: "198.51.100.80",
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
      };

      const result = await calculateSybilScore(user, req);

      expect(result.score).toBe(90);
      expect(result.reasons.some((r) => r.includes("unverified"))).toBe(true);
    });
  });

  // ==========================================================================
  // Layer 4: GitHub Account Age Gate (> 30 days)
  // ==========================================================================
  describe("Layer 4: GitHub Account Age Gate (> 30 days)", () => {
    it("passes mature account (> 30 days old)", async () => {
      const created60DaysAgo = new Date(REF_NOW.getTime() - 60 * 24 * 60 * 60 * 1000);
      const user: SybilUserInput = {
        username: "mature",
        primaryEmail: "mature@example.com",
        createdAt: created60DaysAgo.toISOString(),
        publicRepos: 6,
        contributionsCount: 25,
        now: REF_NOW,
      };
      const req: SybilRequestInput = {
        clientIp: "198.51.100.90",
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
      };

      const result = await calculateSybilScore(user, req);

      expect(result.details.accountAgeDays).toBeGreaterThan(30);
      expect(result.flags.youngAccount).toBe(false);
      expect(result.tier).toBe("builder");
      expect(result.score).toBe(100);
    });

    it("quarantines account <= 30 days old to probationary tier", async () => {
      const created5DaysAgo = new Date(REF_NOW.getTime() - 5 * 24 * 60 * 60 * 1000);
      const user: SybilUserInput = {
        username: "newdev",
        primaryEmail: "newdev@example.com",
        createdAt: created5DaysAgo.toISOString(),
        publicRepos: 10,
        contributionsCount: 50,
        now: REF_NOW,
      };
      const req: SybilRequestInput = {
        clientIp: "198.51.100.91",
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
      };

      const result = await calculateSybilScore(user, req);

      expect(result.details.accountAgeDays).toBeLessThanOrEqual(30);
      expect(result.flags.youngAccount).toBe(true);
      expect(result.tier).toBe("probationary");
      expect(result.score).toBe(80); // Missing 20 points from Layer 4
    });
  });

  // ==========================================================================
  // Layer 5: GitHub Activity Gate (>5 repos or >20 contributions)
  // ==========================================================================
  describe("Layer 5: GitHub Activity Gate (>5 repos or >20 contributions)", () => {
    it("passes when public repos > 5 (even with 0 contributions)", async () => {
      const user: SybilUserInput = {
        username: "repouser",
        primaryEmail: "repo@example.com",
        createdAt: "2024-01-01T00:00:00Z",
        publicRepos: 6, // > 5 repos
        contributionsCount: 0,
        now: REF_NOW,
      };
      const req: SybilRequestInput = {
        clientIp: "198.51.100.101",
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
      };

      const result = await calculateSybilScore(user, req);

      expect(result.flags.lowActivity).toBe(false);
      expect(result.tier).toBe("builder");
      expect(result.score).toBe(100);
    });

    it("passes when contributions > 20 (even with only 1 repo)", async () => {
      const user: SybilUserInput = {
        username: "contribuser",
        primaryEmail: "contrib@example.com",
        createdAt: "2024-01-01T00:00:00Z",
        publicRepos: 1,
        contributionsCount: 25, // > 20 contributions
        now: REF_NOW,
      };
      const req: SybilRequestInput = {
        clientIp: "198.51.100.102",
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
      };

      const result = await calculateSybilScore(user, req);

      expect(result.flags.lowActivity).toBe(false);
      expect(result.tier).toBe("builder");
      expect(result.score).toBe(100);
    });

    it("quarantines to probationary tier when repos <= 5 and contributions <= 20", async () => {
      const user: SybilUserInput = {
        username: "inactiveuser",
        primaryEmail: "inactive@example.com",
        createdAt: "2024-01-01T00:00:00Z",
        publicRepos: 2, // <= 5
        contributionsCount: 5, // <= 20
        now: REF_NOW,
      };
      const req: SybilRequestInput = {
        clientIp: "198.51.100.103",
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
      };

      const result = await calculateSybilScore(user, req);

      expect(result.flags.lowActivity).toBe(true);
      expect(result.tier).toBe("probationary");
      expect(result.score).toBe(80);
    });
  });

  // ==========================================================================
  // GitHub API Fetch Integration
  // ==========================================================================
  describe("GitHub API Fetch Integration", () => {
    it("fetches GitHub user profile using fetch API when details are missing", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            created_at: "2024-01-01T00:00:00Z",
            public_repos: 12,
            total_contributions: 45,
            email: "fetched@github.com",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
      globalThis.fetch = mockFetch;

      const user: SybilUserInput = {
        username: "octocat",
        now: REF_NOW,
      };
      const req: SybilRequestInput = {
        clientIp: "198.51.100.110",
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
      };

      const result = await calculateSybilScore(user, req);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/users/octocat",
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": "Key-Collective-Anti-Sybil/1.0",
          }),
        })
      );
      expect(result.details.publicRepos).toBe(12);
      expect(result.details.contributionsCount).toBe(45);
      expect(result.details.email).toBe("fetched@github.com");
      expect(result.tier).toBe("builder");
      expect(result.score).toBe(100);
    });

    it("attaches Authorization header if user.accessToken is present", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            created_at: "2023-01-01T00:00:00Z",
            public_repos: 15,
            contributions: 50,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
      globalThis.fetch = mockFetch;

      const user: SybilUserInput = {
        username: "autheduser",
        accessToken: "gho_testToken12345",
        primaryEmail: "authed@example.com",
        now: REF_NOW,
      };

      await calculateSybilScore(user);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/users/autheduser",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer gho_testToken12345",
          }),
        })
      );
    });

    it("handles fetch network failure gracefully without throwing", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network timeout"));
      globalThis.fetch = mockFetch;

      const user: SybilUserInput = {
        username: "offlineuser",
        primaryEmail: "offline@example.com",
        createdAt: "2024-01-01T00:00:00Z",
        publicRepos: 8,
        contributionsCount: 30,
        now: REF_NOW,
      };

      const result = await calculateSybilScore(user);

      expect(result.passed).toBe(true);
      expect(result.tier).toBe("builder");
    });
  });

  // ==========================================================================
  // Contract Conformity & Type Coercion
  // ==========================================================================
  describe("Contract Conformity & Coercion", () => {
    it("conforms to SybilScore contract and supports numeric coercion via valueOf", async () => {
      const user: SybilUserInput = {
        username: "coerciondev",
        primaryEmail: "coercion@example.com",
        createdAt: "2024-01-01T00:00:00Z",
        publicRepos: 8,
        contributionsCount: 30,
        now: REF_NOW,
      };
      const req: SybilRequestInput = {
        clientIp: "198.51.100.120",
        turnstileToken: TURNSTILE_TEST_TOKENS.ALWAYS_PASS,
      };

      const result = await calculateSybilScore(user, req);

      // Properties conformity
      expect(typeof result.score).toBe("number");
      expect(typeof result.passed).toBe("boolean");
      expect(typeof result.tier).toBe("string");
      expect(typeof result.riskLevel).toBe("string");
      expect(Array.isArray(result.reasons)).toBe(true);
      expect(typeof result.flags).toBe("object");
      expect(typeof result.details).toBe("object");

      // Coercion test
      expect(result.valueOf()).toBe(100);
      expect(+result).toBe(100);
      expect(Number(result) > 65).toBe(true);
      expect(String(result)).toBe("100");
    });
  });
});
