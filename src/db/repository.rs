use super::models::*;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

/// Repository for database operations
#[derive(Clone)]
pub struct Repository {
    pool: PgPool,
}

impl Repository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    // ============ Agents ============

    /// Get agent by ID
    pub async fn get_agent(&self, id: Uuid) -> Result<Option<Agent>, sqlx::Error> {
        sqlx::query_as::<_, Agent>("SELECT * FROM agents WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Get all agents
    pub async fn get_all_agents(&self) -> Result<Vec<Agent>, sqlx::Error> {
        sqlx::query_as::<_, Agent>("SELECT * FROM agents ORDER BY hostname")
            .fetch_all(&self.pool)
            .await
    }

    /// Create or update agent
    pub async fn upsert_agent(&self, agent: NewAgent) -> Result<Agent, sqlx::Error> {
        sqlx::query_as::<_, Agent>(
            r#"
            INSERT INTO agents (id, hostname, os_name, kernel_version, agent_version, cpu_cores, cpu_name, api_key_hash, agent_group, is_root, queue_pending_count, queue_pending_bytes, created_at, last_seen_at, is_online)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW(), true)
            ON CONFLICT (id) DO UPDATE SET
                hostname = EXCLUDED.hostname,
                os_name = EXCLUDED.os_name,
                kernel_version = EXCLUDED.kernel_version,
                agent_version = EXCLUDED.agent_version,
                cpu_cores = EXCLUDED.cpu_cores,
                cpu_name = EXCLUDED.cpu_name,
                agent_group = COALESCE(EXCLUDED.agent_group, agents.agent_group),
                is_root = EXCLUDED.is_root,
                queue_pending_count = EXCLUDED.queue_pending_count,
                queue_pending_bytes = EXCLUDED.queue_pending_bytes,
                last_seen_at = NOW(),
                is_online = true
            RETURNING *
            "#,
        )
        .bind(agent.id)
        .bind(agent.hostname)
        .bind(agent.os_name)
        .bind(agent.kernel_version)
        .bind(agent.agent_version)
        .bind(agent.cpu_cores)
        .bind(agent.cpu_name)
        .bind(agent.api_key_hash)
        .bind(&agent.agent_group)
        .bind(agent.is_root)
        .bind(agent.queue_pending_count)
        .bind(agent.queue_pending_bytes)
        .fetch_one(&self.pool)
        .await
    }

    /// Get agents filtered by group
    pub async fn get_agents_by_group(&self, group: &str) -> Result<Vec<Agent>, sqlx::Error> {
        sqlx::query_as::<_, Agent>("SELECT * FROM agents WHERE agent_group = $1 ORDER BY hostname")
            .bind(group)
            .fetch_all(&self.pool)
            .await
    }

    /// Get all unique agent groups
    pub async fn get_all_groups(&self) -> Result<Vec<String>, sqlx::Error> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT agent_group FROM agents WHERE agent_group IS NOT NULL ORDER BY agent_group",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|r| r.0).collect())
    }

    /// Update agent group
    pub async fn update_agent_group(
        &self,
        id: Uuid,
        group: Option<&str>,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("UPDATE agents SET agent_group = $2 WHERE id = $1")
            .bind(id)
            .bind(group)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Update agent online status (with reconnect tracking)
    pub async fn set_agent_online(&self, id: Uuid, online: bool) -> Result<(), sqlx::Error> {
        if online {
            // When coming online, increment reconnect_count
            sqlx::query(
                r#"
                UPDATE agents
                SET is_online = true,
                    last_seen_at = NOW(),
                    reconnect_count = CASE WHEN is_online = false THEN reconnect_count + 1 ELSE reconnect_count END
                WHERE id = $1
                "#
            )
            .bind(id)
            .execute(&self.pool)
            .await?;
        } else {
            // When going offline, record disconnect time
            sqlx::query(
                "UPDATE agents SET is_online = false, last_disconnect_at = NOW() WHERE id = $1",
            )
            .bind(id)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    /// Update agent RTT measurement
    pub async fn update_agent_rtt(&self, id: Uuid, rtt_ms: i32) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE agents SET last_rtt_ms = $2, last_rtt_at = NOW() WHERE id = $1")
            .bind(id)
            .bind(rtt_ms)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Update agent queue pending stats (from MetricsSnapshot)
    pub async fn update_agent_queue_stats(
        &self,
        id: Uuid,
        queue_pending_count: i32,
        queue_pending_bytes: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE agents SET queue_pending_count = $2, queue_pending_bytes = $3, last_seen_at = NOW() WHERE id = $1"
        )
        .bind(id)
        .bind(queue_pending_count)
        .bind(queue_pending_bytes)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Reset reconnect count for an agent
    #[allow(dead_code)]
    pub async fn reset_reconnect_count(&self, id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE agents SET reconnect_count = 0 WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ============ Metrics ============

    /// Insert metrics snapshot
    pub async fn insert_metrics(&self, metrics: &MetricsRecord) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO metrics (time, agent_id, cpu_usage, cpu_io_wait, memory_used_kib, memory_available_kib, memory_total_kib, swap_free_kib, swap_total_kib)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(metrics.time)
        .bind(metrics.agent_id)
        .bind(metrics.cpu_usage)
        .bind(metrics.cpu_io_wait)
        .bind(metrics.memory_used_kib)
        .bind(metrics.memory_available_kib)
        .bind(metrics.memory_total_kib)
        .bind(metrics.swap_free_kib)
        .bind(metrics.swap_total_kib)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Get metrics for an agent within a time range (limited to 10000 rows, ordered ASC for charts)
    pub async fn get_metrics(
        &self,
        agent_id: Uuid,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<MetricsRecord>, sqlx::Error> {
        sqlx::query_as::<_, MetricsRecord>(
            r#"
            SELECT * FROM metrics
            WHERE agent_id = $1 AND time >= $2 AND time <= $3
            ORDER BY time ASC
            LIMIT 10000
            "#,
        )
        .bind(agent_id)
        .bind(from)
        .bind(to)
        .fetch_all(&self.pool)
        .await
    }

    /// Get latest metrics for an agent
    pub async fn get_latest_metrics(
        &self,
        agent_id: Uuid,
    ) -> Result<Option<MetricsRecord>, sqlx::Error> {
        sqlx::query_as::<_, MetricsRecord>(
            "SELECT * FROM metrics WHERE agent_id = $1 ORDER BY time DESC LIMIT 1",
        )
        .bind(agent_id)
        .fetch_optional(&self.pool)
        .await
    }

    // ============ Disk Metrics ============

    /// Insert disk metrics (batch insert for high throughput)
    pub async fn insert_disk_metrics(
        &self,
        metrics: &[DiskMetricsRecord],
    ) -> Result<(), sqlx::Error> {
        if metrics.is_empty() {
            return Ok(());
        }

        // Collect all values into vectors for batch insert
        let times: Vec<_> = metrics.iter().map(|m| m.time).collect();
        let agent_ids: Vec<_> = metrics.iter().map(|m| m.agent_id).collect();
        let devices: Vec<_> = metrics.iter().map(|m| m.device.as_str()).collect();
        let read_ops: Vec<_> = metrics.iter().map(|m| m.read_ops).collect();
        let write_ops: Vec<_> = metrics.iter().map(|m| m.write_ops).collect();
        let read_time_ms: Vec<_> = metrics.iter().map(|m| m.read_time_ms).collect();
        let write_time_ms: Vec<_> = metrics.iter().map(|m| m.write_time_ms).collect();

        sqlx::query(
            r#"
            INSERT INTO disk_metrics (time, agent_id, device, read_ops, write_ops, read_time_ms, write_time_ms)
            SELECT * FROM UNNEST($1::timestamptz[], $2::uuid[], $3::varchar[], $4::bigint[], $5::bigint[], $6::bigint[], $7::bigint[])
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(&times)
        .bind(&agent_ids)
        .bind(&devices)
        .bind(&read_ops)
        .bind(&write_ops)
        .bind(&read_time_ms)
        .bind(&write_time_ms)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get disk metrics for an agent within a time range (limited to 5000 rows)
    pub async fn get_disk_metrics(
        &self,
        agent_id: Uuid,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<DiskMetricsRecord>, sqlx::Error> {
        sqlx::query_as::<_, DiskMetricsRecord>(
            r#"
            SELECT * FROM disk_metrics
            WHERE agent_id = $1 AND time >= $2 AND time <= $3
            ORDER BY time ASC, device ASC
            LIMIT 5000
            "#,
        )
        .bind(agent_id)
        .bind(from)
        .bind(to)
        .fetch_all(&self.pool)
        .await
    }

    // ============ Network Metrics ============

    /// Insert network metrics (batch insert for high throughput)
    pub async fn insert_network_metrics(
        &self,
        metrics: &[NetworkMetricsRecord],
    ) -> Result<(), sqlx::Error> {
        if metrics.is_empty() {
            return Ok(());
        }

        // Collect all values into vectors for batch insert
        let times: Vec<_> = metrics.iter().map(|m| m.time).collect();
        let agent_ids: Vec<_> = metrics.iter().map(|m| m.agent_id).collect();
        let interface_names: Vec<_> = metrics.iter().map(|m| m.interface_name.as_str()).collect();
        let bytes_received: Vec<_> = metrics.iter().map(|m| m.bytes_received).collect();
        let bytes_transmitted: Vec<_> = metrics.iter().map(|m| m.bytes_transmitted).collect();

        sqlx::query(
            r#"
            INSERT INTO network_metrics (time, agent_id, interface_name, bytes_received, bytes_transmitted)
            SELECT * FROM UNNEST($1::timestamptz[], $2::uuid[], $3::varchar[], $4::bigint[], $5::bigint[])
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(&times)
        .bind(&agent_ids)
        .bind(&interface_names)
        .bind(&bytes_received)
        .bind(&bytes_transmitted)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get network metrics for an agent within a time range (limited to 5000 rows)
    pub async fn get_network_metrics(
        &self,
        agent_id: Uuid,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<NetworkMetricsRecord>, sqlx::Error> {
        sqlx::query_as::<_, NetworkMetricsRecord>(
            r#"
            SELECT * FROM network_metrics
            WHERE agent_id = $1 AND time >= $2 AND time <= $3
            ORDER BY time ASC, interface_name ASC
            LIMIT 5000
            "#,
        )
        .bind(agent_id)
        .bind(from)
        .bind(to)
        .fetch_all(&self.pool)
        .await
    }

    // ============ Process Snapshots ============

    /// Insert process snapshots (batch insert for high throughput)
    pub async fn insert_process_snapshots(
        &self,
        snapshots: &[ProcessSnapshotRecord],
    ) -> Result<(), sqlx::Error> {
        if snapshots.is_empty() {
            return Ok(());
        }

        // Collect all values into vectors for batch insert
        let times: Vec<_> = snapshots.iter().map(|s| s.time).collect();
        let agent_ids: Vec<_> = snapshots.iter().map(|s| s.agent_id).collect();
        let pids: Vec<_> = snapshots.iter().map(|s| s.pid).collect();
        let names: Vec<_> = snapshots.iter().map(|s| s.name.as_str()).collect();
        let states: Vec<_> = snapshots.iter().map(|s| s.state.as_str()).collect();
        let ppids: Vec<_> = snapshots.iter().map(|s| s.ppid).collect();
        let cpu_percents: Vec<_> = snapshots.iter().map(|s| s.cpu_percent).collect();
        let memory_rss_kibs: Vec<_> = snapshots.iter().map(|s| s.memory_rss_kib).collect();
        let memory_vsz_kibs: Vec<_> = snapshots.iter().map(|s| s.memory_vsz_kib).collect();
        let threads: Vec<_> = snapshots.iter().map(|s| s.threads).collect();
        let usernames: Vec<_> = snapshots.iter().map(|s| s.username.as_str()).collect();
        let cmdlines: Vec<_> = snapshots.iter().map(|s| s.cmdline.as_deref()).collect();
        let start_times: Vec<_> = snapshots.iter().map(|s| s.start_time).collect();

        sqlx::query(
            r#"
            INSERT INTO process_snapshots (time, agent_id, pid, name, state, ppid, cpu_percent, memory_rss_kib, memory_vsz_kib, threads, username, cmdline, start_time)
            SELECT * FROM UNNEST(
                $1::timestamptz[], $2::uuid[], $3::integer[], $4::varchar[], $5::varchar[],
                $6::integer[], $7::double precision[], $8::bigint[], $9::bigint[], $10::integer[],
                $11::varchar[], $12::text[], $13::bigint[]
            )
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(&times)
        .bind(&agent_ids)
        .bind(&pids)
        .bind(&names)
        .bind(&states)
        .bind(&ppids)
        .bind(&cpu_percents)
        .bind(&memory_rss_kibs)
        .bind(&memory_vsz_kibs)
        .bind(&threads)
        .bind(&usernames)
        .bind(&cmdlines)
        .bind(&start_times)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get latest process snapshots for an agent (most recent timestamp)
    pub async fn get_latest_processes(
        &self,
        agent_id: Uuid,
    ) -> Result<Vec<ProcessSnapshotRecord>, sqlx::Error> {
        sqlx::query_as::<_, ProcessSnapshotRecord>(
            r#"
            SELECT * FROM process_snapshots
            WHERE agent_id = $1 AND time = (
                SELECT MAX(time) FROM process_snapshots WHERE agent_id = $1
            )
            ORDER BY cpu_percent DESC
            "#,
        )
        .bind(agent_id)
        .fetch_all(&self.pool)
        .await
    }

    /// Get process snapshots for an agent within a time range
    pub async fn get_processes(
        &self,
        agent_id: Uuid,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<ProcessSnapshotRecord>, sqlx::Error> {
        sqlx::query_as::<_, ProcessSnapshotRecord>(
            r#"
            SELECT * FROM process_snapshots
            WHERE agent_id = $1 AND time >= $2 AND time <= $3
            ORDER BY time DESC, cpu_percent DESC
            "#,
        )
        .bind(agent_id)
        .bind(from)
        .bind(to)
        .fetch_all(&self.pool)
        .await
    }

    /// Get process snapshots closest to a specific timestamp
    /// Finds the nearest snapshot time and returns all processes from that snapshot
    pub async fn get_processes_at_time(
        &self,
        agent_id: Uuid,
        at: DateTime<Utc>,
    ) -> Result<Vec<ProcessSnapshotRecord>, sqlx::Error> {
        // Find the closest snapshot time to the requested timestamp
        sqlx::query_as::<_, ProcessSnapshotRecord>(
            r#"
            WITH closest_time AS (
                SELECT time
                FROM process_snapshots
                WHERE agent_id = $1
                ORDER BY ABS(EXTRACT(EPOCH FROM (time - $2)))
                LIMIT 1
            )
            SELECT ps.*
            FROM process_snapshots ps
            INNER JOIN closest_time ct ON ps.time = ct.time
            WHERE ps.agent_id = $1
            ORDER BY ps.cpu_percent DESC
            "#,
        )
        .bind(agent_id)
        .bind(at)
        .fetch_all(&self.pool)
        .await
    }

    // ============ Cleanup & Management ============

    /// Delete metrics older than specified days
    #[allow(dead_code)] // For future scheduled cleanup job
    pub async fn cleanup_old_metrics(&self, days: u32) -> Result<u64, sqlx::Error> {
        let result =
            sqlx::query("DELETE FROM metrics WHERE time < NOW() - INTERVAL '1 day' * $1::integer")
                .bind(days as i32)
                .execute(&self.pool)
                .await?;
        Ok(result.rows_affected())
    }

    /// Delete an agent and all its metrics (CASCADE)
    pub async fn delete_agent(&self, id: Uuid) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("DELETE FROM agents WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Delete all agents in a group and all their metrics
    /// Returns the number of agents deleted
    pub async fn delete_agents_by_group(&self, group: &str) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM agents WHERE agent_group = $1")
            .bind(group)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }

    /// Delete metrics for an agent (optionally within time range)
    #[allow(unused_assignments)] // Variables are assigned in both branches
    pub async fn delete_agent_metrics(
        &self,
        agent_id: Uuid,
        from: Option<DateTime<Utc>>,
        to: Option<DateTime<Utc>>,
    ) -> Result<DeletedMetricsCount, sqlx::Error> {
        let mut metrics_deleted: u64 = 0;
        let mut disk_deleted: u64 = 0;
        let mut network_deleted: u64 = 0;

        // Build query based on whether time range is specified
        if let (Some(from), Some(to)) = (from, to) {
            metrics_deleted = sqlx::query(
                "DELETE FROM metrics WHERE agent_id = $1 AND time >= $2 AND time <= $3",
            )
            .bind(agent_id)
            .bind(from)
            .bind(to)
            .execute(&self.pool)
            .await?
            .rows_affected();

            disk_deleted = sqlx::query(
                "DELETE FROM disk_metrics WHERE agent_id = $1 AND time >= $2 AND time <= $3",
            )
            .bind(agent_id)
            .bind(from)
            .bind(to)
            .execute(&self.pool)
            .await?
            .rows_affected();

            network_deleted = sqlx::query(
                "DELETE FROM network_metrics WHERE agent_id = $1 AND time >= $2 AND time <= $3",
            )
            .bind(agent_id)
            .bind(from)
            .bind(to)
            .execute(&self.pool)
            .await?
            .rows_affected();
        } else {
            // Delete all metrics for this agent
            metrics_deleted = sqlx::query("DELETE FROM metrics WHERE agent_id = $1")
                .bind(agent_id)
                .execute(&self.pool)
                .await?
                .rows_affected();

            disk_deleted = sqlx::query("DELETE FROM disk_metrics WHERE agent_id = $1")
                .bind(agent_id)
                .execute(&self.pool)
                .await?
                .rows_affected();

            network_deleted = sqlx::query("DELETE FROM network_metrics WHERE agent_id = $1")
                .bind(agent_id)
                .execute(&self.pool)
                .await?
                .rows_affected();
        }

        Ok(DeletedMetricsCount {
            metrics: metrics_deleted,
            disk_metrics: disk_deleted,
            network_metrics: network_deleted,
        })
    }

    /// Get server statistics
    pub async fn get_server_stats(&self) -> Result<ServerStats, sqlx::Error> {
        let agents_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM agents")
            .fetch_one(&self.pool)
            .await?;

        let agents_online: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM agents WHERE is_online = true")
                .fetch_one(&self.pool)
                .await?;

        let metrics_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM metrics")
            .fetch_one(&self.pool)
            .await?;

        let disk_metrics_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM disk_metrics")
            .fetch_one(&self.pool)
            .await?;

        let network_metrics_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM network_metrics")
            .fetch_one(&self.pool)
            .await?;

        // Get oldest and newest metric timestamps
        let oldest_metric: Option<(DateTime<Utc>,)> =
            sqlx::query_as("SELECT MIN(time) FROM metrics")
                .fetch_optional(&self.pool)
                .await?;

        let newest_metric: Option<(DateTime<Utc>,)> =
            sqlx::query_as("SELECT MAX(time) FROM metrics")
                .fetch_optional(&self.pool)
                .await?;

        Ok(ServerStats {
            agents_total: agents_count.0 as u64,
            agents_online: agents_online.0 as u64,
            metrics_count: metrics_count.0 as u64,
            disk_metrics_count: disk_metrics_count.0 as u64,
            network_metrics_count: network_metrics_count.0 as u64,
            oldest_metric: oldest_metric.map(|r| r.0),
            newest_metric: newest_metric.map(|r| r.0),
        })
    }

    // ============ Command Responses ============

    /// Store a command response (for dashboard retrieval)
    pub async fn store_command_response(
        &self,
        command_id: &str,
        agent_id: Uuid,
        success: bool,
        message: &str,
        config_json: Option<&str>,
        swap_processes_json: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO command_responses (command_id, agent_id, success, message, config_json, swap_processes_json, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (command_id) DO UPDATE SET
                success = EXCLUDED.success,
                message = EXCLUDED.message,
                config_json = EXCLUDED.config_json,
                swap_processes_json = EXCLUDED.swap_processes_json,
                created_at = NOW()
            "#,
        )
        .bind(command_id)
        .bind(agent_id)
        .bind(success)
        .bind(message)
        .bind(config_json)
        .bind(swap_processes_json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Get a command response by ID
    pub async fn get_command_response(
        &self,
        command_id: &str,
    ) -> Result<Option<CommandResponseRecord>, sqlx::Error> {
        sqlx::query_as::<_, CommandResponseRecord>(
            "SELECT * FROM command_responses WHERE command_id = $1",
        )
        .bind(command_id)
        .fetch_optional(&self.pool)
        .await
    }

    /// Get recent command responses for an agent
    #[allow(dead_code)] // Public API for future use
    pub async fn get_agent_command_responses(
        &self,
        agent_id: Uuid,
        limit: i64,
    ) -> Result<Vec<CommandResponseRecord>, sqlx::Error> {
        sqlx::query_as::<_, CommandResponseRecord>(
            "SELECT * FROM command_responses WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2",
        )
        .bind(agent_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    /// Cleanup old command responses (older than 1 hour)
    #[allow(dead_code)] // Public API for future use
    pub async fn cleanup_old_command_responses(&self) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            "DELETE FROM command_responses WHERE created_at < NOW() - INTERVAL '1 hour'",
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    // ========================================
    // Service Metrics Methods
    // ========================================

    /// Insert service metrics
    pub async fn insert_service_metrics(
        &self,
        metrics: &ServiceMetricsRecord,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO service_metrics (
                time, agent_id, service_name, plugin_type, is_running,
                cpu_usage_usec, cpu_percent, cpu_user_usec, cpu_system_usec,
                memory_current_bytes, memory_swap_bytes, memory_anon_bytes, memory_file_bytes,
                disk_read_bytes, disk_write_bytes, disk_read_ops, disk_write_ops,
                net_rx_bytes, net_tx_bytes,
                process_count, thread_count,
                cgroup_version, data_source
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(metrics.time)
        .bind(metrics.agent_id)
        .bind(&metrics.service_name)
        .bind(&metrics.plugin_type)
        .bind(metrics.is_running)
        .bind(metrics.cpu_usage_usec)
        .bind(metrics.cpu_percent)
        .bind(metrics.cpu_user_usec)
        .bind(metrics.cpu_system_usec)
        .bind(metrics.memory_current_bytes)
        .bind(metrics.memory_swap_bytes)
        .bind(metrics.memory_anon_bytes)
        .bind(metrics.memory_file_bytes)
        .bind(metrics.disk_read_bytes)
        .bind(metrics.disk_write_bytes)
        .bind(metrics.disk_read_ops)
        .bind(metrics.disk_write_ops)
        .bind(metrics.net_rx_bytes)
        .bind(metrics.net_tx_bytes)
        .bind(metrics.process_count)
        .bind(metrics.thread_count)
        .bind(metrics.cgroup_version)
        .bind(metrics.data_source)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Insert service process details (batch insert for high throughput)
    pub async fn insert_service_processes(
        &self,
        processes: &[ServiceProcessRecord],
    ) -> Result<(), sqlx::Error> {
        if processes.is_empty() {
            return Ok(());
        }

        // Collect all values into vectors for batch insert
        let times: Vec<_> = processes.iter().map(|p| p.time).collect();
        let agent_ids: Vec<_> = processes.iter().map(|p| p.agent_id).collect();
        let service_names: Vec<_> = processes.iter().map(|p| p.service_name.as_str()).collect();
        let pids: Vec<_> = processes.iter().map(|p| p.pid).collect();
        let names: Vec<_> = processes.iter().map(|p| p.name.as_str()).collect();
        let cpu_percents: Vec<_> = processes.iter().map(|p| p.cpu_percent).collect();
        let memory_bytes: Vec<_> = processes.iter().map(|p| p.memory_bytes).collect();
        let threads: Vec<_> = processes.iter().map(|p| p.threads).collect();

        sqlx::query(
            r#"
            INSERT INTO service_processes (time, agent_id, service_name, pid, name, cpu_percent, memory_bytes, threads)
            SELECT * FROM UNNEST(
                $1::timestamptz[], $2::uuid[], $3::varchar[], $4::integer[],
                $5::varchar[], $6::double precision[], $7::bigint[], $8::integer[]
            )
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(&times)
        .bind(&agent_ids)
        .bind(&service_names)
        .bind(&pids)
        .bind(&names)
        .bind(&cpu_percents)
        .bind(&memory_bytes)
        .bind(&threads)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get service metrics for an agent
    pub async fn get_service_metrics(
        &self,
        agent_id: Uuid,
        service_name: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<ServiceMetricsRecord>, sqlx::Error> {
        sqlx::query_as::<_, ServiceMetricsRecord>(
            r#"
            SELECT * FROM service_metrics
            WHERE agent_id = $1 AND service_name = $2 AND time >= $3 AND time <= $4
            ORDER BY time ASC
            LIMIT 10000
            "#,
        )
        .bind(agent_id)
        .bind(service_name)
        .bind(from)
        .bind(to)
        .fetch_all(&self.pool)
        .await
    }

    /// Get latest service metrics for all services of an agent
    #[allow(dead_code)] // Public API for future use
    pub async fn get_latest_service_metrics(
        &self,
        agent_id: Uuid,
    ) -> Result<Vec<ServiceMetricsRecord>, sqlx::Error> {
        sqlx::query_as::<_, ServiceMetricsRecord>(
            r#"
            SELECT DISTINCT ON (service_name) *
            FROM service_metrics
            WHERE agent_id = $1
            ORDER BY service_name, time DESC
            "#,
        )
        .bind(agent_id)
        .fetch_all(&self.pool)
        .await
    }

    /// Get latest metrics for a specific service
    pub async fn get_latest_service_metrics_for_service(
        &self,
        agent_id: Uuid,
        service_name: &str,
    ) -> Result<Option<ServiceMetricsRecord>, sqlx::Error> {
        sqlx::query_as::<_, ServiceMetricsRecord>(
            r#"
            SELECT * FROM service_metrics
            WHERE agent_id = $1 AND service_name = $2
            ORDER BY time DESC
            LIMIT 1
            "#,
        )
        .bind(agent_id)
        .bind(service_name)
        .fetch_optional(&self.pool)
        .await
    }

    /// Get list of services for an agent
    pub async fn get_agent_services(
        &self,
        agent_id: Uuid,
    ) -> Result<Vec<ServiceSummary>, sqlx::Error> {
        let rows: Vec<(String, String, bool, DateTime<Utc>)> = sqlx::query_as(
            r#"
            SELECT DISTINCT ON (service_name)
                service_name, plugin_type, is_running, time as last_seen
            FROM service_metrics
            WHERE agent_id = $1
            ORDER BY service_name, time DESC
            "#,
        )
        .bind(agent_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(
                |(service_name, plugin_type, is_running, last_seen)| ServiceSummary {
                    service_name,
                    plugin_type,
                    is_running,
                    last_seen,
                },
            )
            .collect())
    }

    /// Get service processes at a specific time
    pub async fn get_service_processes(
        &self,
        agent_id: Uuid,
        service_name: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<ServiceProcessRecord>, sqlx::Error> {
        sqlx::query_as::<_, ServiceProcessRecord>(
            r#"
            SELECT * FROM service_processes
            WHERE agent_id = $1 AND service_name = $2 AND time >= $3 AND time <= $4
            ORDER BY time DESC, cpu_percent DESC
            LIMIT 1000
            "#,
        )
        .bind(agent_id)
        .bind(service_name)
        .bind(from)
        .bind(to)
        .fetch_all(&self.pool)
        .await
    }

    /// Delete service metrics for an agent (all services)
    #[allow(dead_code)] // Public API for future use
    pub async fn delete_service_metrics(
        &self,
        agent_id: Uuid,
        from: Option<DateTime<Utc>>,
        to: Option<DateTime<Utc>>,
    ) -> Result<u64, sqlx::Error> {
        let deleted = if let (Some(from), Some(to)) = (from, to) {
            sqlx::query(
                "DELETE FROM service_metrics WHERE agent_id = $1 AND time >= $2 AND time <= $3",
            )
            .bind(agent_id)
            .bind(from)
            .bind(to)
            .execute(&self.pool)
            .await?
            .rows_affected()
        } else {
            sqlx::query("DELETE FROM service_metrics WHERE agent_id = $1")
                .bind(agent_id)
                .execute(&self.pool)
                .await?
                .rows_affected()
        };

        // Also delete associated processes
        if let (Some(from), Some(to)) = (from, to) {
            sqlx::query(
                "DELETE FROM service_processes WHERE agent_id = $1 AND time >= $2 AND time <= $3",
            )
            .bind(agent_id)
            .bind(from)
            .bind(to)
            .execute(&self.pool)
            .await?;
        } else {
            sqlx::query("DELETE FROM service_processes WHERE agent_id = $1")
                .bind(agent_id)
                .execute(&self.pool)
                .await?;
        }

        Ok(deleted)
    }

    /// Delete service metrics for a specific service
    pub async fn delete_service_metrics_for_service(
        &self,
        agent_id: Uuid,
        service_name: &str,
        from: Option<DateTime<Utc>>,
        to: Option<DateTime<Utc>>,
    ) -> Result<u64, sqlx::Error> {
        let deleted = if let (Some(from), Some(to)) = (from, to) {
            sqlx::query(
                "DELETE FROM service_metrics WHERE agent_id = $1 AND service_name = $2 AND time >= $3 AND time <= $4",
            )
            .bind(agent_id)
            .bind(service_name)
            .bind(from)
            .bind(to)
            .execute(&self.pool)
            .await?
            .rows_affected()
        } else {
            sqlx::query("DELETE FROM service_metrics WHERE agent_id = $1 AND service_name = $2")
                .bind(agent_id)
                .bind(service_name)
                .execute(&self.pool)
                .await?
                .rows_affected()
        };

        // Also delete associated processes
        if let (Some(from), Some(to)) = (from, to) {
            sqlx::query(
                "DELETE FROM service_processes WHERE agent_id = $1 AND service_name = $2 AND time >= $3 AND time <= $4",
            )
            .bind(agent_id)
            .bind(service_name)
            .bind(from)
            .bind(to)
            .execute(&self.pool)
            .await?;
        } else {
            sqlx::query("DELETE FROM service_processes WHERE agent_id = $1 AND service_name = $2")
                .bind(agent_id)
                .bind(service_name)
                .execute(&self.pool)
                .await?;
        }

        Ok(deleted)
    }

    /// Health check: verify database is connected and check TimescaleDB availability
    pub async fn health_check(&self) -> Result<HealthInfo, sqlx::Error> {
        // Simple connectivity check
        let _: (i32,) = sqlx::query_as("SELECT 1")
            .fetch_one(&self.pool)
            .await?;

        // Check TimescaleDB availability
        let timescaledb_version: Option<String> = sqlx::query_scalar(
            "SELECT default_version FROM pg_available_extensions WHERE name = 'timescaledb'"
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(HealthInfo {
            timescaledb_version,
        })
    }

}
