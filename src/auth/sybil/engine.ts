/**
 * Key Collective v3 — 5-Layer Anti-Sybil Assessment Engine
 *
 * Conforms to:
 * - docs/research/v3_landscape.md (Section 2: Anti-Sybil Defense)
 * - docs/architecture/lld_pod-auth-sybil.md (Section 4.2: Sybil Defense)
 * - src/contracts/v3_types.ts (AntiSybilAssessment, SybilScore, UserTier)
 */

import type { AntiSybilAssessment, SybilScore, UserTier } from "../../contracts/v3_types";
import {
  BUILDER_MIN_ACCOUNT_AGE_DAYS,
  BUILDER_MIN_CONTRIBUTIONS,
  BUILDER_MIN_PUBLIC_REPOS,
  MAX_REGISTRATIONS_PER_SUBNET,
  SUBNET_VELOCITY_WINDOW_MS,
  SYBIL_SCORE_BUILDER_THRESHOLD,
  SYBIL_SCORE_PROBATIONARY_THRESHOLD,
} from "./constants";
import {
  AntiSybilInput,
  EvaluateAntiSybilOptions,
} from "./types";
import {
  extractSubnet,
  globalSubnetTracker,
  isDatacenterAsn,
  isDisposableEmail,
} from "./utils";
import { verifyTurnstileToken } from "./turnstile";

/**
 * Evaluates an ingress registration request across all 5 Anti-Sybil layers.
 * Returns an AntiSybilAssessment conforming to v3 Data Contracts.
 */
export async function evaluateAntiSybil(
  input: AntiSybilInput,
  options: EvaluateAntiSybilOptions = {}
): Promise<AntiSybilAssessment> {
  const auditReasons: string[] = [];

  // Parse time
  const nowMs =
    input.now instanceof Date
      ? input.now.getTime()
      : typeof input.now === "number"
      ? input.now
      : Date.now();

  const tracker = options.subnetTracker ?? globalSubnetTracker;
  const clientIp = input.clientIp || input.client_ip || "0.0.0.0";
  const token = input.turnstileToken || input.turnstile_token;

  // --------------------------------------------------------------------------
  // Layer 1: Edge Bot Barrier (Cloudflare Turnstile)
  // --------------------------------------------------------------------------
  const turnstileResult = await verifyTurnstileToken(token, {
    secretKey: options.turnstileSecret,
    remoteIp: clientIp,
    fetchFn: options.fetchFn,
  });

  const turnstileValid = turnstileResult.success;
  if (!turnstileValid) {
    auditReasons.push(
      `Turnstile challenge verification failed: ${
        turnstileResult.errorCodes?.join(", ") ?? "invalid response"
      }`
    );
  }

  // --------------------------------------------------------------------------
  // Layer 2: Network Ingress (Subnet Velocity & ASN Reputation)
  // --------------------------------------------------------------------------
  const subnet = extractSubnet(clientIp);
  const subnetRegistrationCount = await tracker.getSubnetRegistrationCount(
    subnet,
    SUBNET_VELOCITY_WINDOW_MS,
    nowMs
  );

  const isSubnetExceeded = subnetRegistrationCount >= MAX_REGISTRATIONS_PER_SUBNET;
  if (isSubnetExceeded) {
    auditReasons.push(
      `Subnet velocity limit exceeded: ${subnetRegistrationCount} active registrations in ${subnet} within 30 days`
    );
  }

  const isDatacenter = isDatacenterAsn(input.asn);
  if (isDatacenter) {
    auditReasons.push(`Datacenter ASN (${input.asn}) detected: elevated proxy risk`);
  }

  const isTor = Boolean(input.isTor || input.country === "T1");
  if (isTor) {
    auditReasons.push("Tor exit node detected: anonymous proxy egress");
  }

  // --------------------------------------------------------------------------
  // Layer 3: Email Verification (Disposable Domain Blocklist)
  // --------------------------------------------------------------------------
  const email = (input.githubProfile.primaryEmail || input.githubProfile.primary_email || "").trim();
  const isDisposable = isDisposableEmail(email);
  const emailNonDisposable = !isDisposable;

  if (isDisposable) {
    auditReasons.push(`Disposable email domain rejected: ${email}`);
  }

  const isEmailVerified = Boolean(
    input.githubProfile.isEmailVerified ?? input.githubProfile.is_email_verified
  );
  if (!isEmailVerified) {
    auditReasons.push("Primary GitHub email address is unverified");
  }

  // --------------------------------------------------------------------------
  // Layer 4: GitHub Account Maturity Gate
  // --------------------------------------------------------------------------
  const rawCreatedAt = input.githubProfile.createdAt ?? input.githubProfile.created_at;
  let createdAtMs = 0;
  if (rawCreatedAt instanceof Date) {
    createdAtMs = rawCreatedAt.getTime();
  } else if (typeof rawCreatedAt === "number") {
    createdAtMs = rawCreatedAt;
  } else if (typeof rawCreatedAt === "string") {
    const parsed = Date.parse(rawCreatedAt);
    createdAtMs = Number.isNaN(parsed) ? nowMs : parsed;
  } else {
    createdAtMs = nowMs;
  }

  const accountAgeDays = Math.max(0, Math.floor((nowMs - createdAtMs) / (24 * 60 * 60 * 1000)));
  const publicRepos = Math.max(
    0,
    input.githubProfile.publicRepos ?? input.githubProfile.public_repos ?? 0
  );
  const contributionsCount = Math.max(
    0,
    input.githubProfile.contributionsCount ??
    input.githubProfile.totalContributions ??
    input.githubProfile.total_contributions ??
    0
  );

  const isMatureAge = accountAgeDays >= BUILDER_MIN_ACCOUNT_AGE_DAYS;
  const hasMinRepos = publicRepos >= BUILDER_MIN_PUBLIC_REPOS;
  const hasMinContributions = contributionsCount >= BUILDER_MIN_CONTRIBUTIONS;

  if (!isMatureAge) {
    auditReasons.push(
      `GitHub account age (${accountAgeDays}d) is less than required ${BUILDER_MIN_ACCOUNT_AGE_DAYS} days`
    );
  }
  if (!hasMinRepos) {
    auditReasons.push(
      `GitHub public repos (${publicRepos}) is less than required ${BUILDER_MIN_PUBLIC_REPOS} (0 public repositories)`
    );
  }
  if (!hasMinContributions) {
    auditReasons.push(
      `GitHub contributions count (${contributionsCount}) is less than required ${BUILDER_MIN_CONTRIBUTIONS}`
    );
  }

  // --------------------------------------------------------------------------
  // Scoring & Layer 5: Triage & Probationary Fallback
  // --------------------------------------------------------------------------
  let score = 100;

  // Layer 1 Penalties
  if (!turnstileValid) {
    score = 0;
  } else {
    // Layer 2 Penalties
    if (isSubnetExceeded) {
      score -= 45;
    }
    if (isDatacenter) {
      score -= 25;
    }
    if (isTor) {
      score -= 30;
    }

    // Layer 3 Penalties
    if (isDisposable) {
      score = Math.min(score, 20); // Hard floor below probationary threshold (<40)
    }
    if (!isEmailVerified) {
      score -= 25;
    }

    // Layer 4 Penalties
    if (!isMatureAge) {
      score -= 20;
    }
    if (!hasMinRepos) {
      score -= 15;
    }
    if (!hasMinContributions) {
      score -= 10;
    }
  }

  // Clamp score strictly between 0 and 100
  score = Math.max(0, Math.min(100, score));

  // Determine Tier & Pass/Fail status
  let tier: UserTier = "suspended";
  let passed = false;

  if (!turnstileValid || isDisposable || score < SYBIL_SCORE_PROBATIONARY_THRESHOLD) {
    // Hard Rejection: Disposable identity or automated bot
    tier = "suspended";
    passed = false;
  } else if (
    score >= SYBIL_SCORE_BUILDER_THRESHOLD &&
    isMatureAge &&
    hasMinRepos &&
    hasMinContributions &&
    !isSubnetExceeded
  ) {
    // Full Pass: Authentic developer receives Builder Tier
    tier = "builder";
    passed = true;
  } else {
    // Layer 5 Fallback: Junior developer / Young account quarantined to Probationary Tier
    tier = "probationary";
    passed = true;
  }

  // If passed and option recordOnPass is true (or default true), record the subnet registration
  const shouldRecord = options.recordOnPass ?? true;
  if (passed && shouldRecord) {
    await tracker.recordRegistration(subnet, nowMs);
  }

  return {
    passed,
    score,
    tier,
    checks: {
      turnstileValid,
      emailNonDisposable,
      accountAgeDays,
      publicRepos,
      contributionsCount,
      subnetRegistrationCount,
    },
    auditReasons,
  };
}

/**
 * Converts an AntiSybilAssessment into a SybilScore object conforming to v3_types.
 */
export function toSybilScore(assessment: AntiSybilAssessment, input: AntiSybilInput): SybilScore {
  let riskLevel: "low" | "medium" | "high" | "critical" = "low";

  if (assessment.score >= 80) {
    riskLevel = "low";
  } else if (assessment.score >= 60) {
    riskLevel = "medium";
  } else if (assessment.score >= 40) {
    riskLevel = "high";
  } else {
    riskLevel = "critical";
  }

  const clientIp = input.clientIp || input.client_ip || "0.0.0.0";

  return {
    score: 100 - assessment.score, // Risk score (0 = safest, 100 = highest risk)
    passed: assessment.passed,
    tier: assessment.tier,
    riskLevel,
    reasons: assessment.auditReasons,
    flags: {
      isVpnOrProxy: isDatacenterAsn(input.asn),
      isTor: Boolean(input.isTor || input.country === "T1"),
      isDisposableEmail: !assessment.checks.emailNonDisposable,
      rateLimitExceeded: assessment.checks.subnetRegistrationCount >= MAX_REGISTRATIONS_PER_SUBNET,
    },
    ip: clientIp,
    details: {
      accountAgeDays: assessment.checks.accountAgeDays,
      publicRepos: assessment.checks.publicRepos,
      contributionsCount: assessment.checks.contributionsCount,
      turnstileValid: assessment.checks.turnstileValid,
      assessmentScore: assessment.score,
    },
  };
}
