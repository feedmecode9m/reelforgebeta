//! Public site hero presentation — source of truth for all browsers / devices.
//! GET is always available (no REELFORGE_PLATFORM_CONFIG gate).
//! PUT is protected by global admin session middleware on mutating /api/* routes.

use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use sqlx::Row;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeroPresentation {
    pub hero_asset_id: Option<String>,
    pub background_source: Option<String>,
    pub background_style: Option<String>,
    pub media_url: Option<String>,
    pub poster_url: Option<String>,
    pub hero_label: Option<String>,
    pub hero_title: Option<String>,
    pub hero_subtitle: Option<String>,
    pub hero_description: Option<String>,
    /// Extra public fields (story context, intelligence, CTAs, etc.)
    #[serde(default)]
    pub presentation: Value,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertHeroPresentation {
    #[serde(default)]
    pub hero_asset_id: Option<String>,
    #[serde(default)]
    pub background_source: Option<String>,
    #[serde(default)]
    pub background_style: Option<String>,
    #[serde(default)]
    pub media_url: Option<String>,
    #[serde(default)]
    pub poster_url: Option<String>,
    #[serde(default)]
    pub hero_label: Option<String>,
    #[serde(default)]
    pub hero_title: Option<String>,
    #[serde(default)]
    pub hero_subtitle: Option<String>,
    #[serde(default)]
    pub hero_description: Option<String>,
    #[serde(default)]
    pub presentation: Option<Value>,
}

async fn ensure_table(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS platform_hero_config (
            id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            hero_enabled        BOOLEAN NOT NULL DEFAULT true,
            hero_mode           TEXT NOT NULL DEFAULT 'STATIC',
            rotation_seconds    INT NOT NULL DEFAULT 8,
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn ensure_row(pool: &PgPool) -> Result<(), sqlx::Error> {
    ensure_table(pool).await?;
    sqlx::query("INSERT INTO platform_hero_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING")
        .execute(pool)
        .await?;
    Ok(())
}

/// Self-heal for prod environments that have not force-applied migrations.
async fn ensure_presentation_columns(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        ALTER TABLE platform_hero_config
            ADD COLUMN IF NOT EXISTS hero_asset_id TEXT,
            ADD COLUMN IF NOT EXISTS background_source TEXT DEFAULT 'selection',
            ADD COLUMN IF NOT EXISTS background_style TEXT DEFAULT 'video',
            ADD COLUMN IF NOT EXISTS media_url TEXT,
            ADD COLUMN IF NOT EXISTS poster_url TEXT,
            ADD COLUMN IF NOT EXISTS hero_label TEXT,
            ADD COLUMN IF NOT EXISTS hero_title TEXT,
            ADD COLUMN IF NOT EXISTS hero_subtitle TEXT,
            ADD COLUMN IF NOT EXISTS hero_description TEXT,
            ADD COLUMN IF NOT EXISTS presentation JSONB NOT NULL DEFAULT '{}'::jsonb
        "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn opt_string_bind(incoming: &Option<String>, current: Option<String>) -> Option<String> {
    match incoming {
        Some(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        None => current,
    }
}

fn row_to_presentation(row: &sqlx::postgres::PgRow) -> HeroPresentation {
    let presentation: Value = row
        .try_get::<Value, _>("presentation")
        .unwrap_or_else(|_| json!({}));
    let updated_at = row
        .try_get::<chrono::DateTime<chrono::Utc>, _>("updated_at")
        .ok()
        .map(|t| t.to_rfc3339());
    HeroPresentation {
        hero_asset_id: row.try_get::<Option<String>, _>("hero_asset_id").ok().flatten(),
        background_source: row
            .try_get::<Option<String>, _>("background_source")
            .ok()
            .flatten(),
        background_style: row
            .try_get::<Option<String>, _>("background_style")
            .ok()
            .flatten(),
        media_url: row.try_get::<Option<String>, _>("media_url").ok().flatten(),
        poster_url: row.try_get::<Option<String>, _>("poster_url").ok().flatten(),
        hero_label: row.try_get::<Option<String>, _>("hero_label").ok().flatten(),
        hero_title: row.try_get::<Option<String>, _>("hero_title").ok().flatten(),
        hero_subtitle: row
            .try_get::<Option<String>, _>("hero_subtitle")
            .ok()
            .flatten(),
        hero_description: row
            .try_get::<Option<String>, _>("hero_description")
            .ok()
            .flatten(),
        presentation,
        updated_at,
    }
}

pub async fn get_presentation(pool: web::Data<PgPool>) -> HttpResponse {
    match get_presentation_inner(pool.get_ref()).await {
        Ok(row) => HttpResponse::Ok().json(row),
        Err(e) => HttpResponse::InternalServerError().json(json!({
            "error": e.to_string()
        })),
    }
}

async fn get_presentation_inner(pool: &PgPool) -> Result<HeroPresentation, sqlx::Error> {
    ensure_row(pool).await?;
    if let Err(e) = ensure_presentation_columns(pool).await {
        eprintln!("[hero_presentation] ensure columns: {e}");
    }

    let row = sqlx::query(
        r#"
        SELECT
            hero_asset_id,
            background_source,
            background_style,
            media_url,
            poster_url,
            hero_label,
            hero_title,
            hero_subtitle,
            hero_description,
            COALESCE(presentation, '{}'::jsonb) AS presentation,
            updated_at
        FROM platform_hero_config
        WHERE id = 1
        "#,
    )
    .fetch_one(pool)
    .await?;

    Ok(row_to_presentation(&row))
}

pub async fn put_presentation(
    pool: web::Data<PgPool>,
    body: web::Json<UpsertHeroPresentation>,
) -> HttpResponse {
    match put_presentation_inner(pool.get_ref(), &*body).await {
        Ok(row) => HttpResponse::Ok().json(row),
        Err(e) => HttpResponse::InternalServerError().json(json!({
            "error": e.to_string()
        })),
    }
}

async fn put_presentation_inner(
    pool: &PgPool,
    body: &UpsertHeroPresentation,
) -> Result<HeroPresentation, sqlx::Error> {
    ensure_row(pool).await?;
    ensure_presentation_columns(pool).await?;

    let current = get_presentation_inner(pool).await?;

    let hero_asset_id = opt_string_bind(&body.hero_asset_id, current.hero_asset_id);
    let background_source = body
        .background_source
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or(current.background_source)
        .unwrap_or_else(|| "selection".into());
    let background_style = body
        .background_style
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or(current.background_style)
        .unwrap_or_else(|| "video".into());
    let media_url = opt_string_bind(&body.media_url, current.media_url);
    let poster_url = opt_string_bind(&body.poster_url, current.poster_url);
    let hero_label = opt_string_bind(&body.hero_label, current.hero_label);
    let hero_title = opt_string_bind(&body.hero_title, current.hero_title);
    let hero_subtitle = opt_string_bind(&body.hero_subtitle, current.hero_subtitle);
    let hero_description = opt_string_bind(&body.hero_description, current.hero_description);
    let presentation = body
        .presentation
        .clone()
        .unwrap_or(current.presentation);

    let row = sqlx::query(
        r#"
        UPDATE platform_hero_config
        SET hero_asset_id = $1,
            background_source = $2,
            background_style = $3,
            media_url = $4,
            poster_url = $5,
            hero_label = $6,
            hero_title = $7,
            hero_subtitle = $8,
            hero_description = $9,
            presentation = $10,
            updated_at = now()
        WHERE id = 1
        RETURNING
            hero_asset_id,
            background_source,
            background_style,
            media_url,
            poster_url,
            hero_label,
            hero_title,
            hero_subtitle,
            hero_description,
            COALESCE(presentation, '{}'::jsonb) AS presentation,
            updated_at
        "#,
    )
    .bind(hero_asset_id)
    .bind(background_source)
    .bind(background_style)
    .bind(media_url)
    .bind(poster_url)
    .bind(hero_label)
    .bind(hero_title)
    .bind(hero_subtitle)
    .bind(hero_description)
    .bind(presentation)
    .fetch_one(pool)
    .await?;

    Ok(row_to_presentation(&row))
}
