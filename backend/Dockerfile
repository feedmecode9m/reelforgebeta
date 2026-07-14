FROM rust:1.92-bookworm AS builder

RUN apt-get update && apt-get install -y \
    build-essential \
    libssl-dev \
    pkg-config \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN cargo build --release -p backend


FROM debian:13-slim

RUN echo "RUNTIME GLIBC CHECK" && ldd --version

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libssl3 \
    libpq5 \
    ca-certificates \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/backend ./backend

RUN mkdir -p /app/public/videos /app/public/thumbs

EXPOSE 8080

CMD ["./backend"]
