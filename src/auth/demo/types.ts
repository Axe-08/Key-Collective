/**
 * Key Collective v3 — Ephemeral Demo Tier Types & Contracts
 *
 * Conforms to:
 * - docs/system_design_v3.md (Section 3: Ephemeral Demo Tier State Machine & DO Alarm Engine)
 * - docs/adr/003-multi-project-tiered-architecture.md (Section 3: Global Demo Pool)
 * - docs/architecture/lld_pod-auth-sybil.md (Section 4.3: Demo Durable Object)
 */

/**
 * Storage contract for DemoDO Durable Object storage.
 * Compatible with Cloudflare Workers DurableObjectStorage.
 */
export interface DemoDOStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
  put<T>(entries: Record<string, T>): Promise<void>;
  delete?(key: string): Promise<boolean>;
  delete?(keys: string[]): Promise<number>;
  deleteAll?(): Promise<void>;
  list?<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  getAlarm?(): Promise<number | null>;
  deleteAlarm?(): Promise<void>;
}

/**
 * Minimal state contract for Cloudflare DurableObjectState.
 */
export interface DurableObjectStateLike {
  readonly id: {
    toString(): string;
    readonly name?: string;
  };
  readonly storage: DemoDOStorageLike;
  waitUntil(promise: Promise<unknown>): void;
  blockConcurrencyWhile?<T>(callback: () => Promise<T>): Promise<T>;
}

/**
 * Sliding window record for an individual client IP.
 */
export interface IpWindowData {
  /** Total requests recorded in active window (for compatibility with system design v3) */
  requests: number;
  /** Timestamp marking start or last activity of window (for 1-hour pruning) */
  windowStart: number;
  /** Array of request timestamps in ms */
  timestamps: number[];
  /** Timestamp marking current minute window start */
  minuteWindowStart?: number;
  /** Number of requests in current minute window */
  minuteRequests?: number;
  /** Timestamp marking current 24-hour day window start */
  dayWindowStart?: number;
  /** Number of requests in current 24-hour day window */
  dayRequests?: number;
}

/**
 * Diagnostic result of checking or recording demo rate limits.
 */
export interface DemoRateLimitResult {
  allowed: boolean;
  currentRpm: number;
  rpmLimit: number;
  currentRpd: number;
  rpdLimit: number;
  globalRpm: number;
  globalRpmLimit: number;
  retryAfterSeconds?: number;
  reason?: "ip_rpm_exceeded" | "ip_rpd_exceeded" | "global_rpm_exceeded" | "global_rpd_exceeded";
}

/**
 * Configuration options for DemoDO.
 */
export interface DemoDOOptions {
  /** Rotation interval in milliseconds (defaults to 15 minutes) */
  rotationIntervalMs?: number;
  /** Requests per minute limit per IP (defaults to 3) */
  ipRpmLimit?: number;
  /** Requests per day limit per IP (defaults to 25) */
  ipRpdLimit?: number;
  /** Global shared demo pool requests per minute ceiling (defaults to 20) */
  globalRpmLimit?: number;
  /** Inactivity duration before pruning stale IP windows (defaults to 1 hour) */
  stalePruneMs?: number;
  /** Injectable time provider for deterministic testing (defaults to Date.now) */
  timeProvider?: () => number;
}

/**
 * Active demo token metadata.
 */
export interface ActiveDemoToken {
  token: string;
  expiresAt: number;
}

/**
 * Candidate demo token validation result.
 */
export interface TokenValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Atomic token consumption and rate-limit enforcement result.
 */
export interface CheckAndConsumeResult {
  allowed: boolean;
  status: number;
  message: string;
  retryAfterSeconds?: number;
  rateLimit?: DemoRateLimitResult;
}
