# Rust toolchain for ReelForge backend

The backend `Cargo.lock` is maintained with a **modern Cargo** (lockfile format v3+).  
System packages such as `rustc 1.75` from Ubuntu are **too old** to build this project.

## Recommended: rustup (stable)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

cd ~/projects/reelforge/backend
cargo build
```

The repo root `rust-toolchain.toml` pins **stable**; with rustup installed, Cargo uses it automatically when you build from this repository.

Verify:

```bash
rustc --version   # expect 1.82+ (stable moves forward)
cargo --version
```

## If you see lockfile version 4 error

Older Cargo cannot parse lockfile v4. This repo ships **v3**. If your copy still shows v4:

```bash
sed -i 's/^version = 4/version = 3/' Cargo.lock
```

Then upgrade Rust via rustup (above) — do not rely on Ubuntu's `rustc` alone.

## If you see `edition2024` / `block-buffer` errors

That means Cargo/Rust is still **&lt; 1.85**. Install or update rustup stable:

```bash
rustup update stable
rustup default stable
cargo build --locked
```

## Docker alternative

```bash
cd ~/projects/reelforge
docker build -f backend/Dockerfile backend
```

Uses `rust:1.92-slim` from the Dockerfile.

## Do not

- Commit secrets in `.env`
- Run `cargo update` unless intentionally upgrading dependencies
- Force-push lockfile downgrades without team agreement
