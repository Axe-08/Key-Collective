export interface EncryptedKey {
    id: string;
    tenantId: string;
    provider: string;
    ciphertext: string;
    nonce: string;
}

export interface KeyMetrics {
    rpm: number;
    circuitBreakerTripped: boolean;
    costAccumulatedMicrodollars: bigint;
}

export interface KeyPoolContract {
    getKey(provider: string): Promise<string>;
    recordUsage(keyId: string, costMicrodollars: bigint): Promise<void>;
}
