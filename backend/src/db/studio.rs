use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct ProjectRow {
    pub id: Uuid,
    pub name: String,
    pub slug: Option<String>,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct SeriesRow {
    pub id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct SeasonRow {
    pub id: Uuid,
    pub series_id: Uuid,
    pub season_number: i32,
    pub title: Option<String>,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct EpisodeRow {
    pub id: Uuid,
    pub season_id: Uuid,
    pub reel_id: Option<Uuid>,
    pub episode_number: i32,
    pub title: String,
    pub description: Option<String>,
    pub publish_status: String,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub published_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HierarchyCounts {
    pub projects: i64,
    pub series: i64,
    pub seasons: i64,
    pub episodes: i64,
    pub episodes_with_reel: i64,
}

pub const DEFAULT_CATALOG_PROJECT_ID: &str = "00000000-0000-4000-8000-000000000001";

pub async fn count_hierarchy(pool: &PgPool) -> Result<HierarchyCounts, sqlx::Error> {
    let projects: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM studio_projects")
        .fetch_one(pool)
        .await?;
    let series: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM studio_series")
        .fetch_one(pool)
        .await?;
    let seasons: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM studio_seasons")
        .fetch_one(pool)
        .await?;
    let episodes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM studio_episodes")
        .fetch_one(pool)
        .await?;
    let episodes_with_reel: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM studio_episodes WHERE reel_id IS NOT NULL")
            .fetch_one(pool)
            .await?;
    Ok(HierarchyCounts {
        projects,
        series,
        seasons,
        episodes,
        episodes_with_reel,
    })
}

pub async fn list_projects(pool: &PgPool) -> Result<Vec<ProjectRow>, sqlx::Error> {
    sqlx::query_as::<_, ProjectRow>(
        r#"
        SELECT id, name, slug, status, created_at, updated_at
        FROM studio_projects
        ORDER BY created_at ASC
        "#,
    )
    .fetch_all(pool)
    .await
}

pub async fn get_project(pool: &PgPool, id: Uuid) -> Result<Option<ProjectRow>, sqlx::Error> {
    sqlx::query_as::<_, ProjectRow>(
        r#"
        SELECT id, name, slug, status, created_at, updated_at
        FROM studio_projects WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn create_project(
    pool: &PgPool,
    name: &str,
    slug: Option<&str>,
) -> Result<ProjectRow, sqlx::Error> {
    sqlx::query_as::<_, ProjectRow>(
        r#"
        INSERT INTO studio_projects (name, slug)
        VALUES ($1, $2)
        RETURNING id, name, slug, status, created_at, updated_at
        "#,
    )
    .bind(name)
    .bind(slug)
    .fetch_one(pool)
    .await
}

pub async fn list_series(
    pool: &PgPool,
    project_id: Option<Uuid>,
) -> Result<Vec<SeriesRow>, sqlx::Error> {
    if let Some(pid) = project_id {
        sqlx::query_as::<_, SeriesRow>(
            r#"
            SELECT id, project_id, title, description, status, created_at, updated_at
            FROM studio_series
            WHERE project_id = $1
            ORDER BY created_at ASC
            "#,
        )
        .bind(pid)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, SeriesRow>(
            r#"
            SELECT id, project_id, title, description, status, created_at, updated_at
            FROM studio_series
            ORDER BY created_at ASC
            "#,
        )
        .fetch_all(pool)
        .await
    }
}

pub async fn get_series(pool: &PgPool, id: Uuid) -> Result<Option<SeriesRow>, sqlx::Error> {
    sqlx::query_as::<_, SeriesRow>(
        r#"
        SELECT id, project_id, title, description, status, created_at, updated_at
        FROM studio_series WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn create_series(
    pool: &PgPool,
    project_id: Uuid,
    title: &str,
    description: Option<&str>,
) -> Result<SeriesRow, sqlx::Error> {
    sqlx::query_as::<_, SeriesRow>(
        r#"
        INSERT INTO studio_series (project_id, title, description)
        VALUES ($1, $2, $3)
        RETURNING id, project_id, title, description, status, created_at, updated_at
        "#,
    )
    .bind(project_id)
    .bind(title)
    .bind(description)
    .fetch_one(pool)
    .await
}

pub async fn create_season(
    pool: &PgPool,
    series_id: Uuid,
    season_number: i32,
    title: Option<&str>,
) -> Result<SeasonRow, sqlx::Error> {
    sqlx::query_as::<_, SeasonRow>(
        r#"
        INSERT INTO studio_seasons (series_id, season_number, title)
        VALUES ($1, $2, $3)
        RETURNING id, series_id, season_number, title, sort_order, created_at, updated_at
        "#,
    )
    .bind(series_id)
    .bind(season_number)
    .bind(title)
    .fetch_one(pool)
    .await
}

pub async fn list_episodes_for_season(
    pool: &PgPool,
    season_id: Uuid,
) -> Result<Vec<EpisodeRow>, sqlx::Error> {
    sqlx::query_as::<_, EpisodeRow>(
        r#"
        SELECT id, season_id, reel_id, episode_number, title, description,
               publish_status, scheduled_at, published_at, created_at, updated_at
        FROM studio_episodes
        WHERE season_id = $1
        ORDER BY episode_number ASC
        "#,
    )
    .bind(season_id)
    .fetch_all(pool)
    .await
}

pub async fn get_episode(pool: &PgPool, id: Uuid) -> Result<Option<EpisodeRow>, sqlx::Error> {
    sqlx::query_as::<_, EpisodeRow>(
        r#"
        SELECT id, season_id, reel_id, episode_number, title, description,
               publish_status, scheduled_at, published_at, created_at, updated_at
        FROM studio_episodes WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn create_episode(
    pool: &PgPool,
    season_id: Uuid,
    episode_number: i32,
    title: &str,
    description: Option<&str>,
    reel_id: Option<Uuid>,
) -> Result<EpisodeRow, sqlx::Error> {
    let published_at = if reel_id.is_some() {
        Some(Utc::now())
    } else {
        None
    };
    sqlx::query_as::<_, EpisodeRow>(
        r#"
        INSERT INTO studio_episodes (
            season_id, episode_number, title, description, reel_id, publish_status, published_at
        )
        VALUES ($1, $2, $3, $4, $5, 'published', $6)
        RETURNING id, season_id, reel_id, episode_number, title, description,
                  publish_status, scheduled_at, published_at, created_at, updated_at
        "#,
    )
    .bind(season_id)
    .bind(episode_number)
    .bind(title)
    .bind(description)
    .bind(reel_id)
    .bind(published_at)
    .fetch_one(pool)
    .await
}

pub enum AttachReelOutcome {
    Attached(EpisodeRow),
    EpisodeNotFound,
    ReelNotFound,
    ReelAlreadyBound,
}

pub async fn attach_reel_to_episode(
    pool: &PgPool,
    episode_id: Uuid,
    reel_id: Uuid,
) -> Result<AttachReelOutcome, sqlx::Error> {
    let episode_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM studio_episodes WHERE id = $1)")
            .bind(episode_id)
            .fetch_one(pool)
            .await?;
    if !episode_exists {
        return Ok(AttachReelOutcome::EpisodeNotFound);
    }

    let reel_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM reels WHERE id = $1)")
        .bind(reel_id)
        .fetch_one(pool)
        .await?;
    if !reel_exists {
        return Ok(AttachReelOutcome::ReelNotFound);
    }

    let already_bound: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM studio_episodes WHERE reel_id = $1 AND id <> $2)",
    )
    .bind(reel_id)
    .bind(episode_id)
    .fetch_one(pool)
    .await?;
    if already_bound {
        return Ok(AttachReelOutcome::ReelAlreadyBound);
    }

    let row = sqlx::query_as::<_, EpisodeRow>(
        r#"
        UPDATE studio_episodes
        SET reel_id = $2,
            published_at = COALESCE(published_at, now()),
            updated_at = now()
        WHERE id = $1
        RETURNING id, season_id, reel_id, episode_number, title, description,
                  publish_status, scheduled_at, published_at, created_at, updated_at
        "#,
    )
    .bind(episode_id)
    .bind(reel_id)
    .fetch_one(pool)
    .await?;

    Ok(AttachReelOutcome::Attached(row))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EpisodeTreeNode {
    #[serde(flatten)]
    pub episode: EpisodeRow,
    pub reel_title: Option<String>,
    pub reel_status: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SeasonTreeNode {
    #[serde(flatten)]
    pub season: SeasonRow,
    pub episodes: Vec<EpisodeTreeNode>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SeriesTreeNode {
    #[serde(flatten)]
    pub series: SeriesRow,
    pub seasons: Vec<SeasonTreeNode>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectTree {
    #[serde(flatten)]
    pub project: ProjectRow,
    pub series: Vec<SeriesTreeNode>,
}

pub async fn get_project_tree(
    pool: &PgPool,
    project_id: Uuid,
) -> Result<Option<ProjectTree>, sqlx::Error> {
    let project = match get_project(pool, project_id).await? {
        Some(p) => p,
        None => return Ok(None),
    };

    let all_series = list_series(pool, Some(project_id)).await?;
    let mut series_nodes = Vec::with_capacity(all_series.len());

    for s in all_series {
        let seasons = sqlx::query_as::<_, SeasonRow>(
            r#"
            SELECT id, series_id, season_number, title, sort_order, created_at, updated_at
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
            let episodes = sqlx::query_as::<_, EpisodeRow>(
                r#"
                SELECT e.id, e.season_id, e.reel_id, e.episode_number, e.title, e.description,
                       e.publish_status, e.scheduled_at, e.published_at, e.created_at, e.updated_at
                FROM studio_episodes e
                WHERE e.season_id = $1
                ORDER BY e.episode_number ASC
                "#,
            )
            .bind(season.id)
            .fetch_all(pool)
            .await?;

            let mut episode_nodes = Vec::with_capacity(episodes.len());
            for ep in episodes {
                let (reel_title, reel_status) = if let Some(rid) = ep.reel_id {
                    let row: Option<(String, String)> =
                        sqlx::query_as("SELECT title, status FROM reels WHERE id = $1")
                            .bind(rid)
                            .fetch_optional(pool)
                            .await?;
                    row.map(|(t, st)| (Some(t), Some(st)))
                        .unwrap_or((None, None))
                } else {
                    (None, None)
                };
                episode_nodes.push(EpisodeTreeNode {
                    episode: ep,
                    reel_title,
                    reel_status,
                });
            }
            season_nodes.push(SeasonTreeNode {
                season,
                episodes: episode_nodes,
            });
        }
        series_nodes.push(SeriesTreeNode {
            series: s,
            seasons: season_nodes,
        });
    }

    Ok(Some(ProjectTree {
        project,
        series: series_nodes,
    }))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BackfillReport {
    pub project_id: Uuid,
    pub series_created: usize,
    pub seasons_created: usize,
    pub episodes_created: usize,
    pub episodes_skipped: usize,
    pub reels_unlinked: i64,
}

/// Idempotent backfill: ready+validated reels → episodes under category-named series.
pub async fn backfill_reels_to_hierarchy(pool: &PgPool) -> Result<BackfillReport, sqlx::Error> {
    let project_id = get_or_create_catalog_project(pool).await?;

    let categories: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT DISTINCT category FROM reels
        WHERE status = 'ready' AND validated = true AND category <> ''
        ORDER BY category
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut series_created = 0usize;
    let mut seasons_created = 0usize;
    let mut episodes_created = 0usize;
    let mut episodes_skipped = 0usize;

    for cat in categories {
        let series_id: Uuid = match find_series_by_title(pool, project_id, &cat).await? {
            Some(id) => id,
            None => {
                let row = create_series(pool, project_id, &cat, None).await?;
                series_created += 1;
                row.id
            }
        };

        let season_id: Uuid = match find_season_one(pool, series_id).await? {
            Some(id) => id,
            None => {
                let row = create_season(pool, series_id, 1, Some("Season 1")).await?;
                seasons_created += 1;
                row.id
            }
        };

        let reels: Vec<(Uuid, String)> = sqlx::query_as(
            r#"
            SELECT id, title FROM reels
            WHERE status = 'ready' AND validated = true AND category = $1
            ORDER BY created_at ASC
            "#,
        )
        .bind(&cat)
        .fetch_all(pool)
        .await?;

        let mut next_ep = next_episode_number(pool, season_id).await?;

        for (reel_id, title) in reels {
            let already: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM studio_episodes WHERE reel_id = $1)",
            )
            .bind(reel_id)
            .fetch_one(pool)
            .await?;
            if already {
                episodes_skipped += 1;
                continue;
            }

            match create_episode(pool, season_id, next_ep, &title, None, Some(reel_id)).await {
                Ok(_) => {
                    episodes_created += 1;
                    next_ep += 1;
                }
                Err(_) => {
                    episodes_skipped += 1;
                }
            }
        }
    }

    let reels_unlinked: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM reels r
        WHERE r.status = 'ready' AND r.validated = true
          AND NOT EXISTS (SELECT 1 FROM studio_episodes e WHERE e.reel_id = r.id)
        "#,
    )
    .fetch_one(pool)
    .await?;

    Ok(BackfillReport {
        project_id,
        series_created,
        seasons_created,
        episodes_created,
        episodes_skipped,
        reels_unlinked,
    })
}

async fn get_or_create_catalog_project(pool: &PgPool) -> Result<Uuid, sqlx::Error> {
    if let Some(id) = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM studio_projects WHERE slug = 'reelforge-catalog' LIMIT 1",
    )
    .fetch_optional(pool)
    .await?
    {
        return Ok(id);
    }

    let fixed = Uuid::parse_str(DEFAULT_CATALOG_PROJECT_ID).unwrap();
    let row: ProjectRow = sqlx::query_as(
        r#"
        INSERT INTO studio_projects (id, name, slug, status)
        VALUES ($1, 'ReelForge Catalog', 'reelforge-catalog', 'active')
        ON CONFLICT (id) DO UPDATE SET updated_at = now()
        RETURNING id, name, slug, status, created_at, updated_at
        "#,
    )
    .bind(fixed)
    .fetch_one(pool)
    .await?;
    Ok(row.id)
}

async fn find_series_by_title(
    pool: &PgPool,
    project_id: Uuid,
    title: &str,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar("SELECT id FROM studio_series WHERE project_id = $1 AND title = $2 LIMIT 1")
        .bind(project_id)
        .bind(title)
        .fetch_optional(pool)
        .await
}

async fn find_season_one(pool: &PgPool, series_id: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT id FROM studio_seasons WHERE series_id = $1 AND season_number = 1 LIMIT 1",
    )
    .bind(series_id)
    .fetch_optional(pool)
    .await
}

async fn next_episode_number(pool: &PgPool, season_id: Uuid) -> Result<i32, sqlx::Error> {
    let max: Option<i32> =
        sqlx::query_scalar("SELECT MAX(episode_number) FROM studio_episodes WHERE season_id = $1")
            .bind(season_id)
            .fetch_one(pool)
            .await?;
    Ok(max.map(|n| n + 1).unwrap_or(1))
}
