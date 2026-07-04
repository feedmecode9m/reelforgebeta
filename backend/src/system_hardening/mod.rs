//! System hardening invariant suite (CI / `cargo test -p backend --lib`).
//! CI entrypoint: `scripts/ci-architecture-integrity.sh` (see `docs/CI_OPERATIONAL_MODEL.md`).

#[cfg(test)]
mod harness;
#[cfg(test)]
mod invariant_suite;
#[cfg(test)]
mod snapshots;
