//! Experience profile families and versions (write + read for resolver loaders).

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct ProfileFamilyRow {
    pub id: Uuid,
    pub name: String,
    pub slug: Option<String>,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct ProfileVersionRow {
    pub id: Uuid,
    pub profile_family_id: Uuid,
    pub version: i32,
    pub status: String,
    pub published_at: Option<DateTime<Utc>>,
    pub created_from_profile_id: Option<Uuid>,
    pub changelog: Option<String>,
    pub content_format: String,
    pub theme_token_set_id: Option<Uuid>,
    pub layout_preset_id: Option<Uuid>,
    pub project_label: Option<String>,
    pub series_label: Option<String>,
    pub season_label: Option<String>,
    pub episode_label: Option<String>,
    pub vip_label: Option<String>,
    pub trailer_label: Option<String>,
    pub bonus_content_label: Option<String>,
    pub hero_enabled: Option<bool>,
    pub hero_mode: Option<String>,
    pub hero_autoplay: Option<bool>,
    pub hero_carousel_interval: Option<i32>,
    pub hero_overlay_enabled: Option<bool>,
    pub continue_watching_enabled: Option<bool>,
    pub recommendations_enabled: Option<bool>,
    pub artist_panel_enabled: Option<bool>,
    pub credits_enabled: Option<bool>,
    pub downloads_enabled: Option<bool>,
    pub comments_enabled: Option<bool>,
    pub cast_panel_enabled: Option<bool>,
    pub trivia_enabled: Option<bool>,
    pub timeline_enabled: Option<bool>,
    pub paywall_style: Option<String>,
    pub access_style: Option<String>,
    pub cta_style: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn create_family(
    pool: &PgPool,
    name: &str,
    slug: Option<&str>,
) -> Result<ProfileFamilyRow, sqlx::Error> {
    sqlx::query_as::<_, ProfileFamilyRow>(
        r#"
        INSERT INTO experience_profile_families (name, slug)
        VALUES ($1, $2)
        RETURNING id, name, slug, description, created_at, updated_at
        "#,
    )
    .bind(name)
    .bind(slug)
    .fetch_one(pool)
    .await
}

pub async fn create_draft_version(
    pool: &PgPool,
    family_id: Uuid,
    content_format: &str,
) -> Result<ProfileVersionRow, sqlx::Error> {
    let next_version: i32 = sqlx::query_scalar(
        r#"
        SELECT COALESCE(MAX(version), 0) + 1
        FROM experience_profile_versions
        WHERE profile_family_id = $1
        "#,
    )
    .bind(family_id)
    .fetch_one(pool)
    .await?;

    sqlx::query_as::<_, ProfileVersionRow>(
        r#"
        INSERT INTO experience_profile_versions (profile_family_id, version, content_format, status)
        VALUES ($1, $2, $3, 'DRAFT')
        RETURNING *
        "#,
    )
    .bind(family_id)
    .bind(next_version)
    .bind(content_format)
    .fetch_one(pool)
    .await
}

pub async fn get_family(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<ProfileFamilyRow>, sqlx::Error> {
    sqlx::query_as::<_, ProfileFamilyRow>(
        "SELECT id, name, slug, description, created_at, updated_at FROM experience_profile_families WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn get_version(pool: &PgPool, id: Uuid) -> Result<Option<ProfileVersionRow>, sqlx::Error> {
    sqlx::query_as::<_, ProfileVersionRow>(
        "SELECT * FROM experience_profile_versions WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Latest ACTIVE version for a family (contract §5.2 unpinned path).
pub async fn get_active_version(
    pool: &PgPool,
    family_id: Uuid,
) -> Result<Option<ProfileVersionRow>, sqlx::Error> {
    sqlx::query_as::<_, ProfileVersionRow>(
        r#"
        SELECT * FROM experience_profile_versions
        WHERE profile_family_id = $1 AND status = 'ACTIVE'
        ORDER BY version DESC
        LIMIT 1
        "#,
    )
    .bind(family_id)
    .fetch_optional(pool)
    .await
}

/// Pinned version by id; rejects DRAFT (contract §10.3 NC-103).
pub async fn get_pinned_version(
    pool: &PgPool,
    version_id: Uuid,
) -> Result<Result<ProfileVersionRow, &'static str>, sqlx::Error> {
    let row = get_version(pool, version_id).await?;
    Ok(match row {
        Some(v) if v.status == "DRAFT" => Err("pinned profile version cannot be DRAFT"),
        Some(v) => Ok(v),
        None => Err("profile version not found"),
    })
}

/// Publish DRAFT → ACTIVE; demote prior ACTIVE → ARCHIVED (transactional).
pub async fn publish_version(
    pool: &PgPool,
    version_id: Uuid,
) -> Result<Result<ProfileVersionRow, &'static str>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let draft = sqlx::query_as::<_, ProfileVersionRow>(
        "SELECT * FROM experience_profile_versions WHERE id = $1 FOR UPDATE",
    )
    .bind(version_id)
    .fetch_optional(&mut *tx)
    .await?;

    let draft = match draft {
        Some(d) if d.status == "DRAFT" => d,
        Some(_) => {
            tx.rollback().await?;
            return Ok(Err("only DRAFT versions can be published"));
        }
        None => {
            tx.rollback().await?;
            return Ok(Err("profile version not found"));
        }
    };

    sqlx::query(
        r#"
        UPDATE experience_profile_versions
        SET status = 'ARCHIVED', updated_at = now()
        WHERE profile_family_id = $1 AND status = 'ACTIVE'
        "#,
    )
    .bind(draft.profile_family_id)
    .execute(&mut *tx)
    .await?;

    let published = sqlx::query_as::<_, ProfileVersionRow>(
        r#"
        UPDATE experience_profile_versions
        SET status = 'ACTIVE', published_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING *
        "#,
    )
    .bind(version_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Ok(published))
}

pub async fn update_draft_labels(
    pool: &PgPool,
    version_id: Uuid,
    episode_label: Option<&str>,
    series_label: Option<&str>,
) -> Result<Option<ProfileVersionRow>, sqlx::Error> {
    sqlx::query_as::<_, ProfileVersionRow>(
        r#"
        UPDATE experience_profile_versions
        SET episode_label = COALESCE($2, episode_label),
            series_label = COALESCE($3, series_label),
            updated_at = now()
        WHERE id = $1 AND status = 'DRAFT'
        RETURNING *
        "#,
    )
    .bind(version_id)
    .bind(episode_label)
    .bind(series_label)
    .fetch_optional(pool)
    .await
}
