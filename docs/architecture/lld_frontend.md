# Frontend LLD
- `ui/`: Svelte 5 + Vite + Tailwind project.
- `ui/src/App.svelte`: Main dashboard showing Key Pool, Health, and recent logs.
- `cmd/key-collective/main.go`: `go:embed ui/dist` to serve the compiled frontend.
