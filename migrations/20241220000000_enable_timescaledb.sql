-- Enable TimescaleDB extension and convert tables to hypertables
-- This migration optimizes the database for high-throughput metrics ingestion (4000+ agents)
-- If TimescaleDB is not available, tables remain as regular PostgreSQL tables (still functional)

DO $$
DECLARE
    timescaledb_available BOOLEAN := false;
BEGIN
    -- Check if TimescaleDB extension is available
    SELECT EXISTS(
        SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'
    ) INTO timescaledb_available;

    IF NOT timescaledb_available THEN
        RAISE NOTICE 'TimescaleDB extension not available - skipping hypertable conversion. Tables will work as regular PostgreSQL tables.';
        RETURN;
    END IF;

    -- Enable TimescaleDB extension
    CREATE EXTENSION IF NOT EXISTS timescaledb;

    -- Convert metrics table to hypertable (1-day chunks for optimal query performance)
    PERFORM create_hypertable('metrics', 'time',
        chunk_time_interval => INTERVAL '1 day',
        if_not_exists => TRUE,
        migrate_data => TRUE);

    -- Convert disk_metrics to hypertable
    PERFORM create_hypertable('disk_metrics', 'time',
        chunk_time_interval => INTERVAL '1 day',
        if_not_exists => TRUE,
        migrate_data => TRUE);

    -- Convert network_metrics to hypertable
    PERFORM create_hypertable('network_metrics', 'time',
        chunk_time_interval => INTERVAL '1 day',
        if_not_exists => TRUE,
        migrate_data => TRUE);

    -- Convert process_snapshots to hypertable
    PERFORM create_hypertable('process_snapshots', 'time',
        chunk_time_interval => INTERVAL '1 day',
        if_not_exists => TRUE,
        migrate_data => TRUE);

    -- Convert service_metrics to hypertable
    PERFORM create_hypertable('service_metrics', 'time',
        chunk_time_interval => INTERVAL '1 day',
        if_not_exists => TRUE,
        migrate_data => TRUE);

    -- Convert service_processes to hypertable
    PERFORM create_hypertable('service_processes', 'time',
        chunk_time_interval => INTERVAL '1 day',
        if_not_exists => TRUE,
        migrate_data => TRUE);

    -- Enable compression on metrics table (compress after 7 days)
    ALTER TABLE metrics SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'agent_id'
    );
    PERFORM add_compression_policy('metrics', INTERVAL '7 days', if_not_exists => TRUE);

    -- Enable compression on disk_metrics
    ALTER TABLE disk_metrics SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'agent_id,device'
    );
    PERFORM add_compression_policy('disk_metrics', INTERVAL '7 days', if_not_exists => TRUE);

    -- Enable compression on network_metrics
    ALTER TABLE network_metrics SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'agent_id,interface_name'
    );
    PERFORM add_compression_policy('network_metrics', INTERVAL '7 days', if_not_exists => TRUE);

    -- Enable compression on process_snapshots (compress after 3 days - less historical value)
    ALTER TABLE process_snapshots SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'agent_id'
    );
    PERFORM add_compression_policy('process_snapshots', INTERVAL '3 days', if_not_exists => TRUE);

    -- Enable compression on service_metrics
    ALTER TABLE service_metrics SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'agent_id,service_name'
    );
    PERFORM add_compression_policy('service_metrics', INTERVAL '7 days', if_not_exists => TRUE);

    -- Add retention policies (automatic data cleanup)
    -- Core metrics: keep 90 days
    PERFORM add_retention_policy('metrics', INTERVAL '90 days', if_not_exists => TRUE);
    PERFORM add_retention_policy('disk_metrics', INTERVAL '90 days', if_not_exists => TRUE);
    PERFORM add_retention_policy('network_metrics', INTERVAL '90 days', if_not_exists => TRUE);

    -- Process snapshots: keep 30 days (high volume, lower historical value)
    PERFORM add_retention_policy('process_snapshots', INTERVAL '30 days', if_not_exists => TRUE);

    -- Service metrics: keep 90 days
    PERFORM add_retention_policy('service_metrics', INTERVAL '90 days', if_not_exists => TRUE);
    PERFORM add_retention_policy('service_processes', INTERVAL '30 days', if_not_exists => TRUE);

    RAISE NOTICE 'TimescaleDB enabled: all time-series tables converted to hypertables with compression and retention policies.';

EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'TimescaleDB setup failed (%), skipping. Tables will work as regular PostgreSQL tables.', SQLERRM;
END;
$$;
