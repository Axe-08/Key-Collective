package db

import (
	"database/sql"
	"fmt"
	"log"

	_ "modernc.org/sqlite"
)

func InitDB(dbPath string) (*sql.DB, error) {
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
	return db, nil
}
