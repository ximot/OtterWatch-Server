# Build stage - use latest Rust for edition 2024 support
FROM rust:latest AS builder

WORKDIR /app

# Install protobuf compiler
RUN apt-get update && apt-get install -y protobuf-compiler && rm -rf /var/lib/apt/lists/*

# Copy manifests
COPY Cargo.toml Cargo.lock ./

# Create dummy src to cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs

# Build dependencies (this layer will be cached)
RUN cargo build --release && rm -rf src

# Copy actual source code
COPY src ./src
COPY proto ./proto
COPY build.rs ./
COPY migrations ./migrations

# Touch main.rs to force rebuild
RUN touch src/main.rs

# Build the actual application
RUN cargo build --release

# Build dashboard
FROM node:20-slim AS dashboard-builder

WORKDIR /app/dashboard

COPY dashboard/package*.json ./
RUN npm ci

COPY dashboard/ ./
RUN npm run build

# Runtime stage
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Copy binary from builder
COPY --from=builder /app/target/release/otterwatch-server /app/otterwatch-server

# Copy migrations
COPY --from=builder /app/migrations /app/migrations

# Copy dashboard build
COPY --from=dashboard-builder /app/dashboard/dist /app/dashboard/dist

# Copy default config
COPY settings.toml.example /app/settings.toml

# Create updates directory
RUN mkdir -p /app/updates

# Expose ports
EXPOSE 8080

# Set environment variables
ENV RUST_LOG=info

# Run the server
CMD ["/app/otterwatch-server"]
