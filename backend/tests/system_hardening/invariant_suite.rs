//! CI anchor for the System Hardening Invariant Suite.
//!
//! Authoritative tests: `backend/src/system_hardening/invariant_suite.rs`
//! Run: `cargo test -p backend --lib system_hardening`

#[test]
fn invariant_suite_entrypoint_documented() {
    assert!(std::path::Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/system_hardening/invariant_suite.rs"
    ))
    .is_file());
}
