.PHONY: all setup check typecheck test test-worker test-ui test-debt-ledger test-pool-commons test-add-key-modal test-telemetry-charts gate dev clean

all: gate

setup:
	@echo "Installing dependencies..."
	npm install
	cd ui && npm install

check:
	@npm run check

typecheck:
	@npx tsc --noEmit

# Worker / Durable Object tests (root — no svelte dependency)
test-worker:
	@npx vitest run

# UI Svelte component tests (run from ui/ where svelte is installed)
test-ui:
	@cd ui && npx vitest run

# Run both test suites
test: test-worker test-ui



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
