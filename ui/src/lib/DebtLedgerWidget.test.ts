import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'svelte/server';
import DebtLedgerWidget, {
  loadLedger,
  resolveDebt,
  getLedgerDebts,
  setLedgerDebts,
  type DebtEntry,
} from './DebtLedgerWidget.svelte';

describe('DebtLedgerWidget', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setLedgerDebts([]);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('Should list all debts', async () => {
    const mockDebts: DebtEntry[] = [
      { id: 'debt_01jh9x81m', amount: 450000 },
      { id: 'debt_01jh9x82p', amount: 1200000 },
      { id: 'debt_01jh9x83q', amount: 85000 },
    ];

    const result = render(DebtLedgerWidget, {
      props: {
        debts: mockDebts,
      },
    });

    // Should list container
    expect(result.body).toContain('data-testid="debt-list"');

    // Should list all debts with their IDs and microdollar amounts
    for (const debt of mockDebts) {
      expect(result.body).toContain(debt.id);
      expect(result.body).toContain(debt.amount.toLocaleString());
    }

    // Should render resolve buttons for each debt entry
    expect(result.body).toContain('data-testid="resolve-debt-button"');
    expect(result.body).toContain('data-debt-id="debt_01jh9x81m"');
    expect(result.body).toContain('data-debt-id="debt_01jh9x82p"');
    expect(result.body).toContain('data-debt-id="debt_01jh9x83q"');
  });

  it('Should call resolve endpoint on click', async () => {
    const debtId = 'debt_01jh9x82p';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, resolvedDebtId: debtId }),
    });
    globalThis.fetch = mockFetch;

    // Component renders resolve button for the debt entry
    const result = render(DebtLedgerWidget, {
      props: {
        debts: [{ id: debtId, amount: 1200000 }],
      },
    });

    expect(result.body).toContain(`data-debt-id="${debtId}"`);
    expect(result.body).toContain('Resolve');

    // Triggering resolution calls the resolve endpoint
    const success = await resolveDebt(debtId);
    expect(success).toBe(true);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/debts/${debtId}/resolve`,
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('should load debt ledger for a tenant via loadLedger signature', async () => {
    const tenantId = 'usr_gh_9824102';
    const mockDebts: DebtEntry[] = [
      { id: 'debt_ext_01', amount: 300000 },
      { id: 'debt_ext_02', amount: 750000 },
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockDebts,
    });
    globalThis.fetch = mockFetch;

    await loadLedger(tenantId);

    expect(mockFetch).toHaveBeenCalledWith(`/api/debts?tenantId=${tenantId}`);
    expect(getLedgerDebts()).toEqual(mockDebts);
  });

  it('should render empty state when no debts exist', () => {
    const result = render(DebtLedgerWidget, {
      props: {
        debts: [],
      },
    });

    expect(result.body).toContain('data-testid="empty-state"');
    expect(result.body).toContain('All debts settled');
  });

  it('should format fixed-point microdollars accurately', () => {
    const mockDebts: DebtEntry[] = [
      { id: 'debt_micro_01', amount: 1000000 }, // $1.0000
      { id: 'debt_micro_02', amount: 2500000 }, // $2.5000
    ];

    const result = render(DebtLedgerWidget, {
      props: {
        debts: mockDebts,
      },
    });

    expect(result.body).toContain('$1.00');
    expect(result.body).toContain('$2.50');
    expect(result.body).toContain('1,000,000 µ$');
    expect(result.body).toContain('2,500,000 µ$');
  });

  it('should handle resolve failure gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal Server Error' }),
    });
    globalThis.fetch = mockFetch;

    setLedgerDebts([{ id: 'debt_err_01', amount: 10000 }]);
    const success = await resolveDebt('debt_err_01');

    expect(success).toBe(false);
    expect(getLedgerDebts()).toHaveLength(1);
  });

  it('should support custom onResolve callback prop', async () => {
    const onResolveMock = vi.fn().mockResolvedValue(true);
    const mockDebts: DebtEntry[] = [{ id: 'debt_prop_01', amount: 50000 }];

    const result = render(DebtLedgerWidget, {
      props: {
        debts: mockDebts,
        onResolve: onResolveMock,
      },
    });

    expect(result.body).toContain('debt_prop_01');
    expect(result.body).toContain('data-testid="resolve-debt-button"');
  });
});
