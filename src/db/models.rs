use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Registered agent in the system
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Agent {
    pub id: Uuid,
    pub hostname: String,
    pub os_name: String,
    pub kernel_version: String,
    pub agent_version: String,
    pub cpu_cores: i32,
    pub cpu_name: String,
    pub api_key_hash: String,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub is_online: bool,
    pub agent_group: Option<String>,
    /// Number of times the agent has reconnected
    pub reconnect_count: i32,
    /// Timestamp of last disconnect
    pub last_disconnect_at: Option<DateTime<Utc>>,
    /// Last measured RTT in milliseconds
    pub last_rtt_ms: Option<i32>,
    /// Timestamp of last RTT measurement
    pub last_rtt_at: Option<DateTime<Utc>>,
    /// Whether agent is running as root
    pub is_root: bool,
    /// Number of messages waiting in offline queue
    pub queue_pending_count: i32,
    /// Size of pending queue in bytes
    pub queue_pending_bytes: i64,
}

/// Core metrics snapshot
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct MetricsRecord {
    pub time: DateTime<Utc>,
    pub agent_id: Uuid,
    pub cpu_usage: f64,
    pub cpu_io_wait: f64,
    pub memory_used_kib: i64,
    pub memory_available_kib: i64,
    pub memory_total_kib: i64,
    pub swap_free_kib: i64,
    pub swap_total_kib: i64,
}

/// Disk I/O metrics
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct DiskMetricsRecord {
    pub time: DateTime<Utc>,
    pub agent_id: Uuid,
    pub device: String,
    pub read_ops: i64,
    pub write_ops: i64,
    pub read_time_ms: i64,
    pub write_time_ms: i64,
}

/// Network interface metrics
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct NetworkMetricsRecord {
    pub time: DateTime<Utc>,
    pub agent_id: Uuid,
    pub interface_name: String,
    pub bytes_received: i64,
    pub bytes_transmitted: i64,
}

/// Process snapshot record
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ProcessSnapshotRecord {
    pub time: DateTime<Utc>,
    pub agent_id: Uuid,
    pub pid: i32,
    pub name: String,
    pub state: String,
    pub ppid: i32,
    pub cpu_percent: f64,
    pub memory_rss_kib: i64,
    pub memory_vsz_kib: i64,
    pub threads: i32,
    pub username: String,
    pub cmdline: Option<String>,
    pub start_time: i64,
}

/// Agent creation request
#[derive(Debug)]
pub struct NewAgent {
    pub id: Uuid,
    pub hostname: String,
    pub os_name: String,
    pub kernel_version: String,
    pub agent_version: String,
    pub cpu_cores: i32,
    pub cpu_name: String,
    pub api_key_hash: String,
    pub agent_group: Option<String>,
    pub is_root: bool,
    pub queue_pending_count: i32,
    pub queue_pending_bytes: i64,
}

/// Cached command response (for dashboard retrieval)
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct CommandResponseRecord {
    pub command_id: String,
    pub agent_id: Uuid,
    pub success: bool,
    pub message: String,
    pub config_json: Option<String>,
    pub swap_processes_json: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Result of deleting metrics
#[derive(Debug, Serialize)]
pub struct DeletedMetricsCount {
    pub metrics: u64,
    pub disk_metrics: u64,
    pub network_metrics: u64,
}

/// Server statistics
#[derive(Debug, Serialize)]
pub struct ServerStats {
    pub agents_total: u64,
    pub agents_online: u64,
    pub metrics_count: u64,
    pub disk_metrics_count: u64,
    pub network_metrics_count: u64,
    pub oldest_metric: Option<DateTime<Utc>>,
    pub newest_metric: Option<DateTime<Utc>>,
}

/// Service metrics record (nginx, tomcat, etc.)
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ServiceMetricsRecord {
    pub time: DateTime<Utc>,
    pub agent_id: Uuid,
    pub service_name: String,
    pub plugin_type: String,
    pub is_running: bool,

    // CPU metrics
    pub cpu_usage_usec: i64,
    pub cpu_percent: f64,
    pub cpu_user_usec: i64,
    pub cpu_system_usec: i64,

    // Memory metrics
    pub memory_current_bytes: i64,
    pub memory_swap_bytes: i64,
    pub memory_anon_bytes: i64,
    pub memory_file_bytes: i64,

    // Disk I/O metrics
    pub disk_read_bytes: i64,
    pub disk_write_bytes: i64,
    pub disk_read_ops: i64,
    pub disk_write_ops: i64,

    // Network I/O metrics
    pub net_rx_bytes: i64,
    pub net_tx_bytes: i64,

    // Process/thread counts
    pub process_count: i32,
    pub thread_count: i64,

    // Data source info
    pub cgroup_version: Option<i32>,
    pub data_source: i32,
}

/// Service process record (individual process within a service)
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ServiceProcessRecord {
    pub time: DateTime<Utc>,
    pub agent_id: Uuid,
    pub service_name: String,
    pub pid: i32,
    pub name: String,
    pub cpu_percent: f64,
    pub memory_bytes: i64,
    pub threads: i64,
}

/// Summary of services for an agent
#[derive(Debug, Clone, Serialize)]
pub struct ServiceSummary {
    pub service_name: String,
    pub plugin_type: String,
    pub is_running: bool,
    pub last_seen: DateTime<Utc>,
}

/// Database health check info
#[derive(Debug, Clone, Serialize)]
pub struct HealthInfo {
    /// TimescaleDB version if available, None if not installed
    pub timescaledb_version: Option<String>,
}

