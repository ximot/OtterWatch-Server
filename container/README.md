# OtterWatch Container Deployment

This directory contains configuration files for running OtterWatch using Podman/Docker containers.

## Services

- **db** - PostgreSQL 16 with TimescaleDB extension
- **mqtt** - Eclipse Mosquitto MQTT broker
- **server** - OtterWatch server with dashboard

## Quick Start

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` and set your API key:**
   ```bash
   OTTERWATCH_API_KEYS=your-secret-api-key
   OTTERWATCH_PUBLIC_URL=http://your-server-ip:8080
   ```

3. **Start services:**
   ```bash
   # Using the helper script
   ./container/start.sh up

   # Or manually with podman-compose
   podman-compose up -d

   # Or with docker compose
   docker compose up -d
   ```

4. **Access the dashboard:**
   - URL: http://localhost:8080

## Helper Script Commands

```bash
./container/start.sh up       # Start all services
./container/start.sh down     # Stop all services
./container/start.sh logs     # Show logs (follow)
./container/start.sh logs server  # Show server logs only
./container/start.sh build    # Rebuild server image
./container/start.sh restart  # Restart all services
./container/start.sh status   # Show service status
./container/start.sh clean    # Remove all containers and volumes
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OTTERWATCH_API_KEYS` | `default-api-key-change-me` | Comma-separated API keys for agents |
| `OTTERWATCH_PUBLIC_URL` | `http://localhost:8080` | Public URL for update downloads |
| `RUST_LOG` | `info` | Log level (trace, debug, info, warn, error) |

### Ports

| Port | Service | Protocol |
|------|---------|----------|
| 8080 | Dashboard/API | HTTP |
| 1883 | MQTT | TCP |
| 9001 | MQTT WebSocket | WS |
| 5432 | PostgreSQL | TCP |

### Volumes

- `otterwatch-db-data` - PostgreSQL data
- `otterwatch-mqtt-data` - MQTT persistence
- `otterwatch-mqtt-log` - MQTT logs
- `otterwatch-updates` - Agent binary updates

## Agent Configuration

Configure your OtterWatch agents to connect to this server:

```toml
# Agent settings.toml
mqtt_enabled = true
mqtt_broker_addr = "tcp://your-server-ip:1883"
mqtt_api_key = "your-secret-api-key"
mqtt_topic_prefix = "otterwatch/metrics"
```

## Building Manually

```bash
# Build server image
podman build -t otterwatch-server .

# Or with docker
docker build -t otterwatch-server .
```

## Troubleshooting

### Check service logs
```bash
podman-compose logs server
podman-compose logs db
podman-compose logs mqtt
```

### Database connection issues
```bash
# Check if database is ready
podman exec otterwatch-db pg_isready -U otterwatch

# Connect to database
podman exec -it otterwatch-db psql -U otterwatch -d otterwatch
```

### MQTT connection issues
```bash
# Test MQTT connection
podman exec otterwatch-mqtt mosquitto_sub -t '#' -v
```

## Production Recommendations

1. **Change default credentials** in `.env`
2. **Enable MQTT authentication** by editing `container/mosquitto.conf`
3. **Use a reverse proxy** (nginx/traefik) with HTTPS
4. **Set up backups** for the database volume
5. **Configure firewall** to restrict access to ports
