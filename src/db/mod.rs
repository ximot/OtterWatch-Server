mod models;
mod repository;

pub use models::*;
pub use repository::*;

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::Duration;

/// Initialize database connection pool
/// Optimized for high-throughput metrics ingestion (4000+ agents)
pub async fn init_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(100) // Increased from 10 for high concurrency
        .min_connections(20) // Keep warm connections ready
        .acquire_timeout(Duration::from_secs(10)) // Longer timeout under load
        .idle_timeout(Duration::from_secs(600)) // Keep idle connections for 10 min
        .connect(database_url)
        .await
}

/// Run database migrations
pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}
