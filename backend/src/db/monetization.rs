use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

pub const ACCESS_MODES: &[&str] = &["FREE", "EPISODE_LOCK", "SEASON_PASS", "VIP", "SUBSCRIPTION"];

pub fn is_valid_access_mode(mode: &str) -> bool {
    ACCESS_MODES.contains(&mode)
}

fn parse_optional_price(raw: Option<&str>) -> Result<Option<String>, &'static str> {
    match raw {
        None | Some("") => Ok(None),
        Some(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            let n: f64 = trimmed.parse().map_err(|_| "Invalid price")?;
            if n < 0.0 {
                return Err("Price must be >= 0");
            }
            Ok(Some(format!("{:.2}", n)))
        }
    }
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct ProjectMonetization {
    pub id: Uuid,
    pub name: String,
    pub access_mode: String,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
struct SeriesMonetizationRow {
    pub id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub access_mode: String,
    pub free_episode_count: i32,
    pub season_price: Option<String>,
    pub vip_price: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SeriesMonetization {
    pub id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub access_mode: String,
    pub free_episode_count: i32,
    pub season_price: Option<String>,
    pub vip_price: Option<String>,
}

impl From<SeriesMonetizationRow> for SeriesMonetization {
    fn from(row: SeriesMonetizationRow) -> Self {
        Self {
            id: row.id,
            project_id: row.project_id,
            title: row.title,
            access_mode: row.access_mode,
            free_episode_count: row.free_episode_count,
            season_price: row.season_price,
            vip_price: row.vip_price,
        }
    }
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct SeasonMonetization {
    pub id: Uuid,
    pub series_id: Uuid,
    pub season_number: i32,
    pub title: Option<String>,
    pub access_mode: Option<String>,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct EpisodeMonetization {
    pub id: Uuid,
    pub season_id: Uuid,
    pub episode_number: i32,
    pub title: String,
    pub reel_id: Option<Uuid>,
    pub is_free_override: bool,
    pub early_access: bool,
    pub release_date: Option<DateTime<Utc>>,
    pub unlock_after_episode: Option<i32>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct UpdateProjectMonetization {
    pub access_mode: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct UpdateSeriesMonetization {
    pub access_mode: Option<String>,
    pub free_episode_count: Option<i32>,
    pub season_price: Option<String>,
    pub vip_price: Option<String>,
    #[serde(default)]
    pub clear_season_price: bool,
    #[serde(default)]
    pub clear_vip_price: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct UpdateSeasonMonetization {
    pub access_mode: Option<Option<String>>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct UpdateEpisodeMonetization {
    pub is_free_override: Option<bool>,
    pub early_access: Option<bool>,
    pub release_date: Option<Option<DateTime<Utc>>>,
    pub unlock_after_episode: Option<Option<i32>>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EpisodeMonetizationNode {
    #[serde(flatten)]
    pub episode: EpisodeMonetization,
    pub access_granted: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SeasonMonetizationNode {
    #[serde(flatten)]
    pub season: SeasonMonetization,
    pub episodes: Vec<EpisodeMonetizationNode>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SeriesMonetizationNode {
    #[serde(flatten)]
    pub series: SeriesMonetization,
    pub seasons: Vec<SeasonMonetizationNode>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MonetizationConfig {
    pub enforce_paywall: bool,
    pub project: ProjectMonetization,
    pub series: Vec<SeriesMonetizationNode>,
}

async fn fetch_series_row(
    pool: &PgPool,
    series_id: Uuid,
) -> Result<Option<SeriesMonetization>, sqlx::Error> {
    let row = sqlx::query_as::<_, SeriesMonetizationRow>(
        r#"
        SELECT id, project_id, title, access_mode, free_episode_count,
               season_price::text AS season_price,
               vip_price::text AS vip_price
        FROM studio_series
        WHERE id = $1
        "#,
    )
    .bind(series_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(SeriesMonetization::from))
}

pub async fn get_project_monetization(
    pool: &PgPool,
    project_id: Uuid,
) -> Result<Option<ProjectMonetization>, sqlx::Error> {
    sqlx::query_as::<_, ProjectMonetization>(
        r#"
        SELECT id, name, access_mode
        FROM studio_projects
        WHERE id = $1
        "#,
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
}

pub async fn get_series_monetization(
    pool: &PgPool,
    series_id: Uuid,
) -> Result<Option<SeriesMonetization>, sqlx::Error> {
    fetch_series_row(pool, series_id).await
}

pub async fn get_season_monetization(
    pool: &PgPool,
    season_id: Uuid,
) -> Result<Option<SeasonMonetization>, sqlx::Error> {
    sqlx::query_as::<_, SeasonMonetization>(
        r#"
        SELECT id, series_id, season_number, title, access_mode
        FROM studio_seasons
        WHERE id = $1
        "#,
    )
    .bind(season_id)
    .fetch_optional(pool)
    .await
}

pub async fn get_episode_monetization(
    pool: &PgPool,
    episode_id: Uuid,
) -> Result<Option<EpisodeMonetization>, sqlx::Error> {
    sqlx::query_as::<_, EpisodeMonetization>(
        r#"
        SELECT id, season_id, episode_number, title, reel_id,
               is_free_override, early_access, release_date, unlock_after_episode
        FROM studio_episodes
        WHERE id = $1
        "#,
    )
    .bind(episode_id)
    .fetch_optional(pool)
    .await
}

pub async fn get_monetization_config(
    pool: &PgPool,
    project_id: Uuid,
) -> Result<Option<MonetizationConfig>, sqlx::Error> {
    let project = match get_project_monetization(pool, project_id).await? {
        Some(p) => p,
        None => return Ok(None),
    };

    let all_series = sqlx::query_as::<_, SeriesMonetizationRow>(
        r#"
        SELECT id, project_id, title, access_mode, free_episode_count,
               season_price::text AS season_price,
               vip_price::text AS vip_price
        FROM studio_series
        WHERE project_id = $1
        ORDER BY created_at ASC
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let mut series_nodes = Vec::with_capacity(all_series.len());

    for series_row in all_series {
        let s: SeriesMonetization = series_row.into();

        let seasons = sqlx::query_as::<_, SeasonMonetization>(
            r#"
            SELECT id, series_id, season_number, title, access_mode
            FROM studio_seasons
            WHERE series_id = $1
            ORDER BY season_number ASC
            "#,
        )
        .bind(s.id)
        .fetch_all(pool)
        .await?;

        let mut season_nodes = Vec::with_capacity(seasons.len());
        for season in seasons {
            let episodes = sqlx::query_as::<_, EpisodeMonetization>(
                r#"
                SELECT id, season_id, episode_number, title, reel_id,
                       is_free_override, early_access, release_date, unlock_after_episode
                FROM studio_episodes
                WHERE season_id = $1
                ORDER BY episode_number ASC
                "#,
            )
            .bind(season.id)
            .fetch_all(pool)
            .await?;

            let episode_nodes: Vec<EpisodeMonetizationNode> = episodes
                .into_iter()
                .map(|ep| EpisodeMonetizationNode {
                    access_granted: true,
                    episode: ep,
                })
                .collect();

            season_nodes.push(SeasonMonetizationNode {
                season,
                episodes: episode_nodes,
            });
        }

        series_nodes.push(SeriesMonetizationNode {
            series: s,
            seasons: season_nodes,
        });
    }

    Ok(Some(MonetizationConfig {
        enforce_paywall: false,
        project,
        series: series_nodes,
    }))
}

pub async fn update_project_monetization(
    pool: &PgPool,
    project_id: Uuid,
    patch: &UpdateProjectMonetization,
) -> Result<Result<ProjectMonetization, &'static str>, sqlx::Error> {
    let current = match get_project_monetization(pool, project_id).await? {
        Some(p) => p,
        None => return Ok(Err("Project not found")),
    };

    let access_mode = patch
        .access_mode
        .as_deref()
        .unwrap_or(current.access_mode.as_str());
    if !is_valid_access_mode(access_mode) {
        return Ok(Err("Invalid access_mode"));
    }

    let row = sqlx::query_as::<_, ProjectMonetization>(
        r#"
        UPDATE studio_projects
        SET access_mode = $2, updated_at = now()
        WHERE id = $1
        RETURNING id, name, access_mode
        "#,
    )
    .bind(project_id)
    .bind(access_mode)
    .fetch_one(pool)
    .await?;

    Ok(Ok(row))
}

pub async fn update_series_monetization(
    pool: &PgPool,
    series_id: Uuid,
    patch: &UpdateSeriesMonetization,
) -> Result<Result<SeriesMonetization, &'static str>, sqlx::Error> {
    let current = match fetch_series_row(pool, series_id).await? {
        Some(s) => s,
        None => return Ok(Err("Series not found")),
    };

    let access_mode = patch
        .access_mode
        .as_deref()
        .unwrap_or(current.access_mode.as_str());
    if !is_valid_access_mode(access_mode) {
        return Ok(Err("Invalid access_mode"));
    }

    let free_episode_count = patch
        .free_episode_count
        .unwrap_or(current.free_episode_count);
    if free_episode_count < 0 {
        return Ok(Err("free_episode_count must be >= 0"));
    }

    let season_price = if patch.clear_season_price {
        None
    } else if patch.season_price.is_some() {
        match parse_optional_price(patch.season_price.as_deref()) {
            Ok(v) => v,
            Err(e) => return Ok(Err(e)),
        }
    } else {
        current.season_price
    };

    let vip_price = if patch.clear_vip_price {
        None
    } else if patch.vip_price.is_some() {
        match parse_optional_price(patch.vip_price.as_deref()) {
            Ok(v) => v,
            Err(e) => return Ok(Err(e)),
        }
    } else {
        current.vip_price
    };

    sqlx::query(
        r#"
        UPDATE studio_series
        SET access_mode = $2,
            free_episode_count = $3,
            season_price = $4::numeric,
            vip_price = $5::numeric,
            updated_at = now()
        WHERE id = $1
        "#,
    )
    .bind(series_id)
    .bind(access_mode)
    .bind(free_episode_count)
    .bind(season_price.as_deref())
    .bind(vip_price.as_deref())
    .execute(pool)
    .await?;

    match fetch_series_row(pool, series_id).await? {
        Some(row) => Ok(Ok(row)),
        None => Ok(Err("Series not found")),
    }
}

pub async fn update_season_monetization(
    pool: &PgPool,
    season_id: Uuid,
    patch: &UpdateSeasonMonetization,
) -> Result<Result<SeasonMonetization, &'static str>, sqlx::Error> {
    let current = match get_season_monetization(pool, season_id).await? {
        Some(s) => s,
        None => return Ok(Err("Season not found")),
    };

    let access_mode = match &patch.access_mode {
        Some(v) => v.clone(),
        None => current.access_mode,
    };

    if let Some(ref mode) = access_mode {
        if !is_valid_access_mode(mode) {
            return Ok(Err("Invalid access_mode"));
        }
    }

    let row = sqlx::query_as::<_, SeasonMonetization>(
        r#"
        UPDATE studio_seasons
        SET access_mode = $2, updated_at = now()
        WHERE id = $1
        RETURNING id, series_id, season_number, title, access_mode
        "#,
    )
    .bind(season_id)
    .bind(access_mode)
    .fetch_one(pool)
    .await?;

    Ok(Ok(row))
}

pub async fn update_episode_monetization(
    pool: &PgPool,
    episode_id: Uuid,
    patch: &UpdateEpisodeMonetization,
) -> Result<Result<EpisodeMonetization, &'static str>, sqlx::Error> {
    let current = match get_episode_monetization(pool, episode_id).await? {
        Some(e) => e,
        None => return Ok(Err("Episode not found")),
    };

    let is_free_override = patch.is_free_override.unwrap_or(current.is_free_override);
    let early_access = patch.early_access.unwrap_or(current.early_access);
    let release_date = match &patch.release_date {
        Some(v) => *v,
        None => current.release_date,
    };
    let unlock_after_episode = match &patch.unlock_after_episode {
        Some(v) => *v,
        None => current.unlock_after_episode,
    };

    if let Some(n) = unlock_after_episode {
        if n < 1 {
            return Ok(Err("unlock_after_episode must be >= 1"));
        }
    }

    let row = sqlx::query_as::<_, EpisodeMonetization>(
        r#"
        UPDATE studio_episodes
        SET is_free_override = $2,
            early_access = $3,
            release_date = $4,
            unlock_after_episode = $5,
            updated_at = now()
        WHERE id = $1
        RETURNING id, season_id, episode_number, title, reel_id,
                  is_free_override, early_access, release_date, unlock_after_episode
        "#,
    )
    .bind(episode_id)
    .bind(is_free_override)
    .bind(early_access)
    .bind(release_date)
    .bind(unlock_after_episode)
    .fetch_one(pool)
    .await?;

    Ok(Ok(row))
}
