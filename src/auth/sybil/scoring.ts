/**
 * Key Collective v3 — Unified calculateSybilScore Function (AUTH-02)
 *
 * Conforms to:
 * - docs/architecture/lld_pod-auth-sybil.md (Section 4.2: Sybil Defense)
 * - docs/golden_tests/v3_cases.yaml (tc-v3-01 & tc-v3-02)
 */

import type { UserTier } from "../../contracts/v3_types";
import {
  MAX_REGISTRATIONS_PER_SUBNET,
  SUBNET_VELOCITY_WINDOW_MS,
  SYBIL_MIN_ACCOUNT_AGE_DAYS,
  SYBIL_MIN_ACTIVITY_CONTRIBUTIONS,
  SYBIL_MIN_ACTIVITY_REPOS,
  SYBIL_SCORE_BUILDER_THRESHOLD,
  SYBIL_SCORE_PROBATIONARY_THRESHOLD,
} from "./constants";
import type {
  CfPropertiesLike,
  SybilRequestInput,
  SybilScoreResult,
  SybilUserInput,
} from "./types";
import {
  extractSubnet,
  globalSubnetTracker,
  isDatacenterAsn,
  isDisposableEmail,
} from "./utils";
import { verifyTurnstileToken } from "./turnstile";

function extractHeaderValue(
  req: Request | SybilRequestInput | undefined,
  name: string
): string | undefined {
  if (!req || !req.headers) return undefined;
  const headers = req.headers;
  if ("get" in headers && typeof headers.get === "function") {
    const val = headers.get(name);
    return val !== null && val !== undefined ? val : undefined;
  }
  if (typeof headers === "object") {
    const rec = headers as Record<string, string | undefined>;
    return rec[name.toLowerCase()] ?? rec[name];
  }
  return undefined;
}

function extractCfProperties(
  req: Request | SybilRequestInput | undefined
): CfPropertiesLike | undefined {
  if (!req || !("cf" in req) || !req.cf) return undefined;
  return req.cf as CfPropertiesLike;
}

/**
 * Calculates a comprehensive 5-layer Sybil assessment for developer ingress.
 * Checks:
 * 1. Cloudflare Turnstile bot verification & bot management score.
 * 2. IP / Subnet velocity (/24 IPv4 30-day limit) & Datacenter ASN.
 * 3. Disposable email domain denylist & email verification.
 * 4. GitHub account age (> 30 days).
 * 5. GitHub activity (> 5 public repos OR > 20 contributions).
 *
 * Employs `fetch` for upstream GitHub API user profile inspection.
 *
 * @param user User profile or registration payload
 * @param req Ingress HTTP request or mock request object
 * @returns SybilScoreResult implementing SybilScore contract with valueOf numeric coercion
 */
export async function calculateSybilScore(
  user: SybilUserInput,
  req?: Request | SybilRequestInput
): Promise<SybilScoreResult> {
  const auditReasons: string[] = [];

  // Parse reference timestamp
  const nowMs =
    user.now instanceof Date
      ? user.now.getTime()
      : typeof user.now === "number"
      ? user.now
      : Date.now();

  // --------------------------------------------------------------------------
  // Resolve Client IP & Subnet
  // --------------------------------------------------------------------------
  let clientIp =
    extractHeaderValue(req, "cf-connecting-ip") ??
    extractHeaderValue(req, "x-real-ip") ??
    extractHeaderValue(req, "x-forwarded-for")?.split(",")[0]?.trim();

  if (!clientIp && req) {
    if ("clientIp" in req && typeof req.clientIp === "string") {
      clientIp = req.clientIp;
    } else if ("ip" in req && typeof req.ip === "string") {
      clientIp = req.ip;
    }
  }

  if (!clientIp) {
    clientIp = user.registrationIp || "127.0.0.1";
  }

  const subnet = extractSubnet(clientIp);

  // --------------------------------------------------------------------------
  // GitHub API Fetch: Populate maturity and activity profile if needed
  // --------------------------------------------------------------------------
  let resolvedCreatedAt = user.createdAt ?? user.created_at ?? user.githubCreatedAt;
  let resolvedPublicRepos = user.publicRepos ?? user.public_repos;
  let resolvedContributions =
    user.contributionsCount ??
    user.totalContributions ??
    user.total_contributions ??
    user.contributions;
  let resolvedEmail = user.email ?? user.primaryEmail ?? user.primary_email;

  const ghUsername = user.username ?? user.login ?? user.githubUsername;
  const ghToken = user.accessToken ?? user.access_token ?? user.token;

  if (ghUsername || ghToken) {
    try {
      const url = ghUsername
        ? `https://api.github.com/users/${encodeURIComponent(ghUsername)}`
        : "https://api.github.com/user";

      const fetchHeaders: Record<string, string> = {
        "User-Agent": "Key-Collective-Anti-Sybil/1.0",
        Accept: "application/vnd.github.v3+json",
      };
      if (ghToken) {
        fetchHeaders["Authorization"] = `Bearer ${ghToken}`;
      }

      const fetchImpl = typeof fetch !== "undefined" ? fetch : undefined;
      if (fetchImpl) {
        const ghRes = await fetchImpl(url, { headers: fetchHeaders });
        if (ghRes.ok) {
          const ghData = (await ghRes.json()) as {
            created_at?: string;
            public_repos?: number;
            email?: string | null;
            total_contributions?: number;
            contributions?: number;
            contributions_count?: number;
          };

          if (ghData.created_at && !resolvedCreatedAt) {
            resolvedCreatedAt = ghData.created_at;
          }
          if (typeof ghData.public_repos === "number" && resolvedPublicRepos === undefined) {
            resolvedPublicRepos = ghData.public_repos;
          }
          if (ghData.email && !resolvedEmail) {
            resolvedEmail = ghData.email;
          }
          if (resolvedContributions === undefined) {
            if (typeof ghData.total_contributions === "number") {
              resolvedContributions = ghData.total_contributions;
            } else if (typeof ghData.contributions === "number") {
              resolvedContributions = ghData.contributions;
            } else if (typeof ghData.contributions_count === "number") {
              resolvedContributions = ghData.contributions_count;
            }
          }
        }
      }
    } catch (_err) {
      // Network or mock failure handled gracefully; fall back to provided fields
    }
  }

  // --------------------------------------------------------------------------
  // Layer 1: Cloudflare Turnstile Bot Score & Verification
  // --------------------------------------------------------------------------
  const turnstileToken =
    extractHeaderValue(req, "cf-turnstile-response") ??
    extractHeaderValue(req, "cf-turnstile-token") ??
    extractHeaderValue(req, "x-turnstile-token") ??
    extractHeaderValue(req, "turnstile-token") ??
    (req && "turnstileToken" in req ? req.turnstileToken : undefined) ??
    (req && "turnstile_token" in req ? req.turnstile_token : undefined) ??
    user.turnstileToken ??
    user.turnstile_token;

  const cfProps = extractCfProperties(req);
  let botScore: number | undefined = undefined;
  if (cfProps?.botManagement && typeof cfProps.botManagement.score === "number") {
    botScore = cfProps.botManagement.score;
  } else {
    const botScoreHeader =
      extractHeaderValue(req, "cf-bot-score") ?? extractHeaderValue(req, "x-bot-score");
    if (botScoreHeader !== undefined) {
      const parsed = Number(botScoreHeader);
      if (!Number.isNaN(parsed)) {
        botScore = parsed;
      }
    }
  }

  let turnstileValid = true;
  if (botScore !== undefined && botScore < 30) {
    turnstileValid = false;
    auditReasons.push(`Cloudflare Turnstile bot score too low: ${botScore} (bot detected)`);
  } else if (turnstileToken !== undefined && turnstileToken.trim() !== "") {
    const turnstileResult = await verifyTurnstileToken(turnstileToken, {
      remoteIp: clientIp,
      fetchFn: typeof fetch !== "undefined" ? fetch : undefined,
    });
    turnstileValid = turnstileResult.success;
    if (!turnstileValid) {
      auditReasons.push(
        `Turnstile bot verification failed: ${
          turnstileResult.errorCodes?.join(", ") ?? "invalid response"
        }`
      );
    }
  }

  // --------------------------------------------------------------------------
  // Layer 2: Network Ingress & IP Velocity (/24 Subnet 30-Day Window)
  // --------------------------------------------------------------------------
  const tracker = globalSubnetTracker;
  const subnetRegistrationCount = await tracker.getSubnetRegistrationCount(
    subnet,
    SUBNET_VELOCITY_WINDOW_MS,
    nowMs
  );
  const isSubnetExceeded = subnetRegistrationCount >= MAX_REGISTRATIONS_PER_SUBNET;
  if (isSubnetExceeded) {
    auditReasons.push(
      `IP velocity limit exceeded: ${subnetRegistrationCount} active registrations in ${subnet} within 30 days`
    );
  }

  let asn: number | string | undefined = undefined;
  if (cfProps && cfProps.asn !== null && cfProps.asn !== undefined) {
    asn = cfProps.asn;
  } else {
    asn = extractHeaderValue(req, "cf-ray-asn");
  }
  const isDatacenter = isDatacenterAsn(asn);
  if (isDatacenter) {
    auditReasons.push(`Datacenter ASN (${asn}) detected: elevated proxy risk`);
  }

  const isTor = Boolean(
    (cfProps && cfProps.isTor) ||
    (cfProps && cfProps.country === "T1")
  );
  if (isTor) {
    auditReasons.push("Tor exit node detected: anonymous proxy egress");
  }

  // --------------------------------------------------------------------------
  // Layer 3: Disposable Email Domain Blocklist
  // --------------------------------------------------------------------------
  const email = (resolvedEmail || "").trim();
  const isDisposable = isDisposableEmail(email);
  if (isDisposable) {
    auditReasons.push(`Disposable email domain rejected: ${email}`);
  }

  const isEmailVerified = user.isEmailVerified ?? user.is_email_verified ?? true;
  if (!isEmailVerified) {
    auditReasons.push("Primary email is unverified");
  }

  // --------------------------------------------------------------------------
  // Layer 4: GitHub Account Age Gate (> 30 days)
  // --------------------------------------------------------------------------
  let createdAtMs = 0;
  if (resolvedCreatedAt instanceof Date) {
    createdAtMs = resolvedCreatedAt.getTime();
  } else if (typeof resolvedCreatedAt === "number") {
    createdAtMs = resolvedCreatedAt;
  } else if (typeof resolvedCreatedAt === "string") {
    const parsed = Date.parse(resolvedCreatedAt);
    createdAtMs = Number.isNaN(parsed) ? nowMs : parsed;
  } else {
    createdAtMs = nowMs;
  }

  const accountAgeDays = Math.max(
    0,
    Math.floor((nowMs - createdAtMs) / (24 * 60 * 60 * 1000))
  );
  const isMatureAge = accountAgeDays > SYBIL_MIN_ACCOUNT_AGE_DAYS;
  if (!isMatureAge) {
    auditReasons.push(
      `GitHub account age (${accountAgeDays}d) is not > ${SYBIL_MIN_ACCOUNT_AGE_DAYS} days`
    );
  }

  // --------------------------------------------------------------------------
  // Layer 5: GitHub Activity Gate (> 5 repos OR > 20 contributions)
  // --------------------------------------------------------------------------
  const publicRepos = Math.max(0, resolvedPublicRepos ?? 0);
  const contributionsCount = Math.max(0, resolvedContributions ?? 0);
  const hasActivity =
    publicRepos > SYBIL_MIN_ACTIVITY_REPOS ||
    contributionsCount > SYBIL_MIN_ACTIVITY_CONTRIBUTIONS;
  if (!hasActivity) {
    auditReasons.push(
      `GitHub activity insufficient: ${publicRepos} public repos (requires >${SYBIL_MIN_ACTIVITY_REPOS}) and ${contributionsCount} contributions (requires >${SYBIL_MIN_ACTIVITY_CONTRIBUTIONS})`
    );
  }

  // --------------------------------------------------------------------------
  // Scoring Synthesis & Tier Mapping
  // --------------------------------------------------------------------------
  let score = 0;

  if (turnstileValid) {
    score += 20;
  }
  if (!isSubnetExceeded) {
    score += 20;
  }
  if (isDatacenter) {
    score -= 10;
  }
  if (isTor) {
    score -= 10;
  }
  if (!isDisposable) {
    score += 20;
  }
  if (!isEmailVerified) {
    score -= 10;
  }
  if (isMatureAge) {
    score += 20;
  }
  if (hasActivity) {
    score += 20;
  }

  // Hard gating floors / penalties
  if (!turnstileValid) {
    score = 0;
  } else if (isDisposable) {
    score = Math.min(score, 20);
  }

  score = Math.max(0, Math.min(100, score));

  // Determine Tier & Passed
  let tier: UserTier = "suspended";
  let passed = false;

  if (!turnstileValid || isDisposable || score < SYBIL_SCORE_PROBATIONARY_THRESHOLD) {
    tier = "suspended";
    passed = false;
  } else if (
    score >= SYBIL_SCORE_BUILDER_THRESHOLD &&
    isMatureAge &&
    hasActivity &&
    !isSubnetExceeded
  ) {
    tier = "builder";
    passed = true;
  } else {
    tier = "probationary";
    passed = true;
  }

  if (passed && !isSubnetExceeded) {
    await tracker.recordRegistration(subnet, nowMs);
  }

  let riskLevel: "low" | "medium" | "high" | "critical" = "low";
  if (score >= 80) {
    riskLevel = "low";
  } else if (score >= 60) {
    riskLevel = "medium";
  } else if (score >= 40) {
    riskLevel = "high";
  } else {
    riskLevel = "critical";
  }

  const resultObj: SybilScoreResult = {
    score,
    passed,
    tier,
    riskLevel,
    reasons: auditReasons,
    flags: {
      isVpnOrProxy: isDatacenter,
      isTor,
      isDisposableEmail: isDisposable,
      rateLimitExceeded: isSubnetExceeded,
      turnstileFailed: !turnstileValid,
      ipVelocityExceeded: isSubnetExceeded,
      disposableEmail: isDisposable,
      youngAccount: !isMatureAge,
      lowActivity: !hasActivity,
    },
    ip: clientIp,
    details: {
      turnstileValid,
      turnstileScore: botScore,
      subnetRegistrationCount,
      accountAgeDays,
      publicRepos,
      contributionsCount,
      email,
      ip: clientIp,
      assessmentScore: score,
    },
    valueOf(): number {
      return score;
    },
    [Symbol.toPrimitive](hint: string): number | string {
      if (hint === "string") return String(score);
      return score;
    },
  };

  return resultObj;
}
