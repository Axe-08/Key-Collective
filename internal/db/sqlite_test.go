package db

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/akshit/key-collective/internal/domain"
	"github.com/google/uuid"
)

func setupTestDB(t *testing.T) (*DB, func()) {
	t.Helper()
	tempDir, err := os.MkdirTemp("", "kc_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	dbPath := filepath.Join(tempDir, "test.db")
	database, err := InitDB(dbPath)
	if err != nil {
		os.RemoveAll(tempDir)
		t.Fatalf("failed to init test db: %v", err)
	}

	cleanup := func() {
		database.Close()
		os.RemoveAll(tempDir)
	}

	return database, cleanup
}

func TestDB_InsertAndGetKeys(t *testing.T) {
	database, cleanup := setupTestDB(t)
	defer cleanup()

	key1 := &domain.APIKey{
		ID:        uuid.New().String(),
		KeyHash:   "hash1",
		KeyPrefix: "AIzaSy",
		KeySuffix: "1234",
		Provider:  domain.ProviderGemini,
		Label:     "Gemini Test Key",
		RPMLimit:  15,
		RPDLimit:  1500,
		Priority:  1,
		Status:    domain.KeyHealthy,
	}
	blob1 := []byte("encrypted_blob_1")

	key2 := &domain.APIKey{
		ID:        uuid.New().String(),
		KeyHash:   "hash2",
		KeyPrefix: "gsk_te",
		KeySuffix: "5678",
		Provider:  domain.ProviderGroq,
		Label:     "Groq Test Key",
		RPMLimit:  30,
		RPDLimit:  14400,
		Priority:  0,
		Status:    domain.KeyRateLimited,
	}
	blob2 := []byte("encrypted_blob_2")

	// Insert keys
	if err := database.InsertKey(key1, blob1); err != nil {
		t.Fatalf("failed to insert key1: %v", err)
	}
	if err := database.InsertKey(key2, blob2); err != nil {
		t.Fatalf("failed to insert key2: %v", err)
	}

	// Retrieve keys
	keys, err := database.GetKeys()
	if err != nil {
		t.Fatalf("failed to get keys: %v", err)
	}

	if len(keys) != 2 {
		t.Fatalf("expected 2 keys, got %d", len(keys))
	}

	// Priority order check (Priority 0 first, then Priority 1)
	if keys[0].ID != key2.ID {
		t.Errorf("expected keys[0] to be key2 (priority 0), got ID %s", keys[0].ID)
	}
	if string(keys[0].EncryptedKey) != string(blob2) {
		t.Errorf("expected encrypted blob %q, got %q", blob2, keys[0].EncryptedKey)
	}

	if keys[1].ID != key1.ID {
		t.Errorf("expected keys[1] to be key1 (priority 1), got ID %s", keys[1].ID)
	}
	if string(keys[1].EncryptedKey) != string(blob1) {
		t.Errorf("expected encrypted blob %q, got %q", blob1, keys[1].EncryptedKey)
	}
}

func TestDB_DeleteKey(t *testing.T) {
	database, cleanup := setupTestDB(t)
	defer cleanup()

	key := &domain.APIKey{
		ID:        "key_to_delete",
		KeyHash:   "hash_del",
		KeyPrefix: "prefix",
		KeySuffix: "suff",
		Provider:  domain.ProviderGemini,
		Label:     "Delete Me",
		RPMLimit:  15,
		RPDLimit:  1500,
		Priority:  0,
		Status:    domain.KeyHealthy,
	}
	if err := database.InsertKey(key, []byte("blob")); err != nil {
		t.Fatalf("failed to insert key: %v", err)
	}

	// Delete existing key
	if err := database.DeleteKey("key_to_delete"); err != nil {
		t.Fatalf("failed to delete key: %v", err)
	}

	// Verify deleted
	keys, err := database.GetKeys()
	if err != nil {
		t.Fatalf("failed to get keys: %v", err)
	}
	if len(keys) != 0 {
		t.Fatalf("expected 0 keys, got %d", len(keys))
	}

	// Deleting again should error
	if err := database.DeleteKey("key_to_delete"); err == nil {
		t.Errorf("expected error deleting non-existent key, got nil")
	}
}

func TestDB_LogsAndStats(t *testing.T) {
	database, cleanup := setupTestDB(t)
	defer cleanup()

	// Insert keys with different statuses
	k1 := &domain.APIKey{
		ID:        "k1",
		KeyHash:   "h1",
		KeyPrefix: "p1",
		KeySuffix: "s1",
		Provider:  domain.ProviderGemini,
		Label:     "K1",
		RPMLimit:  15,
		RPDLimit:  1500,
		Status:    domain.KeyHealthy,
	}
	k2 := &domain.APIKey{
		ID:        "k2",
		KeyHash:   "h2",
		KeyPrefix: "p2",
		KeySuffix: "s2",
		Provider:  domain.ProviderGroq,
		Label:     "K2",
		RPMLimit:  30,
		RPDLimit:  14400,
		Status:    domain.KeyRateLimited,
	}
	k3 := &domain.APIKey{
		ID:        "k3",
		KeyHash:   "h3",
		KeyPrefix: "p3",
		KeySuffix: "s3",
		Provider:  domain.ProviderGemini,
		Label:     "K3 Disabled",
		RPMLimit:  15,
		RPDLimit:  1500,
		Status:    domain.KeyDisabled,
	}

	_ = database.InsertKey(k1, []byte("b1"))
	_ = database.InsertKey(k2, []byte("b2"))
	_ = database.InsertKey(k3, []byte("b3"))

	// Insert request logs
	log1 := &domain.RequestLog{
		KeyID:      "k1",
		Provider:   domain.ProviderGemini,
		StatusCode: 200,
		LatencyMs:  120.5,
		BytesIn:    100,
		BytesOut:   500,
		CreatedAt:  time.Now(),
	}
	log2 := &domain.RequestLog{
		KeyID:      "k2",
		Provider:   domain.ProviderGroq,
		StatusCode: 429,
		LatencyMs:  45.2,
		BytesIn:    80,
		BytesOut:   150,
		CreatedAt:  time.Now(),
	}

	if err := database.InsertLog(log1); err != nil {
		t.Fatalf("failed to insert log1: %v", err)
	}
	if err := database.InsertLog(log2); err != nil {
		t.Fatalf("failed to insert log2: %v", err)
	}

	// Test GetRecentLogs
	logs, err := database.GetRecentLogs(10)
	if err != nil {
		t.Fatalf("failed to get recent logs: %v", err)
	}
	if len(logs) != 2 {
		t.Fatalf("expected 2 logs, got %d", len(logs))
	}
	if logs[0].StatusCode != 429 && logs[1].StatusCode != 429 {
		t.Errorf("expected logs to contain status code 429")
	}

	// Test GetStats
	stats, err := database.GetStats()
	if err != nil {
		t.Fatalf("failed to get stats: %v", err)
	}

	if stats.ActiveKeys != 2 { // k1 and k2 active, k3 disabled
		t.Errorf("expected 2 active keys, got %d", stats.ActiveKeys)
	}
	if stats.HealthyCount != 1 {
		t.Errorf("expected 1 healthy key, got %d", stats.HealthyCount)
	}
	if stats.RateLimitedCount != 1 {
		t.Errorf("expected 1 rate-limited key, got %d", stats.RateLimitedCount)
	}
	if stats.TotalRequestsToday != 2 {
		t.Errorf("expected 2 total requests today, got %d", stats.TotalRequestsToday)
	}
}
