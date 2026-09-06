package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"

	"github.com/akshit/key-collective/internal/db"
	"github.com/akshit/key-collective/internal/domain"
	"github.com/akshit/key-collective/internal/proxy"
	"github.com/joho/godotenv"
)

//go:embed all:ui/dist
var uiAssets embed.FS

func main() {
	godotenv.Load()

	masterKey := os.Getenv("KC_MASTER_KEY")
	if masterKey == "" {
		log.Fatal("KC_MASTER_KEY environment variable is required")
	}

	database, err := db.InitDB("keys.db")
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer database.Close()

	// Load keys and tokens from DB... (mocking this for now to boot)
	keys := []*domain.APIKey{}
	// Example key for local testing if DB is empty
	// keys = append(keys, &domain.APIKey{ ... })

	manager := proxy.NewKeyManager(keys, 500)
	
	validTokens := make(map[string]bool)
	// Example token load
	// validTokens[proxy.HashToken("kc_test_token")] = true
	
	logChannel := make(chan *domain.RequestLog, 1000)

	proxyServer := &proxy.ProxyServer{
		Manager:     manager,
		ValidTokens: validTokens,
		LogChannel:  logChannel,
	}

	mux := http.NewServeMux()

	// API Proxy Endpoint
	mux.Handle("/v1/", proxyServer)

	// API Management Endpoints (for dashboard)
	mux.HandleFunc("/api/keys", func(w http.ResponseWriter, r *http.Request) {
		// return keys
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]"))
	})

	// Dashboard UI (Static Files)
	uiFS, err := fs.Sub(uiAssets, "ui/dist")
	if err != nil {
		// Fallback to local FS for dev mode if ui/dist doesn't exist yet
		log.Println("Embedded UI not found (maybe not built yet). Using local ./ui/dist if exists.")
		mux.Handle("/", http.FileServer(http.Dir("./ui/dist")))
	} else {
		mux.Handle("/", http.FileServer(http.FS(uiFS)))
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Start async logger
	go func() {
		for reqLog := range logChannel {
			// Write to SQLite here
			_, err := database.Exec(`
				INSERT INTO request_logs (id, key_id, provider, status_code, latency_ms, bytes_in, bytes_out, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`, reqLog.ID, reqLog.KeyID, reqLog.Provider, reqLog.StatusCode, reqLog.LatencyMs, reqLog.BytesIn, reqLog.BytesOut, reqLog.CreatedAt)
			if err != nil {
				log.Printf("Failed to insert log: %v", err)
			}
		}
	}()

	log.Printf("Key Collective running on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
