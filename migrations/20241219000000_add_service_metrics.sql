-- Service metrics table for plugin monitoring (nginx, tomcat, etc.)
CREATE TABLE IF NOT EXISTS service_metrics (
    time TIMESTAMPTZ NOT NULL,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    service_name VARCHAR(100) NOT NULL,
    plugin_type VARCHAR(50) NOT NULL,
    is_running BOOLEAN NOT NULL DEFAULT false,

    -- CPU metrics
    cpu_usage_usec BIGINT DEFAULT 0,
    cpu_percent DOUBLE PRECISION DEFAULT 0,
    cpu_user_usec BIGINT DEFAULT 0,
    cpu_system_usec BIGINT DEFAULT 0,

    -- Memory metrics
    memory_current_bytes BIGINT DEFAULT 0,
    memory_swap_bytes BIGINT DEFAULT 0,
    memory_anon_bytes BIGINT DEFAULT 0,
    memory_file_bytes BIGINT DEFAULT 0,

    -- Disk I/O metrics
    disk_read_bytes BIGINT DEFAULT 0,
    disk_write_bytes BIGINT DEFAULT 0,
    disk_read_ops BIGINT DEFAULT 0,
    disk_write_ops BIGINT DEFAULT 0,

    -- Network I/O metrics
    net_rx_bytes BIGINT DEFAULT 0,
    net_tx_bytes BIGINT DEFAULT 0,

    -- Process/thread counts
    process_count INTEGER DEFAULT 0,
    thread_count BIGINT DEFAULT 0,

    -- Data source info
    cgroup_version INTEGER,           -- 1 or 2 if using cgroup, NULL if proc
    data_source INTEGER DEFAULT 0,    -- 0=unknown, 1=cgroupv2, 2=cgroupv1, 3=procfs

    PRIMARY KEY (time, agent_id, service_name)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_service_metrics_agent_id ON service_metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_service_metrics_time ON service_metrics(time DESC);
CREATE INDEX IF NOT EXISTS idx_service_metrics_service ON service_metrics(agent_id, service_name);

-- Service processes table for per-process details within a service
CREATE TABLE IF NOT EXISTS service_processes (
    time TIMESTAMPTZ NOT NULL,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    service_name VARCHAR(100) NOT NULL,
    pid INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    cpu_percent DOUBLE PRECISION DEFAULT 0,
    memory_bytes BIGINT DEFAULT 0,
    threads BIGINT DEFAULT 0,

    PRIMARY KEY (time, agent_id, service_name, pid)
);

CREATE INDEX IF NOT EXISTS idx_service_processes_agent ON service_processes(agent_id, service_name);
CREATE INDEX IF NOT EXISTS idx_service_processes_time ON service_processes(time DESC);
