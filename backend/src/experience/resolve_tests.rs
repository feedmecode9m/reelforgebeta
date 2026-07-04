//! Resolver integration tests — one per RDR merge rule (see RESOLVER_DECISION_RECORD.md).

use super::contract::{validate_rve, SCHEMA_VERSION};
use super::experience_resolve::{resolve, ResolveError};
use super::hierarchy::load_hierarchy_context;
use super::loader::load_resolve_bundle;
use super::profiles::{
    create_draft_version, create_family, get_active_version, publish_version, update_draft_labels,
};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

async fn pool() -> Option<PgPool> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = PgPool::connect(&url).await.ok()?;
    let _ = crate::db::run_migrations(&pool).await.ok()?;
    Some(pool)
}

async fn any_episode_id(pool: &PgPool) -> Option<Uuid> {
    sqlx::query_scalar(
        r#"SELECT e.id FROM studio_episodes e LIMIT 1"#,
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

// RDR-130 / RDR-004: campaigns always empty
#[tokio::test]
async fn rdr_130_campaigns_empty() {
    let Some(pool) = pool().await else {
        eprintln!("skip rdr_130: DATABASE_URL not set");
        return;
    };
    let episode_id = any_episode_id(&pool).await.expect("episode");
    let rve = resolve(&pool, episode_id).await.expect("resolve");
    assert_eq!(rve["campaigns"], json!([]));
}

// RDR-150 / RDR-005: validate_rve on every response
#[tokio::test]
async fn rdr_150_validate_on_resolve() {
    let Some(pool) = pool().await else {
        eprintln!("skip rdr_150: DATABASE_URL not set");
        return;
    };
    let episode_id = any_episode_id(&pool).await.expect("episode");
    let rve = resolve(&pool, episode_id).await.expect("resolve");
    validate_rve(&rve).expect("valid RVE");
    assert_eq!(rve["schema_version"], SCHEMA_VERSION);
}

// RDR-024: enforce_paywall always false
#[tokio::test]
async fn rdr_024_enforce_paywall_false() {
    let Some(pool) = pool().await else {
        eprintln!("skip rdr_024: DATABASE_URL not set");
        return;
    };
    let episode_id = any_episode_id(&pool).await.expect("episode");
    let rve = resolve(&pool, episode_id).await.expect("resolve");
    assert_eq!(rve["resolve_context"]["enforce_paywall"], false);
}

// RDR-020: missing episode → NotFound
#[tokio::test]
async fn rdr_020_episode_not_found() {
    let Some(pool) = pool().await else {
        eprintln!("skip rdr_020: DATABASE_URL not set");
        return;
    };
    let missing = Uuid::new_v4();
    let err = resolve(&pool, missing).await.unwrap_err();
    assert!(matches!(err, ResolveError::NotFound));
}

// RDR-031 / NC-103: pinned DRAFT → PinnedDraft
#[tokio::test]
async fn rdr_031_pinned_draft_rejected() {
    let Some(pool) = pool().await else {
        eprintln!("skip rdr_031: DATABASE_URL not set");
        return;
    };
    let episode_id = any_episode_id(&pool).await.expect("episode");
    let family = create_family(&pool, "RDR Pin Draft", Some("rdr-pin-draft"))
        .await
        .expect("family");
    let draft = create_draft_version(&pool, family.id, "DOCUMENTARY")
        .await
        .expect("draft");

    sqlx::query(
        r#"
        UPDATE studio_episodes
        SET experience_profile_family_id = $2,
            experience_profile_pin_version = true,
            experience_profile_version_id = $3
        WHERE id = $1
        "#,
    )
    .bind(episode_id)
    .bind(family.id)
    .bind(draft.id)
    .execute(&pool)
    .await
    .expect("attach");

    let err = resolve(&pool, episode_id).await.unwrap_err();
    assert!(matches!(err, ResolveError::PinnedDraft));

    sqlx::query(
        r#"
        UPDATE studio_episodes
        SET experience_profile_family_id = NULL,
            experience_profile_pin_version = false,
            experience_profile_version_id = NULL
        WHERE id = $1
        "#,
    )
    .bind(episode_id)
    .execute(&pool)
    .await
    .ok();
}

// RDR-040 / RDR-041: episode label from profile chain
#[tokio::test]
async fn rdr_041_episode_label_from_profile() {
    let Some(pool) = pool().await else {
        eprintln!("skip rdr_041: DATABASE_URL not set");
        return;
    };
    let episode_id = any_episode_id(&pool).await.expect("episode");
    let family = create_family(&pool, "RDR Label", Some("rdr-label-family"))
        .await
        .expect("family");
    let draft = create_draft_version(&pool, family.id, "MUSIC_VIDEO")
        .await
        .expect("draft");
    update_draft_labels(&pool, draft.id, Some("Track"), None)
        .await
        .expect("labels");
    let published = publish_version(&pool, draft.id)
        .await
        .expect("pub")
        .expect("ok");

    sqlx::query(
        r#"
        UPDATE studio_episodes
        SET experience_profile_family_id = $2,
            experience_profile_pin_version = false,
            experience_profile_version_id = NULL
        WHERE id = $1
        "#,
    )
    .bind(episode_id)
    .bind(family.id)
    .execute(&pool)
    .await
    .expect("attach");

    let rve = resolve(&pool, episode_id).await.expect("resolve");
    assert_eq!(rve["labels"]["episode_label"], "Track");
    assert_eq!(
        rve["experience_profile"]["profile_version_id"],
        json!(published.id)
    );

    sqlx::query(
        r#"
        UPDATE studio_episodes
        SET experience_profile_family_id = NULL
        WHERE id = $1
        "#,
    )
    .bind(episode_id)
    .execute(&pool)
    .await
    .ok();
}

// RDR-060–063: visibility intersection
#[tokio::test]
async fn rdr_062_panel_intersection() {
    let Some(pool) = pool().await else {
        eprintln!("skip rdr_062: DATABASE_URL not set");
        return;
    };
    let episode_id = any_episode_id(&pool).await.expect("episode");
    let family = create_family(&pool, "RDR Vis", Some("rdr-vis-family"))
        .await
        .expect("family");
    let draft = create_draft_version(&pool, family.id, "DOCUMENTARY")
        .await
        .expect("draft");

    sqlx::query(
        r#"
        UPDATE experience_profile_versions
        SET continue_watching_enabled = false
        WHERE id = $1
        "#,
    )
    .bind(draft.id)
    .execute(&pool)
    .await
    .expect("flag");

    publish_version(&pool, draft.id).await.expect("pub").expect("ok");

    sqlx::query(
        r#"
        UPDATE studio_episodes
        SET experience_profile_family_id = $2
        WHERE id = $1
        "#,
    )
    .bind(episode_id)
    .bind(family.id)
    .execute(&pool)
    .await
    .expect("attach");

    let rve = resolve(&pool, episode_id).await.expect("resolve");
    if let Some(cw) = rve["visibility"]["panels"].get("continue_watching") {
        assert_eq!(cw["baseline_visible"], true);
        assert_eq!(cw["profile_enabled"], false);
        assert_eq!(cw["effective_visible"], false);
        assert_eq!(cw["disabled_by"], "profile");
    }

    sqlx::query(
        r#"UPDATE studio_episodes SET experience_profile_family_id = NULL WHERE id = $1"#,
    )
    .bind(episode_id)
    .execute(&pool)
    .await
    .ok();
}

// RDR-090: unknown layout falls back to MINIMAL
#[tokio::test]
async fn rdr_090_unknown_layout_fallback() {
    let Some(pool) = pool().await else {
        eprintln!("skip rdr_090: DATABASE_URL not set");
        return;
    };
    let episode_id = any_episode_id(&pool).await.expect("episode");
    let family = create_family(&pool, "RDR Layout", Some("rdr-layout-family"))
        .await
        .expect("family");
    let draft = create_draft_version(&pool, family.id, "GENERIC")
        .await
        .expect("draft");
    let bogus = Uuid::new_v4();
    sqlx::query(
        r#"UPDATE experience_profile_versions SET layout_preset_id = $2 WHERE id = $1"#,
    )
    .bind(draft.id)
    .bind(bogus)
    .execute(&pool)
    .await
    .expect("layout");

    publish_version(&pool, draft.id).await.expect("pub").expect("ok");

    sqlx::query(
        r#"UPDATE studio_episodes SET experience_profile_family_id = $2 WHERE id = $1"#,
    )
    .bind(episode_id)
    .bind(family.id)
    .execute(&pool)
    .await
    .expect("attach");

    let rve = resolve(&pool, episode_id).await.expect("resolve");
    assert_eq!(rve["layout"]["preset_key"], "MINIMAL");

    sqlx::query(
        r#"UPDATE studio_episodes SET experience_profile_family_id = NULL WHERE id = $1"#,
    )
    .bind(episode_id)
    .execute(&pool)
    .await
    .ok();
}

// RDR-110: metadata chain merge
#[tokio::test]
async fn rdr_111_metadata_later_scope_wins() {
    let Some(pool) = pool().await else {
        eprintln!("skip rdr_111: DATABASE_URL not set");
        return;
    };
    let ctx = load_hierarchy_context(&pool, any_episode_id(&pool).await.unwrap())
        .await
        .expect("load")
        .expect("ctx");

    let def = super::metadata_registry::create_definition(&pool, "rdr_test_key", "RDR Test", "string")
        .await
        .expect("def")
        .expect("ok");

    super::metadata_registry::upsert_value(
        &pool,
        def.id,
        "project",
        ctx.project_id,
        json!("project-value"),
    )
    .await
    .expect("proj");
    super::metadata_registry::upsert_value(
        &pool,
        def.id,
        "episode",
        ctx.episode_id,
        json!("episode-value"),
    )
    .await
    .expect("ep");

    let rve = resolve(&pool, ctx.episode_id).await.expect("resolve");
    assert_eq!(rve["metadata"]["rdr_test_key"], "episode-value");

    sqlx::query("DELETE FROM metadata_values WHERE definition_id = $1")
        .bind(def.id)
        .execute(&pool)
        .await
        .ok();
}

// RDR-200: query counter present on bundle
#[tokio::test]
async fn rdr_200_query_count_bounded() {
    let Some(pool) = pool().await else {
        eprintln!("skip rdr_200: DATABASE_URL not set");
        return;
    };
    let episode_id = any_episode_id(&pool).await.expect("episode");
    let bundle = load_resolve_bundle(&pool, episode_id)
        .await
        .expect("bundle");
    assert!(bundle.query_count > 0);
    assert!(bundle.query_count <= 15, "query_count={}", bundle.query_count);
}

// RDR-030: no profile section when unattached
#[tokio::test]
async fn rdr_030_omit_experience_profile() {
    let Some(pool) = pool().await else {
        eprintln!("skip rdr_030: DATABASE_URL not set");
        return;
    };
    let episode_id = any_episode_id(&pool).await.expect("episode");

    sqlx::query(
        r#"
        UPDATE studio_episodes SET experience_profile_family_id = NULL WHERE id = $1;
        UPDATE studio_seasons SET experience_profile_family_id = NULL
        WHERE id = (SELECT season_id FROM studio_episodes WHERE id = $1);
        UPDATE studio_series SET experience_profile_family_id = NULL
        WHERE id = (SELECT s.series_id FROM studio_episodes e JOIN studio_seasons s ON s.id = e.season_id WHERE e.id = $1);
        UPDATE studio_projects SET experience_profile_family_id = NULL
        WHERE id = (SELECT sr.project_id FROM studio_episodes e
            JOIN studio_seasons s ON s.id = e.season_id
            JOIN studio_series sr ON sr.id = s.series_id WHERE e.id = $1);
        "#,
    )
    .bind(episode_id)
    .execute(&pool)
    .await
    .ok();

    let rve = resolve(&pool, episode_id).await.expect("resolve");
    assert!(rve.get("experience_profile").is_none());
}

// RDR-001: resolver file has no direct SQL (static guard)
#[test]
fn rdr_001_resolver_no_direct_sql() {
    let src = include_str!("experience_resolve.rs");
    assert!(
        !src.contains("sqlx::query"),
        "experience_resolve.rs must not contain sqlx::query"
    );
}

// RDR-032: unpinned uses ACTIVE version
#[tokio::test]
async fn rdr_032_active_version_unpinned() {
    let Some(pool) = pool().await else {
        eprintln!("skip rdr_032: DATABASE_URL not set");
        return;
    };
    let episode_id = any_episode_id(&pool).await.expect("episode");
    let family = create_family(&pool, "RDR Active", Some("rdr-active-family"))
        .await
        .expect("family");
    let draft = create_draft_version(&pool, family.id, "REALITY")
        .await
        .expect("draft");
    let published = publish_version(&pool, draft.id)
        .await
        .expect("pub")
        .expect("ok");

    sqlx::query(
        r#"UPDATE studio_episodes SET experience_profile_family_id = $2 WHERE id = $1"#,
    )
    .bind(episode_id)
    .bind(family.id)
    .execute(&pool)
    .await
    .expect("attach");

    let active = get_active_version(&pool, family.id)
        .await
        .expect("active")
        .expect("row");
    assert_eq!(active.id, published.id);

    let rve = resolve(&pool, episode_id).await.expect("resolve");
    assert_eq!(
        rve["experience_profile"]["profile_version_id"],
        json!(published.id)
    );

    sqlx::query(
        r#"UPDATE studio_episodes SET experience_profile_family_id = NULL WHERE id = $1"#,
    )
    .bind(episode_id)
    .execute(&pool)
    .await
    .ok();
}
