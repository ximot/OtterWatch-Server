use crate::config::ClusterBootstrapConfig;
use crate::db::Repository;
use crate::mqtt::MqttSubscriber;
use crate::proto;
use crate::updates::UpdateManager;
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::IntoResponse,
    routing::{delete, get, patch, post},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use prost_types::Timestamp;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

/// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    pub repository: Repository,
    /// MQTT subscribers - one per broker in the cluster
    /// Commands are published through ALL subscribers to reach agents on any broker
    pub mqtt_subscribers: Vec<Arc<MqttSubscriber>>,
    pub update_manager: Arc<UpdateManager>,
    /// Public URL base for generating download URLs
    pub public_url: String,
    /// MQTT broker cluster node API addresses
    pub mqtt_cluster_nodes: Vec<String>,
    /// Cluster bootstrap configuration for agent auto-discovery
    pub cluster_bootstrap: ClusterBootstrapConfig,
    /// Valid API keys for authentication
    pub api_keys: Vec<String>,
}

/// Query parameters for metrics endpoint
#[derive(Debug, Deserialize)]
pub struct MetricsQuery {
    /// Start time (ISO 8601)
    pub from: Option<DateTime<Utc>>,
    /// End time (ISO 8601)
    pub to: Option<DateTime<Utc>>,
}

/// Query parameters for processes at specific time
#[derive(Debug, Deserialize)]
pub struct ProcessesAtQuery {
    /// Specific timestamp (ISO 8601)
    pub at: DateTime<Utc>,
}

/// Query parameters for agents list endpoint
#[derive(Debug, Deserialize)]
pub struct AgentsQuery {
    /// Filter by group
    pub group: Option<String>,
}

/// Request body for updating agent group
#[derive(Debug, Deserialize)]
pub struct UpdateGroupRequest {
    pub group: Option<String>,
}

/// Request body for sending a command to an agent
#[derive(Debug, Deserialize)]
pub struct SendCommandRequest {
    /// Command type: "reload-config", "restart", "set-group", "update", "ping", "get-config", "get-swap-processes", "set-config", "sync-config", "get-config-schema", "reconnect"
    pub command: String,
    /// Optional group name for set-group command
    pub group: Option<String>,
    /// Optional URL for update command
    pub update_url: Option<String>,
    /// Optional checksum for update command
    pub update_checksum: Option<String>,
    /// Optional config key for set-config command
    pub config_key: Option<String>,
    /// Optional config value for set-config command
    pub config_value: Option<String>,
}

/// Response for command send
#[derive(Debug, Serialize)]
pub struct CommandSentResponse {
    pub command_id: String,
    pub agent_id: String,
    pub command_type: String,
    pub sent: bool,
}

/// Request for cluster bootstrap - agent sends its group to get broker assignment
#[derive(Debug, Deserialize)]
pub struct BootstrapRequest {
    /// Agent's group for broker assignment
    pub agent_group: Option<String>,
    /// API key for authentication
    pub api_key: String,
}

/// Response for cluster bootstrap - returns broker configuration
#[derive(Debug, Serialize)]
pub struct BootstrapResponse {
    /// Primary broker for this agent's group
    pub primary_broker: String,
    /// All brokers for failover
    pub all_brokers: Vec<String>,
    /// Full group-to-broker mapping
    pub group_mapping: HashMap<String, String>,
}

/// API response wrapper
#[derive(Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn ok(data: T) -> Json<Self> {
        Json(Self {
            success: true,
            data: Some(data),
            error: None,
        })
    }

    pub fn err(message: &str) -> Json<Self> {
        Json(Self {
            success: false,
            data: None,
            error: Some(message.to_string()),
        })
    }
}

/// Server version from Cargo.toml
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Create API router
pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_check_with_db))
        .route("/api/version", get(get_version))
        // Agents
        .route("/api/agents", get(list_agents))
        .route("/api/agents/:id", get(get_agent).delete(delete_agent))
        .route("/api/agents/:id/group", patch(update_agent_group))
        .route("/api/agents/:id/command", post(send_command))
        .route(
            "/api/agents/:id/command/:command_id",
            get(get_command_response),
        )
        .route(
            "/api/agents/:id/metrics",
            get(get_agent_metrics).delete(delete_agent_metrics),
        )
        .route(
            "/api/agents/:id/metrics/latest",
            get(get_agent_latest_metrics),
        )
        // Disk and Network metrics (for history view)
        .route("/api/agents/:id/disk-metrics", get(get_agent_disk_metrics))
        .route(
            "/api/agents/:id/network-metrics",
            get(get_agent_network_metrics),
        )
        // Processes
        .route("/api/agents/:id/processes", get(get_agent_processes))
        .route(
            "/api/agents/:id/processes/latest",
            get(get_agent_latest_processes),
        )
        .route(
            "/api/agents/:id/processes/at",
            get(get_agent_processes_at_time),
        )
        // Service metrics (plugins)
        .route("/api/agents/:id/services", get(list_agent_services))
        .route(
            "/api/agents/:id/services/:service_name/metrics",
            get(get_service_metrics).delete(delete_service_metrics),
        )
        .route(
            "/api/agents/:id/services/:service_name/metrics/latest",
            get(get_service_metrics_latest),
        )
        .route(
            "/api/agents/:id/services/:service_name/processes",
            get(get_service_processes),
        )
        // Groups
        .route("/api/groups", get(list_groups))
        .route("/api/groups/:group_name", delete(delete_group_agents))
        // Server management
        .route("/api/server/stats", get(get_server_stats))
        // Updates
        .route("/api/updates/latest", get(get_latest_update))
        .route("/api/updates/versions", get(list_update_versions))
        .route("/api/updates/download/:version", get(download_update))
        .route("/api/updates/refresh", post(refresh_updates))
        // MQTT Cluster
        .route("/api/mqtt/cluster", get(get_mqtt_cluster_status))
        .route("/api/mqtt/cluster/rebalance", post(mqtt_cluster_rebalance))
        // Cluster Bootstrap (agent auto-discovery)
        .route("/api/cluster/bootstrap", post(cluster_bootstrap))
        .with_state(Arc::new(state))
}

/// Health check endpoint (legacy, no DB check)
async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "version": VERSION,
        "timestamp": Utc::now().to_rfc3339()
    }))
}

/// Health check endpoint with database status verification
async fn health_check_with_db(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    // Check database connectivity
    let db_status = match state.repository.health_check().await {
        Ok(info) => serde_json::json!({
            "status": "connected",
            "timescaledb": info.timescaledb_version,
        }),
        Err(e) => serde_json::json!({
            "status": "error",
            "error": format!("{}", e),
        }),
    };

    let overall_status = if db_status["status"] == "connected" {
        "ok"
    } else {
        "degraded"
    };

    Json(serde_json::json!({
        "status": overall_status,
        "version": VERSION,
        "timestamp": Utc::now().to_rfc3339(),
        "database": db_status,
    }))
}

/// Get server version info
async fn get_version() -> impl IntoResponse {
    Json(serde_json::json!({
        "server_version": VERSION,
        "api_version": "1.0",
        "name": "otterwatch-server"
    }))
}

/// List all registered agents (optionally filtered by group)
async fn list_agents(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AgentsQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let agents = if let Some(group) = query.group {
        state.repository.get_agents_by_group(&group).await
    } else {
        state.repository.get_all_agents().await
    };

    match agents {
        Ok(agents) => Ok(ApiResponse::ok(agents)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// List all unique agent groups
async fn list_groups(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match state.repository.get_all_groups().await {
        Ok(groups) => Ok(ApiResponse::ok(groups)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Delete all agents in a group and their metrics
async fn delete_group_agents(
    State(state): State<Arc<AppState>>,
    Path(group_name): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // First get all agents in the group to clear their MQTT retained messages
    let agents = match state.repository.get_agents_by_group(&group_name).await {
        Ok(agents) => agents,
        Err(e) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {}", e),
            ))
        }
    };

    // Clear MQTT retained messages for each agent on all brokers
    for agent in &agents {
        for subscriber in &state.mqtt_subscribers {
            if let Err(e) = subscriber.clear_agent_retained_messages(agent.id).await {
                log::warn!(
                    "Failed to clear retained MQTT messages for agent {}: {}",
                    agent.id,
                    e
                );
            }
        }
    }

    // Delete all agents in the group
    match state.repository.delete_agents_by_group(&group_name).await {
        Ok(count) => Ok(ApiResponse::ok(serde_json::json!({
            "deleted": count,
            "group": group_name
        }))),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Update agent group
async fn update_agent_group(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateGroupRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match state
        .repository
        .update_agent_group(id, body.group.as_deref())
        .await
    {
        Ok(true) => Ok(ApiResponse::ok(serde_json::json!({
            "updated": true,
            "agent_id": id.to_string(),
            "group": body.group
        }))),
        Ok(false) => Err((StatusCode::NOT_FOUND, "Agent not found".to_string())),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Get agent by ID
async fn get_agent(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match state.repository.get_agent(id).await {
        Ok(Some(agent)) => Ok(ApiResponse::ok(agent)),
        Ok(None) => Err((StatusCode::NOT_FOUND, "Agent not found".to_string())),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Delete agent and all its metrics
async fn delete_agent(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // First, clear retained MQTT messages to prevent re-registration on server restart
    // Clear on all brokers since we don't know which one the agent was connected to
    for subscriber in &state.mqtt_subscribers {
        if let Err(e) = subscriber.clear_agent_retained_messages(id).await {
            log::warn!(
                "Failed to clear retained MQTT messages for agent {}: {}",
                id,
                e
            );
            // Continue with deletion even if MQTT cleanup fails
        }
    }

    match state.repository.delete_agent(id).await {
        Ok(true) => Ok(ApiResponse::ok(serde_json::json!({
            "deleted": true,
            "agent_id": id.to_string()
        }))),
        Ok(false) => Err((StatusCode::NOT_FOUND, "Agent not found".to_string())),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Get metrics for an agent
async fn get_agent_metrics(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(query): Query<MetricsQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Default to last 24 hours if not specified
    let to = query.to.unwrap_or_else(Utc::now);
    let from = query.from.unwrap_or_else(|| to - Duration::hours(24));

    match state.repository.get_metrics(id, from, to).await {
        Ok(metrics) => Ok(ApiResponse::ok(metrics)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Delete metrics for an agent (optionally within time range)
async fn delete_agent_metrics(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(query): Query<MetricsQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match state
        .repository
        .delete_agent_metrics(id, query.from, query.to)
        .await
    {
        Ok(count) => Ok(ApiResponse::ok(count)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Get latest metrics for an agent
async fn get_agent_latest_metrics(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match state.repository.get_latest_metrics(id).await {
        Ok(Some(metrics)) => Ok(ApiResponse::ok(metrics)),
        Ok(None) => Err((
            StatusCode::NOT_FOUND,
            "No metrics found for agent".to_string(),
        )),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Get process history for an agent
async fn get_agent_processes(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(query): Query<MetricsQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Default to last 1 hour if not specified
    let to = query.to.unwrap_or_else(Utc::now);
    let from = query.from.unwrap_or_else(|| to - Duration::hours(1));

    match state.repository.get_processes(id, from, to).await {
        Ok(processes) => Ok(ApiResponse::ok(processes)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Get latest process list for an agent
async fn get_agent_latest_processes(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match state.repository.get_latest_processes(id).await {
        Ok(processes) if processes.is_empty() => Err((
            StatusCode::NOT_FOUND,
            "No process data found for agent".to_string(),
        )),
        Ok(processes) => Ok(ApiResponse::ok(processes)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Get disk metrics for an agent (for history view)
async fn get_agent_disk_metrics(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(query): Query<MetricsQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Default to last 24 hours if not specified
    let to = query.to.unwrap_or_else(Utc::now);
    let from = query.from.unwrap_or_else(|| to - Duration::hours(24));

    match state.repository.get_disk_metrics(id, from, to).await {
        Ok(metrics) => Ok(ApiResponse::ok(metrics)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Get network metrics for an agent (for history view)
async fn get_agent_network_metrics(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(query): Query<MetricsQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Default to last 24 hours if not specified
    let to = query.to.unwrap_or_else(Utc::now);
    let from = query.from.unwrap_or_else(|| to - Duration::hours(24));

    match state.repository.get_network_metrics(id, from, to).await {
        Ok(metrics) => Ok(ApiResponse::ok(metrics)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Get processes at a specific timestamp (closest snapshot)
async fn get_agent_processes_at_time(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(query): Query<ProcessesAtQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match state.repository.get_processes_at_time(id, query.at).await {
        Ok(processes) if processes.is_empty() => Err((
            StatusCode::NOT_FOUND,
            "No process data found near this timestamp".to_string(),
        )),
        Ok(processes) => Ok(ApiResponse::ok(processes)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

// ============================================================================
// Service metrics endpoints (plugins: nginx, tomcat, self, etc.)
// ============================================================================

/// List all services monitored for an agent
async fn list_agent_services(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match state.repository.get_agent_services(id).await {
        Ok(services) => Ok(ApiResponse::ok(services)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Get metrics for a specific service
async fn get_service_metrics(
    State(state): State<Arc<AppState>>,
    Path((id, service_name)): Path<(Uuid, String)>,
    Query(query): Query<MetricsQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Default to last 24 hours if not specified
    let to = query.to.unwrap_or_else(Utc::now);
    let from = query.from.unwrap_or_else(|| to - Duration::hours(24));

    match state
        .repository
        .get_service_metrics(id, &service_name, from, to)
        .await
    {
        Ok(metrics) => Ok(ApiResponse::ok(metrics)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Get latest metrics for a specific service
async fn get_service_metrics_latest(
    State(state): State<Arc<AppState>>,
    Path((id, service_name)): Path<(Uuid, String)>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match state
        .repository
        .get_latest_service_metrics_for_service(id, &service_name)
        .await
    {
        Ok(Some(metrics)) => Ok(ApiResponse::ok(metrics)),
        Ok(None) => Err((
            StatusCode::NOT_FOUND,
            format!("No metrics found for service '{}'", service_name),
        )),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Delete metrics for a specific service
async fn delete_service_metrics(
    State(state): State<Arc<AppState>>,
    Path((id, service_name)): Path<(Uuid, String)>,
    Query(query): Query<MetricsQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match state
        .repository
        .delete_service_metrics_for_service(id, &service_name, query.from, query.to)
        .await
    {
        Ok(count) => Ok(ApiResponse::ok(serde_json::json!({
            "deleted": count,
            "agent_id": id.to_string(),
            "service_name": service_name
        }))),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Get processes for a specific service (detailed per-process breakdown)
async fn get_service_processes(
    State(state): State<Arc<AppState>>,
    Path((id, service_name)): Path<(Uuid, String)>,
    Query(query): Query<MetricsQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Default to last 1 hour if not specified
    let to = query.to.unwrap_or_else(Utc::now);
    let from = query.from.unwrap_or_else(|| to - Duration::hours(1));

    match state
        .repository
        .get_service_processes(id, &service_name, from, to)
        .await
    {
        Ok(processes) => Ok(ApiResponse::ok(processes)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Get server statistics
async fn get_server_stats(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match state.repository.get_server_stats().await {
        Ok(stats) => Ok(ApiResponse::ok(stats)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

/// Send a command to an agent
async fn send_command(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<SendCommandRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Parse command type
    let command_type = match body.command.as_str() {
        "reload-config" => proto::CommandType::ReloadConfig,
        "restart" => proto::CommandType::Restart,
        "set-group" => proto::CommandType::SetGroup,
        "update" => proto::CommandType::Update,
        "ping" => proto::CommandType::Ping,
        "get-config" => proto::CommandType::GetConfig,
        "get-swap-processes" => proto::CommandType::GetSwapProcesses,
        "set-config" => proto::CommandType::SetConfig,
        "sync-config" => proto::CommandType::SyncConfig,
        "get-config-schema" => proto::CommandType::GetConfigSchema,
        "reconnect" => proto::CommandType::Reconnect,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Unknown command type: {}", body.command),
            ))
        }
    };

    // Validate parameters for specific commands
    if command_type == proto::CommandType::SetGroup && body.group.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            "set-group command requires 'group' parameter".to_string(),
        ));
    }

    if command_type == proto::CommandType::Update && body.update_url.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            "update command requires 'update_url' parameter".to_string(),
        ));
    }

    if command_type == proto::CommandType::SetConfig && body.config_key.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            "set-config command requires 'config_key' parameter".to_string(),
        ));
    }

    // Generate command ID
    let command_id = Uuid::new_v4().to_string();

    // Create command proto
    let now = Utc::now();
    let command = proto::Command {
        command_id: command_id.clone(),
        command_type: command_type.into(),
        timestamp: Some(Timestamp {
            seconds: now.timestamp(),
            nanos: now.timestamp_subsec_nanos() as i32,
        }),
        set_group_value: body.group.unwrap_or_default(),
        update_url: body.update_url.unwrap_or_default(),
        update_checksum: body.update_checksum.unwrap_or_default(),
        config_key: body.config_key.unwrap_or_default(),
        config_value: body.config_value.unwrap_or_default(),
    };

    // Publish command via MQTT to ALL brokers
    // The agent will only receive it from the broker it's connected to
    let mut publish_errors = Vec::new();
    let mut published_count = 0;

    for subscriber in &state.mqtt_subscribers {
        match subscriber.publish_command(id, command.clone()).await {
            Ok(_) => published_count += 1,
            Err(e) => publish_errors.push(e.to_string()),
        }
    }

    if published_count > 0 {
        Ok(ApiResponse::ok(CommandSentResponse {
            command_id,
            agent_id: id.to_string(),
            command_type: body.command,
            sent: true,
        }))
    } else {
        Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to send command to any broker: {:?}", publish_errors),
        ))
    }
}

/// Get command response by command ID
async fn get_command_response(
    State(state): State<Arc<AppState>>,
    Path((agent_id, command_id)): Path<(Uuid, String)>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match state.repository.get_command_response(&command_id).await {
        Ok(Some(response)) => {
            // Verify the response belongs to the requested agent
            if response.agent_id != agent_id {
                return Err((
                    StatusCode::NOT_FOUND,
                    "Command response not found".to_string(),
                ));
            }
            Ok(ApiResponse::ok(response))
        }
        Ok(None) => Err((
            StatusCode::NOT_FOUND,
            "Command response not found. The agent may not have responded yet.".to_string(),
        )),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Database error: {}", e),
        )),
    }
}

// ============================================================================
// Update endpoints
// ============================================================================

/// Response for latest update version
#[derive(Debug, Serialize)]
pub struct LatestUpdateResponse {
    pub version: String,
    pub checksum: String,
    pub download_url: String,
    pub size: u64,
}

/// Response for version list
#[derive(Debug, Serialize)]
pub struct UpdateVersionInfo {
    pub version: String,
    pub checksum: String,
    pub size: u64,
}

/// Get latest available update version
async fn get_latest_update(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match state.update_manager.get_latest() {
        Some(info) => {
            // Build full URL using public_url if configured
            let download_url = if state.public_url.is_empty() {
                format!("/api/updates/download/{}", info.version)
            } else {
                format!(
                    "{}/api/updates/download/{}",
                    state.public_url.trim_end_matches('/'),
                    info.version
                )
            };

            Ok(ApiResponse::ok(LatestUpdateResponse {
                version: info.version.clone(),
                checksum: info.checksum,
                download_url,
                size: info.size,
            }))
        }
        None => Err((StatusCode::NOT_FOUND, "No updates available".to_string())),
    }
}

/// List all available update versions
async fn list_update_versions(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let versions: Vec<UpdateVersionInfo> = state
        .update_manager
        .list_versions()
        .into_iter()
        .map(|info| UpdateVersionInfo {
            version: info.version,
            checksum: info.checksum,
            size: info.size,
        })
        .collect();

    ApiResponse::ok(versions)
}

/// Download update binary
async fn download_update(
    State(state): State<Arc<AppState>>,
    Path(version): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Get binary path
    let path = state.update_manager.get_binary_path(&version).ok_or((
        StatusCode::NOT_FOUND,
        format!("Version {} not found", version),
    ))?;

    // Get update info for filename
    let info = state.update_manager.get_version(&version).ok_or((
        StatusCode::NOT_FOUND,
        format!("Version {} not found", version),
    ))?;

    // Open file
    let file = tokio::fs::File::open(&path).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to open file: {}", e),
        )
    })?;

    // Stream the file
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    // Build response with appropriate headers
    let content_disposition = format!("attachment; filename=\"{}\"", info.filename);
    let content_length = info.size.to_string();

    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_string()),
            (header::CONTENT_DISPOSITION, content_disposition),
            (header::CONTENT_LENGTH, content_length),
            // Include checksum in header for verification
            (
                header::HeaderName::from_static("x-checksum-sha256"),
                info.checksum,
            ),
        ],
        body,
    ))
}

/// Refresh the update versions cache
async fn refresh_updates(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    state.update_manager.scan_updates();
    let versions = state.update_manager.list_versions();

    ApiResponse::ok(serde_json::json!({
        "refreshed": true,
        "versions_count": versions.len()
    }))
}

// ========== MQTT Cluster Endpoints ==========

/// MQTT cluster node info from broker API
#[derive(Debug, Serialize, Deserialize)]
struct MqttClusterNode {
    name: String,
    cluster_addr: String,
    mqtt_addr: String,
    state: String,
    assigned_groups: Vec<String>,
    connection_count: u64,
    is_local: bool,
}

/// MQTT broker stats from broker API
#[derive(Debug, Serialize, Deserialize)]
struct MqttBrokerStats {
    node: String,
    uptime_secs: u64,
    connections_active: i64,
    subscriptions_active: i64,
    messages_received: u64,
    messages_failed: u64,
}

/// Aggregated MQTT cluster status
#[derive(Debug, Serialize)]
struct MqttClusterStatus {
    /// Whether cluster config is set up
    configured: bool,
    /// Number of configured broker nodes
    configured_nodes: usize,
    /// Number of reachable broker nodes
    reachable_nodes: usize,
    /// All cluster nodes (deduplicated across brokers)
    nodes: Vec<MqttClusterNode>,
    /// Group to node assignments
    group_assignments: std::collections::HashMap<String, String>,
    /// Broker stats per node
    broker_stats: Vec<MqttBrokerStats>,
    /// Total connections across all brokers
    total_connections: i64,
    /// Total messages received across all brokers
    total_messages: u64,
    /// Retained message count
    retained_count: usize,
    /// Any errors while fetching
    errors: Vec<String>,
}

/// Get aggregated MQTT cluster status from all configured broker nodes
async fn get_mqtt_cluster_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let nodes_config = &state.mqtt_cluster_nodes;

    if nodes_config.is_empty() {
        return Json(MqttClusterStatus {
            configured: false,
            configured_nodes: 0,
            reachable_nodes: 0,
            nodes: vec![],
            group_assignments: std::collections::HashMap::new(),
            broker_stats: vec![],
            total_connections: 0,
            total_messages: 0,
            retained_count: 0,
            errors: vec![
                "No MQTT cluster nodes configured. Add mqtt_cluster_nodes to settings.toml"
                    .to_string(),
            ],
        });
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap();

    let mut all_nodes: Vec<MqttClusterNode> = vec![];
    let mut all_groups: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut broker_stats: Vec<MqttBrokerStats> = vec![];
    let mut errors: Vec<String> = vec![];
    let mut reachable = 0;
    let mut retained_count = 0;

    // Fetch from each configured broker node
    for node_url in nodes_config {
        // Get cluster nodes
        match client
            .get(format!("{}/api/cluster/nodes", node_url))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(data) = resp.json::<serde_json::Value>().await {
                    if let Some(nodes) = data.get("nodes").and_then(|n| n.as_array()) {
                        for node in nodes {
                            if let Ok(n) = serde_json::from_value::<MqttClusterNode>(node.clone()) {
                                // Deduplicate by name
                                if !all_nodes.iter().any(|existing| existing.name == n.name) {
                                    all_nodes.push(n);
                                }
                            }
                        }
                    }
                    reachable += 1;
                }
            }
            Ok(resp) => {
                errors.push(format!("{}: HTTP {}", node_url, resp.status()));
            }
            Err(e) => {
                errors.push(format!("{}: {}", node_url, e));
            }
        }

        // Get group assignments
        match client
            .get(format!("{}/api/cluster/groups", node_url))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(data) = resp.json::<serde_json::Value>().await {
                    if let Some(assignments) = data.get("assignments").and_then(|a| a.as_object()) {
                        for (group, node_name) in assignments {
                            if let Some(name) = node_name.as_str() {
                                all_groups.insert(group.clone(), name.to_string());
                            }
                        }
                    }
                }
            }
            _ => {} // Errors already captured above
        }

        // Get broker stats
        match client.get(format!("{}/api/stats", node_url)).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(stats) = resp.json::<MqttBrokerStats>().await {
                    broker_stats.push(stats);
                }
            }
            _ => {} // Errors already captured above
        }

        // Get retained count
        match client
            .get(format!("{}/api/cluster/retained", node_url))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(data) = resp.json::<serde_json::Value>().await {
                    if let Some(count) = data.get("count").and_then(|c| c.as_u64()) {
                        retained_count = retained_count.max(count as usize);
                    }
                }
            }
            _ => {} // Errors already captured above
        }
    }

    // Calculate totals
    let total_connections: i64 = broker_stats.iter().map(|s| s.connections_active).sum();
    let total_messages: u64 = broker_stats.iter().map(|s| s.messages_received).sum();

    Json(MqttClusterStatus {
        configured: true,
        configured_nodes: nodes_config.len(),
        reachable_nodes: reachable,
        nodes: all_nodes,
        group_assignments: all_groups,
        broker_stats,
        total_connections,
        total_messages,
        retained_count,
        errors,
    })
}

/// Request body for MQTT cluster rebalance
#[derive(Debug, Deserialize)]
pub struct MqttRebalanceRequest {
    /// Group to reassign
    pub group: String,
    /// Target node name
    pub node: String,
}

/// Response for MQTT cluster rebalance
#[derive(Debug, Serialize)]
pub struct MqttRebalanceResponse {
    pub success: bool,
    pub message: String,
    pub group: String,
    pub node: String,
}

/// Proxy rebalance request to MQTT cluster
async fn mqtt_cluster_rebalance(
    State(state): State<Arc<AppState>>,
    Json(req): Json<MqttRebalanceRequest>,
) -> impl IntoResponse {
    let nodes_config = &state.mqtt_cluster_nodes;

    if nodes_config.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(MqttRebalanceResponse {
                success: false,
                message: "No MQTT cluster nodes configured".to_string(),
                group: req.group,
                node: req.node,
            }),
        );
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap();

    // Try each configured broker node until one succeeds
    for node_url in nodes_config {
        match client
            .post(format!("{}/api/cluster/rebalance", node_url))
            .json(&serde_json::json!({
                "group": req.group,
                "node": req.node
            }))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(data) = resp.json::<serde_json::Value>().await {
                    let success = data
                        .get("success")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    let message = data
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown result");
                    return (
                        StatusCode::OK,
                        Json(MqttRebalanceResponse {
                            success,
                            message: message.to_string(),
                            group: req.group,
                            node: req.node,
                        }),
                    );
                }
            }
            Ok(resp) => {
                log::warn!("Rebalance failed on {}: HTTP {}", node_url, resp.status());
            }
            Err(e) => {
                log::warn!("Rebalance failed on {}: {}", node_url, e);
            }
        }
    }

    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(MqttRebalanceResponse {
            success: false,
            message: "Failed to reach any MQTT broker node".to_string(),
            group: req.group,
            node: req.node,
        }),
    )
}

/// Cluster bootstrap endpoint - agents call this to discover their assigned broker
async fn cluster_bootstrap(
    State(state): State<Arc<AppState>>,
    Json(req): Json<BootstrapRequest>,
) -> impl IntoResponse {
    // Validate API key
    if !state.api_keys.iter().any(|k| k == &req.api_key) {
        return (
            StatusCode::UNAUTHORIZED,
            ApiResponse::<BootstrapResponse>::err("Invalid API key"),
        );
    }

    let bootstrap_config = &state.cluster_bootstrap;

    // Check if bootstrap is enabled
    if !bootstrap_config.enabled {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            ApiResponse::<BootstrapResponse>::err("Cluster bootstrap is not enabled"),
        );
    }

    let agent_group = req.agent_group.as_deref().unwrap_or("default");

    // Try to fetch dynamic group assignments from MQTT cluster
    let dynamic_result =
        fetch_dynamic_broker_for_group(&state.mqtt_cluster_nodes, agent_group).await;

    let (primary_broker, group_mapping) = match dynamic_result {
        Some((broker, mapping)) => {
            log::info!(
                "Bootstrap: agent_group='{}' -> primary_broker='{}' (from cluster)",
                agent_group,
                broker
            );
            (broker, mapping)
        }
        None => {
            // Fall back to static config from settings.toml
            let broker = bootstrap_config
                .group_mapping
                .get(agent_group)
                .cloned()
                .unwrap_or_else(|| {
                    bootstrap_config
                        .group_mapping
                        .get("default")
                        .cloned()
                        .unwrap_or_else(|| bootstrap_config.fallback_broker.clone())
                });

            log::info!(
                "Bootstrap: agent_group='{}' -> primary_broker='{}' (from static config)",
                agent_group,
                broker
            );
            (broker, bootstrap_config.group_mapping.clone())
        }
    };

    // If no broker found, return error
    if primary_broker.is_empty() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            ApiResponse::<BootstrapResponse>::err("No broker configured for this group"),
        );
    }

    let response = BootstrapResponse {
        primary_broker,
        all_brokers: bootstrap_config.all_brokers.clone(),
        group_mapping,
    };

    (StatusCode::OK, ApiResponse::ok(response))
}

/// Fetch dynamic broker assignment for a group from MQTT cluster nodes
async fn fetch_dynamic_broker_for_group(
    cluster_nodes: &[String],
    agent_group: &str,
) -> Option<(String, std::collections::HashMap<String, String>)> {
    if cluster_nodes.is_empty() {
        log::debug!("Bootstrap: no cluster nodes configured");
        return None;
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;

    // Collect nodes and group assignments from cluster
    let mut nodes: Vec<MqttClusterNode> = vec![];
    let mut group_assignments: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    for node_url in cluster_nodes {
        log::debug!("Bootstrap: fetching from {}", node_url);

        // Get cluster nodes (for mqtt_addr mapping)
        match client
            .get(format!("{}/api/cluster/nodes", node_url))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(data) = resp.json::<serde_json::Value>().await {
                    log::debug!("Bootstrap: nodes response: {:?}", data);
                    if let Some(node_list) = data.get("nodes").and_then(|n| n.as_array()) {
                        for node in node_list {
                            if let Ok(n) = serde_json::from_value::<MqttClusterNode>(node.clone()) {
                                // Deduplicate by name
                                if !nodes.iter().any(|existing| existing.name == n.name) {
                                    nodes.push(n);
                                }
                            }
                        }
                    }
                }
            }
            Ok(resp) => {
                log::debug!(
                    "Bootstrap: nodes request failed with status {}",
                    resp.status()
                );
            }
            Err(e) => {
                log::debug!("Bootstrap: nodes request error: {}", e);
            }
        }

        // Get group assignments (endpoint is /api/cluster/groups)
        match client
            .get(format!("{}/api/cluster/groups", node_url))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(data) = resp.json::<serde_json::Value>().await {
                    log::debug!("Bootstrap: cluster/groups response: {:?}", data);
                    if let Some(assignments) = data.get("assignments").and_then(|a| a.as_object()) {
                        for (group, node_name) in assignments {
                            if let Some(name) = node_name.as_str() {
                                group_assignments.insert(group.clone(), name.to_string());
                            }
                        }
                    }
                }
            }
            Ok(resp) => {
                log::debug!(
                    "Bootstrap: cluster/groups request failed with status {}",
                    resp.status()
                );
            }
            Err(e) => {
                log::debug!("Bootstrap: cluster/groups request error: {}", e);
            }
        }
    }

    log::debug!(
        "Bootstrap: found {} nodes, {} group assignments",
        nodes.len(),
        group_assignments.len()
    );

    // If we have no data, return None to fall back to static config
    if nodes.is_empty() || group_assignments.is_empty() {
        log::debug!("Bootstrap: no cluster data available, falling back to static config");
        return None;
    }

    // Find the node name assigned to this group
    let node_name = group_assignments
        .get(agent_group)
        .or_else(|| group_assignments.get("default"))?;

    // Find the mqtt_addr for that node
    let mqtt_addr = nodes
        .iter()
        .find(|n| &n.name == node_name)
        .map(|n| format_mqtt_addr(&n.mqtt_addr))?;

    // Build group -> mqtt_addr mapping for response
    let mut group_to_broker: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for (group, assigned_node) in &group_assignments {
        if let Some(node) = nodes.iter().find(|n| &n.name == assigned_node) {
            group_to_broker.insert(group.clone(), format_mqtt_addr(&node.mqtt_addr));
        }
    }

    Some((mqtt_addr, group_to_broker))
}

/// Format mqtt_addr with tcp:// prefix if not already present
fn format_mqtt_addr(addr: &str) -> String {
    if addr.starts_with("tcp://") || addr.starts_with("ssl://") {
        addr.to_string()
    } else {
        format!("tcp://{}", addr)
    }
}

