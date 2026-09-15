/**
 * Key Collective v3 — Anti-Sybil Types & Contracts
 *
 * Conforms to:
 * - src/contracts/v3_types.ts (AntiSybilAssessment, SybilScore, UserTier)
 */

import type { AntiSybilAssessment, SybilScore, UserTier } from "../../contracts/v3_types";

export interface GitHubMaturityProfile {
  readonly id?: number | string;
  readonly username?: string;
  readonly primaryEmail?: string;
  readonly primary_email?: string;
  readonly isEmailVerified?: boolean;
  readonly is_email_verified?: boolean;
  readonly createdAt?: string | Date | number;
  readonly created_at?: string | Date | number;
  readonly publicRepos?: number;
  readonly public_repos?: number;
  readonly contributionsCount?: number;
  readonly totalContributions?: number;
  readonly total_contributions?: number;
}

export interface AntiSybilInput {
  readonly turnstileToken?: string;
  readonly turnstile_token?: string;
  readonly clientIp: string;
  readonly client_ip?: string;
  readonly asn?: number | string;
  readonly country?: string;
  readonly isTor?: boolean;
  readonly githubProfile: GitHubMaturityProfile;
  readonly now?: number | Date; // Time injection for deterministic evaluation
}

export interface TurnstileVerificationResult {
  readonly success: boolean;
  readonly errorCodes?: readonly string[];
  readonly challengeTs?: string;
  readonly hostname?: string;
}

export interface SubnetTracker {
  getSubnetRegistrationCount(subnet: string, windowMs?: number, nowMs?: number): Promise<number> | number;
  recordRegistration(subnet: string, timestamp?: number): Promise<void> | void;
  reset?(): Promise<void> | void;
}

export interface EvaluateAntiSybilOptions {
  readonly subnetTracker?: SubnetTracker;
  readonly turnstileSecret?: string;
  readonly fetchFn?: typeof fetch;
  readonly recordOnPass?: boolean;
}

export interface CfBotManagementLike {
  readonly score?: number;
  readonly verifiedBot?: boolean;
}

export interface CfPropertiesLike {
  readonly asn?: number | string | null;
  readonly country?: string | null;
  readonly isTor?: boolean | null;
  readonly botManagement?: CfBotManagementLike;
}

export interface SybilUserInput {
  readonly id?: string | number;
  readonly githubId?: string | number;
  readonly username?: string;
  readonly login?: string;
  readonly githubUsername?: string;
  readonly email?: string;
  readonly primaryEmail?: string;
  readonly primary_email?: string;
  readonly isEmailVerified?: boolean;
  readonly is_email_verified?: boolean;
  readonly createdAt?: string | Date | number;
  readonly created_at?: string | Date | number;
  readonly githubCreatedAt?: string | Date | number;
  readonly publicRepos?: number;
  readonly public_repos?: number;
  readonly contributionsCount?: number;
  readonly totalContributions?: number;
  readonly total_contributions?: number;
  readonly contributions?: number;
  readonly accessToken?: string;
  readonly access_token?: string;
  readonly token?: string;
  readonly turnstileToken?: string;
  readonly turnstile_token?: string;
  readonly registrationIp?: string;
  readonly now?: number | Date;
}

export interface SybilRequestInput {
  readonly headers?:
    | Headers
    | Record<string, string | undefined>
    | {
        get(name: string): string | null | undefined;
      };
  readonly cf?: CfPropertiesLike;
  readonly url?: string;
  readonly ip?: string;
  readonly clientIp?: string;
  readonly turnstileToken?: string;
  readonly turnstile_token?: string;
  readonly json?: () => Promise<unknown>;
  readonly clone?: () => SybilRequestInput;
}

export interface SybilScoreResult extends SybilScore {
  readonly score: number;
  readonly passed: boolean;
  readonly tier: UserTier;
  readonly riskLevel: "low" | "medium" | "high" | "critical";
  readonly reasons: readonly string[];
  readonly flags: {
    readonly isVpnOrProxy: boolean;
    readonly isTor: boolean;
    readonly isDisposableEmail: boolean;
    readonly rateLimitExceeded: boolean;
    readonly turnstileFailed: boolean;
    readonly ipVelocityExceeded: boolean;
    readonly disposableEmail: boolean;
    readonly youngAccount: boolean;
    readonly lowActivity: boolean;
    readonly [key: string]: boolean | undefined;
  };
  readonly ip: string;
  readonly details: {
    readonly turnstileValid: boolean;
    readonly turnstileScore?: number;
    readonly subnetRegistrationCount: number;
    readonly accountAgeDays: number;
    readonly publicRepos: number;
    readonly contributionsCount: number;
    readonly email: string;
    readonly ip: string;
    readonly assessmentScore: number;
    readonly [key: string]: unknown;
  };
  valueOf(): number;
  [Symbol.toPrimitive](hint: string): number | string;
}
