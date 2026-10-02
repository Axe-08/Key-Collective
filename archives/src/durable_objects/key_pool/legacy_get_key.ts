/**
 * Archived in WP-7.5 (T-7.5.2) — Legacy getKey(), getKeyDetails(), and checkD1KeyStatus()
 * from KeyPoolDO. Replaced by LeaseOrchestrator.acquireLease() and PoolCoordinatorDO.
 */

export const ARCHIVED_KEY_POOL_LEGACY_METHODS = `
  private async checkD1KeyStatus(keyId: string): Promise<string | null> { ... }
  public async getKey(provider: string, tenantId?: string): Promise<string> { ... }
  public async getKeyDetails(provider: string, options?: SelectKeyOptions<EncryptedKey>): Promise<EncryptedKey> { ... }
`;
