.PHONY: all setup check typecheck test test-debt-ledger test-pool-commons test-add-key-modal gate dev clean

all: gate

setup:
	@echo "Installing dependencies..."
	npm install

check:
	@npm run check

typecheck:
	@npx tsc --noEmit

test:
	@npx vitest run



test-pool-commons:
	@npx vitest run ui/src/lib/PoolCommonsTab.test.ts

test-debt-ledger:
	@npx vitest run ui/src/lib/DebtLedgerWidget.test.ts

test-add-key-modal:
	@npx vitest run ui/src/lib/AddKeyModal.test.ts

test-telemetry-charts:
	@npx vitest run ui/src/lib/TelemetryCharts.test.ts

gate: typecheck test
	@echo "🎉 [GATE PASSED] TypeScript typecheck and tests satisfied in <10s."

dev:
	@npx wrangler dev

clean:
	@rm -rf node_modules dist .wrangler
