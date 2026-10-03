/**
 * @file formatters.ts
 * Date, relative time, and Markdown configuration export formatters for Workbench.
 */

import type { UserAccount, UserTier, TierLimits } from '../../../../src/contracts/v3_types';
import type { ExtendedProject, ExtendedKey } from './types';

export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  if (dateStr.includes('ago') || dateStr.includes('minute') || dateStr.includes('day')) {
    return dateStr;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diffSec < 60) return `${Math.max(1, diffSec)} seconds ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minutes ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hours ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} days ago`;
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Unknown';
  if (dateStr.startsWith('Created ')) return dateStr.replace('Created ', '');
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function generateMarkdownExport(
  account: UserAccount,
  selectedTier: UserTier,
  currentLimits: TierLimits,
  localProjects: ExtendedProject[],
  localKeys: ExtendedKey[]
): string {
  function getProjectKeyCount(projectId: string): number {
    return localKeys.filter((k) => k.projectId === projectId && !k.isRevoked).length;
  }

  function getProjectName(projectId: string): string {
    const p = localProjects.find((proj) => proj.id === projectId);
    return p ? p.name : '—';
  }

  // Only data the server returned. No cluster, region, ASN or verification claims (QA-05).
  return `# Key Collective — Developer Workbench Configuration

**Exported at:** ${new Date().toISOString()}

---

## 👤 Account
- **Account ID:** \`${account.id}\`
- **Username:** ${account.githubUsername ? `\`@${account.githubUsername}\`` : 'GitHub not linked'}
- **Primary Email:** ${account.primaryEmail || '—'}
- **Sybil Score:** ${account.sybilScore === null ? 'Unverified — link GitHub' : `${account.sybilScore}/100`}
- **Active Governance Tier:** **${selectedTier.toUpperCase()}**

---

## ⚡ Quota & Tier Allocations (${selectedTier.toUpperCase()})
- **RPM Limit:** ${currentLimits.rpmLimit === Infinity ? 'Unlimited' : currentLimits.rpmLimit.toLocaleString()}
- **RPD Limit:** ${currentLimits.rpdLimit === Infinity ? 'Unlimited' : currentLimits.rpdLimit.toLocaleString()}
- **Max Projects:** ${currentLimits.maxProjects === Infinity ? 'Unlimited' : currentLimits.maxProjects}
- **Sub-Caps Permitted:** ${currentLimits.allowCustomSubCaps ? 'Yes' : 'No'}
- **Priority Weight:** P${currentLimits.priorityWeight}

---

## 📁 Registered Projects (${localProjects.length})
${localProjects
  .map(
    (p, i) => `### ${i + 1}. ${p.name} (\`${p.slug}\`)
- **Project ID:** \`${p.id}\`
- **Description:** ${p.description || 'None'}
- **Assigned RPM Sub-Cap:** ${p.maxRpmSubCap ? `${p.maxRpmSubCap} RPM` : 'Inherited'}
- **Status:** ${p.isArchived ? 'Archived' : 'Live'}
- **Active Keys:** ${getProjectKeyCount(p.id)}
- **Created:** ${p.createdAt}`
  )
  .join('\n\n')}

---

## 🔑 Project-Scoped API Keys (${localKeys.length})
| Key Name | Associated Project | Token Prefix | Status | Last Used | Created |
| :--- | :--- | :--- | :--- | :--- | :--- |
${localKeys
  .map(
    (k) =>
      `| \`${k.name}\` | ${getProjectName(k.projectId)} | \`${k.tokenPrefix}...\` | ${k.isRevoked ? 'Revoked' : 'Active'} | ${k.displayTime || 'Never'} | ${k.displayCreated || k.createdAt} |`
  )
  .join('\n')}
`;
}
