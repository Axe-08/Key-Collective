package domain

import "time"

type Provider string

const (
	ProviderGemini Provider = "gemini"
	ProviderGroq   Provider = "groq"
)

type KeyStatus string

const (
	KeyHealthy     KeyStatus = "healthy"
	KeyRateLimited KeyStatus = "rate_limited"
	KeyExhausted   KeyStatus = "exhausted"
	KeyInvalid     KeyStatus = "invalid"
	KeyDisabled    KeyStatus = "disabled"
)

type APIKey struct {
	ID           string    `json:"id" db:"id"`
	KeyHash      string    `json:"-" db:"key_hash"`
	KeyPrefix    string    `json:"key_prefix" db:"key_prefix"`
	KeySuffix    string    `json:"key_suffix" db:"key_suffix"`
	EncryptedKey []byte    `json:"-" db:"encrypted_key"`
	Provider     Provider  `json:"provider" db:"provider"`
	Label        string    `json:"label" db:"label"`
	RPMLimit     int       `json:"rpm_limit" db:"rpm_limit"`
	RPDLimit     int       `json:"rpd_limit" db:"rpd_limit"`
	Priority     int       `json:"priority" db:"priority"`
	Status       KeyStatus `json:"status" db:"status"`

	// Runtime State (not persisted to DB immediately)
	RequestsThisMin   int       `json:"-"`
	RequestsToday     int       `json:"-"`
	MinuteWindowStart time.Time `json:"-"`
	TotalLatencyMs    float64   `json:"-"`
	TotalRequests     int64     `json:"-"`
	CooldownUntil     time.Time `json:"-"`
}

type RequestLog struct {
	ID         string    `json:"id"`
	KeyID      string    `json:"key_id"`
	Provider   Provider  `json:"provider"`
	StatusCode int       `json:"status_code"`
	LatencyMs  float64   `json:"latency_ms"`
	BytesIn    int64     `json:"bytes_in"`
	BytesOut   int64     `json:"bytes_out"`
	CreatedAt  time.Time `json:"created_at"`
}
