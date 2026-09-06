package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/akshit/key-collective/internal/api"
	"github.com/akshit/key-collective/internal/db"
	"github.com/akshit/key-collective/internal/domain"
	"github.com/akshit/key-collective/internal/proxy"
	"github.com/akshit/key-collective/ui"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	masterKey := os.Getenv("KC_MASTER_KEY")
	if masterKey == "" {
		log.Fatal("KC_MASTER_KEY environment variable is required")
	}

	database, err := db.InitDB("keys.db")
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer database.Close()

	// Hydrate active keys from SQLite, decrypting into memory
	dbKeys, err := database.GetKeys()
	if err != nil {
		log.Fatalf("Failed to fetch keys from database: %v", err)
	}

	keys := make([]*domain.APIKey, 0, len(dbKeys))
	for _, k := range dbKeys {
		decrypted, err := proxy.Decrypt(k.EncryptedKey, masterKey)
		if err != nil {
			log.Printf("Warning: failed to decrypt key %s (%s): %v. Skipping.", k.ID, k.Label, err)
			continue
		}
		k.Decrypted = decrypted
		k.MinuteWindowStart = time.Now()
		keys = append(keys, k)
	}
	log.Printf("Hydrated %d active key(s) from SQLite into memory", len(keys))

	manager := proxy.NewKeyManager(keys, 500)

	// Auth tokens initialization
	validTokens := make(map[string]bool)
	if authToken := os.Getenv("KC_AUTH_TOKEN"); authToken != "" {
		validTokens[proxy.HashToken(authToken)] = true
	}

	rows, err := database.Query("SELECT token_hash FROM auth_tokens")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var tokenHash string
			if err := rows.Scan(&tokenHash); err == nil {
				validTokens[tokenHash] = true
			}
		}
	}

	if len(validTokens) == 0 {
		validTokens[proxy.HashToken("kc_test_token")] = true
		log.Println("No auth tokens configured; initialized with default token 'kc_test_token'")
	}

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
	apiHandler := api.NewHandler(database, manager, masterKey)
	apiHandler.RegisterRoutes(mux)

	// Dashboard UI (Static Files - Embedded)
	mux.Handle("/", ui.Handler())

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Start non-blocking async logger
	go func() {
		for reqLog := range logChannel {
			if err := database.InsertLog(reqLog); err != nil {
				log.Printf("Failed to insert request log: %v", err)
			}
		}
	}()

	log.Printf("Key Collective running on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
