-- Migration: 0010_purge_all_keys.sql
-- Description: Clean-slate purge of all upstream API keys for isolated QA testing
-- Invariants Enforced:
-- 1. Clears api_keys table completely without altering table schema or constraints.
-- 2. Preserves users, auth_tokens, projects, and contributor standing accounts.

DELETE FROM api_keys;
