package proxy

import (
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/akshit/key-collective/internal/domain"
)

type KeyManager struct {
	keys       []*domain.APIKey
	mu         sync.RWMutex
	dailyLimit int
}

func NewKeyManager(keys []*domain.APIKey, dailyLimit int) *KeyManager {
	return &KeyManager{
		keys:       keys,
		dailyLimit: dailyLimit,
	}
}

// GetBestKey selects the most optimal key based on priority, RPM headroom, and latency
func (km *KeyManager) GetBestKey(preferredProvider domain.Provider) (*domain.APIKey, error) {
	km.mu.Lock()
	defer km.mu.Unlock()

	now := time.Now()
	totalToday := 0

	// Sliding window resets and global quota check
	for _, k := range km.keys {
		totalToday += k.RequestsToday

		// Reset minute window if 60s passed
		if now.Sub(k.MinuteWindowStart).Seconds() >= 60 {
			k.RequestsThisMin = 0
			k.MinuteWindowStart = now
		}

		// Reset cooldown if expired
		if k.Status == domain.KeyRateLimited && now.After(k.CooldownUntil) {
			k.Status = domain.KeyHealthy
		}
	}

	if totalToday >= km.dailyLimit {
		return nil, errors.New("global daily LLM quota ceiling reached")
	}

	var available []*domain.APIKey
	for _, k := range km.keys {
		if k.Status == domain.KeyHealthy && k.RPMLimit-k.RequestsThisMin > 0 {
			if preferredProvider == "" || k.Provider == preferredProvider {
				available = append(available, k)
			}
		}
	}

	// Fallback to any provider if preferred is exhausted
	if len(available) == 0 && preferredProvider != "" {
		for _, k := range km.keys {
			if k.Status == domain.KeyHealthy && k.RPMLimit-k.RequestsThisMin > 0 {
				available = append(available, k)
			}
		}
	}

	if len(available) == 0 {
		return nil, errors.New("all keys exhausted or in cooldown")
	}

	// Sort logic: Provider Match (1st) -> Priority (Lowest first) -> RPM Headroom (Most) -> Avg Latency (Lowest)
	sort.Slice(available, func(i, j int) bool {
		a := available[i]
		b := available[j]

		aMatch := 1
		if a.Provider == preferredProvider {
			aMatch = 0
		}
		bMatch := 1
		if b.Provider == preferredProvider {
			bMatch = 0
		}
		
		if aMatch != bMatch {
			return aMatch < bMatch
		}

		if a.Priority != b.Priority {
			return a.Priority < b.Priority
		}

		aRPMRemaining := a.RPMLimit - a.RequestsThisMin
		bRPMRemaining := b.RPMLimit - b.RequestsThisMin
		if aRPMRemaining != bRPMRemaining {
			return aRPMRemaining > bRPMRemaining
		}

		var aAvg, bAvg float64
		if a.TotalRequests > 0 {
			aAvg = a.TotalLatencyMs / float64(a.TotalRequests)
		}
		if b.TotalRequests > 0 {
			bAvg = b.TotalLatencyMs / float64(b.TotalRequests)
		}
		return aAvg < bAvg
	})

	best := available[0]
	best.RequestsThisMin++
	best.RequestsToday++
	return best, nil
}

func (km *KeyManager) ReportSuccess(key *domain.APIKey, latencyMs float64) {
	km.mu.Lock()
	defer km.mu.Unlock()

	key.TotalRequests++
	key.TotalLatencyMs += latencyMs
	key.Status = domain.KeyHealthy
}

func (km *KeyManager) ReportError(key *domain.APIKey, statusCode int) {
	km.mu.Lock()
	defer km.mu.Unlock()

	if statusCode == 429 || statusCode >= 500 {
		key.Status = domain.KeyRateLimited
		key.CooldownUntil = time.Now().Add(60 * time.Second)
	} else if statusCode == 401 || statusCode == 403 {
		key.Status = domain.KeyInvalid
	}
}
