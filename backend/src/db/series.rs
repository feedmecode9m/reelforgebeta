use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct SeriesRow {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub genre: Option<String>,
    pub release_year: Option<i32>,
    pub poster: Option<String>,
    pub tags: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct SeasonRow {
    pub id: String,
    pub series_id: String,
    pub season_number: i32,
    pub title: Option<String>,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct EpisodeRow {
    pub id: String,
    pub season_id: String,
    pub series_id: Option<String>,
    pub season_number: Option<i32>,
    pub episode_number: i32,
    pub title: String,
    pub description: Option<String>,
    pub runtime: Option<i32>,
    pub runtime_seconds: Option<i32>,
    pub status: String,
    pub reel_id: Option<String>,
    pub thumbnail_url: Option<String>,
    pub release_date: Option<NaiveDate>,
    pub genre: Option<String>,
    pub tags: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeDto {
    pub episode_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub season_number: Option<i32>,
    pub episode_number: i32,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_seconds: Option<i32>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeFlatDto {
    pub id: String,
    pub series_id: String,
    pub season_number: i32,
    pub episode_number: i32,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_seconds: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub season_id: Option<String>,
    pub season_number: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub episodes: Vec<EpisodeDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesDto {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    pub seasons: Vec<SeasonDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertEpisodeInput {
    pub episode_id: String,
    pub episode_number: i32,
    pub title: String,
    pub description: Option<String>,
    pub runtime: Option<i32>,
    pub runtime_seconds: Option<i32>,
    pub status: Option<String>,
    pub reel_id: Option<String>,
    pub thumbnail_url: Option<String>,
    pub release_date: Option<String>,
    pub genre: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSeasonInput {
    pub season_id: Option<String>,
    pub season_number: i32,
    pub title: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEpisodeInput {
    pub id: Option<String>,
    pub series_id: String,
    pub season_number: i32,
    pub episode_number: i32,
    pub title: String,
    pub description: Option<String>,
    pub runtime_seconds: Option<i32>,
    pub thumbnail_url: Option<String>,
    pub reel_id: Option<String>,
    pub release_date: Option<String>,
    pub status: Option<String>,
    pub genre: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEpisodeInput {
    pub series_id: Option<String>,
    pub season_number: Option<i32>,
    pub episode_number: Option<i32>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub runtime_seconds: Option<i32>,
    pub thumbnail_url: Option<String>,
    pub reel_id: Option<String>,
    pub release_date: Option<String>,
    pub status: Option<String>,
    pub genre: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSeasonInput {
    pub season_id: Option<String>,
    pub season_number: i32,
    pub title: Option<String>,
    pub description: Option<String>,
    pub episodes: Option<Vec<UpsertEpisodeInput>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSeriesInput {
    pub id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub genre: Option<String>,
    pub release_year: Option<i32>,
    pub poster: Option<String>,
    pub tags: Option<Vec<String>>,
    pub seasons: Option<Vec<UpsertSeasonInput>>,
}

fn tags_to_vec(value: &serde_json::Value) -> Vec<String> {
    value
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn tags_to_json(tags: Option<&[String]>) -> serde_json::Value {
    serde_json::json!(tags.unwrap_or(&[]))
}

fn format_release_date(value: Option<NaiveDate>) -> Option<String> {
    value.map(|d| d.format("%Y-%m-%d").to_string())
}

fn parse_release_date(value: Option<&str>) -> Option<NaiveDate> {
    value.and_then(|raw| NaiveDate::parse_from_str(raw, "%Y-%m-%d").ok())
}

fn runtime_value(runtime_seconds: Option<i32>, runtime: Option<i32>) -> Option<i32> {
    runtime_seconds.or(runtime)
}

fn episode_row_to_dto(row: EpisodeRow, season_series_id: Option<String>, season_number: Option<i32>) -> EpisodeDto {
    let runtime_seconds = runtime_value(row.runtime_seconds, row.runtime);
    EpisodeDto {
        episode_id: row.id,
        series_id: row.series_id.or(season_series_id),
        season_number: row.season_number.or(season_number),
        episode_number: row.episode_number,
        title: row.title,
        description: row.description,
        runtime: runtime_seconds,
        runtime_seconds,
        status: row.status,
        reel_id: row.reel_id,
        thumbnail_url: row.thumbnail_url,
        release_date: format_release_date(row.release_date),
        genre: row.genre,
        tags: tags_to_vec(&row.tags),
    }
}

fn episode_row_to_flat(row: EpisodeRow, season_series_id: String, season_number: i32) -> EpisodeFlatDto {
    EpisodeFlatDto {
        id: row.id,
        series_id: row.series_id.unwrap_or(season_series_id),
        season_number: row.season_number.unwrap_or(season_number),
        episode_number: row.episode_number,
        title: row.title,
        description: row.description,
        runtime_seconds: runtime_value(row.runtime_seconds, row.runtime),
        thumbnail_url: row.thumbnail_url,
        reel_id: row.reel_id,
        release_date: format_release_date(row.release_date),
        status: row.status,
    }
}

pub async fn list_series_ids(pool: &PgPool) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT id FROM series ORDER BY updated_at DESC")
        .fetch_all(pool)
        .await
}

pub async fn get_series(pool: &PgPool, id: &str) -> Result<Option<SeriesDto>, sqlx::Error> {
    let series_row: Option<SeriesRow> = sqlx::query_as(
        r#"
        SELECT id, title, description, genre, release_year, poster, tags, created_at, updated_at
        FROM series WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    let Some(series_row) = series_row else {
        return Ok(None);
    };

    let season_rows: Vec<SeasonRow> = sqlx::query_as(
        r#"
        SELECT id, series_id, season_number, title, description, created_at, updated_at
        FROM seasons
        WHERE series_id = $1
        ORDER BY season_number ASC
        "#,
    )
    .bind(id)
    .fetch_all(pool)
    .await?;

    let mut seasons = Vec::with_capacity(season_rows.len());
    for season_row in season_rows {
        let episode_rows: Vec<EpisodeRow> = sqlx::query_as(
            r#"
            SELECT id, season_id, series_id, season_number, episode_number, title, description,
                   runtime, runtime_seconds, status, reel_id, thumbnail_url, release_date,
                   genre, tags, created_at, updated_at
            FROM episodes
            WHERE season_id = $1
            ORDER BY episode_number ASC
            "#,
        )
        .bind(&season_row.id)
        .fetch_all(pool)
        .await?;

        seasons.push(SeasonDto {
            season_id: Some(season_row.id),
            season_number: season_row.season_number,
            title: season_row.title,
            description: season_row.description,
            episodes: episode_rows
                .into_iter()
                .map(|row| {
                    episode_row_to_dto(
                        row,
                        Some(season_row.series_id.clone()),
                        Some(season_row.season_number),
                    )
                })
                .collect(),
        });
    }

    Ok(Some(SeriesDto {
        id: series_row.id,
        title: series_row.title,
        description: series_row.description,
        genre: series_row.genre,
        release_year: series_row.release_year,
        poster: series_row.poster,
        tags: tags_to_vec(&series_row.tags),
        seasons,
    }))
}

pub async fn list_series(pool: &PgPool) -> Result<Vec<SeriesDto>, sqlx::Error> {
    let ids = list_series_ids(pool).await?;
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(series) = get_series(pool, &id).await? {
            out.push(series);
        }
    }
    Ok(out)
}

pub async fn upsert_series(pool: &PgPool, input: &UpsertSeriesInput) -> Result<SeriesDto, sqlx::Error> {
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| format!("series-{}", uuid::Uuid::new_v4()));

    sqlx::query(
        r#"
        INSERT INTO series (id, title, description, genre, release_year, poster, tags)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            genre = EXCLUDED.genre,
            release_year = EXCLUDED.release_year,
            poster = EXCLUDED.poster,
            tags = EXCLUDED.tags,
            updated_at = now()
        "#,
    )
    .bind(&id)
    .bind(input.title.trim())
    .bind(input.description.as_deref())
    .bind(input.genre.as_deref())
    .bind(input.release_year)
    .bind(input.poster.as_deref())
    .bind(tags_to_json(input.tags.as_deref()))
    .execute(pool)
    .await?;

    if let Some(seasons) = &input.seasons {
        for season in seasons {
            let season_id = season.season_id.clone().unwrap_or_else(|| {
                format!("season-{}-{}", id, season.season_number)
            });

            sqlx::query(
                r#"
                INSERT INTO seasons (id, series_id, season_number, title, description)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (id) DO UPDATE SET
                    season_number = EXCLUDED.season_number,
                    title = EXCLUDED.title,
                    description = EXCLUDED.description,
                    updated_at = now()
                "#,
            )
            .bind(&season_id)
            .bind(&id)
            .bind(season.season_number)
            .bind(season.title.as_deref())
            .bind(season.description.as_deref())
            .execute(pool)
            .await?;

            if let Some(episodes) = &season.episodes {
                for episode in episodes {
                    let status = episode
                        .status
                        .as_deref()
                        .unwrap_or("draft")
                        .to_string();
                    let runtime_seconds = runtime_value(episode.runtime_seconds, episode.runtime);
                    let release_date = parse_release_date(episode.release_date.as_deref());

                    sqlx::query(
                        r#"
                        INSERT INTO episodes (
                            id, season_id, series_id, season_number, episode_number, title, description,
                            runtime, runtime_seconds, status, reel_id, thumbnail_url, release_date,
                            genre, tags
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                        ON CONFLICT (id) DO UPDATE SET
                            episode_number = EXCLUDED.episode_number,
                            title = EXCLUDED.title,
                            description = EXCLUDED.description,
                            runtime = EXCLUDED.runtime,
                            runtime_seconds = EXCLUDED.runtime_seconds,
                            series_id = EXCLUDED.series_id,
                            season_number = EXCLUDED.season_number,
                            status = EXCLUDED.status,
                            reel_id = COALESCE(EXCLUDED.reel_id, episodes.reel_id),
                            thumbnail_url = EXCLUDED.thumbnail_url,
                            release_date = EXCLUDED.release_date,
                            genre = EXCLUDED.genre,
                            tags = EXCLUDED.tags,
                            updated_at = now()
                        "#,
                    )
                    .bind(&episode.episode_id)
                    .bind(&season_id)
                    .bind(&id)
                    .bind(season.season_number)
                    .bind(episode.episode_number)
                    .bind(episode.title.trim())
                    .bind(episode.description.as_deref())
                    .bind(runtime_seconds)
                    .bind(runtime_seconds)
                    .bind(&status)
                    .bind(episode.reel_id.as_deref())
                    .bind(episode.thumbnail_url.as_deref())
                    .bind(release_date)
                    .bind(episode.genre.as_deref())
                    .bind(tags_to_json(episode.tags.as_deref()))
                    .execute(pool)
                    .await?;
                }
            }
        }
    }

    get_series(pool, &id)
        .await?
        .ok_or_else(|| sqlx::Error::RowNotFound)
}

pub async fn count_series(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM series")
        .fetch_one(pool)
        .await
}

pub async fn series_exists(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM series WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await?;
    Ok(count > 0)
}

pub async fn list_seasons_for_series(pool: &PgPool, series_id: &str) -> Result<Vec<SeasonDto>, sqlx::Error> {
    let season_rows: Vec<SeasonRow> = sqlx::query_as(
        r#"
        SELECT id, series_id, season_number, title, description, created_at, updated_at
        FROM seasons
        WHERE series_id = $1
        ORDER BY season_number ASC
        "#,
    )
    .bind(series_id)
    .fetch_all(pool)
    .await?;

    let mut seasons = Vec::with_capacity(season_rows.len());
    for season_row in season_rows {
        let episode_rows: Vec<EpisodeRow> = sqlx::query_as(
            r#"
            SELECT id, season_id, series_id, season_number, episode_number, title, description,
                   runtime, runtime_seconds, status, reel_id, thumbnail_url, release_date,
                   genre, tags, created_at, updated_at
            FROM episodes
            WHERE season_id = $1
            ORDER BY episode_number ASC
            "#,
        )
        .bind(&season_row.id)
        .fetch_all(pool)
        .await?;

        seasons.push(SeasonDto {
            season_id: Some(season_row.id),
            season_number: season_row.season_number,
            title: season_row.title,
            description: season_row.description,
            episodes: episode_rows
                .into_iter()
                .map(|row| {
                    episode_row_to_dto(
                        row,
                        Some(season_row.series_id.clone()),
                        Some(season_row.season_number),
                    )
                })
                .collect(),
        });
    }

    Ok(seasons)
}

pub async fn list_episodes_for_series(pool: &PgPool, series_id: &str) -> Result<Vec<EpisodeFlatDto>, sqlx::Error> {
    let rows: Vec<EpisodeRow> = sqlx::query_as(
        r#"
        SELECT e.id, e.season_id, e.series_id, e.season_number, e.episode_number, e.title, e.description,
               e.runtime, e.runtime_seconds, e.status, e.reel_id, e.thumbnail_url, e.release_date,
               e.genre, e.tags, e.created_at, e.updated_at
        FROM episodes e
        INNER JOIN seasons s ON s.id = e.season_id
        WHERE s.series_id = $1
        ORDER BY COALESCE(e.season_number, s.season_number) ASC, e.episode_number ASC
        "#,
    )
    .bind(series_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let season_number = row.season_number.unwrap_or(1);
            let sid = row
                .series_id
                .clone()
                .unwrap_or_else(|| series_id.to_string());
            episode_row_to_flat(row, sid, season_number)
        })
        .collect())
}

pub async fn create_season(
    pool: &PgPool,
    series_id: &str,
    input: &CreateSeasonInput,
) -> Result<SeasonDto, sqlx::Error> {
    let season_id = input
        .season_id
        .clone()
        .unwrap_or_else(|| format!("season-{}-{}", series_id, input.season_number));

    sqlx::query(
        r#"
        INSERT INTO seasons (id, series_id, season_number, title, description)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
            season_number = EXCLUDED.season_number,
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            updated_at = now()
        "#,
    )
    .bind(&season_id)
    .bind(series_id)
    .bind(input.season_number)
    .bind(input.title.as_deref())
    .bind(input.description.as_deref())
    .execute(pool)
    .await?;

    Ok(SeasonDto {
        season_id: Some(season_id),
        season_number: input.season_number,
        title: input.title.clone(),
        description: input.description.clone(),
        episodes: vec![],
    })
}

async fn resolve_season_id(
    pool: &PgPool,
    series_id: &str,
    season_number: i32,
) -> Result<String, sqlx::Error> {
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT id FROM seasons WHERE series_id = $1 AND season_number = $2",
    )
    .bind(series_id)
    .bind(season_number)
    .fetch_optional(pool)
    .await?;

    if let Some(id) = existing {
        return Ok(id);
    }

    let season_id = format!("season-{}-{}", series_id, season_number);
    sqlx::query(
        r#"
        INSERT INTO seasons (id, series_id, season_number, title)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (series_id, season_number) DO UPDATE SET updated_at = now()
        "#,
    )
    .bind(&season_id)
    .bind(series_id)
    .bind(season_number)
    .bind(format!("Season {}", season_number))
    .execute(pool)
    .await?;

    let resolved: String = sqlx::query_scalar(
        "SELECT id FROM seasons WHERE series_id = $1 AND season_number = $2",
    )
    .bind(series_id)
    .bind(season_number)
    .fetch_one(pool)
    .await?;

    Ok(resolved)
}

pub async fn create_episode(pool: &PgPool, input: &CreateEpisodeInput) -> Result<EpisodeFlatDto, sqlx::Error> {
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| format!("ep-{}-s{}e{}", input.series_id, input.season_number, input.episode_number));
    let season_id = resolve_season_id(pool, &input.series_id, input.season_number).await?;
    let status = input.status.as_deref().unwrap_or("draft").to_string();
    let release_date = parse_release_date(input.release_date.as_deref());

    sqlx::query(
        r#"
        INSERT INTO episodes (
            id, season_id, series_id, season_number, episode_number, title, description,
            runtime, runtime_seconds, status, reel_id, thumbnail_url, release_date, genre, tags
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO UPDATE SET
            season_id = EXCLUDED.season_id,
            series_id = EXCLUDED.series_id,
            season_number = EXCLUDED.season_number,
            episode_number = EXCLUDED.episode_number,
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            runtime = EXCLUDED.runtime,
            runtime_seconds = EXCLUDED.runtime_seconds,
            status = EXCLUDED.status,
            reel_id = COALESCE(EXCLUDED.reel_id, episodes.reel_id),
            thumbnail_url = EXCLUDED.thumbnail_url,
            release_date = EXCLUDED.release_date,
            genre = EXCLUDED.genre,
            tags = EXCLUDED.tags,
            updated_at = now()
        "#,
    )
    .bind(&id)
    .bind(&season_id)
    .bind(&input.series_id)
    .bind(input.season_number)
    .bind(input.episode_number)
    .bind(input.title.trim())
    .bind(input.description.as_deref())
    .bind(input.runtime_seconds)
    .bind(input.runtime_seconds)
    .bind(&status)
    .bind(input.reel_id.as_deref())
    .bind(input.thumbnail_url.as_deref())
    .bind(release_date)
    .bind(input.genre.as_deref())
    .bind(tags_to_json(input.tags.as_deref()))
    .execute(pool)
    .await?;

    let row: EpisodeRow = sqlx::query_as(
        r#"
        SELECT id, season_id, series_id, season_number, episode_number, title, description,
               runtime, runtime_seconds, status, reel_id, thumbnail_url, release_date,
               genre, tags, created_at, updated_at
        FROM episodes
        WHERE id = $1
        "#,
    )
    .bind(&id)
    .fetch_one(pool)
    .await?;

    Ok(episode_row_to_flat(row, input.series_id.clone(), input.season_number))
}

pub async fn get_episode_flat(pool: &PgPool, id: &str) -> Result<Option<EpisodeFlatDto>, sqlx::Error> {
    let row: Option<EpisodeRow> = sqlx::query_as(
        r#"
        SELECT e.id, e.season_id, e.series_id, e.season_number, e.episode_number, e.title, e.description,
               e.runtime, e.runtime_seconds, e.status, e.reel_id, e.thumbnail_url, e.release_date,
               e.genre, e.tags, e.created_at, e.updated_at
        FROM episodes e
        WHERE e.id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|episode| {
        let season_number = episode.season_number.unwrap_or(1);
        let sid = episode.series_id.clone().unwrap_or_default();
        episode_row_to_flat(episode, sid, season_number)
    }))
}

pub async fn update_episode(
    pool: &PgPool,
    id: &str,
    input: &UpdateEpisodeInput,
) -> Result<Option<EpisodeFlatDto>, sqlx::Error> {
    let existing = get_episode_flat(pool, id).await?;
    let Some(existing) = existing else {
        return Ok(None);
    };

    let series_id = input.series_id.clone().unwrap_or(existing.series_id);
    let season_number = input.season_number.unwrap_or(existing.season_number);
    let season_id = resolve_season_id(pool, &series_id, season_number).await?;
    let title = input.title.clone().unwrap_or(existing.title);
    let episode_number = input.episode_number.unwrap_or(existing.episode_number);
    let status = input
        .status
        .clone()
        .unwrap_or(existing.status);
    let release_date = parse_release_date(input.release_date.as_deref());

    if let Some(tags) = &input.tags {
        sqlx::query(
            r#"
            UPDATE episodes SET
                season_id = $2,
                series_id = $3,
                season_number = $4,
                episode_number = $5,
                title = $6,
                description = COALESCE($7, description),
                runtime = COALESCE($8, runtime),
                runtime_seconds = COALESCE($8, runtime_seconds),
                status = $9,
                reel_id = COALESCE($10, reel_id),
                thumbnail_url = COALESCE($11, thumbnail_url),
                release_date = COALESCE($12, release_date),
                genre = COALESCE($13, genre),
                tags = $14,
                updated_at = now()
            WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(&season_id)
        .bind(&series_id)
        .bind(season_number)
        .bind(episode_number)
        .bind(title.trim())
        .bind(input.description.as_deref())
        .bind(input.runtime_seconds)
        .bind(&status)
        .bind(input.reel_id.as_deref())
        .bind(input.thumbnail_url.as_deref())
        .bind(release_date)
        .bind(input.genre.as_deref())
        .bind(tags_to_json(Some(tags)))
        .execute(pool)
        .await?;
    } else {
        sqlx::query(
            r#"
            UPDATE episodes SET
                season_id = $2,
                series_id = $3,
                season_number = $4,
                episode_number = $5,
                title = $6,
                description = COALESCE($7, description),
                runtime = COALESCE($8, runtime),
                runtime_seconds = COALESCE($8, runtime_seconds),
                status = $9,
                reel_id = COALESCE($10, reel_id),
                thumbnail_url = COALESCE($11, thumbnail_url),
                release_date = COALESCE($12, release_date),
                genre = COALESCE($13, genre),
                updated_at = now()
            WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(&season_id)
        .bind(&series_id)
        .bind(season_number)
        .bind(episode_number)
        .bind(title.trim())
        .bind(input.description.as_deref())
        .bind(input.runtime_seconds)
        .bind(&status)
        .bind(input.reel_id.as_deref())
        .bind(input.thumbnail_url.as_deref())
        .bind(release_date)
        .bind(input.genre.as_deref())
        .execute(pool)
        .await?;
    }

    get_episode_flat(pool, id).await
}

pub async fn delete_episode(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM episodes WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
