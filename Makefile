.PHONY: all setup check typecheck test gate dev clean

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

gate: typecheck test
	@echo "🎉 [GATE PASSED] TypeScript typecheck and tests satisfied in <10s."

dev:
	@npx wrangler dev

clean:
	@rm -rf node_modules dist .wrangler
