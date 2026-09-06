.PHONY: all setup build run test clean check

BINARY_NAME=key-collective

all: check test build

setup:
	@echo "Checking for Go installation..."
	@which go > /dev/null || (echo "Go is not installed. Please install Go 1.23+ from https://go.dev/doc/install" && exit 1)
	@echo "Checking for Node.js (for Svelte)..."
	@which npm > /dev/null || (echo "npm is not installed. Please install Node.js." && exit 1)
	@echo "Setting up UI dependencies..."
	cd ui && npm install

build: setup
	@echo "Building UI..."
	cd ui && npm run build
	@echo "Building Go binary..."
	go build -o bin/$(BINARY_NAME) ./cmd/key-collective

run: build
	@echo "Running Key Collective locally..."
	./bin/$(BINARY_NAME)

test:
	go test ./... -v

check:
	go fmt ./...
	go vet ./...

clean:
	go clean
	rm -rf bin/
	rm -rf ui/build/
