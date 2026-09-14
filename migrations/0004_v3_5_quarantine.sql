-- Migration: 0004_v3_5_quarantine.sql
-- Description: Add is_quarantined and quarantine_reason to users table

ALTER TABLE users ADD COLUMN is_quarantined INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN quarantine_reason TEXT;
