package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/akshit/key-collective/internal/db"
	"github.com/akshit/key-collective/internal/domain"
	"github.com/akshit/key-collective/internal/proxy"
)

const testMasterKey = "0123456789abcdef0123456789abcdef"

func setupTestAPI(t *testing.T) (*Handler, *http.ServeMux, func()) {
	t.Helper()
	tempDir, err := os.MkdirTemp("", "kc_api_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	database, err := db.InitDB(filepath.Join(tempDir, "test.db"))
	if err != nil {
		os.RemoveAll(tempDir)
		t.Fatalf("failed to init db: %v", err)
	}

	manager := proxy.NewKeyManager([]*domain.APIKey{}, 500)
	handler := NewHandler(database, manager, testMasterKey)

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	cleanup := func() {
		database.Close()
		os.RemoveAll(tempDir)
	}

	return handler, mux, cleanup
}

func TestAPI_KeysLifecycle(t *testing.T) {
	handler, mux, cleanup := setupTestAPI(t)
	defer cleanup()

	// 1. Initial GET /api/keys -> empty list
	req := httptest.NewRequest("GET", "/api/keys", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	var keys []KeyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &keys); err != nil {
		t.Fatalf("failed to unmarshal keys: %v", err)
	}
	if len(keys) != 0 {
		t.Fatalf("expected 0 keys initially, got %d", len(keys))
	}

	// 2. POST /api/keys -> create a new Gemini key
	createPayload := CreateKeyRequest{
		Label:    "Primary Gemini Key",
		Provider: domain.ProviderGemini,
		Key:      "AIzaSyDemoKeySecretPlaintext12345",
		RPMLimit: 15,
		RPDLimit: 1500,
		Priority: 0,
	}
	body, _ := json.Marshal(createPayload)
	req = httptest.NewRequest("POST", "/api/keys", bytes.NewReader(body))
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var createdKey KeyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &createdKey); err != nil {
		t.Fatalf("failed to unmarshal created key: %v", err)
	}

	if createdKey.ID == "" {
		t.Error("expected generated ID, got empty")
	}
	if createdKey.KeyPrefix != "AIzaSy" {
		t.Errorf("expected prefix 'AIzaSy', got %q", createdKey.KeyPrefix)
	}
	if createdKey.KeySuffix != "2345" {
		t.Errorf("expected suffix '2345', got %q", createdKey.KeySuffix)
	}
	if createdKey.Label != "Primary Gemini Key" {
		t.Errorf("expected label 'Primary Gemini Key', got %q", createdKey.Label)
	}
	if createdKey.Provider != domain.ProviderGemini {
		t.Errorf("expected provider 'gemini', got %q", createdKey.Provider)
	}

	// Verify key was added to KeyManager
	mgrKeys := handler.Manager.GetKeys()
	if len(mgrKeys) != 1 {
		t.Fatalf("expected 1 key in KeyManager, got %d", len(mgrKeys))
	}
	if mgrKeys[0].Decrypted != "AIzaSyDemoKeySecretPlaintext12345" {
		t.Errorf("expected decrypted key in manager memory, got %q", mgrKeys[0].Decrypted)
	}

	// Verify key in DB is encrypted at rest (NEVER plaintext)
	dbKeys, err := handler.DB.GetKeys()
	if err != nil {
		t.Fatalf("failed to query keys from db: %v", err)
	}
	if len(dbKeys) != 1 {
		t.Fatalf("expected 1 key in db, got %d", len(dbKeys))
	}
	if bytes.Contains(dbKeys[0].EncryptedKey, []byte("Plaintext")) {
		t.Fatalf("CRITICAL SECURITY VIOLATION: encrypted blob contains plaintext key fragment!")
	}

	// Decrypt blob from DB to verify it matches
	decrypted, err := proxy.Decrypt(dbKeys[0].EncryptedKey, testMasterKey)
	if err != nil {
		t.Fatalf("failed to decrypt key from db: %v", err)
	}
	if decrypted != "AIzaSyDemoKeySecretPlaintext12345" {
		t.Errorf("decrypted db key mismatch: got %q", decrypted)
	}

	// 3. GET /api/keys -> returns masked metadata, zero plaintext / encrypted blob
	req = httptest.NewRequest("GET", "/api/keys", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	rawJSON := rec.Body.String()
	if bytes.Contains([]byte(rawJSON), []byte("Plaintext")) || bytes.Contains([]byte(rawJSON), []byte("AIzaSyDemoKeySecret")) {
		t.Fatalf("CRITICAL SECURITY VIOLATION: /api/keys response leaked plaintext key: %s", rawJSON)
	}
	if bytes.Contains([]byte(rawJSON), []byte("encrypted_key")) {
		t.Fatalf("CRITICAL SECURITY VIOLATION: /api/keys response leaked encrypted_key blob: %s", rawJSON)
	}

	// 4. DELETE /api/keys/{id}
	req = httptest.NewRequest("DELETE", "/api/keys/"+createdKey.ID, nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 on delete, got %d: %s", rec.Code, rec.Body.String())
	}

	// Verify removed from KeyManager
	if len(handler.Manager.GetKeys()) != 0 {
		t.Errorf("expected 0 keys in KeyManager after delete, got %d", len(handler.Manager.GetKeys()))
	}

	// Verify removed from DB
	dbKeysAfter, _ := handler.DB.GetKeys()
	if len(dbKeysAfter) != 0 {
		t.Errorf("expected 0 keys in DB after delete, got %d", len(dbKeysAfter))
	}

	// Deleting again should return 404
	req = httptest.NewRequest("DELETE", "/api/keys/"+createdKey.ID, nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected status 404 on deleting non-existent key, got %d", rec.Code)
	}
}

func TestAPI_CreateKeyValidation(t *testing.T) {
	_, mux, cleanup := setupTestAPI(t)
	defer cleanup()

	tests := []struct {
		name       string
		payload    CreateKeyRequest
		wantStatus int
	}{
		{
			name: "empty key",
			payload: CreateKeyRequest{
				Label:    "Test",
				Provider: domain.ProviderGemini,
				Key:      "",
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "empty label",
			payload: CreateKeyRequest{
				Label:    "",
				Provider: domain.ProviderGroq,
				Key:      "gsk_valid_key_12345",
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "invalid provider",
			payload: CreateKeyRequest{
				Label:    "Test",
				Provider: "unknown_provider",
				Key:      "some_key_12345",
			},
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body, _ := json.Marshal(tc.payload)
			req := httptest.NewRequest("POST", "/api/keys", bytes.NewReader(body))
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Errorf("expected status %d, got %d: %s", tc.wantStatus, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestAPI_LogsAndStats(t *testing.T) {
	handler, mux, cleanup := setupTestAPI(t)
	defer cleanup()

	// Insert test key
	apiKey := &domain.APIKey{
		ID:        "k-stats-test",
		KeyHash:   "hash123",
		KeyPrefix: "AIzaSy",
		KeySuffix: "9999",
		Provider:  domain.ProviderGemini,
		Label:     "Stats Key",
		RPMLimit:  15,
		RPDLimit:  1500,
		Status:    domain.KeyHealthy,
	}
	_ = handler.DB.InsertKey(apiKey, []byte("encrypted"))
	handler.Manager.AddKey(apiKey)

	// Insert test logs
	_ = handler.DB.InsertLog(&domain.RequestLog{
		KeyID:      apiKey.ID,
		Provider:   domain.ProviderGemini,
		StatusCode: 200,
		LatencyMs:  95.0,
		BytesIn:    100,
		BytesOut:   200,
		CreatedAt:  time.Now(),
	})
	_ = handler.DB.InsertLog(&domain.RequestLog{
		KeyID:      apiKey.ID,
		Provider:   domain.ProviderGemini,
		StatusCode: 429,
		LatencyMs:  30.0,
		BytesIn:    50,
		BytesOut:   100,
		CreatedAt:  time.Now(),
	})

	// Test GET /api/logs
	req := httptest.NewRequest("GET", "/api/logs?limit=10", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var logs []domain.RequestLog
	if err := json.Unmarshal(rec.Body.Bytes(), &logs); err != nil {
		t.Fatalf("failed to unmarshal logs: %v", err)
	}
	if len(logs) != 2 {
		t.Fatalf("expected 2 logs, got %d", len(logs))
	}

	// Test GET /api/stats
	req = httptest.NewRequest("GET", "/api/stats", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var stats domain.ProxyStats
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("failed to unmarshal stats: %v", err)
	}

	if stats.ActiveKeys != 1 {
		t.Errorf("expected 1 active key, got %d", stats.ActiveKeys)
	}
	if stats.HealthyCount != 1 {
		t.Errorf("expected 1 healthy key, got %d", stats.HealthyCount)
	}
	if stats.TotalRequestsToday != 2 {
		t.Errorf("expected 2 total requests today, got %d", stats.TotalRequestsToday)
	}
}

func TestAPI_TestKey(t *testing.T) {
	handler, mux, cleanup := setupTestAPI(t)
	defer cleanup()

	key := &domain.APIKey{
		ID:       "key-test-id",
		Label:    "Test Key",
		Provider: domain.ProviderGemini,
		Status:   domain.KeyHealthy,
	}
	handler.Manager.AddKey(key)

	req := httptest.NewRequest("POST", "/api/keys/key-test-id/test", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var resp TestKeyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal test response: %v", err)
	}
	if !resp.Success {
		t.Errorf("expected success true, got false")
	}

	// Test non-existent key returns 404
	req = httptest.NewRequest("POST", "/api/keys/non-existent/test", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", rec.Code)
	}
}

