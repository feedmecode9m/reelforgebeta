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
    libssl3 libpq5 ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Package name in Cargo.toml is "backend"
COPY --from=builder /app/target/release/backend ./backend
RUN mkdir -p /app/public/videos /app/public/thumbs
EXPOSE 8080
CMD ["./backend"]
