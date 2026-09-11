/**
 * Key Collective v3.5 Data Contracts
 * Two-Phase Authentication, Hidden Tiers, Subdomain Dispatch & Admin Surveillance
 */

// 1. Fixed-Point Financial Units (Invariants)
export type Microdollars = number; // int64 microdollars: 1 USD = 1,000,000 µ$
export type Milliseconds = number;

// 2. Subdomain Host Routing Contracts
export type EdgeSubdomain = 'api' | 'console' | 'admin' | 'apex';

export interface HostRouteDecision {
  readonly host: string;
  readonly subdomain: EdgeSubdomain;
  readonly requiresAdminAuth: boolean;
  readonly isApiGateway: boolean;
  readonly isConsoleSpa: boolean;
}

// 3. User Governance Tiers
export type PublicTier = 'probationary' | 'builder' | 'max';
export type InternalTier = 'ultra' | 'admin';
export type UserTier = PublicTier | InternalTier;

export interface TierCapabilities {
  readonly tier: UserTier;
  readonly rpmLimit: number;
  readonly rpdLimit: number;
  readonly maxProjects: number;
  readonly allowedModels: readonly string[];
  readonly isHiddenFromPublic: boolean;
  readonly canAssignRoles: boolean;
}

// 4. Two-Phase Identity Context
export interface UserIdentity {
  readonly id: string;
  readonly email: string;
  readonly authProvider: 'email' | 'google' | 'github';
  readonly isGithubVerified: boolean;
  readonly githubUserId?: number;
  readonly githubUsername?: string;
  readonly sybilTrustScore: number; // 0 - 100
  readonly tier: UserTier;
  readonly isQuarantined: boolean;
  readonly quarantineReason?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

// 5. Public Profile Scrubbed of Hidden Tiers
export interface PublicUserProfile {
  readonly id: string;
  readonly email: string;
  readonly username?: string;
  readonly tier: PublicTier; // Never leaks 'ultra' or 'admin' to clients
  readonly isGithubVerified: boolean;
  readonly sybilTrustScore: number;
  readonly quota: {
    readonly rpmLimit: number;
    readonly rpdLimit: number;
    readonly currentRpm: number;
    readonly currentRpd: number;
  };
}

// 6. Anti-Sybil 5-Layer Proof Results
export interface SybilProofResult {
  readonly layer1AccountAgeDays: number;
  readonly layer1Passed: boolean;
  readonly layer2CommitCountAnnual: number;
  readonly layer2Passed: boolean;
  readonly layer3TurnstileNonceValid: boolean;
  readonly layer3Passed: boolean;
  readonly layer4EmailDomainClean: boolean;
  readonly layer4Passed: boolean;
  readonly layer5SubnetVelocityClean: boolean;
  readonly layer5Passed: boolean;
  readonly compositeTrustScore: number; // 0 - 100
  readonly isEligibleForBuilderPromotion: boolean;
}

// 7. Admin Surveillance & Mutation Contracts
export interface TenantSurveillanceRow {
  readonly tenantId: string;
  readonly email: string;
  readonly authProvider: string;
  readonly tier: UserTier;
  readonly currentRpm: number;
  readonly rpmLimit: number;
  readonly todaySpendMicrodollars: Microdollars;
  readonly activeKeyCount: number;
  readonly isQuarantined: boolean;
  readonly lastActiveTimestamp: Milliseconds;
}

export interface AdminActionPayload {
  readonly adminEmail: string;
  readonly targetTenantId: string;
  readonly action: 'UPDATE_TIER' | 'QUARANTINE' | 'UNQUARANTINE' | 'RESET_QUOTA';
  readonly newTier?: UserTier;
  readonly reason: string;
}

export interface ProviderCircuitOverridePayload {
  readonly adminEmail: string;
  readonly provider: 'gemini' | 'groq' | 'cerebras' | 'deepseek' | 'all';
  readonly state: 'TRIPPED' | 'NORMAL';
  readonly reason: string;
}
