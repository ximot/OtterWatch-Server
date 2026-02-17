-- Process snapshots table
-- Stores periodic snapshots of top processes per agent

CREATE TABLE IF NOT EXISTS process_snapshots (
    time TIMESTAMPTZ NOT NULL,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    pid INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    state CHAR(1) NOT NULL,
    ppid INTEGER NOT NULL,
    cpu_percent DOUBLE PRECISION NOT NULL,
    memory_rss_kib BIGINT NOT NULL,
    memory_vsz_kib BIGINT NOT NULL,
    threads INTEGER NOT NULL,
    username VARCHAR(64) NOT NULL,
    cmdline TEXT,
    start_time BIGINT NOT NULL,
    PRIMARY KEY (time, agent_id, pid)
);

CREATE INDEX IF NOT EXISTS idx_process_snapshots_agent_id ON process_snapshots(agent_id);
CREATE INDEX IF NOT EXISTS idx_process_snapshots_time ON process_snapshots(time DESC);
CREATE INDEX IF NOT EXISTS idx_process_snapshots_cpu ON process_snapshots(cpu_percent DESC);

-- Convert to hypertable if TimescaleDB is available
-- SELECT create_hypertable('process_snapshots', 'time', if_not_exists => TRUE);
