//! Integration tests — require DATABASE_URL and migrations through 289.

use super::contract::{validate_metadata_key, validate_rve, SCHEMA_VERSION};
use super::hierarchy::{load_hierarchy_context, merge_optional_string, winning_attachment};
use super::profiles::{create_draft_version, create_family, get_active_version, publish_version, update_draft_labels};
use super::provenance::{entry, scope_id, ProvenanceSource};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

async fn pool() -> Option<PgPool> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = PgPool::connect(&url).await.ok()?;
    let _ = crate::db::run_migrations(&pool).await.ok()?;
    Some(pool)
}

fn minimal_valid_rve(episode_label: &str) -> serde_json::Value {
    json!({
        "schema_version": SCHEMA_VERSION,
        "resolve_context": {
            "episode_id": "a1000000-0000-4000-8000-000000000001",
            "project_id": "c3000000-0000-4000-8000-000000000003",
            "resolved_at": "2026-06-03T12:00:00Z",
            "enforce_paywall": false
        },
        "layout": {
            "preset_key": "MINIMAL",
            "definition": { "panels": { "hero": { "visible": true, "zone": "top" } }, "shelf_order": [] }
        },
        "theme": { "tokens": {} },
        "labels": { "episode_label": episode_label },
        "metadata": {},
        "visibility": {
            "hero": { "enabled": true, "mode": "OFF" },
            "panels": { "hero": { "effective_visible": true, "baseline_visible": true } }
        },
        "campaigns": [],
        "slots": [],
        "monetization_presentation": {},
        "watch_features": {
            "continue_watching_enabled": false,
            "recommendations_enabled": false,
            "downloads_enabled": false,
            "comments_enabled": false
        },
        "provenance": {
            "schema_version": { "value": SCHEMA_VERSION, "source": "default" },
            "resolve_context.project_id": { "value": "c3000000-0000-4000-8000-000000000003", "source": "episode" },
            "layout.preset_key": { "value": "MINIMAL", "source": "default" },
            "labels.episode_label": { "value": episode_label, "source": "default" },
            "visibility.hero.mode": { "value": "OFF", "source": "default" },
            "visibility.hero.enabled": { "value": true, "source": "default" }
        }
    })
}

#[tokio::test]
async fn schema_validates_documentary_shape() {
    let doc = include_str!("../../../docs/RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md");
    let _ = doc;
    let payload = minimal_valid_rve("Episode");
    match validate_rve(&payload) {
        Ok(()) => {}
        Err(e) => panic!("expected valid RVE: {e}"),
    }
}

#[tokio::test]
async fn schema_rejects_missing_episode_label() {
    let mut payload = minimal_valid_rve("");
    payload["labels"] = json!({});
    assert!(validate_rve(&payload).is_err());
}

#[tokio::test]
async fn schema_rejects_reserved_metadata_key() {
    assert!(validate_metadata_key("ai.shelf_rank").is_err());
    assert!(validate_metadata_key("artist_name").is_ok());
}

#[tokio::test]
async fn provenance_entry_serializes_contract_shape() {
    let e = entry(&"Ep", ProvenanceSource::Series, Some(scope_id("studio_series", Uuid::nil())), None);
    let v = serde_json::to_value(&e).unwrap();
    assert_eq!(v["source"], "series");
    assert!(v.get("value").is_some());
}

#[tokio::test]
async fn hierarchy_label_inheritance_merge() {
    let merged = merge_optional_string(&[
        Some("Project".into()),
        Some("Show".into()),
        None,
        Some("Ep".into()),
    ]);
    assert_eq!(merged.as_deref(), Some("Ep"));
}

#[tokio::test]
async fn active_version_selection_and_single_active() {
    let Some(pool) = pool().await else {
        eprintln!("skip active_version_selection: DATABASE_URL not set");
        return;
    };

    let family = create_family(&pool, "Test Family Active", Some("test-active-family"))
        .await
        .expect("create family");
    let draft = create_draft_version(&pool, family.id, "DOCUMENTARY")
        .await
        .expect("draft");
    let published = publish_version(&pool, draft.id)
        .await
        .expect("publish")
        .expect("ok");
    assert_eq!(published.status, "ACTIVE");

    let active = get_active_version(&pool, family.id)
        .await
        .expect("get active")
        .expect("exists");
    assert_eq!(active.id, published.id);

    let draft2 = create_draft_version(&pool, family.id, "DOCUMENTARY")
        .await
        .expect("draft2");
    let published2 = publish_version(&pool, draft2.id)
        .await
        .expect("publish2")
        .expect("ok");
    assert_eq!(published2.status, "ACTIVE");

    let active2 = get_active_version(&pool, family.id)
        .await
        .expect("get active2")
        .expect("exists");
    assert_eq!(active2.id, published2.id);
    assert!(active2.version > active.version);
}

#[tokio::test]
async fn pinned_version_rejects_draft() {
    let Some(pool) = pool().await else {
        eprintln!("skip pinned_version_rejects_draft: DATABASE_URL not set");
        return;
    };

    let family = create_family(&pool, "Test Pin", Some("test-pin-family"))
        .await
        .expect("family");
    let draft = create_draft_version(&pool, family.id, "MICRO_DRAMA")
        .await
        .expect("draft");
    let result = super::profiles::get_pinned_version(&pool, draft.id)
        .await
        .expect("pin");
    assert!(result.is_err());
}

#[tokio::test]
async fn hierarchy_attachment_load() {
    let Some(pool) = pool().await else {
        eprintln!("skip hierarchy_attachment_load: DATABASE_URL not set");
        return;
    };

    let episode_id: Uuid = sqlx::query_scalar(
        r#"
        SELECT e.id FROM studio_episodes e
        JOIN studio_seasons s ON s.id = e.season_id
        LIMIT 1
        "#,
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
    .expect("need seeded episode");

    let ctx = load_hierarchy_context(&pool, episode_id)
        .await
        .expect("load")
        .expect("ctx");
    assert_eq!(ctx.episode_id, episode_id);
    let _win = winning_attachment(&ctx);
}

#[tokio::test]
async fn profile_labels_override_at_draft_level() {
    let Some(pool) = pool().await else {
        eprintln!("skip profile_labels: DATABASE_URL not set");
        return;
    };

    let family = create_family(&pool, "Label Test", Some("label-test-family"))
        .await
        .expect("family");
    let draft = create_draft_version(&pool, family.id, "MUSIC_VIDEO")
        .await
        .expect("draft");
    let updated = update_draft_labels(&pool, draft.id, Some("Track"), Some("Album"))
        .await
        .expect("update")
        .expect("row");
    assert_eq!(updated.episode_label.as_deref(), Some("Track"));
    assert_eq!(updated.series_label.as_deref(), Some("Album"));
}
