-- Add connection statistics columns to agents table

-- Count of reconnections since agent was first registered
ALTER TABLE agents ADD COLUMN IF NOT EXISTS reconnect_count INTEGER NOT NULL DEFAULT 0;

-- Timestamp of last disconnect event
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_disconnect_at TIMESTAMPTZ;

-- Last measured RTT (round-trip time) in milliseconds
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_rtt_ms INTEGER;

-- Timestamp of last RTT measurement
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_rtt_at TIMESTAMPTZ;

-- Create index for querying unstable connections
CREATE INDEX IF NOT EXISTS idx_agents_reconnect_count ON agents(reconnect_count DESC);
