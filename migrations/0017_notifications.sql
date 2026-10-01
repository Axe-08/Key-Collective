-- Migration 0017: Notifications table (WP-4.3 T-4.3.3)
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  key_id TEXT,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notif_tenant_created ON notifications(tenant_id, created_at);
