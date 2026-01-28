use crate::models::Reel;
use sqlx::PgPool;
use sqlx::types::Json;
use uuid::Uuid;

pub async fn fetch_all_reels(pool: &PgPool) -> Result<Vec<Reel>, sqlx::Error> {
    sqlx::query_as!(
        Reel,
        r#"
        SELECT 
            id as "id: Uuid", 
            title as "title!", 
            category as "category!", 
            episode as "episode!", 
            video_url as "video_url!", 
            thumbnail_url as "thumbnail_url!", 
            likes as "likes!", 
            COALESCE(tags, ARRAY[]::text[]) as "tags!",
            file_name, 
            file_size, 
            is_auto_detected, 
            detection_confidence::text as "detection_confidence?", 
            ai_tags, 
            cultural_themes, 
            video_metadata as "video_metadata?: Json<serde_json::Value>", 
            status, 
            views as "views!", 
            shares as "shares!",
            duration::float8 as "duration?", 
            resolution, 
            has_thumbnail, 
            upload_source, 
            created_at as "created_at?", 
            updated_at as "updated_at?"
        FROM reels
        ORDER BY created_at DESC
        "#
    )
    .fetch_all(pool)
    .await
}

pub async fn create_reel(pool: &PgPool, reel: Reel) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO reels (
            id, title, category, episode, video_url, thumbnail_url, likes, tags,
            file_name, file_size, is_auto_detected, detection_confidence, 
            ai_tags, cultural_themes, video_metadata, status, views, shares,
            duration, resolution, has_thumbnail, upload_source, created_at, updated_at
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
            $19, $20, $21, $22, $23, $24
        )
        "#,
        reel.id,
        reel.title,
        reel.category,
        reel.episode,
        reel.video_url,
        reel.thumbnail_url,
        reel.likes,
        &reel.tags,
        reel.file_name,
        reel.file_size,
        reel.is_auto_detected,
        reel.detection_confidence,
        reel.ai_tags.as_deref(),
        reel.cultural_themes.as_deref(),
        reel.video_metadata as _, 
        reel.status.as_deref().unwrap_or("active"),
        reel.views,
        reel.shares,
        reel.duration,
        reel.resolution,
        reel.has_thumbnail,
        reel.upload_source.as_deref().unwrap_or("studio"),
        reel.created_at,
        reel.updated_at
    )
    .execute(pool)
    .await?;
    
    Ok(())
}

pub async fn sync_user_stats(
    pool: &PgPool, 
    _user_id: String, 
    points: i64,       // Matched to BIGINT
    total_reels: i64   // Matched to BIGINT
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "INSERT INTO studio_stats (id, total_likes, total_uploads) VALUES (1, $1, $2) 
         ON CONFLICT (id) DO UPDATE SET total_likes = $1, total_uploads = $2",
        points,
        total_reels
    )
    .execute(pool)
    .await?;
    
    Ok(())
}
