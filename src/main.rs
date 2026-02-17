mod api;
mod config;
mod db;
mod mqtt;
mod proto;
mod updates;

use crate::api::{create_router, AppState};
use crate::config::Settings;
use crate::db::Repository;
use crate::mqtt::{run_mqtt_event_loop, MqttSubscriber};
use crate::updates::UpdateManager;
use log::{error, info};
use std::sync::Arc;
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    info!("OtterWatch Server starting...");

    // Load configuration
    let config = Settings::load().map_err(|e| {
        error!("Failed to load configuration: {}", e);
        e
    })?;

    info!("Configuration loaded");

    // Initialize database
    let pool = db::init_pool(&config.database_url).await.map_err(|e| {
        error!("Failed to connect to database: {}", e);
        e
    })?;

    info!("Database connected");

    // Run migrations
    if let Err(e) = db::run_migrations(&pool).await {
        error!("Failed to run migrations: {}", e);
        // Continue anyway - migrations might already be applied
    }

    // Create repository
    let repository = Repository::new(pool);

    // Get valid API keys
    let api_keys = config.get_api_keys();
    if api_keys.is_empty() {
        log::warn!(
            "No API keys configured! Set api_keys in settings.toml or OTTERWATCH_API_KEYS env var"
        );
    }

    // Log cluster bootstrap config
    if config.cluster_bootstrap.enabled {
        info!(
            "Cluster bootstrap enabled with {} group mappings, fallback: {}",
            config.cluster_bootstrap.group_mapping.len(),
            config.cluster_bootstrap.fallback_broker
        );
    }

    // Get all MQTT broker addresses
    let mqtt_broker_addrs = config.get_mqtt_broker_addrs();
    if mqtt_broker_addrs.is_empty() {
        error!("No MQTT broker addresses configured!");
        return Err(anyhow::anyhow!("No MQTT broker addresses configured"));
    }

    // Initialize MQTT subscribers - one for each broker in the cluster
    let mut mqtt_subscribers: Vec<Arc<MqttSubscriber>> = Vec::new();

    for (idx, broker_addr) in mqtt_broker_addrs.iter().enumerate() {
        // Each subscriber needs a unique client ID
        let client_id = if mqtt_broker_addrs.len() > 1 {
            format!("{}-{}", config.mqtt_client_id, idx)
        } else {
            config.mqtt_client_id.clone()
        };

        let api_keys_for_mqtt = api_keys.clone();
        match MqttSubscriber::new(
            broker_addr,
            &client_id,
            &config.mqtt_topic_prefix,
            api_keys_for_mqtt,
            repository.clone(),
        )
        .await
        {
            Ok((subscriber, eventloop)) => {
                let subscriber = Arc::new(subscriber);

                // Keep subscriber for API commands
                mqtt_subscribers.push(Arc::clone(&subscriber));

                // Spawn MQTT event loop
                let mqtt_subscriber = Arc::clone(&subscriber);
                let broker_addr_clone = broker_addr.clone();
                tokio::spawn(async move {
                    info!("MQTT subscriber {} connected to {}", idx, broker_addr_clone);
                    run_mqtt_event_loop(mqtt_subscriber, eventloop).await;
                });

                info!(
                    "MQTT subscriber started for broker {}: {}",
                    idx, broker_addr
                );
            }
            Err(e) => {
                error!(
                    "Failed to create MQTT subscriber for {}: {}",
                    broker_addr, e
                );
                // Continue with other brokers if this one fails
            }
        }
    }

    if mqtt_subscribers.is_empty() {
        error!("Failed to connect to any MQTT broker!");
        return Err(anyhow::anyhow!("Failed to connect to any MQTT broker"));
    }

    info!("Connected to {} MQTT broker(s)", mqtt_subscribers.len());

    // Initialize update manager
    let update_manager = Arc::new(UpdateManager::new(&config.updates_dir));
    info!(
        "Update manager initialized, updates dir: {}",
        config.updates_dir
    );

    // Create HTTP API
    let app_state = AppState {
        repository,
        mqtt_subscribers,
        update_manager,
        public_url: config.public_url.clone(),
        mqtt_cluster_nodes: config.mqtt_cluster_nodes.clone(),
        cluster_bootstrap: config.cluster_bootstrap.clone(),
        api_keys,
    };
    let app = create_router(app_state);

    // Start HTTP server
    let listener = TcpListener::bind(&config.http_listen_addr).await?;
    info!("HTTP API listening on {}", config.http_listen_addr);

    axum::serve(listener, app).await?;

    Ok(())
}
