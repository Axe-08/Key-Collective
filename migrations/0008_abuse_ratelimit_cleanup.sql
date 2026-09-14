-- Migration 0008: Remove abuse_rate_limits table as it's now managed centrally
DROP TABLE IF EXISTS abuse_rate_limits;
