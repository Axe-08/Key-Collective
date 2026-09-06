package db

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/akshit/key-collective/internal/domain"
	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

type DB struct {
	*sql.DB
}

func New(sqlDB *sql.DB) *DB {
	return &DB{DB: sqlDB}
}

func InitDB(dbPath string) (*DB, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}

	// WAL mode for concurrency
	if _, err := db.Exec("PRAGMA journal_mode=WAL;"); err != nil {
		return nil, fmt.Errorf("failed to enable WAL: %w", err)
	}

	schema := `
	CREATE TABLE IF NOT EXISTS api_keys (
		id TEXT PRIMARY KEY,
		key_hash TEXT UNIQUE NOT NULL,
		key_prefix TEXT NOT NULL,
		key_suffix TEXT NOT NULL,
		encrypted_key BLOB NOT NULL,
		provider TEXT NOT NULL,
		label TEXT NOT NULL,
		rpm_limit INTEGER NOT NULL,
		rpd_limit INTEGER NOT NULL,
		priority INTEGER DEFAULT 0,
		status TEXT DEFAULT 'healthy',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS auth_tokens (
		id TEXT PRIMARY KEY,
		token_hash TEXT UNIQUE NOT NULL,
		label TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		last_used_at DATETIME
	);

	CREATE TABLE IF NOT EXISTS request_logs (
		id TEXT PRIMARY KEY,
		key_id TEXT,
		provider TEXT,
		status_code INTEGER,
		latency_ms REAL,
		bytes_in INTEGER,
		bytes_out INTEGER,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("failed to apply schema: %w", err)
	}

	log.Println("Database initialized in WAL mode")
	return &DB{DB: db}, nil
}

// InsertKey persists a new API key with its encrypted blob
func (db *DB) InsertKey(key *domain.APIKey, encrypted []byte) error {
	if key.ID == "" {
		key.ID = uuid.New().String()
	}
	if key.Status == "" {
		key.Status = domain.KeyHealthy
	}
	key.EncryptedKey = encrypted

	query := `
		INSERT INTO api_keys (id, key_hash, key_prefix, key_suffix, encrypted_key, provider, label, rpm_limit, rpd_limit, priority, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err := db.Exec(query,
		key.ID,
		key.KeyHash,
		key.KeyPrefix,
		key.KeySuffix,
		encrypted,
		string(key.Provider),
		key.Label,
		key.RPMLimit,
		key.RPDLimit,
		key.Priority,
		string(key.Status),
	)
	if err != nil {
		return fmt.Errorf("failed to insert api key: %w", err)
	}
	return nil
}

// GetKeys loads all active keys with encrypted blob to decrypt into memory
func (db *DB) GetKeys() ([]*domain.APIKey, error) {
	query := `
		SELECT id, key_hash, key_prefix, key_suffix, encrypted_key, provider, label, rpm_limit, rpd_limit, priority, status
		FROM api_keys
		WHERE status != 'disabled'
		ORDER BY priority ASC, created_at ASC
	`
	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query api keys: %w", err)
	}
	defer rows.Close()

	keys := make([]*domain.APIKey, 0)
	for rows.Next() {
		var k domain.APIKey
		var provider string
		var status string
		err := rows.Scan(
			&k.ID,
			&k.KeyHash,
			&k.KeyPrefix,
			&k.KeySuffix,
			&k.EncryptedKey,
			&provider,
			&k.Label,
			&k.RPMLimit,
			&k.RPDLimit,
			&k.Priority,
			&status,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan api key row: %w", err)
		}
		k.Provider = domain.Provider(provider)
		k.Status = domain.KeyStatus(status)
		k.MinuteWindowStart = time.Now()
		keys = append(keys, &k)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("row iteration error: %w", err)
	}
	return keys, nil
}

// DeleteKey removes an API key from the database by ID
func (db *DB) DeleteKey(id string) error {
	res, err := db.Exec("DELETE FROM api_keys WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("failed to delete api key: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("key with id %s not found: %w", id, sql.ErrNoRows)
	}
	return nil
}

// GetRecentLogs returns the latest request logs up to limit
func (db *DB) GetRecentLogs(limit int) ([]*domain.RequestLog, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `
		SELECT id, COALESCE(key_id, ''), provider, status_code, latency_ms, bytes_in, bytes_out, created_at
		FROM request_logs
		ORDER BY created_at DESC
		LIMIT ?
	`
	rows, err := db.Query(query, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query request logs: %w", err)
	}
	defer rows.Close()

	logs := make([]*domain.RequestLog, 0)
	for rows.Next() {
		var l domain.RequestLog
		var provider string
		var rawCreatedAt any
		err := rows.Scan(
			&l.ID,
			&l.KeyID,
			&provider,
			&l.StatusCode,
			&l.LatencyMs,
			&l.BytesIn,
			&l.BytesOut,
			&rawCreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan request log row: %w", err)
		}
		l.Provider = domain.Provider(provider)
		switch v := rawCreatedAt.(type) {
		case time.Time:
			l.CreatedAt = v
		case string:
			if parsed, err := time.Parse("2006-01-02 15:04:05", v); err == nil {
				l.CreatedAt = parsed
			} else if parsed, err := time.Parse(time.RFC3339, v); err == nil {
				l.CreatedAt = parsed
			} else if parsed, err := time.Parse(time.RFC3339Nano, v); err == nil {
				l.CreatedAt = parsed
			}
		}
		logs = append(logs, &l)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("row iteration error: %w", err)
	}
	return logs, nil
}

// GetStats computes aggregate metrics across keys and request logs
func (db *DB) GetStats() (*domain.ProxyStats, error) {
	stats := &domain.ProxyStats{}
	row := db.QueryRow(`
		SELECT 
			COUNT(CASE WHEN status != 'disabled' THEN 1 END),
			COUNT(CASE WHEN status = 'healthy' THEN 1 END),
			COUNT(CASE WHEN status = 'rate_limited' THEN 1 END)
		FROM api_keys
	`)
	if err := row.Scan(&stats.ActiveKeys, &stats.HealthyCount, &stats.RateLimitedCount); err != nil {
		return nil, fmt.Errorf("failed to scan key stats: %w", err)
	}

	todayUTC := time.Now().UTC().Format("2006-01-02")
	err := db.QueryRow(`
		SELECT COUNT(*) 
		FROM request_logs 
		WHERE date(created_at) = date('now') 
		   OR date(created_at) = ? 
		   OR created_at LIKE ?
	`, todayUTC, todayUTC+"%").Scan(&stats.TotalRequestsToday)
	if err != nil {
		return nil, fmt.Errorf("failed to scan request logs stats: %w", err)
	}

	return stats, nil
}

// InsertLog writes a single request log entry to SQLite
func (db *DB) InsertLog(l *domain.RequestLog) error {
	if l.ID == "" {
		l.ID = uuid.New().String()
	}
	if l.CreatedAt.IsZero() {
		l.CreatedAt = time.Now()
	}
	query := `
		INSERT INTO request_logs (id, key_id, provider, status_code, latency_ms, bytes_in, bytes_out, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err := db.Exec(query,
		l.ID,
		l.KeyID,
		string(l.Provider),
		l.StatusCode,
		l.LatencyMs,
		l.BytesIn,
		l.BytesOut,
		l.CreatedAt.UTC().Format("2006-01-02 15:04:05"),
	)
	if err != nil {
		return fmt.Errorf("failed to insert request log: %w", err)
	}
	return nil
}
