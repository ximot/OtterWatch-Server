# OtterWatch Server

> Central metrics collection, storage, and management server for OtterWatch monitoring system

**Version:** 0.3.6  
**License:** MIT  
**Author:** Tomasz Wyderka

## 📋 Overview

OtterWatch Server is the central hub of the OtterWatch monitoring ecosystem. It receives metrics from agents via MQTT, stores them in PostgreSQL/TimescaleDB, provides a REST API and web dashboard, and manages the agent fleet.

### Key Features

✅ **Metrics Collection & Storage**
- Subscribes to agent metrics via MQTT (Protocol Buffers)
- Stores time-series data in PostgreSQL/TimescaleDB
- Automatic data retention management
- Efficient bulk inserts with batching

✅ **Web Dashboard & API**
- Modern React dashboard with real-time updates
- REST API for querying metrics and managing agents
- Historical and real-time data visualization
- Agent fleet status monitoring

✅ **Agent Fleet Management**
- Send remote commands to agents (restart, update, config changes)
- Agent grouping and filtering
- Bootstrap endpoint for agent auto-discovery
- Binary distribution system for agent updates

✅ **High Availability**
- MQTT cluster support with load balancing
- Database connection pooling
- Graceful shutdown and recovery

---

## 🚀 Quick Start

### Docker Deployment (Recommended)

```bash
# Clone the repository
git clone https://github.com/ximot/otterwatch-server.git
cd otterwatch-server

# Copy and edit configuration
cp .env.example .env
nano .env  # Set passwords and API keys!

# Start the complete stack (DB + MQTT + Server)
docker-compose -f podman-compose.yml up -d

# Check status
docker-compose -f podman-compose.yml ps

# View logs
docker-compose -f podman-compose.yml logs -f server
```

**Access the dashboard:** http://localhost:8080

### Manual Installation

#### Prerequisites

```bash
# Ubuntu/Debian
sudo apt-get install build-essential pkg-config libssl-dev protobuf-compiler postgresql-14

# Install TimescaleDB extension
sudo apt-get install postgresql-14-timescaledb

# Enable TimescaleDB
sudo timescaledb-tune --quiet --yes
sudo systemctl restart postgresql
```

#### Build and Run

```bash
# Clone and build
git clone https://github.com/ximot/otterwatch-server.git
cd otterwatch-server
cargo build --release

# Create database
sudo -u postgres createuser otterwatch
sudo -u postgres createdb -O otterwatch otterwatch
sudo -u postgres psql -d otterwatch -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"

# Copy and edit configuration
cp settings.toml.example settings.toml
nano settings.toml

# Run migrations (automatic on first start)
DATABASE_URL="postgres://otterwatch:otterwatch@localhost/otterwatch" \
  ./target/release/otterwatch-server

# Or use environment variables
export OTTERWATCH_DATABASE_URL="postgres://otterwatch:otterwatch@localhost/otterwatch"
export OTTERWATCH_API_KEYS="your-secret-api-key"
./target/release/otterwatch-server
```

---

## ⚙️ Configuration

Configuration file: `settings.toml`

```toml
# HTTP API server settings
http_listen_addr = "0.0.0.0:8080"

# MQTT broker connection
mqtt_broker_addr = "tcp://localhost:1883"
mqtt_client_id = "otterwatch-server"
mqtt_topic_prefix = "otterwatch/metrics"

# Database connection (PostgreSQL/TimescaleDB)
database_url = "postgres://otterwatch:otterwatch@localhost:5432/otterwatch"

# Agent API keys (comma-separated)
api_keys = "change-me-in-production"

# Data retention (days)
metrics_retention_days = 90

# Agent binary updates directory
updates_dir = "./updates"

# Public URL for generating download links (required for agent updates)
public_url = "http://localhost:8080"
```

### Environment Variables

Override settings with `OTTERWATCH_` prefix:

```bash
OTTERWATCH_DATABASE_URL="postgres://user:pass@host:5432/db"
OTTERWATCH_HTTP_LISTEN_ADDR="0.0.0.0:8080"
OTTERWATCH_MQTT_BROKER_ADDR="tcp://broker:1883"
OTTERWATCH_API_KEYS="key1,key2,key3"
OTTERWATCH_PUBLIC_URL="https://monitor.example.com"
RUST_LOG=info  # trace, debug, info, warn, error
```

---

## 🔌 API Endpoints

Base URL: `http://localhost:8080/api`

### Agent Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agents` | GET | List all registered agents |
| `/agents/{id}` | GET | Get specific agent details |
| `/agents/{id}/metrics` | GET | Query agent metrics |
| `/agents/{id}/command` | POST | Send command to agent |
| `/agents/{id}/processes` | GET | Get agent's process list |

### Fleet Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/groups` | GET | List agent groups |
| `/groups/{name}/agents` | GET | Get agents in group |
| `/cluster/bootstrap` | GET | Bootstrap endpoint for agents |

### Metrics & History

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/metrics/latest` | GET | Latest metrics from all agents |
| `/metrics/history` | GET | Historical metrics (time range) |
| `/metrics/aggregated` | GET | Aggregated statistics |

### Updates

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/updates` | GET | List available agent updates |
| `/updates/upload` | POST | Upload new agent binary |
| `/updates/{version}/download` | GET | Download agent binary |

### Example API Calls

```bash
# List all agents
curl http://localhost:8080/api/agents | jq

# Get specific agent
curl http://localhost:8080/api/agents/agent-uuid | jq

# Send restart command
curl -X POST http://localhost:8080/api/agents/agent-uuid/command \
  -H "Content-Type: application/json" \
  -d '{"command":"restart"}'

# Query metrics (last hour)
curl "http://localhost:8080/api/agents/agent-uuid/metrics?from=1h" | jq

# Bootstrap (called by agents)
curl http://localhost:8080/api/cluster/bootstrap | jq
```

---

## 🗄️ Database Schema

### Main Tables

- `agents` - Registered agents (id, hostname, version, group, last_seen)
- `metrics_cpu` - CPU usage metrics (hypertable)
- `metrics_memory` - Memory metrics (hypertable)
- `metrics_disk` - Disk I/O metrics (hypertable)
- `metrics_network` - Network metrics (hypertable)
- `metrics_pressure` - PSI metrics (hypertable)
- `processes` - Process snapshots

### TimescaleDB Hypertables

All metrics tables are TimescaleDB hypertables with automatic:
- Time-based partitioning
- Compression for old data
- Retention policy enforcement

### Migrations

Migrations are automatically applied on server startup using SQLx.

Manual migration:
```bash
sqlx migrate run --database-url "postgres://otterwatch:otterwatch@localhost/otterwatch"
```

---

## 🎯 Agent Commands

Server can send commands to agents via MQTT:

### Available Commands

| Command | Payload | Description |
|---------|---------|-------------|
| `ping` | - | Health check with RTT |
| `reload-config` | - | Reload agent settings.toml |
| `restart` | - | Restart agent process |
| `reconnect` | - | Re-bootstrap and reconnect |
| `set-group` | `{"group":"name"}` | Update agent group |
| `update` | `{"url":"http://...", "checksum":"sha256..."}` | Update agent binary |
| `get-config` | - | Get current config |
| `set-config` | `{"key":"value"}` | Set config parameter |
| `sync-config` | - | Add missing config keys |
| `get-config-schema` | - | Get config schema |
| `get-swap-processes` | - | List swap-using processes |

### Sending Commands

Via API:
```bash
curl -X POST http://localhost:8080/api/agents/AGENT_ID/command \
  -H "Content-Type: application/json" \
  -d '{"command":"restart"}'
```

Via Dashboard:
1. Navigate to Agents page
2. Select agent
3. Click "Commands" dropdown
4. Choose command

---

## 📊 Dashboard

The web dashboard provides:

- **Fleet Overview:** All agents with status, CPU, memory, load
- **Agent Details:** Detailed metrics with charts
- **Process Monitoring:** Top processes per agent
- **Historical Charts:** Time-series visualization
- **Agent Management:** Send commands, view logs
- **Group Management:** Organize agents by groups

**Technologies:** React, TypeScript, Recharts, Tailwind CSS

### Building Dashboard

```bash
cd dashboard
npm install
npm run build  # Outputs to dashboard/dist
```

Dashboard is automatically included in Docker image and served by the server at `/`.

---

## 🔄 Agent Update System

Server can distribute agent updates:

### Uploading Agent Binary

```bash
# Via API
curl -X POST http://localhost:8080/api/updates/upload \
  -F "file=@otterwatch-0.3.6" \
  -F "version=0.3.6"

# Or manually
cp otterwatch-0.3.6 updates/otterwatch-0.3.6
sha256sum otterwatch-0.3.6 > updates/otterwatch-0.3.6.sha256
```

### Triggering Update

```bash
curl -X POST http://localhost:8080/api/agents/AGENT_ID/command \
  -H "Content-Type: application/json" \
  -d '{
    "command": "update",
    "url": "http://server:8080/api/updates/0.3.6/download",
    "checksum": "sha256-hash-here"
  }'
```

Agent will:
1. Download new binary
2. Verify SHA256 checksum
3. Create backup of current binary
4. Replace binary
5. Restart (via wrapper script)
6. Rollback if health check fails

---

## 🏗️ Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│                   OtterWatch Server                      │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ MQTT         │→ │ Repository   │→ │ PostgreSQL/  │  │
│  │ Subscriber   │  │ Layer        │  │ TimescaleDB  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ HTTP API     │← │ Business     │← │ Dashboard    │  │
│  │ (Axum)       │  │ Logic        │  │ (React)      │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                          │
│  ┌──────────────┐                                       │
│  │ Update       │                                       │
│  │ Manager      │                                       │
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
```

### Source Modules

- `api/` - HTTP REST API endpoints (Axum)
- `config/` - Configuration loading
- `db/` - Database repository pattern and migrations
- `mqtt/` - MQTT subscriber client
- `proto/` - Protocol Buffers definitions
- `updates/` - Agent update distribution

---

## 🐳 Docker Deployment

### Using Existing Compose File

```bash
# Start stack
docker-compose -f podman-compose.yml up -d

# Scale (if using cluster mode)
docker-compose -f podman-compose.yml up -d --scale server=3
```

### Using Centralized Build Scripts

```bash
cd /path/to/otterwatch/scripts

# Build all images
./build-all-images.sh

# Use full stack compose
docker-compose -f docker-compose-full.yml up -d
```

See [otterwatch/scripts/README-DOCKER.md](../otterwatch/scripts/README-DOCKER.md) for complete Docker documentation.

---

## 🔧 Development

### Build Commands

```bash
# Development build
cargo build

# Release build
cargo build --release

# Run with debug logging
RUST_LOG=debug cargo run

# Run tests
cargo test

# Code formatting
cargo fmt

# Linting
cargo clippy
```

### Database Development

```bash
# Create migration
sqlx migrate add migration_name

# Run migrations
sqlx migrate run

# Revert last migration
sqlx migrate revert
```

---

## 🛠️ Troubleshooting

### Server won't start

```bash
# Check database connection
psql "postgres://otterwatch:otterwatch@localhost/otterwatch" -c "SELECT 1;"

# Check MQTT broker
nc -zv mqtt-broker 1883

# Check logs
RUST_LOG=debug ./otterwatch-server
```

### Agents not appearing

```bash
# Check MQTT subscription
# Server subscribes to: otterwatch/metrics/+/info

# Verify agent is publishing
mosquitto_sub -h broker -t 'otterwatch/#' -v

# Check API keys match between agent and server
```

### Dashboard not loading

```bash
# Rebuild dashboard
cd dashboard
npm run build

# Check if served by server
curl http://localhost:8080/
```

---

## 📈 Performance Tuning

### Database

```sql
-- Create indexes for common queries
CREATE INDEX idx_metrics_cpu_agent_time ON metrics_cpu(agent_id, timestamp DESC);

-- Adjust compression policy (compress data older than 7 days)
SELECT add_compression_policy('metrics_cpu', INTERVAL '7 days');

-- Adjust retention (drop data older than 90 days)
SELECT add_retention_policy('metrics_cpu', INTERVAL '90 days');
```

### MQTT

```toml
# Increase buffer if agents send bursts
mqtt_client_buffer_size = 10000

# Adjust QoS (0 = at most once, 1 = at least once, 2 = exactly once)
mqtt_qos = 1
```

---

## 📝 License

MIT License - see [LICENSE](LICENSE) file

---

## 🔗 Links

- **GitHub:** https://github.com/ximot/otterwatch-server
- **Agent:** https://github.com/ximot/otterwatch
- **MQTT Broker:** https://github.com/ximot/otterwatch-mqtt
- **AI Agent:** https://github.com/ximot/otterwatch-ai

---

**Part of the OtterWatch monitoring ecosystem**
