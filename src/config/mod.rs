use config::{Config, Environment, File};
use serde::Deserialize;
use std::collections::HashMap;

/// Configuration for cluster bootstrap endpoint
/// Allows agents to discover their assigned MQTT broker based on agent_group
#[derive(Debug, Clone, Deserialize, Default)]
pub struct ClusterBootstrapConfig {
    /// Enable the bootstrap endpoint
    #[serde(default)]
    pub enabled: bool,
    /// Mapping of agent_group -> MQTT broker address
    /// Example: {"web-servers": "tcp://broker1:1883", "databases": "tcp://broker2:1884"}
    #[serde(default)]
    pub group_mapping: HashMap<String, String>,
    /// Fallback broker for unknown groups
    #[serde(default)]
    pub fallback_broker: String,
    /// All available brokers for failover
    #[serde(default)]
    pub all_brokers: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Settings {
    pub http_listen_addr: String,
    /// Single MQTT broker address (for backwards compatibility)
    #[serde(default)]
    pub mqtt_broker_addr: String,
    /// Multiple MQTT broker addresses (for cluster support)
    /// If set, overrides mqtt_broker_addr
    #[serde(default)]
    pub mqtt_broker_addrs: Vec<String>,
    pub mqtt_client_id: String,
    pub mqtt_topic_prefix: String,
    pub database_url: String,
    #[serde(default)]
    pub api_keys: String,
    #[serde(default = "default_retention")]
    #[allow(dead_code)] // For future scheduled cleanup
    pub metrics_retention_days: u32,
    /// Directory where agent update binaries are stored
    #[serde(default = "default_updates_dir")]
    pub updates_dir: String,
    /// Public URL base for generating download URLs (e.g., "http://server:8080")
    #[serde(default)]
    pub public_url: String,
    /// MQTT broker cluster node API addresses for dashboard cluster view
    /// Example: ["http://localhost:8085", "http://localhost:8086"]
    #[serde(default)]
    pub mqtt_cluster_nodes: Vec<String>,
    /// Cluster bootstrap configuration for agent auto-discovery
    #[serde(default)]
    pub cluster_bootstrap: ClusterBootstrapConfig,
}

fn default_retention() -> u32 {
    90
}

fn default_updates_dir() -> String {
    "./updates".to_string()
}

impl Settings {
    pub fn load() -> Result<Self, config::ConfigError> {
        let config = Config::builder()
            .add_source(File::with_name("settings").required(false))
            .add_source(Environment::with_prefix("OTTERWATCH"))
            .build()?;

        config.try_deserialize()
    }

    /// Returns list of valid API keys
    pub fn get_api_keys(&self) -> Vec<String> {
        self.api_keys
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    }

    /// Returns list of MQTT broker addresses to connect to
    /// If mqtt_broker_addrs is set, uses that; otherwise uses single mqtt_broker_addr
    pub fn get_mqtt_broker_addrs(&self) -> Vec<String> {
        if !self.mqtt_broker_addrs.is_empty() {
            self.mqtt_broker_addrs.clone()
        } else if !self.mqtt_broker_addr.is_empty() {
            vec![self.mqtt_broker_addr.clone()]
        } else {
            vec![]
        }
    }
}
