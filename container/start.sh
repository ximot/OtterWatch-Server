#!/bin/bash
# OtterWatch Container Startup Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Check if .env exists, create from example if not
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "Creating .env from .env.example..."
        cp .env.example .env
        echo "Please edit .env and set your API keys before starting!"
        exit 1
    fi
fi

# Check for podman or docker
if command -v podman-compose &> /dev/null; then
    COMPOSE_CMD="podman-compose"
elif command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    echo "Error: Neither podman-compose nor docker-compose found!"
    exit 1
fi

echo "Using: $COMPOSE_CMD"

case "${1:-up}" in
    up)
        echo "Starting OtterWatch services..."
        $COMPOSE_CMD up -d
        echo ""
        echo "Services started!"
        echo "  - Dashboard: http://localhost:8080"
        echo "  - MQTT: localhost:1883"
        echo "  - Database: localhost:5432"
        ;;
    down)
        echo "Stopping OtterWatch services..."
        $COMPOSE_CMD down
        ;;
    logs)
        $COMPOSE_CMD logs -f "${@:2}"
        ;;
    build)
        echo "Building OtterWatch server image..."
        $COMPOSE_CMD build --no-cache
        ;;
    restart)
        echo "Restarting OtterWatch services..."
        $COMPOSE_CMD restart
        ;;
    status)
        $COMPOSE_CMD ps
        ;;
    clean)
        echo "Stopping and removing all containers and volumes..."
        $COMPOSE_CMD down -v
        ;;
    *)
        echo "Usage: $0 {up|down|logs|build|restart|status|clean}"
        echo ""
        echo "Commands:"
        echo "  up      - Start all services"
        echo "  down    - Stop all services"
        echo "  logs    - Show logs (optionally specify service: logs server)"
        echo "  build   - Rebuild server image"
        echo "  restart - Restart all services"
        echo "  status  - Show service status"
        echo "  clean   - Stop and remove all containers and volumes"
        exit 1
        ;;
esac
