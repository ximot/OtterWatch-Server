-- OtterWatch Database Initialization
-- This script runs once when the PostgreSQL container is first created

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Grant all privileges to otterwatch user (already done by default, but explicit)
GRANT ALL PRIVILEGES ON DATABASE otterwatch TO otterwatch;

-- Log successful initialization
DO $$
BEGIN
    RAISE NOTICE 'OtterWatch database initialized successfully with TimescaleDB extension';
END $$;
