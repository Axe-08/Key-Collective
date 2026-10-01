export interface EncryptedKey {
    id: string;
    tenantId: string;
    provider: string;
    ciphertext: string;
    nonce: string;
    label?: string;
    priority?: number;
    rpmLimit?: number;
    rpdLimit?: number;
    status?: string;
    circuitOpenUntil?: string | null;
    lastUsedAt?: string | number | null;
    poolType?: "PRIVATE" | "COMMUNITY";
    communityRoutingStatus?: "OBSERVATION" | "ACTIVE" | "QUARANTINED" | "REVOKED" | null;
    observationUntil?: string | number | null;
    dispatchedToday?: number;
    dispatchedCommunal?: number;
    vestingTier?: number;
    cooldownUntil?: number | null;
}

export interface KeyMetrics {
    rpm: number;
    circuitBreakerTripped: boolean;
    costAccumulatedMicrodollars: bigint;
}

export interface KeyPoolContract {
    getKey(provider: string): Promise<string>;
    recordUsage(keyId: string, costMicrodollars: bigint): Promise<void>;
    recordResult?(keyId: string, success: boolean): Promise<void>;
}
