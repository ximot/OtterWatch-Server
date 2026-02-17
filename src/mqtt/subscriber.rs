use crate::db::{
    DiskMetricsRecord, MetricsRecord, NetworkMetricsRecord, NewAgent, ProcessSnapshotRecord,
    Repository, ServiceMetricsRecord, ServiceProcessRecord,
};
use crate::proto;
use chrono::{TimeZone, Utc};
use log::{debug, error, info, warn};
use prost::Message;
use rumqttc::{AsyncClient, Event, EventLoop, MqttOptions, Packet, QoS};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use uuid::Uuid;

use super::auth::{hash_api_key, ApiKeyValidator};

/// Tracks pending ping commands for RTT measurement
#[derive(Debug)]
struct PendingPing {
    agent_id: Uuid,
    sent_at: Instant,
}

/// MQTT Subscriber that receives metrics from agents
pub struct MqttSubscriber {
    client: AsyncClient,
    topic_prefix: String,
    api_key_validator: ApiKeyValidator,
    repository: Repository,
    /// Pending pings for RTT measurement: command_id -> PendingPing
    pending_pings: RwLock<HashMap<String, PendingPing>>,
}

impl MqttSubscriber {
    pub async fn new(
        broker_addr: &str,
        client_id: &str,
        topic_prefix: &str,
        valid_api_keys: Vec<String>,
        repository: Repository,
    ) -> Result<(Self, EventLoop), rumqttc::ClientError> {
        let host = parse_broker_host(broker_addr);
        let port = parse_broker_port(broker_addr);

        let mut mqtt_options = MqttOptions::new(client_id, host, port);
        mqtt_options.set_keep_alive(Duration::from_secs(30));
        mqtt_options.set_clean_session(true);
        // Increase max packet size to 256KB (default is 10KB)
        mqtt_options.set_max_packet_size(262144, 262144);

        // Buffer size increased from 100 to 10000 for handling 4000+ agents
        let (client, eventloop) = AsyncClient::new(mqtt_options, 10000);

        Ok((
            Self {
                client,
                topic_prefix: topic_prefix.to_string(),
                api_key_validator: ApiKeyValidator::new(valid_api_keys),
                repository,
                pending_pings: RwLock::new(HashMap::new()),
            },
            eventloop,
        ))
    }

    /// Subscribe to agent metrics topics
    pub async fn subscribe(&self) -> Result<(), rumqttc::ClientError> {
        // Subscribe to all agent topics: otterwatch/metrics/+/+
        let topic = format!("{}/+/+", self.topic_prefix);
        self.client.subscribe(&topic, QoS::AtLeastOnce).await?;
        info!("Subscribed to topic: {}", topic);

        // Subscribe to command responses: otterwatch/responses/+
        let response_topic = format!("{}/+", self.topic_prefix.replace("/metrics", "/responses"));
        self.client
            .subscribe(&response_topic, QoS::AtLeastOnce)
            .await?;
        info!("Subscribed to response topic: {}", response_topic);

        Ok(())
    }

    /// Publish a command to an agent
    pub async fn publish_command(
        &self,
        agent_id: Uuid,
        command: proto::Command,
    ) -> Result<(), rumqttc::ClientError> {
        let topic = format!(
            "{}/{}/command",
            self.topic_prefix.replace("/metrics", "/commands"),
            agent_id
        );

        // Track ping commands for RTT measurement
        if command.command_type() == proto::CommandType::Ping {
            let mut pending = self.pending_pings.write().await;
            pending.insert(
                command.command_id.clone(),
                PendingPing {
                    agent_id,
                    sent_at: Instant::now(),
                },
            );
            // Clean up old pending pings (older than 60 seconds)
            pending.retain(|_, ping| ping.sent_at.elapsed() < Duration::from_secs(60));
        }

        let payload = command.encode_to_vec();
        self.client
            .publish(&topic, QoS::AtLeastOnce, false, payload)
            .await?;

        info!(
            "Published command {:?} to agent {}",
            command.command_type(),
            agent_id
        );
        Ok(())
    }

    /// Get the topic prefix
    #[allow(dead_code)] // Public API
    pub fn topic_prefix(&self) -> &str {
        &self.topic_prefix
    }

    /// Clear retained MQTT messages for an agent (call when deleting agent)
    pub async fn clear_agent_retained_messages(
        &self,
        agent_id: Uuid,
    ) -> Result<(), rumqttc::ClientError> {
        // Topics that may have retained messages
        let topics = [
            format!("{}/{}/info", self.topic_prefix, agent_id),
            format!("{}/{}/status", self.topic_prefix, agent_id),
        ];

        // Publish empty message with retain=true to clear retained messages
        for topic in &topics {
            self.client
                .publish(topic, QoS::AtLeastOnce, true, vec![])
                .await?;
        }

        info!("Cleared retained MQTT messages for agent {}", agent_id);
        Ok(())
    }

    /// Process incoming message
    pub async fn process_message(&self, topic: &str, payload: &[u8]) {
        // Ignore empty payloads (used to clear retained messages)
        if payload.is_empty() {
            debug!("Ignoring empty message on topic: {}", topic);
            return;
        }

        // Check if this is a command response
        if topic.contains("/responses/") {
            self.handle_command_response(topic, payload).await;
            return;
        }

        // Parse topic: {prefix}/{agent_id}/{message_type}
        let parts: Vec<&str> = topic.split('/').collect();
        if parts.len() < 3 {
            warn!("Invalid topic format: {}", topic);
            return;
        }

        let message_type = parts[parts.len() - 1];
        let agent_id_str = parts[parts.len() - 2];

        let agent_id = match Uuid::parse_str(agent_id_str) {
            Ok(id) => id,
            Err(_) => {
                warn!("Invalid agent ID in topic: {}", agent_id_str);
                return;
            }
        };

        match message_type {
            "info" => self.handle_agent_info(agent_id, payload).await,
            "snapshot" => self.handle_metrics_snapshot(agent_id, payload).await,
            "status" => self.handle_agent_status(agent_id, payload).await,
            "processes" => self.handle_process_list(agent_id, payload).await,
            "services" => self.handle_service_metrics(agent_id, payload).await,
            _ => {
                debug!("Unknown message type: {}", message_type);
            }
        }
    }

    async fn handle_command_response(&self, _topic: &str, payload: &[u8]) {
        let response = match proto::CommandResponse::decode(payload) {
            Ok(r) => r,
            Err(e) => {
                warn!("Failed to decode CommandResponse: {}", e);
                return;
            }
        };

        if response.success {
            info!(
                "Command {} succeeded for agent {}: {}",
                response.command_id, response.agent_id, response.message
            );
        } else {
            warn!(
                "Command {} failed for agent {}: {}",
                response.command_id, response.agent_id, response.message
            );
        }

        // Check if this is a pong response and calculate RTT
        if response.success && response.message.to_lowercase().contains("pong") {
            let mut pending = self.pending_pings.write().await;
            if let Some(ping) = pending.remove(&response.command_id) {
                let rtt_ms = ping.sent_at.elapsed().as_millis() as i32;
                info!("RTT for agent {}: {}ms", ping.agent_id, rtt_ms);

                // Update RTT in database
                if let Err(e) = self
                    .repository
                    .update_agent_rtt(ping.agent_id, rtt_ms)
                    .await
                {
                    error!("Failed to update agent RTT: {}", e);
                }
            }
        }

        // Store command response in database (especially for GET_CONFIG responses)
        let agent_id = match Uuid::parse_str(&response.agent_id) {
            Ok(id) => id,
            Err(_) => {
                warn!(
                    "Invalid agent ID in command response: {}",
                    response.agent_id
                );
                return;
            }
        };

        // Serialize config to JSON if present
        let config_json = response.config.as_ref().map(|config| {
            serde_json::json!({
                "interval_secs": config.interval_secs,
                "process_list_interval_secs": config.process_list_interval_secs,
                "process_top_n": config.process_top_n,
                "listen_addr": config.listen_addr,
                "mqtt_broker_addr": config.mqtt_broker_addr,
                "mqtt_topic_prefix": config.mqtt_topic_prefix,
                "mqtt_enabled": config.mqtt_enabled,
                // MQTT Bootstrap settings (v0.3.2+)
                "mqtt_bootstrap_url": config.mqtt_bootstrap_url,
                "mqtt_bootstrap_timeout_secs": config.mqtt_bootstrap_timeout_secs,
                "db_file_name": config.db_file_name,
                "db_save": config.db_save,
                "db_history_days": config.db_history_days,
                "agent_group": config.agent_group,
                "exclude_interfaces": config.exclude_interfaces,
                "config_path": config.config_path,
                "data_directory": config.data_directory,
                // Plugin settings (v0.2.3+)
                "plugin_interval_secs": config.plugin_interval_secs,
                "plugins_collect_process_details": config.plugins_collect_process_details,
                "plugins_nginx_enabled": config.plugins_nginx_enabled,
                "plugins_nginx_service_name": config.plugins_nginx_service_name,
                "plugins_tomcat_enabled": config.plugins_tomcat_enabled,
                "plugins_tomcat_service_name": config.plugins_tomcat_service_name,
                "plugins_self_monitor_enabled": config.plugins_self_monitor_enabled,
                "plugins_self_monitor_collect_open_fds": config.plugins_self_monitor_collect_open_fds,
                "plugins_self_monitor_collect_io_stats": config.plugins_self_monitor_collect_io_stats,
            }).to_string()
        });

        // Serialize swap_processes to JSON if present
        let swap_processes_json = response.swap_processes.as_ref().map(|swap_list| {
            serde_json::json!({
                "total_swap_kib": swap_list.total_swap_kib,
                "processes": swap_list.processes.iter().map(|p| {
                    serde_json::json!({
                        "pid": p.pid,
                        "name": p.name,
                        "swap_kib": p.swap_kib,
                        "cmdline": p.cmdline,
                        "user": p.user,
                    })
                }).collect::<Vec<_>>()
            })
            .to_string()
        });

        if let Err(e) = self
            .repository
            .store_command_response(
                &response.command_id,
                agent_id,
                response.success,
                &response.message,
                config_json.as_deref(),
                swap_processes_json.as_deref(),
            )
            .await
        {
            error!("Failed to store command response: {}", e);
        }
    }

    async fn handle_agent_info(&self, agent_id: Uuid, payload: &[u8]) {
        let auth_msg = match proto::AuthenticatedMessage::decode(payload) {
            Ok(msg) => msg,
            Err(e) => {
                warn!("Failed to decode AuthenticatedMessage: {}", e);
                return;
            }
        };

        // Validate API key
        if !self.api_key_validator.validate(&auth_msg.api_key) {
            warn!("Invalid API key for agent {}", agent_id);
            return;
        }

        let info = match auth_msg.payload {
            Some(proto::authenticated_message::Payload::AgentInfo(info)) => info,
            _ => {
                warn!("Expected AgentInfo payload for agent {}", agent_id);
                return;
            }
        };

        let new_agent = NewAgent {
            id: agent_id,
            hostname: info.hostname,
            os_name: info.os_name,
            kernel_version: info.kernel_version,
            agent_version: info.agent_version,
            cpu_cores: info.cpu_cores as i32,
            cpu_name: info.cpu_name,
            api_key_hash: hash_api_key(&auth_msg.api_key),
            agent_group: if info.agent_group.is_empty() {
                None
            } else {
                Some(info.agent_group)
            },
            is_root: info.is_root,
            queue_pending_count: info.queue_pending_count as i32,
            queue_pending_bytes: info.queue_pending_bytes as i64,
        };

        match self.repository.upsert_agent(new_agent).await {
            Ok(agent) => {
                info!(
                    "Registered/updated agent: {} ({})",
                    agent.hostname, agent.id
                );
            }
            Err(e) => {
                error!("Failed to upsert agent: {}", e);
            }
        }
    }

    async fn handle_metrics_snapshot(&self, agent_id: Uuid, payload: &[u8]) {
        let auth_msg = match proto::AuthenticatedMessage::decode(payload) {
            Ok(msg) => msg,
            Err(e) => {
                warn!("Failed to decode AuthenticatedMessage: {}", e);
                return;
            }
        };

        // Validate API key
        if !self.api_key_validator.validate(&auth_msg.api_key) {
            warn!("Invalid API key for agent {}", agent_id);
            return;
        }

        let snapshot = match auth_msg.payload {
            Some(proto::authenticated_message::Payload::Metrics(m)) => m,
            _ => {
                warn!("Expected MetricsSnapshot payload for agent {}", agent_id);
                return;
            }
        };

        // Convert timestamp
        let timestamp = snapshot
            .timestamp
            .map(|ts| Utc.timestamp_opt(ts.seconds, ts.nanos as u32).unwrap())
            .unwrap_or_else(Utc::now);

        // Insert core metrics
        let metrics = MetricsRecord {
            time: timestamp,
            agent_id,
            cpu_usage: snapshot.cpu_usage_percent,
            cpu_io_wait: snapshot.cpu_io_wait_percent,
            memory_used_kib: snapshot.memory_used_kib as i64,
            memory_available_kib: snapshot.memory_available_kib as i64,
            memory_total_kib: snapshot.memory_total_kib as i64,
            swap_free_kib: snapshot.swap_free_kib as i64,
            swap_total_kib: snapshot.swap_total_kib as i64,
        };

        if let Err(e) = self.repository.insert_metrics(&metrics).await {
            error!("Failed to insert metrics: {}", e);
        }

        // Insert disk metrics
        let disk_metrics: Vec<DiskMetricsRecord> = snapshot
            .disks
            .iter()
            .map(|d| DiskMetricsRecord {
                time: timestamp,
                agent_id,
                device: d.device.clone(),
                read_ops: d.read_ops as i64,
                write_ops: d.write_ops as i64,
                read_time_ms: d.read_time_ms as i64,
                write_time_ms: d.write_time_ms as i64,
            })
            .collect();

        if !disk_metrics.is_empty() {
            if let Err(e) = self.repository.insert_disk_metrics(&disk_metrics).await {
                error!("Failed to insert disk metrics: {}", e);
            }
        }

        // Insert network metrics
        let network_metrics: Vec<NetworkMetricsRecord> = snapshot
            .network
            .iter()
            .map(|n| NetworkMetricsRecord {
                time: timestamp,
                agent_id,
                interface_name: n.interface_name.clone(),
                bytes_received: n.bytes_received as i64,
                bytes_transmitted: n.bytes_transmitted as i64,
            })
            .collect();

        if !network_metrics.is_empty() {
            if let Err(e) = self
                .repository
                .insert_network_metrics(&network_metrics)
                .await
            {
                error!("Failed to insert network metrics: {}", e);
            }
        }

        // Update agent queue stats from metrics snapshot
        if let Err(e) = self
            .repository
            .update_agent_queue_stats(
                agent_id,
                snapshot.queue_pending_count as i32,
                snapshot.queue_pending_bytes as i64,
            )
            .await
        {
            error!("Failed to update agent queue stats: {}", e);
        }

        debug!("Stored metrics for agent {}", agent_id);
    }

    async fn handle_agent_status(&self, agent_id: Uuid, payload: &[u8]) {
        let status = match proto::AgentStatus::decode(payload) {
            Ok(s) => s,
            Err(e) => {
                warn!("Failed to decode AgentStatus: {}", e);
                return;
            }
        };

        if let Err(e) = self
            .repository
            .set_agent_online(agent_id, status.online)
            .await
        {
            error!("Failed to update agent status: {}", e);
        } else {
            info!(
                "Agent {} is now {}",
                agent_id,
                if status.online { "online" } else { "offline" }
            );
        }
    }

    async fn handle_process_list(&self, agent_id: Uuid, payload: &[u8]) {
        let auth_msg = match proto::AuthenticatedMessage::decode(payload) {
            Ok(msg) => msg,
            Err(e) => {
                warn!("Failed to decode AuthenticatedMessage: {}", e);
                return;
            }
        };

        // Validate API key
        if !self.api_key_validator.validate(&auth_msg.api_key) {
            warn!("Invalid API key for agent {}", agent_id);
            return;
        }

        let process_list = match auth_msg.payload {
            Some(proto::authenticated_message::Payload::ProcessList(pl)) => pl,
            _ => {
                warn!("Expected ProcessList payload for agent {}", agent_id);
                return;
            }
        };

        // Convert timestamp
        let timestamp = process_list
            .timestamp
            .map(|ts| Utc.timestamp_opt(ts.seconds, ts.nanos as u32).unwrap())
            .unwrap_or_else(Utc::now);

        // Convert to ProcessSnapshotRecord
        let snapshots: Vec<ProcessSnapshotRecord> = process_list
            .processes
            .iter()
            .map(|p| ProcessSnapshotRecord {
                time: timestamp,
                agent_id,
                pid: p.pid as i32,
                name: p.name.clone(),
                state: p.state.clone(),
                ppid: p.ppid as i32,
                cpu_percent: p.cpu_percent,
                memory_rss_kib: p.memory_rss_kib as i64,
                memory_vsz_kib: p.memory_vsz_kib as i64,
                threads: p.threads as i32,
                username: p.user.clone(),
                cmdline: if p.cmdline.is_empty() {
                    None
                } else {
                    Some(p.cmdline.clone())
                },
                start_time: p.start_time as i64,
            })
            .collect();

        if !snapshots.is_empty() {
            if let Err(e) = self.repository.insert_process_snapshots(&snapshots).await {
                error!("Failed to insert process snapshots: {}", e);
            } else {
                debug!(
                    "Stored {} process snapshots for agent {}",
                    snapshots.len(),
                    agent_id
                );
            }
        }
    }

    /// Handle service metrics from plugin system (nginx, tomcat, etc.)
    async fn handle_service_metrics(&self, agent_id: Uuid, payload: &[u8]) {
        let auth_msg = match proto::AuthenticatedMessage::decode(payload) {
            Ok(msg) => msg,
            Err(e) => {
                warn!("Failed to decode AuthenticatedMessage: {}", e);
                return;
            }
        };

        // Validate API key
        if !self.api_key_validator.validate(&auth_msg.api_key) {
            warn!("Invalid API key for agent {}", agent_id);
            return;
        }

        let service_list = match auth_msg.payload {
            Some(proto::authenticated_message::Payload::ServiceMetrics(sl)) => sl,
            _ => {
                warn!("Expected ServiceMetrics payload for agent {}", agent_id);
                return;
            }
        };

        // Convert timestamp
        let timestamp = service_list
            .timestamp
            .map(|ts| Utc.timestamp_opt(ts.seconds, ts.nanos as u32).unwrap())
            .unwrap_or_else(Utc::now);

        // Process each service
        for service in &service_list.services {
            // Create service metrics record
            let metrics = ServiceMetricsRecord {
                time: timestamp,
                agent_id,
                service_name: service.service_name.clone(),
                plugin_type: service.plugin_type.clone(),
                is_running: service.is_running,
                cpu_usage_usec: service.cpu_usage_usec as i64,
                cpu_percent: service.cpu_percent,
                cpu_user_usec: service.cpu_user_usec as i64,
                cpu_system_usec: service.cpu_system_usec as i64,
                memory_current_bytes: service.memory_current_bytes as i64,
                memory_swap_bytes: service.memory_swap_bytes as i64,
                memory_anon_bytes: service.memory_anon_bytes as i64,
                memory_file_bytes: service.memory_file_bytes as i64,
                disk_read_bytes: service.disk_read_bytes as i64,
                disk_write_bytes: service.disk_write_bytes as i64,
                disk_read_ops: service.disk_read_ops as i64,
                disk_write_ops: service.disk_write_ops as i64,
                net_rx_bytes: service.net_rx_bytes as i64,
                net_tx_bytes: service.net_tx_bytes as i64,
                process_count: service.process_count as i32,
                thread_count: service.thread_count as i64,
                cgroup_version: service.cgroup_version.map(|v| v as i32),
                data_source: service.data_source as i32,
            };

            if let Err(e) = self.repository.insert_service_metrics(&metrics).await {
                error!(
                    "Failed to insert service metrics for {}: {}",
                    service.service_name, e
                );
                continue;
            }

            // Insert process details if available
            if !service.processes.is_empty() {
                let processes: Vec<ServiceProcessRecord> = service
                    .processes
                    .iter()
                    .map(|p| ServiceProcessRecord {
                        time: timestamp,
                        agent_id,
                        service_name: service.service_name.clone(),
                        pid: p.pid as i32,
                        name: p.name.clone(),
                        cpu_percent: p.cpu_percent,
                        memory_bytes: p.memory_bytes as i64,
                        threads: p.threads as i64,
                    })
                    .collect();

                if let Err(e) = self.repository.insert_service_processes(&processes).await {
                    error!(
                        "Failed to insert service processes for {}: {}",
                        service.service_name, e
                    );
                }
            }
        }

        debug!(
            "Stored service metrics for {} services from agent {}",
            service_list.services.len(),
            agent_id
        );
    }

}

/// Run the MQTT event loop
pub async fn run_mqtt_event_loop(subscriber: Arc<MqttSubscriber>, mut eventloop: EventLoop) {
    loop {
        match eventloop.poll().await {
            Ok(Event::Incoming(Packet::ConnAck(_))) => {
                info!("Connected to MQTT broker");
                if let Err(e) = subscriber.subscribe().await {
                    error!("Failed to subscribe: {}", e);
                }
            }
            Ok(Event::Incoming(Packet::Publish(msg))) => {
                subscriber.process_message(&msg.topic, &msg.payload).await;
            }
            Ok(_) => {}
            Err(e) => {
                error!("MQTT connection error: {}", e);
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

fn parse_broker_host(addr: &str) -> String {
    addr.trim_start_matches("tcp://")
        .trim_start_matches("ssl://")
        .split(':')
        .next()
        .unwrap_or("localhost")
        .to_string()
}

fn parse_broker_port(addr: &str) -> u16 {
    addr.trim_start_matches("tcp://")
        .trim_start_matches("ssl://")
        .split(':')
        .nth(1)
        .and_then(|p| p.parse().ok())
        .unwrap_or(1883)
}
