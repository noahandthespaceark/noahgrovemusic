-- Phase 1 standalone integration groundwork. Additive only.
-- Apply to the D1 binding selected for cross-app integration when that binding is designated.
CREATE TABLE IF NOT EXISTS integration_links (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, canonical_id TEXT NOT NULL, local_type TEXT NOT NULL, local_id TEXT NOT NULL, source_app TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(entity_type, canonical_id, local_type, local_id), UNIQUE(source_app, local_type, local_id, entity_type));
CREATE INDEX IF NOT EXISTS idx_integration_links_canonical ON integration_links(entity_type, canonical_id);
CREATE INDEX IF NOT EXISTS idx_integration_links_local ON integration_links(source_app, local_type, local_id);
CREATE TABLE IF NOT EXISTS integration_event_receipts (event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, source_app TEXT NOT NULL, source_record_id TEXT, idempotency_key TEXT NOT NULL UNIQUE, gig_id TEXT, contact_id TEXT, venue_id TEXT, payload_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'received', received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, processed_at TEXT, error_message TEXT);
CREATE INDEX IF NOT EXISTS idx_integration_receipts_subject ON integration_event_receipts(gig_id, contact_id, venue_id);
CREATE INDEX IF NOT EXISTS idx_integration_receipts_status ON integration_event_receipts(status, received_at);
