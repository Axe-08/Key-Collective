import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// T-F.7.6 (RA-10): no invented SLA, latency, region or verification data in the UI.
const path = (rel: string): URL => new URL(rel, import.meta.url);
const src = (rel: string): string => readFileSync(path(rel), 'utf8');

describe('T-F.7.6 remaining invented UI data is gone (RA-10)', () => {
  it.each([
    ['admin/VelocityDials.svelte', ['&lt; 250ms SLA', '12ms (SIN-01)', '±2.1%']],
    ['DashboardView.svelte', ['Sub-15ms Edge Routing']],
    ['workbench/ProjectsSection.svelte', ['12ms avg']],
    ['api_docs/CodePlayground.svelte', ['simulatedLatency']],
    ['workbench/Modals.svelte', ['VerificationProofModal']],
    ['Workbench.svelte', ['VerificationProofModal']],
  ])('%s has none of the invented literals', (file, literals) => {
    const text = src(file);
    for (const literal of literals) {
      expect(text.includes(literal), `${file}: ${literal}`).toBe(false);
    }
  });

  it('the fake verification proof modal and the dead debt ledger widget are archived', () => {
    expect(existsSync(path('workbench/modals/VerificationProofModal.svelte'))).toBe(false);
    expect(existsSync(path('DebtLedgerWidget.svelte'))).toBe(false);
    expect(existsSync(path('../../../archives/ui/src/lib/workbench/modals/VerificationProofModal.svelte'))).toBe(true);
    expect(existsSync(path('../../../archives/ui/src/lib/DebtLedgerWidget.svelte'))).toBe(true);
  });
});
