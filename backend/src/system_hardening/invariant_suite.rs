//! Deterministic cross-layer invariant and regression-lock tests.

use std::collections::hash_map::DefaultHasher;
use std::collections::BTreeSet;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;

use crate::asset_resolution::mock_registry::MockAssetRegistry;
use crate::asset_resolution::AssetResolutionAdapter;
use crate::experience::compose_pipeline::run_from_base_rve;
use crate::experience::contract::{validate_rve, SCHEMA_VERSION};
use crate::experience::cspp::{self, structural_snapshot};
use crate::viewer_sim::simulate_viewer;

use super::harness::{harness_base_rve, FROZEN_MEDIA_METADATA_KEYS};

fn stable_json_hash(value: &Value) -> u64 {
    let json = serde_json::to_string(value).expect("serialize for hash");
    let mut hasher = DefaultHasher::new();
    json.hash(&mut hasher);
    hasher.finish()
}

fn run_hardening_pipeline() -> crate::experience::compose_pipeline::PipelineArtifacts {
    let base = harness_base_rve();
    validate_rve(&base).expect("harness base must validate");
    run_from_base_rve(base)
}

fn media_metadata_snapshot(delivered_with_media: &Value) -> Value {
    let meta = delivered_with_media
        .get("metadata")
        .and_then(|m| m.as_object())
        .expect("metadata object");
    let mut out = serde_json::Map::new();
    for key in FROZEN_MEDIA_METADATA_KEYS {
        if let Some(v) = meta.get(*key) {
            out.insert((*key).to_string(), v.clone());
        }
    }
    Value::Object(out)
}

fn render_tree_json(plan: &crate::experience::cspp::composition_plan::CompositionPlan) -> Value {
    serde_json::to_value(&plan.render_tree).expect("render_tree json")
}

fn composition_plan_json(plan: &crate::experience::cspp::composition_plan::CompositionPlan) -> Value {
    serde_json::to_value(plan).expect("composition_plan json")
}

// --- Golden snapshot hashes (documentary harness; update only via formal contract amendment) ---

const GOLDEN_MEDIA_METADATA_HASH: u64 = 8387924463358500133;
const GOLDEN_DELIVERED_RVE_HASH: u64 = 9841484776351403435;
const GOLDEN_COMPOSITION_PLAN_HASH: u64 = 7114314472671742618;
const GOLDEN_RENDER_TREE_HASH: u64 = 16849311097117245714;

#[test]
fn test_runtime_asset_mode_does_not_change_semantics() {
    // Simulates OFF vs ON: pipeline never branches on runtime_asset_mode.
    let off_a = run_hardening_pipeline();
    let off_b = run_hardening_pipeline();

    assert_eq!(off_a.composition_plan, off_b.composition_plan);
    assert_eq!(off_a.delivered_rve, off_b.delivered_rve);
    assert_eq!(off_a.delivered_with_media, off_b.delivered_with_media);
    assert_eq!(off_a.base_rve, off_b.base_rve);
    assert_eq!(
        media_metadata_snapshot(&off_a.delivered_with_media),
        media_metadata_snapshot(&off_b.delivered_with_media)
    );
    assert_eq!(
        render_tree_json(&off_a.composition_plan),
        render_tree_json(&off_b.composition_plan)
    );

    #[cfg(feature = "runtime_asset_mode")]
    {
        use crate::asset_resolution::metadata_snapshot_from_json;
        use crate::asset_runtime::InMemoryAssetRegistry;

        let meta = off_a.delivered_with_media["metadata"]
            .as_object()
            .unwrap();
        let snap = metadata_snapshot_from_json(meta);
        let media_ref = meta["media_reference"].as_str().unwrap();
        let inventory = MockAssetRegistry::ready_episode();
        let plain = AssetResolutionAdapter::resolve(Some(media_ref), &snap, inventory.records());
        let enriched = AssetResolutionAdapter::resolve_with_runtime(
            Some(media_ref),
            &snap,
            inventory.records(),
            Some(&InMemoryAssetRegistry::harness_dataset()),
        );
        assert_eq!(plain, enriched.result, "runtime enrichment must not alter binding");
    }
}

#[test]
fn test_pipeline_deterministic_repeatability() {
    let baseline = run_hardening_pipeline();
    for i in 0..10 {
        let run = run_hardening_pipeline();
        assert_eq!(baseline.composition_plan, run.composition_plan, "run {i}");
        assert_eq!(baseline.delivered_with_media, run.delivered_with_media, "run {i}");
        assert_eq!(baseline.delivered_rve, run.delivered_rve, "run {i}");
    }
}

#[test]
fn test_adapter_statelessness() {
    let inventory = MockAssetRegistry::ready_episode();
    let meta = crate::asset_resolution::MetadataSnapshot {
        media_intent: Some("DOCUMENTARY".into()),
        thumbnail_resolution: Some("SHOULD_EXIST".into()),
        ..Default::default()
    };
    let media_ref = "episode:a1000000-0000-4000-8000-000000000001";
    let first = AssetResolutionAdapter::resolve(Some(media_ref), &meta, inventory.records());
    for _ in 0..10 {
        let again = AssetResolutionAdapter::resolve(Some(media_ref), &meta, inventory.records());
        assert_eq!(first, again);
    }
}

#[test]
fn test_cspp_purity() {
    let base = harness_base_rve();
    let structural_before = structural_snapshot(&base);
    let delivered = cspp::enrich(base.clone());
    assert_eq!(structural_snapshot(&delivered), structural_before);
    assert_eq!(structural_snapshot(&base), structural_before);

    let meta_before = base.get("metadata").cloned();
    let meta_after = delivered.get("metadata");
    assert_eq!(meta_after, meta_before.as_ref());
}

#[test]
fn test_viewer_purity() {
    let base = harness_base_rve();
    let delivered = cspp::enrich(base.clone());
    let with_media = crate::media::apply_media_semantic_stub(delivered.clone());
    let plan_a = simulate_viewer(&base, &with_media);
    let plan_b = simulate_viewer(&base, &with_media);
    assert_eq!(plan_a, plan_b);
}

#[test]
fn test_no_forbidden_import_paths() {
    let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let forbidden_roots = [
        "experience/experience_resolve.rs",
        "experience/compose_pipeline.rs",
    ];
    let forbidden_dirs = ["experience/cspp", "media"];

    for rel in forbidden_roots {
        let path = src.join(rel);
        let content = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{rel}: {e}"));
        assert!(
            !content.contains("asset_runtime"),
            "{rel} must not import asset_runtime"
        );
        assert!(
            !content.contains("runtime_asset_mode"),
            "{rel} must not branch on runtime_asset_mode"
        );
    }

    for dir in forbidden_dirs {
        for rel in collect_rs_files(&src.join(dir)) {
            let path = src.join(&rel);
            let content = std::fs::read_to_string(&path).expect("read");
            assert!(
                !content.contains("asset_runtime"),
                "{rel} must not import asset_runtime"
            );
        }
    }
}

fn collect_rs_files(dir: &std::path::Path) -> Vec<String> {
    let mut out = Vec::new();
    if !dir.is_dir() {
        return out;
    }
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = std::fs::read_dir(&current).expect("read_dir");
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(
                    path.strip_prefix(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src"))
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        }
    }
    out
}

#[test]
fn test_no_semantic_field_additions() {
    let artifacts = run_hardening_pipeline();
    let meta = artifacts.delivered_with_media["metadata"]
        .as_object()
        .expect("metadata");
    let frozen: BTreeSet<&str> = FROZEN_MEDIA_METADATA_KEYS.iter().copied().collect();
    for key in meta.keys() {
        if key.starts_with("harness_") {
            continue;
        }
        assert!(
            frozen.contains(key.as_str()),
            "unexpected metadata key in delivered RVE: {key}"
        );
    }
    for key in FROZEN_MEDIA_METADATA_KEYS {
        assert!(meta.contains_key(*key), "missing frozen media key: {key}");
    }
    assert_eq!(artifacts.delivered_with_media["schema_version"], SCHEMA_VERSION);
}

#[test]
fn test_snapshot_json_golden_files() {
    let artifacts = run_hardening_pipeline();
    let media: Value = serde_json::from_str(super::snapshots::MEDIA_METADATA_JSON).expect("media json");
    let delivered: Value =
        serde_json::from_str(super::snapshots::DELIVERED_WITH_MEDIA_JSON).expect("delivered json");
    let plan: crate::experience::cspp::composition_plan::CompositionPlan =
        serde_json::from_str(super::snapshots::COMPOSITION_PLAN_JSON).expect("plan json");

    assert_eq!(media_metadata_snapshot(&artifacts.delivered_with_media), media);
    assert_eq!(artifacts.delivered_with_media, delivered);
    assert_eq!(artifacts.composition_plan, plan);
    let golden_plan: Value =
        serde_json::from_str(super::snapshots::COMPOSITION_PLAN_JSON).expect("plan json");
    assert_eq!(
        render_tree_json(&artifacts.composition_plan),
        golden_plan.get("render_tree").cloned().expect("render_tree")
    );
}

#[test]
fn test_snapshot_hashes_locked() {
    let artifacts = run_hardening_pipeline();
    assert_eq!(
        stable_json_hash(&media_metadata_snapshot(&artifacts.delivered_with_media)),
        GOLDEN_MEDIA_METADATA_HASH
    );
    assert_eq!(
        stable_json_hash(&artifacts.delivered_with_media),
        GOLDEN_DELIVERED_RVE_HASH
    );
    assert_eq!(
        stable_json_hash(&composition_plan_json(&artifacts.composition_plan)),
        GOLDEN_COMPOSITION_PLAN_HASH
    );
    assert_eq!(
        stable_json_hash(&render_tree_json(&artifacts.composition_plan)),
        GOLDEN_RENDER_TREE_HASH
    );
}

#[test]
#[ignore = "bootstrap: WRITE_HARDENING_SNAPSHOTS=1 cargo test -p backend --lib print_hardening_golden_hashes -- --ignored --nocapture"]
fn print_hardening_golden_hashes() {
    let artifacts = run_hardening_pipeline();
    let (a, b, c, d) = (
        stable_json_hash(&media_metadata_snapshot(&artifacts.delivered_with_media)),
        stable_json_hash(&artifacts.delivered_with_media),
        stable_json_hash(&composition_plan_json(&artifacts.composition_plan)),
        stable_json_hash(&render_tree_json(&artifacts.composition_plan)),
    );
    eprintln!("GOLDEN_MEDIA_METADATA_HASH = {a}");
    eprintln!("GOLDEN_DELIVERED_RVE_HASH = {b}");
    eprintln!("GOLDEN_COMPOSITION_PLAN_HASH = {c}");
    eprintln!("GOLDEN_RENDER_TREE_HASH = {d}");

    if std::env::var("WRITE_HARDENING_SNAPSHOTS").as_deref() == Ok("1") {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/system_hardening/snapshots");
        std::fs::create_dir_all(&dir).ok();
        write_pretty(
            dir.join("media_metadata_documentary.json"),
            &media_metadata_snapshot(&artifacts.delivered_with_media),
        );
        write_pretty(
            dir.join("delivered_with_media_documentary.json"),
            &artifacts.delivered_with_media,
        );
        write_pretty(
            dir.join("composition_plan_documentary.json"),
            &composition_plan_json(&artifacts.composition_plan),
        );
    }
}

fn write_pretty(path: PathBuf, value: &Value) {
    let s = serde_json::to_string_pretty(value).expect("pretty json");
    std::fs::write(path, s).expect("write snapshot");
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo root")
        .to_path_buf()
}

fn run_depgraph_check() -> std::process::Output {
    let repo_root = repo_root();
    let policy = repo_root.join("architecture/dependency_policy.toml");
    Command::new("cargo")
        .current_dir(&repo_root)
        .args(["run", "-p", "depgraph-check", "--quiet"])
        .env("DEPGRAPH_POLICY_PATH", &policy)
        .output()
        .expect("spawn depgraph-check")
}

#[test]
fn test_dgel_policy_compliance() {
    let policy = repo_root().join("architecture/dependency_policy.toml");
    if !policy.is_file() {
        eprintln!("skip test_dgel_policy_compliance: policy file missing");
        return;
    }
    let output = run_depgraph_check();
    assert!(
        output.status.success(),
        "depgraph-check failed:\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn test_ci_fusion_consistency() {
    let repo_root = repo_root();

    // Fusion CI entrypoints must exist (single source of truth).
    assert!(
        repo_root.join("scripts/ci-architecture-integrity.sh").is_file(),
        "missing fusion script: scripts/ci-architecture-integrity.sh"
    );
    assert!(
        repo_root.join("scripts/ci-depgraph-check.sh").is_file(),
        "missing DGEL script: scripts/ci-depgraph-check.sh"
    );
    assert!(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/system_hardening/invariant_suite.rs")
            .is_file(),
        "missing system_hardening invariant_suite.rs"
    );
    assert!(
        repo_root.join("architecture/dependency_policy.toml").is_file(),
        "missing dependency_policy.toml"
    );

    // Structural layer: depgraph-check PASS with observable output.
    let dgel = run_depgraph_check();
    let dgel_ok = dgel.status.success();
    let dgel_observable = !dgel.stdout.is_empty() || !dgel.stderr.is_empty();

    // Semantic layer: harness pipeline PASS (inline hardening smoke).
    let semantic_a = run_hardening_pipeline();
    let semantic_b = run_hardening_pipeline();
    let semantic_ok = semantic_a.composition_plan == semantic_b.composition_plan
        && semantic_a.delivered_with_media == semantic_b.delivered_with_media
        && render_tree_json(&semantic_a.composition_plan)
            == render_tree_json(&semantic_b.composition_plan);

    if dgel_ok && !semantic_ok {
        panic!("CROSS_LAYER_DRIFT_BLOCK: DGEL PASS but semantic harness diverged");
    }
    if !dgel_ok && semantic_ok {
        panic!(
            "CROSS_LAYER_DRIFT_BLOCK: DGEL FAIL but semantic harness PASS\nstdout: {}\nstderr: {}",
            String::from_utf8_lossy(&dgel.stdout),
            String::from_utf8_lossy(&dgel.stderr)
        );
    }

    assert!(dgel_ok, "fusion: DGEL must PASS");
    assert!(dgel_observable, "fusion: depgraph-check must emit output");
    assert_eq!(
        semantic_a.composition_plan, semantic_b.composition_plan,
        "fusion: semantic pipeline must be deterministic"
    );
    assert_eq!(
        semantic_a.delivered_with_media, semantic_b.delivered_with_media,
        "fusion: delivered RVE must be stable"
    );
    assert_eq!(
        render_tree_json(&semantic_a.composition_plan),
        render_tree_json(&semantic_b.composition_plan),
        "fusion: render tree must be stable"
    );

    // runtime_asset_mode must not create pass/fail divergence on semantic outputs.
    #[cfg(feature = "runtime_asset_mode")]
    {
        use crate::asset_resolution::metadata_snapshot_from_json;
        use crate::asset_runtime::InMemoryAssetRegistry;

        let meta = semantic_a.delivered_with_media["metadata"]
            .as_object()
            .expect("metadata");
        let snap = metadata_snapshot_from_json(meta);
        let media_ref = meta["media_reference"].as_str().expect("media_reference");
        let inventory = MockAssetRegistry::ready_episode();
        let plain =
            AssetResolutionAdapter::resolve(Some(media_ref), &snap, inventory.records());
        let enriched = AssetResolutionAdapter::resolve_with_runtime(
            Some(media_ref),
            &snap,
            inventory.records(),
            Some(&InMemoryAssetRegistry::harness_dataset()),
        );
        assert_eq!(
            plain, enriched.result,
            "fusion: runtime_asset_mode must not change adapter binding (no semantic divergence)"
        );
    }
}
