# Backend Port Forensics Report

Phase: `BACKEND-PORT-FORENSICS`  
Policy: forensic only, no patches.

## Executive Root Cause

`AddrInUse` (`Error: Os { code: 98, kind: AddrInUse, message: "Address already in use" }`) is caused by **a second backend process attempting to bind `0.0.0.0:8080` while another backend process is already listening on that port**.

Primary evidence:
- Failed runs show:
  - `🚀 Binding to 0.0.0.0:8080`
  - immediately followed by `AddrInUse`
- Live state confirms exactly one current owner on `:8080`:
  - process name `backend`
  - command `/home/youloose2dafish/projects/reelforge/target/debug/backend`

## 1) Backend Launch Locations (investigated)

## `scripts/start-dev.sh`
- Backend launch point:
  - `cargo run &` (background launch)
- Behavior:
  - checks port with `port_in_use "$BACKEND_PORT"` first
  - if occupied -> logs `Backend already running ...` and skips launch
  - if free -> starts backend in background

## `backend/scripts/recover-backend-8080.sh`
- Backend launch point:
  - `nohup bash -lc "$START_CMD" ... &`
  - default `START_CMD`: `cargo run --manifest-path backend/Cargo.toml`
- This is an independent launcher path and can start backend outside `start-dev.sh`.

## Other findings
- `backend/scripts/start-db.sh` does **not** launch backend automatically; it prints instructions containing `cargo run`.
- No project `.service` unit files found in repo.

## 2) Listener Audit (`backend/src/main.rs`)

Listener creation in runtime path:
- One HTTP server is created via `HttpServer::new(...)`
- One bind call:
  - `.bind(bind_address)?`
- Bind address is computed as:
  - `0.0.0.0:${PORT}` (default `PORT=8080`)

Conclusion:
- Backend process creates **one network listener** on port `8080` for the Actix server.
- No second bind/listener path in `main.rs` for the same port.

## 3) Can Backend Be Launched Twice?

### `start-dev.sh` + manual `cargo run`
- **Yes, possible operationally** if manual launch happens outside the script lifecycle.
- If manual process already owns port, a second backend launch will fail with `AddrInUse`.

### `start-dev.sh` + systemd service
- **Yes, possible in environment** (if a system service exists externally).
- In this workspace scan, no repo service file found and no matching service unit listed.
- If such external service owns `8080`, manual/script launch attempts can fail with `AddrInUse`.

### `start-dev.sh` + existing background process
- **Yes, this is the observed failure mode.**
- Historical failed terminals show direct `cargo run` attempts hitting bind conflict.

## 4) Historical Bind Failure Evidence (second bind attempts)

From recorded terminal runs:

- Terminal `902051` command:
  - `cd .../backend && ... PORT=8080 cargo run`
  - output:
    - `🚀 Binding to 0.0.0.0:8080`
    - `Error: Os { code: 98, kind: AddrInUse, message: "Address already in use" }`

- Terminal `830424` command:
  - `su - youloose2dafish -c '... cd ~/projects/reelforge/backend && cargo run ...'`
  - output:
    - `🚀 Binding to 0.0.0.0:8080`
    - `Error: Os { code: 98, kind: AddrInUse, message: "Address already in use" }`

Interpretation:
- These commands are the **second bind attempts**.
- The existing listener process already held `:8080` when these were executed.

## 5) Current Owner Diagnostics

[BACKEND_PROCESS]
- PID: `110589`
- owner: `root`
- start command: `/home/youloose2dafish/projects/reelforge/target/debug/backend`
- uptime (elapsed at capture): `~10 minutes`
- listener evidence:
  - `LISTEN ... 0.0.0.0:8080 ... users:(("backend",pid=110589,...))`

## 6) Why This Recurs

- Multiple valid backend launch paths exist (`start-dev.sh`, direct `cargo run`, recovery `nohup` script).
- All target the same default bind address `0.0.0.0:8080`.
- Any concurrent or stale prior backend process causes new launch attempts to fail at `.bind(...)` with `AddrInUse`.

## Final Determination

Root cause is **port ownership collision on `8080` from concurrent/previous backend runtime process**, not multiple listeners inside `main.rs`.

