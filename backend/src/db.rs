use sqlx::{PgPool, postgres::PgPoolOptions};

use crate::models::{Reel, placeholder_reels};

pub async fn connect(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
}

pub async fn init(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS reels (
            id UUID PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            thumbnail_url TEXT,
            status TEXT NOT NULL DEFAULT 'placeholder',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn count_reels(pool: &PgPool) -> Result<i64, sqlx::Error> {
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM reels")
        .fetch_one(pool)
        .await?;
    Ok(count.0)
}

pub async fn list_reels(pool: &PgPool) -> Result<Vec<Reel>, sqlx::Error> {
    sqlx::query_as::<_, Reel>(
        r#"
        SELECT id, title, description, thumbnail_url, status, created_at
        FROM reels
        ORDER BY created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await
}

pub async fn seed_placeholders(pool: &PgPool) -> Result<Vec<Reel>, sqlx::Error> {
    for reel in placeholder_reels() {
        sqlx::query(
            r#"
            INSERT INTO reels (id, title, description, thumbnail_url, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(reel.id)
        .bind(&reel.title)
        .bind(&reel.description)
        .bind(&reel.thumbnail_url)
        .bind(&reel.status)
        .bind(reel.created_at)
        .execute(pool)
        .await?;
    }

    list_reels(pool).await
}

pub async fn ensure_seed_data(pool: &PgPool) -> Result<(), sqlx::Error> {
    if count_reels(pool).await? == 0 {
        seed_placeholders(pool).await?;
    }
    Ok(())
}
