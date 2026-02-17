-- Add agent group support
-- Groups allow categorizing agents by application, server type, environment, etc.

ALTER TABLE agents ADD COLUMN agent_group VARCHAR(100);

-- Index for efficient filtering by group
CREATE INDEX IF NOT EXISTS idx_agents_group ON agents(agent_group);
