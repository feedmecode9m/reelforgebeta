FROM rust:1.92-bookworm AS builder

# musl-tools: musl-gcc linker for x86_64-unknown-linux-musl
# libssl-dev: headers + static libs for openssl-sys (native-tls via sqlx)
# pkg-config: zstd-sys / openssl-sys build scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
    musl-tools \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN rustup target add x86_64-unknown-linux-musl

ENV CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc
ENV RUSTFLAGS='-C target-feature=+crt-static'
ENV OPENSSL_STATIC=1
ENV OPENSSL_LIB_DIR=/usr/lib/x86_64-linux-gnu
ENV OPENSSL_INCLUDE_DIR=/usr/include

WORKDIR /app

COPY . .

RUN cargo build --release -p backend --target x86_64-unknown-linux-musl


FROM alpine:3.21

RUN apk add --no-cache ca-certificates ffmpeg

WORKDIR /app

COPY --from=builder /app/target/x86_64-unknown-linux-musl/release/backend ./backend

RUN mkdir -p /app/public/videos /app/public/thumbs

EXPOSE 8080

CMD ["./backend"]
