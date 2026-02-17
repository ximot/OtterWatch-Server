-- Add queue status fields to track offline message queue on agents
ALTER TABLE agents ADD COLUMN queue_pending_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN queue_pending_bytes BIGINT NOT NULL DEFAULT 0;
