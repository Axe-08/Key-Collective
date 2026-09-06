package proxy

import (
	"testing"
	"time"

	"github.com/akshit/key-collective/internal/domain"
)

func TestKeyManager_GetBestKey(t *testing.T) {
	keys := []*domain.APIKey{
		{
			ID:       "gemini_1",
			Provider: domain.ProviderGemini,
			RPMLimit: 15,
			Status:   domain.KeyHealthy,
			Priority: 0,
		},
		{
			ID:       "groq_1",
			Provider: domain.ProviderGroq,
			RPMLimit: 30,
			Status:   domain.KeyHealthy,
			Priority: 1,
		},
	}

	km := NewKeyManager(keys, 500)

	// Test 1: Get any key
	best, err := km.GetBestKey("")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if best.ID != "gemini_1" {
		t.Errorf("expected gemini_1 (highest priority), got %s", best.ID)
	}

	// Test 2: Get specific provider
	best, err = km.GetBestKey(domain.ProviderGroq)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if best.ID != "groq_1" {
		t.Errorf("expected groq_1, got %s", best.ID)
	}

	// Test 3: Circuit breaker cooldown
	km.ReportError(keys[0], 429)
	if keys[0].Status != domain.KeyRateLimited {
		t.Errorf("expected gemini_1 to be rate limited")
	}

	// Since gemini is rate limited, groq should be selected as fallback even if gemini preferred
	best, err = km.GetBestKey(domain.ProviderGemini)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if best.ID != "groq_1" {
		t.Errorf("expected groq_1 fallback, got %s", best.ID)
	}

	// Test 4: Sliding window reset simulation
	// artificially expire cooldown
	keys[0].CooldownUntil = time.Now().Add(-1 * time.Minute)
	
	best, err = km.GetBestKey(domain.ProviderGemini)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if best.ID != "gemini_1" {
		t.Errorf("expected gemini_1 to recover, got %s", best.ID)
	}
}
