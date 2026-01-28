FROM rust:1.92-slim as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential libssl-dev pkg-config libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# We don't need SQLX_OFFLINE=true if we use unchecked queries, 
# but keeping it doesn't hurt.
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y \
    libssl3 libpq5 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Note: Ensure 'reel-forge' matches the executable name in your Cargo.toml
COPY --from=builder /app/target/release/reel-forge ./backend
EXPOSE 8080
CMD ["./backend"]
