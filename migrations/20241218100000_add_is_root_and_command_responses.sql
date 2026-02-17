-- Add is_root column to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_root BOOLEAN NOT NULL DEFAULT false;

-- Create table for caching command responses (for dashboard retrieval)
CREATE TABLE IF NOT EXISTS command_responses (
    command_id TEXT PRIMARY KEY,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    success BOOLEAN NOT NULL,
    message TEXT NOT NULL,
    config_json TEXT, -- JSON serialized AgentConfig for get-config responses
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookup by agent and time
CREATE INDEX IF NOT EXISTS idx_command_responses_agent_time
ON command_responses(agent_id, created_at DESC);

-- Auto-cleanup old responses (keep for 1 hour max)
-- Note: This would typically be done by a background job, but we add an index to facilitate it
CREATE INDEX IF NOT EXISTS idx_command_responses_cleanup
ON command_responses(created_at);
