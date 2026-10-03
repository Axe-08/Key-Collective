import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('WP-6.1: Frontend truth & eradication of invented UI data', () => {
  const root = path.resolve(__dirname, '../../../ui/src/lib');

  it('T-6.1.2: AdminView.svelte has no hardcoded latency numbers or synthetic audit defaults', () => {
    const content = fs.readFileSync(path.join(root, 'admin/AdminView.svelte'), 'utf-8');
    expect(content).not.toMatch(/avgLatencyMs:\s*(238|114|79|385)/);
    expect(content).not.toMatch(/syncDurationMs:\s*[0-9]+/);
    expect(content).not.toMatch(/aud_init_/);
  });

  it('T-6.1.3: CircuitBreakerControls.svelte has no hardcoded latency numbers or synthetic audit logs', () => {
    const content = fs.readFileSync(path.join(root, 'admin/CircuitBreakerControls.svelte'), 'utf-8');
    expect(content).not.toMatch(/avgLatencyMs:\s*(242|118|82|380)/);
    expect(content).not.toMatch(/aud_init_/);
  });

  it('T-6.1.4: TelemetryLogs.svelte has no invented model, token, or intercept messages', () => {
    const content = fs.readFileSync(path.join(root, 'TelemetryLogs.svelte'), 'utf-8');
    expect(content).not.toContain("Auto-rerouted to Key #04 in 8ms (Shield Intercept)");
    expect(content).not.toMatch(/bytes_in\s*\|\|\s*410/);
    expect(content).not.toMatch(/bytes_out\s*\|\|\s*89/);
    expect(content).not.toMatch(/log\.model\s*\|\|\s*['"]gemini-1\.5-pro['"]/);
  });

  it('T-6.1.5: TopNavBar.svelte has no hardcoded trust score (92), fake email, or fake BUILDER tier fallback', () => {
    const content = fs.readFileSync(path.join(root, 'TopNavBar.svelte'), 'utf-8');
    expect(content).not.toMatch(/sybilScore\s*\?\?\s*92/);
    expect(content).not.toContain('builder@keycollective.io');
    expect(content).not.toMatch(/userAccount\?\.tier\s*\|\|\s*['"]builder['"]/i);
  });

  it('T-6.1.6: the dead DebtLedgerWidget.svelte (mock standing fallbacks) is archived out of ui/src (T-F.7.6)', () => {
    expect(fs.existsSync(path.join(root, 'DebtLedgerWidget.svelte'))).toBe(false);
  });

  it('T-6.1.7: KeysTable.svelte has no arbitrary 60 RPM or 10000 RPD fallback literals', () => {
    const content = fs.readFileSync(path.join(root, 'KeysTable.svelte'), 'utf-8');
    expect(content).not.toMatch(/key\.rpm_limit\s*\|\|\s*60\b/);
    expect(content).not.toMatch(/key\.rpd_limit\s*\|\|\s*10000\b/);
  });

  it('T-6.1.8: MetricCards.svelte has no $1.00 budget ring or microdollar currency', () => {
    const content = fs.readFileSync(path.join(root, 'MetricCards.svelte'), 'utf-8');
    expect(content).not.toContain('$1.00');
    expect(content).not.toMatch(/microdollars/i);
    expect(content).toContain('CU SPEND RING');
  });

  it('T-6.1.9: KeysSection.svelte and TierMatrixSection.svelte have no synthetic timestamps or dailyUsagePercent', () => {
    const tierContent = fs.readFileSync(path.join(root, 'workbench/TierMatrixSection.svelte'), 'utf-8');
    expect(tierContent).not.toContain('dailyUsagePercent');

    const keysContent = fs.readFileSync(path.join(root, 'workbench/KeysSection.svelte'), 'utf-8');
    expect(keysContent).not.toContain('Oct 14, 2024');
  });
});
