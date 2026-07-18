use std::collections::HashSet;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ReelRow {
    pub id: Uuid,
    pub title: String,
    pub category: String,
    pub description: Option<String>,
    pub video_url: Option<String>,
    pub thumbnail_url: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub file_name: String,
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,
    pub validated: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn insert_pending_reel(
    pool: &PgPool,
    id: Uuid,
    title: &str,
    category: &str,
    description: Option<&str>,
    video_url: &str,
    thumbnail_url: Option<&str>,
    file_name: &str,
    file_size: i64,
    mime_type: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO reels (
            id, title, category, description, video_url, thumbnail_url,
            status, file_name, file_size, mime_type, validated
        ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, false)
        "#,
    )
    .bind(id)
    .bind(title)
    .bind(category)
    .bind(description)
    .bind(video_url)
    .bind(thumbnail_url)
    .bind(file_name)
    .bind(file_size)
    .bind(mime_type)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_ready_reels(pool: &PgPool) -> Result<Vec<ReelRow>, sqlx::Error> {
    sqlx::query_as::<_, ReelRow>(
        r#"
        SELECT id, title, category, description, video_url, thumbnail_url,
               status, error_message, file_name, file_size, mime_type, validated,
               created_at, updated_at
        FROM reels
        WHERE status = 'ready' AND validated = true
        ORDER BY created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await
}

pub async fn get_reel_by_id(pool: &PgPool, id: Uuid) -> Result<Option<ReelRow>, sqlx::Error> {
    sqlx::query_as::<_, ReelRow>(
        r#"
        SELECT id, title, category, description, video_url, thumbnail_url,
               status, error_message, file_name, file_size, mime_type, validated,
               created_at, updated_at
        FROM reels WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn set_status_processing(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE reels SET status = 'processing', updated_at = now() WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn mark_ready(pool: &PgPool, id: Uuid, thumbnail_url: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE reels
        SET status = 'ready', validated = true, thumbnail_url = $2, error_message = NULL, updated_at = now()
        WHERE id = $1
        "#,
    )
    .bind(id)
    .bind(thumbnail_url)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn mark_failed(pool: &PgPool, id: Uuid, error: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE reels SET status = 'failed', validated = false, error_message = $2, updated_at = now() WHERE id = $1
        "#,
    )
    .bind(id)
    .bind(error)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_reel(pool: &PgPool, id: Uuid) -> Result<Option<ReelRow>, sqlx::Error> {
    let row = get_reel_by_id(pool, id).await?;
    sqlx::query("DELETE FROM reels WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(row)
}

pub async fn count_ready(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM reels WHERE status = 'ready' AND validated = true",
    )
    .fetch_one(pool)
    .await
}

pub async fn count_by_category_ready(pool: &PgPool) -> Result<Vec<(String, i64)>, sqlx::Error> {
    sqlx::query_as::<_, (String, i64)>(
        "SELECT category, COUNT(*) FROM reels WHERE status = 'ready' AND validated = true GROUP BY category",
    )
    .fetch_all(pool)
    .await
}

/// Basenames of video files for ready reels (from `file_name` or `video_url`).
pub async fn list_ready_video_basenames(pool: &PgPool) -> Result<Vec<String>, sqlx::Error> {
    let rows = list_ready_reels(pool).await?;
    Ok(rows
        .into_iter()
        .filter_map(|r| {
            if !r.file_name.is_empty() {
                return Some(r.file_name);
            }
            r.video_url
                .and_then(|u| u.split('/').last().map(|s| s.to_string()))
        })
        .collect())
}

/// Basenames of thumbnail files for ready reels.
pub async fn list_ready_thumbnail_basenames(pool: &PgPool) -> Result<Vec<String>, sqlx::Error> {
    let rows = list_ready_reels(pool).await?;
    Ok(rows
        .into_iter()
        .filter_map(|r| {
            r.thumbnail_url
                .and_then(|u| u.split('/').last().map(|s| s.to_string()))
        })
        .collect())
}

pub async fn find_by_video_basename(
    pool: &PgPool,
    basename: &str,
) -> Result<Option<ReelRow>, sqlx::Error> {
    sqlx::query_as::<_, ReelRow>(
        r#"
        SELECT id, title, category, description, video_url, thumbnail_url,
               status, error_message, file_name, file_size, mime_type, validated,
               created_at, updated_at
        FROM reels
        WHERE video_url LIKE '%' || $1
        LIMIT 1
        "#,
    )
    .bind(basename)
    .fetch_optional(pool)
    .await
}

/// All video basenames referenced by reels (any status) for reconciliation dedup.
pub async fn list_cataloged_video_basenames(pool: &PgPool) -> Result<HashSet<String>, sqlx::Error> {
    let rows = sqlx::query_scalar::<_, String>(
        r#"
        SELECT file_name AS basename FROM reels WHERE file_name <> ''
        UNION
        SELECT split_part(video_url, '/', array_length(string_to_array(video_url, '/'), 1))
        FROM reels
        WHERE video_url IS NOT NULL AND video_url <> ''
        "#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect())
}

pub async fn find_by_file_name(
    pool: &PgPool,
    basename: &str,
) -> Result<Option<ReelRow>, sqlx::Error> {
    sqlx::query_as::<_, ReelRow>(
        r#"
        SELECT id, title, category, description, video_url, thumbnail_url,
               status, error_message, file_name, file_size, mime_type, validated,
               created_at, updated_at
        FROM reels
        WHERE file_name = $1
        LIMIT 1
        "#,
    )
    .bind(basename)
    .fetch_optional(pool)
    .await
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SemanticDuplicateRow {
    pub id: Uuid,
    pub file_name: String,
    pub video_url: Option<String>,
}

pub async fn find_semantic_duplicate(
    pool: &PgPool,
    file_size: i64,
    title: &str,
) -> Result<Option<SemanticDuplicateRow>, sqlx::Error> {
    sqlx::query_as::<_, SemanticDuplicateRow>(
        r#"
        SELECT id, file_name, video_url
        FROM reels
        WHERE file_size = $1
          AND lower(title) = lower($2)
          AND video_url LIKE '/videos/%'
        LIMIT 1
        "#,
    )
    .bind(file_size)
    .bind(title)
    .fetch_optional(pool)
    .await
}

pub async fn set_validated(pool: &PgPool, id: Uuid, validated: bool) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE reels SET validated = $2, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(validated)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_category(
    pool: &PgPool,
    id: Uuid,
    category: &str,
) -> Result<Option<ReelRow>, sqlx::Error> {
    sqlx::query_as::<_, ReelRow>(
        r#"
        UPDATE reels
        SET category = $2, updated_at = now()
        WHERE id = $1
        RETURNING id, title, category, description, video_url, thumbnail_url,
                  status, error_message, file_name, file_size, mime_type, validated,
                  created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(category)
    .fetch_optional(pool)
    .await
}

/// Re-verify ready reels that predate the validated column.
pub async fn backfill_validated_ready_reels(
    pool: &PgPool,
    videos_path: &std::path::Path,
) -> (usize, usize) {
    use crate::media_validator;

    let rows = match sqlx::query_as::<_, ReelRow>(
        r#"
        SELECT id, title, category, description, video_url, thumbnail_url,
               status, error_message, file_name, file_size, mime_type, validated,
               created_at, updated_at
        FROM reels
        WHERE status = 'ready' AND validated = false AND video_url LIKE '/videos/%'
        "#,
    )
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[validation-backfill] query failed: {}", e);
            return (0, 0);
        }
    };

    let mut confirmed = 0usize;
    let mut rejected = 0usize;

    for row in rows {
        let file_path = videos_path.join(&row.file_name);
        match media_validator::validate_video_path(&file_path) {
            Ok(meta) => {
                if set_validated(pool, row.id, true).await.is_ok() {
                    confirmed += 1;
                    eprintln!(
                        "[validation-backfill] validated reel={} file={} codec={}",
                        row.id, row.file_name, meta.codec
                    );
                }
            }
            Err(err) => {
                let _ = media_validator::quarantine_video(videos_path, &file_path, &err);
                let msg = err.to_string();
                let _ = mark_failed(pool, row.id, &msg).await;
                rejected += 1;
            }
        }
    }

    (confirmed, rejected)
}
