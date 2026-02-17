-- OtterWatch Server Database Schema
-- Designed for PostgreSQL with TimescaleDB extension

-- Enable TimescaleDB extension (if available)
-- CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY,
    hostname VARCHAR(255) NOT NULL,
    os_name VARCHAR(255) NOT NULL,
    kernel_version VARCHAR(100) NOT NULL,
    agent_version VARCHAR(50) NOT NULL,
    cpu_cores INTEGER NOT NULL,
    cpu_name VARCHAR(255) NOT NULL,
    api_key_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ,
    is_online BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_agents_hostname ON agents(hostname);
CREATE INDEX IF NOT EXISTS idx_agents_is_online ON agents(is_online);

-- Core metrics table
CREATE TABLE IF NOT EXISTS metrics (
    time TIMESTAMPTZ NOT NULL,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    cpu_usage DOUBLE PRECISION NOT NULL,
    cpu_io_wait DOUBLE PRECISION NOT NULL,
    memory_used_kib BIGINT NOT NULL,
    memory_available_kib BIGINT NOT NULL,
    memory_total_kib BIGINT NOT NULL,
    swap_free_kib BIGINT NOT NULL,
    swap_total_kib BIGINT NOT NULL,
    PRIMARY KEY (time, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_metrics_agent_id ON metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_metrics_time ON metrics(time DESC);

-- Convert to hypertable if TimescaleDB is available
-- SELECT create_hypertable('metrics', 'time', if_not_exists => TRUE);

-- Disk I/O metrics
CREATE TABLE IF NOT EXISTS disk_metrics (
    time TIMESTAMPTZ NOT NULL,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    device VARCHAR(50) NOT NULL,
    read_ops BIGINT NOT NULL,
    write_ops BIGINT NOT NULL,
    read_time_ms BIGINT NOT NULL,
    write_time_ms BIGINT NOT NULL,
    PRIMARY KEY (time, agent_id, device)
);

CREATE INDEX IF NOT EXISTS idx_disk_metrics_agent_id ON disk_metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_disk_metrics_time ON disk_metrics(time DESC);

-- Convert to hypertable if TimescaleDB is available
-- SELECT create_hypertable('disk_metrics', 'time', if_not_exists => TRUE);

-- Network metrics
CREATE TABLE IF NOT EXISTS network_metrics (
    time TIMESTAMPTZ NOT NULL,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    interface_name VARCHAR(50) NOT NULL,
    bytes_received BIGINT NOT NULL,
    bytes_transmitted BIGINT NOT NULL,
    PRIMARY KEY (time, agent_id, interface_name)
);

CREATE INDEX IF NOT EXISTS idx_network_metrics_agent_id ON network_metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_network_metrics_time ON network_metrics(time DESC);

-- Convert to hypertable if TimescaleDB is available
-- SELECT create_hypertable('network_metrics', 'time', if_not_exists => TRUE);
