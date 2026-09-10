/**
 * Key Collective v3 — Multi-Project, Anti-Sybil & Tiered Developer Platform
 * Data Contracts & Domain Primitives
 *
 * Invariants Enforced (GEMINI.md Constitution):
 * 1. Zero Plaintext Keys: Upstream keys encrypted via AES-256-GCM with 12-byte CSPRNG nonces.
 * 2. Per-Tenant Compute Isolation: User root accounts isolated via Durable Objects (`idFromName(tenantId)`).
 * 3. Fixed-Point Microdollars: All financial tracking in int64/bigint microdollars (1 USD = 1,000,000 µ$).
 * 4. Strict TypeScript: No `any`, strict null checks, full runtime assertion guards.
 */

/**
 * Platform Authorization & Quota Tiers.
 */
export type UserTier =
  | 'admin'        // 👑 Root Owner: Unlimited RPM/RPD, full administrative access
  | 'ultra'        // ⚡ Ultra Developer: Unlimited RPM/RPD, no platform admin privileges
  | 'max'          // 🚀 Power Developer: 60 RPM, 10,000 RPD, max 10 projects
  | 'builder'      // 🛠️ Standard Developer: 20 RPM, 2,000 RPD, max 3 projects
  | 'probationary'  // ⏳ Sandboxed New Account: 2 RPM, 50 RPD, 1 project
  | 'demo'         // 🎭 Ephemeral Playground: 20 RPM shared pool, 3 RPM / IP, 25 RPD / IP
  | 'suspended';   // 🚫 Revoked Account: 0 RPM, immediate 403

/**
 * Tier Quota Configuration Limits.
 */
export interface TierLimits {
  readonly tier: UserTier;
  readonly rpmLimit: number;
  readonly rpdLimit: number;
  readonly maxProjects: number;
  readonly allowCustomSubCaps: boolean;
  readonly priorityWeight: number; // 0 (highest) to 5 (lowest)
}

export const TIER_LIMITS_MAP: Readonly<Record<UserTier, TierLimits>> = {
  admin: {
    tier: 'admin',
    rpmLimit: Infinity,
    rpdLimit: Infinity,
    maxProjects: Infinity,
    allowCustomSubCaps: true,
    priorityWeight: 0,
  },
  ultra: {
    tier: 'ultra',
    rpmLimit: Infinity,
    rpdLimit: Infinity,
    maxProjects: 25,
    allowCustomSubCaps: true,
    priorityWeight: 1,
  },
  max: {
    tier: 'max',
    rpmLimit: 60,
    rpdLimit: 10000,
    maxProjects: 10,
    allowCustomSubCaps: true,
    priorityWeight: 2,
  },
  builder: {
    tier: 'builder',
    rpmLimit: 20,
    rpdLimit: 2000,
    maxProjects: 3,
    allowCustomSubCaps: true,
    priorityWeight: 3,
  },
  probationary: {
    tier: 'probationary',
    rpmLimit: 2,
    rpdLimit: 50,
    maxProjects: 1,
    allowCustomSubCaps: false,
    priorityWeight: 4,
  },
  demo: {
    tier: 'demo',
    rpmLimit: 20, // Shared global pool ceiling
    rpdLimit: 2000,
    maxProjects: 0,
    allowCustomSubCaps: false,
    priorityWeight: 5,
  },
  suspended: {
    tier: 'suspended',
    rpmLimit: 0,
    rpdLimit: 0,
    maxProjects: 0,
    allowCustomSubCaps: false,
    priorityWeight: 99,
  },
};

/**
 * Root User Account entity stored in D1.
 */
export interface UserAccount {
  readonly id: string; // e.g., "usr_gh_12948174"
  readonly githubId: number;
  readonly githubUsername: string;
  readonly primaryEmail: string;
  readonly tier: UserTier;
  readonly avatarUrl: string;
  readonly isEmailVerified: boolean;
  readonly githubCreatedAt: string;
  readonly sybilScore: number; // 0 to 100
  readonly registrationIp: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Anti-Sybil Verification Assessment.
 */
export interface AntiSybilAssessment {
  readonly passed: boolean;
  readonly score: number; // 0 to 100
  readonly tier: UserTier;
  readonly checks: {
    turnstileValid: boolean;
    emailNonDisposable: boolean;
    accountAgeDays: number;
    publicRepos: number;
    contributionsCount: number;
    subnetRegistrationCount: number;
  };
  readonly auditReasons: string[];
}

/**
 * Project registered by an authorized user.
 */
export interface Project {
  readonly id: string; // e.g., "proj_rag_app_89f"
  readonly tenantId: string; // Foreign key to UserAccount.id
  readonly name: string;
  readonly slug: string;
  readonly description?: string;
  readonly maxRpmSubCap?: number | null; // Optional sub-limit (<= user root RPM)
  readonly isArchived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Project-Scoped API Key issued to a project.
 */
export interface ProjectKey {
  readonly id: string; // e.g., "key_cln_19a8f"
  readonly projectId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly tokenPrefix: string; // e.g., "kc_proj_8Yk2" (first 12 chars for display)
  readonly tokenHashSha256: string; // SHA-256 hash for constant-time edge verification
  readonly isRevoked: boolean;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

/**
 * Ephemeral Demo Playground Session.
 */
export interface DemoSession {
  readonly token: string; // e.g., "kc_demo_1741604400_a8f9"
  readonly clientIp: string;
  readonly expiresAt: number; // Timestamp in ms
  readonly requestsToday: number;
  readonly requestsThisMinute: number;
}

/**
 * OAuth Provider Configuration for PKCE & Provider Integration.
 */
export interface OAuthProviderConfig {
  readonly provider?: "github" | "google" | string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly tokenEndpoint: string;
  readonly authorizeEndpoint?: string;
  readonly userInfoEndpoint?: string;
  readonly redirectUri?: string;
  readonly codeVerifier?: string;
  readonly scopes?: readonly string[];
}

/**
 * Normalized OAuth User Profile returned by identity providers.
 */
export interface OAuthUserProfile {
  readonly id: string;
  readonly email: string;
  readonly username: string;
  readonly name?: string;
  readonly avatarUrl?: string;
}

/**
 * Raw OAuth Token Response from identity providers.
 */
export interface OAuthTokenResponse {
  readonly access_token: string;
  readonly token_type?: string;
  readonly scope?: string;
  readonly expires_in?: number;
  readonly refresh_token?: string;
  readonly id_token?: string;
  readonly error?: string;
  readonly error_description?: string;
}

/**
 * JWT Payload for authenticated sessions.
 */
export interface JWTPayload {
  readonly sub: string;        // Subject (user/tenant identifier)
  readonly tenantId: string;
  readonly email?: string;
  readonly username?: string;
  readonly tier?: UserTier;
  readonly iat?: number;        // Issued at (seconds)
  readonly exp?: number;        // Expiration (seconds)
  readonly iss?: string;        // Issuer
  readonly customClaims?: Record<string, unknown>;
}

/**
 * Sybil Score risk evaluation structure.
 */
export interface SybilScore {
  readonly score: number; // 0 (safest) to 100 (highest risk)
  readonly passed: boolean;
  readonly tier: UserTier;
  readonly riskLevel: "low" | "medium" | "high" | "critical";
  readonly reasons: readonly string[];
  readonly flags?: {
    readonly isVpnOrProxy?: boolean;
    readonly isTor?: boolean;
    readonly isDisposableEmail?: boolean;
    readonly rateLimitExceeded?: boolean;
    readonly abnormalHeaders?: boolean;
    readonly failedOpen?: boolean;
    readonly [key: string]: boolean | undefined;
  };
  readonly failedOpen?: boolean;
  readonly ip?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Demo Session DO storage schema.
 */
export interface DemoSessionState {
  readonly clientIp: string;
  readonly sessionToken: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly minuteWindowTimestamp: number;
  readonly requestsInCurrentMinute: number;
  readonly dayWindowTimestamp: number;
  readonly requestsInCurrentDay: number;
}
