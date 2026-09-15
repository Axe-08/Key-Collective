/**
 * @file types.ts
 * Types for Workbench state, projects, keys, and tier metrics.
 */

import type { UserAccount, Project, ProjectKey, UserTier } from '../../../../src/contracts/v3_types';
import type { APIKey } from '../types';

export interface ExtendedProject extends Project {
  assignedRpm?: number;
  latencyMs?: number;
  latency?: string;
  icon?: string;
  iconColor?: string;
}

export interface ExtendedKey extends ProjectKey {
  fullSecret?: string;
  displayTime?: string;
  displayCreated?: string;
}

export interface TierMatrixItem {
  id: UserTier;
  name: string;
  icon: string;
  badge: string;
  badgeClass: string;
  quotaText: string;
  description: string;
  footerText: string;
  dailyUsagePercent: number;
  minWidth: string;
}

export interface WorkbenchProps {
  userAccount?: UserAccount;
  projects?: Project[];
  keys?: ProjectKey[];
  providerKeys?: APIKey[];
  onSelectTier?: (tier: UserTier) => void;
  onCreateProject?: (project: Partial<Project>) => void;
  onRotateKey?: (keyId: string) => void;
  onRevokeKey?: (keyId: string) => void;
  onDeleteKey?: (keyId: string) => void;
  onToggleKeyStatus?: (keyId: string) => void;
  onRefreshProviderKeys?: () => Promise<void> | void;
}

export const DEFAULT_USER_ACCOUNT: UserAccount = {
  id: '',
  githubId: 0,
  githubUsername: '',
  primaryEmail: '',
  tier: 'demo',
  avatarUrl: '',
  isEmailVerified: false,
  githubCreatedAt: '',
  sybilScore: 0,
  registrationIp: '',
  createdAt: '',
  updatedAt: '',
};

export const TIER_MATRIX: TierMatrixItem[] = [
  {
    id: 'admin',
    name: '👑 Admin',
    icon: 'admin_panel_settings',
    badge: 'System',
    badgeClass: 'bg-surface-container text-outline',
    quotaText: 'Unlimited RPM / RPD',
    description: 'Full Platform Control & Root Secrets',
    footerText: 'System Operator',
    dailyUsagePercent: 12,
    minWidth: 'min-w-[210px]',
  },
  {
    id: 'ultra',
    name: '⚡ Ultra',
    icon: 'bolt',
    badge: 'Tier 5',
    badgeClass: 'bg-surface-container text-tertiary',
    quotaText: 'Unlimited RPM / RPD',
    description: 'High-Volume Enterprise Proxy Routing',
    footerText: 'Tier 5 Sybil Required',
    dailyUsagePercent: 35,
    minWidth: 'min-w-[210px]',
  },
  {
    id: 'max',
    name: '🚀 Max',
    icon: 'rocket_launch',
    badge: 'Upgrade',
    badgeClass: 'bg-primary/10 text-primary',
    quotaText: '60 RPM • 10,000 RPD',
    description: 'Up to 10 Projects • Priority Edge',
    footerText: 'Upgrade Available',
    dailyUsagePercent: 45,
    minWidth: 'min-w-[210px]',
  },
  {
    id: 'builder',
    name: '🛠️ Builder',
    icon: 'construction',
    badge: 'Current',
    badgeClass: 'bg-primary text-on-primary',
    quotaText: '20 RPM • 2,000 RPD',
    description: 'Up to 3 Projects • Standard Fallback',
    footerText: 'Active Tier',
    dailyUsagePercent: 68,
    minWidth: 'min-w-[230px]',
  },
  {
    id: 'builder' as UserTier,
    name: '🌱 Starter',
    icon: 'eco',
    badge: 'Unlocked',
    badgeClass: 'bg-surface-container text-secondary',
    quotaText: '10 RPM • 500 RPD',
    description: '2 Projects • Community Nodes',
    footerText: 'Unlocked',
    dailyUsagePercent: 55,
    minWidth: 'min-w-[210px]',
  },
  {
    id: 'probationary',
    name: '⏳ Probationary',
    icon: 'hourglass_empty',
    badge: 'Sandbox',
    badgeClass: 'bg-surface-container text-outline',
    quotaText: '2 RPM • 50 RPD',
    description: 'Sandboxed • Heavy Throttling',
    footerText: 'Baseline',
    dailyUsagePercent: 84,
    minWidth: 'min-w-[210px]',
  },
  {
    id: 'demo',
    name: '🎭 Demo',
    icon: 'theater_comedy',
    badge: 'Public',
    badgeClass: 'bg-surface-container text-outline',
    quotaText: '20 RPM Shared • 3/IP',
    description: 'Ephemeral Sessions • Zero Persistence',
    footerText: 'Public Sandbox',
    dailyUsagePercent: 90,
    minWidth: 'min-w-[210px]',
  },
];
