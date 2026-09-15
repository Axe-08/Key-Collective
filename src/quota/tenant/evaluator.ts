/**
 * Key Collective v3 — Quota Consumption Evaluator
 */

import { UserTier } from "../../contracts/v3_types";
import { calculateProjectQuota, getTierLimits } from "../limits";
import type { ConsumeQuotaRequest, ConsumeQuotaResult, QuotaEntry } from "./types";
import { toMicrodollars } from "./types";

export interface QuotaEvaluationContext {
  tenantId: string;
  tier: UserTier;
  entries: QuotaEntry[];
  totalCostMicrodollars: bigint;
  communityDebtMicroCu: bigint;
  dailyContributedCu: bigint;
  trustedContributor: boolean;
  consecutiveDebtFreeDays: number;
  multiplierCeiling: number;
  rpmWindowMs: number;
  rpdWindowMs: number;
  now: number;
}

export function calculateUsage(
  entries: QuotaEntry[],
  windowMs: number,
  now: number,
  projectId?: string
): number {
  const cutoff = now - windowMs;
  let count = 0;
  for (const e of entries) {
    if (e.timestamp > cutoff) {
      if (!projectId || e.projectId === projectId) {
        count += e.count;
      }
    }
  }
  return count;
}

export function calculateRpmRetryAfter(
  entries: QuotaEntry[],
  rpmWindowMs: number,
  now: number
): number {
  const cutoff = now - rpmWindowMs;
  for (const e of entries) {
    if (e.timestamp > cutoff) {
      const expiresAt = e.timestamp + rpmWindowMs;
      const diffMs = expiresAt - now;
      return Math.max(1, Math.ceil(diffMs / 1000));
    }
  }
  return 60;
}

export function evaluateQuota(
  request: ConsumeQuotaRequest,
  ctx: QuotaEvaluationContext
): { result: ConsumeQuotaResult; newEntry?: QuotaEntry; incomingCost: bigint } {
  const effectiveTier = request.tier ?? ctx.tier;
  const requestedCount = request.count !== undefined && request.count > 0 ? request.count : 1;
  const incomingCost = toMicrodollars(request.costMicrodollars);

  const tierLimits = getTierLimits(effectiveTier);
  const rootRpmLimit = tierLimits.rpmLimit;
  const rootRpdLimit = tierLimits.rpdLimit;

  const currentRootRpm = calculateUsage(ctx.entries, ctx.rpmWindowMs, ctx.now);
  const currentRootRpd = calculateUsage(ctx.entries, ctx.rpdWindowMs, ctx.now);

  const baseDebtFields = {
    communityDebtMicroCu: ctx.communityDebtMicroCu.toString(),
    dailyContributedCu: ctx.dailyContributedCu.toString(),
    trustedContributor: ctx.trustedContributor,
    consecutiveDebtFreeDays: ctx.consecutiveDebtFreeDays,
    multiplierCeiling: ctx.multiplierCeiling,
  };

  // Check 1: Root Tenant RPM Limit
  if (rootRpmLimit !== Infinity && currentRootRpm + requestedCount > rootRpmLimit) {
    const retryAfterSeconds = calculateRpmRetryAfter(ctx.entries, ctx.rpmWindowMs, ctx.now);
    return {
      result: {
        allowed: false,
        tenantId: ctx.tenantId,
        projectId: request.projectId,
        tier: effectiveTier,
        currentRpm: currentRootRpm,
        rpmLimit: rootRpmLimit,
        currentRpd: currentRootRpd,
        rpdLimit: rootRpdLimit,
        totalCostMicrodollars: ctx.totalCostMicrodollars.toString(),
        ...baseDebtFields,
        remainingRpm: Math.max(0, rootRpmLimit - currentRootRpm),
        remainingRpd: Math.max(0, rootRpdLimit - currentRootRpd),
        retryAfterSeconds,
        retry_after_seconds: retryAfterSeconds,
        error: "User quota ceiling exceeded",
        errorCode: "USER_QUOTA_EXHAUSTED",
        error_code: "USER_QUOTA_EXHAUSTED",
      },
      incomingCost,
    };
  }

  // Check 2: Root Tenant RPD Limit
  if (rootRpdLimit !== Infinity && currentRootRpd + requestedCount > rootRpdLimit) {
    const retryAfterSeconds = 86_400;
    return {
      result: {
        allowed: false,
        tenantId: ctx.tenantId,
        projectId: request.projectId,
        tier: effectiveTier,
        currentRpm: currentRootRpm,
        rpmLimit: rootRpmLimit,
        currentRpd: currentRootRpd,
        rpdLimit: rootRpdLimit,
        totalCostMicrodollars: ctx.totalCostMicrodollars.toString(),
        ...baseDebtFields,
        remainingRpm: Math.max(0, rootRpmLimit - currentRootRpm),
        remainingRpd: Math.max(0, rootRpdLimit - currentRootRpd),
        retryAfterSeconds,
        retry_after_seconds: retryAfterSeconds,
        error: "User daily quota ceiling exceeded",
        errorCode: "USER_DAILY_QUOTA_EXHAUSTED",
        error_code: "USER_DAILY_QUOTA_EXHAUSTED",
      },
      incomingCost,
    };
  }

  // Check 3: Project-Level Sub-Cap Enforcement
  let projectRpmLimit: number | undefined;
  let currentProjectRpm: number | undefined;
  if (request.projectId) {
    projectRpmLimit = calculateProjectQuota(effectiveTier, request.projectMaxSubCap);
    currentProjectRpm = calculateUsage(ctx.entries, ctx.rpmWindowMs, ctx.now, request.projectId);

    if (projectRpmLimit !== Infinity && currentProjectRpm + requestedCount > projectRpmLimit) {
      const retryAfterSeconds = calculateRpmRetryAfter(ctx.entries, ctx.rpmWindowMs, ctx.now);
      return {
        result: {
          allowed: false,
          tenantId: ctx.tenantId,
          projectId: request.projectId,
          tier: effectiveTier,
          currentRpm: currentRootRpm,
          rpmLimit: rootRpmLimit,
          currentRpd: currentRootRpd,
          rpdLimit: rootRpdLimit,
          currentProjectRpm,
          projectRpmLimit,
          totalCostMicrodollars: ctx.totalCostMicrodollars.toString(),
          ...baseDebtFields,
          remainingRpm: Math.max(0, rootRpmLimit - currentRootRpm),
          remainingRpd: Math.max(0, rootRpdLimit - currentRootRpd),
          retryAfterSeconds,
          retry_after_seconds: retryAfterSeconds,
          error: "Project sub-cap exceeded",
          errorCode: "PROJECT_SUB_CAP_EXCEEDED",
          error_code: "PROJECT_SUB_CAP_EXCEEDED",
        },
        incomingCost,
      };
    }
  }

  if (request.checkOnly) {
    return {
      result: {
        allowed: true,
        tenantId: ctx.tenantId,
        projectId: request.projectId,
        tier: effectiveTier,
        currentRpm: currentRootRpm,
        rpmLimit: rootRpmLimit,
        currentRpd: currentRootRpd,
        rpdLimit: rootRpdLimit,
        currentProjectRpm,
        projectRpmLimit,
        totalCostMicrodollars: ctx.totalCostMicrodollars.toString(),
        ...baseDebtFields,
        remainingRpm: Math.max(0, rootRpmLimit - currentRootRpm),
        remainingRpd: Math.max(0, rootRpdLimit - currentRootRpd),
      },
      incomingCost,
    };
  }

  const newEntry: QuotaEntry = {
    timestamp: ctx.now,
    count: requestedCount,
    costMicrodollars: incomingCost.toString(),
    ...(request.projectId ? { projectId: request.projectId } : {}),
  };

  const updatedRootRpm = currentRootRpm + requestedCount;
  const updatedRootRpd = currentRootRpd + requestedCount;

  return {
    result: {
      allowed: true,
      tenantId: ctx.tenantId,
      projectId: request.projectId,
      tier: effectiveTier,
      currentRpm: updatedRootRpm,
      rpmLimit: rootRpmLimit,
      currentRpd: updatedRootRpd,
      rpdLimit: rootRpdLimit,
      currentProjectRpm: currentProjectRpm !== undefined ? currentProjectRpm + requestedCount : undefined,
      projectRpmLimit,
      totalCostMicrodollars: (ctx.totalCostMicrodollars + incomingCost).toString(),
      ...baseDebtFields,
      remainingRpm: rootRpmLimit === Infinity ? Infinity : Math.max(0, rootRpmLimit - updatedRootRpm),
      remainingRpd: rootRpdLimit === Infinity ? Infinity : Math.max(0, rootRpdLimit - updatedRootRpd),
    },
    newEntry,
    incomingCost,
  };
}
