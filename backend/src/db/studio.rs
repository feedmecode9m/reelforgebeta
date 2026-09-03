use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;
use sqlx::{Postgres, Transaction};

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
    let row = sqlx::query_as::<_, EpisodeRow>(
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
    .await?;

    if let Some(bound_reel_id) = row.reel_id {
        sync_reel_episode_bridge(pool, bound_reel_id, row.id).await?;
    }

    Ok(row)
}

pub enum AttachReelOutcome {
    Attached(EpisodeRow),
    EpisodeNotFound,
    ReelNotFound,
    ReelAlreadyBound,
}

pub enum RebindReelOutcome {
    Rebound {
        row: EpisodeRow,
        previous_episode_id: Option<Uuid>,
        noop: bool,
    },
    EpisodeNotFound,
    ReelNotFound,
    SourceEpisodeRequired,
    SourceMismatch {
        current_episode_id: Option<Uuid>,
    },
    TargetHasAnotherReel {
        target_reel_id: Uuid,
    },
}

pub async fn attach_reel_to_episode(
    pool: &PgPool,
    episode_id: Uuid,
    reel_id: Uuid,
) -> Result<AttachReelOutcome, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let existing_target_reel_row: Option<(Option<Uuid>,)> = sqlx::query_as(
        "SELECT reel_id FROM studio_episodes WHERE id = $1 FOR UPDATE",
    )
    .bind(episode_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((existing_target_reel,)) = existing_target_reel_row else {
        tx.rollback().await?;
        return Ok(AttachReelOutcome::EpisodeNotFound);
    };

    let reel_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM reels WHERE id = $1 FOR UPDATE)")
        .bind(reel_id)
        .fetch_one(&mut *tx)
        .await?;
    if !reel_exists {
        tx.rollback().await?;
        return Ok(AttachReelOutcome::ReelNotFound);
    }

    lock_reel_advisory_tx(&mut tx, reel_id).await?;

    let already_bound: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM studio_episodes WHERE reel_id = $1 AND id <> $2)",
    )
    .bind(reel_id)
    .bind(episode_id)
    .fetch_one(&mut *tx)
    .await?;
    if already_bound {
        tx.rollback().await?;
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
    .fetch_one(&mut *tx)
    .await?;

    sync_reel_episode_bridge_tx(&mut tx, reel_id, episode_id).await?;

    // Attach can replace the target episode reel in-place; clear the displaced bridge
    // so `reels.episode_id` always matches the current studio owner.
    if let Some(displaced_reel_id) = existing_target_reel {
        if displaced_reel_id != reel_id {
            clear_reel_episode_bridge_tx(&mut tx, displaced_reel_id, episode_id).await?;
        }
    }

    tx.commit().await?;

    Ok(AttachReelOutcome::Attached(row))
}

pub async fn rebind_reel_to_episode(
    pool: &PgPool,
    target_episode_id: Uuid,
    reel_id: Uuid,
    source_episode_id: Option<Uuid>,
) -> Result<RebindReelOutcome, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let target_existing_reel_row: Option<(Option<Uuid>,)> = sqlx::query_as(
        "SELECT reel_id FROM studio_episodes WHERE id = $1 FOR UPDATE",
    )
    .bind(target_episode_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((target_existing_reel,)) = target_existing_reel_row else {
        tx.rollback().await?;
        return Ok(RebindReelOutcome::EpisodeNotFound);
    };

    let reel_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM reels WHERE id = $1 FOR UPDATE)")
        .bind(reel_id)
        .fetch_one(&mut *tx)
        .await?;
    if !reel_exists {
        tx.rollback().await?;
        return Ok(RebindReelOutcome::ReelNotFound);
    }

    lock_reel_advisory_tx(&mut tx, reel_id).await?;

    let current_owner_episode_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM studio_episodes WHERE reel_id = $1 LIMIT 1 FOR UPDATE",
    )
    .bind(reel_id)
    .fetch_optional(&mut *tx)
    .await?;

    if current_owner_episode_id == Some(target_episode_id) {
        let row = sqlx::query_as::<_, EpisodeRow>(
            r#"
            SELECT id, season_id, reel_id, episode_number, title, description,
                   publish_status, scheduled_at, published_at, created_at, updated_at
            FROM studio_episodes
            WHERE id = $1
            "#,
        )
        .bind(target_episode_id)
        .fetch_one(&mut *tx)
        .await?;
        sync_reel_episode_bridge_tx(&mut tx, reel_id, target_episode_id).await?;
        tx.commit().await?;
        return Ok(RebindReelOutcome::Rebound {
            row,
            previous_episode_id: current_owner_episode_id,
            noop: true,
        });
    }

    if let Some(target_reel_id) = target_existing_reel {
        if target_reel_id != reel_id {
            tx.rollback().await?;
            return Ok(RebindReelOutcome::TargetHasAnotherReel { target_reel_id });
        }
    }

    if current_owner_episode_id.is_some() && source_episode_id.is_none() {
        tx.rollback().await?;
        return Ok(RebindReelOutcome::SourceEpisodeRequired);
    }

    if source_episode_id != current_owner_episode_id {
        tx.rollback().await?;
        return Ok(RebindReelOutcome::SourceMismatch {
            current_episode_id: current_owner_episode_id,
        });
    }

    if let Some(owner_episode_id) = current_owner_episode_id {
        sqlx::query(
            r#"
            UPDATE studio_episodes
            SET reel_id = NULL,
                updated_at = now()
            WHERE id = $1
            "#,
        )
        .bind(owner_episode_id)
        .execute(&mut *tx)
        .await?;
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
    .bind(target_episode_id)
    .bind(reel_id)
    .fetch_one(&mut *tx)
    .await?;

    sync_reel_episode_bridge_tx(&mut tx, reel_id, target_episode_id).await?;
    tx.commit().await?;

    Ok(RebindReelOutcome::Rebound {
        row,
        previous_episode_id: current_owner_episode_id,
        noop: false,
    })
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
        // Backfill creates catalog-series rows from reel categories with default FREE/0 settings.
        // The current viewer paywall contract treats backfilled episodic content as EPISODE_LOCK
        // with a 2-episode free window, so we normalize only untouched default rows.
        apply_default_backfill_monetization(pool, series_id).await?;

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
            match create_backfill_episode_for_reel(pool, season_id, next_ep, &title, reel_id).await {
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

    // Keep legacy reel-level episode identity aligned with canonical studio binding.
    sqlx::query(
        r#"
        UPDATE reels r
        SET episode_id = CAST(se.id AS TEXT),
            updated_at = now()
        FROM studio_episodes se
        WHERE se.reel_id = r.id
          AND (
              r.episode_id IS NULL
              OR r.episode_id <> CAST(se.id AS TEXT)
          )
        "#,
    )
    .execute(pool)
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

async fn sync_reel_episode_bridge(
    pool: &PgPool,
    reel_id: Uuid,
    canonical_episode_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE reels
        SET episode_id = CAST($2 AS TEXT),
            updated_at = now()
        WHERE id = $1
        "#,
    )
    .bind(reel_id)
    .bind(canonical_episode_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn lock_reel_advisory_tx(
    tx: &mut Transaction<'_, Postgres>,
    reel_id: Uuid,
) -> Result<(), sqlx::Error> {
    let key = advisory_key_for_uuid(reel_id);
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(key)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

fn advisory_key_for_uuid(id: Uuid) -> i64 {
    let bytes = id.as_bytes();
    let mut head = [0u8; 8];
    head.copy_from_slice(&bytes[..8]);
    i64::from_be_bytes(head)
}

async fn sync_reel_episode_bridge_tx(
    tx: &mut Transaction<'_, Postgres>,
    reel_id: Uuid,
    canonical_episode_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE reels
        SET episode_id = CAST($2 AS TEXT),
            updated_at = now()
        WHERE id = $1
        "#,
    )
    .bind(reel_id)
    .bind(canonical_episode_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn clear_reel_episode_bridge_tx(
    tx: &mut Transaction<'_, Postgres>,
    reel_id: Uuid,
    expected_episode_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE reels
        SET episode_id = NULL,
            updated_at = now()
        WHERE id = $1
          AND episode_id = CAST($2 AS TEXT)
        "#,
    )
    .bind(reel_id)
    .bind(expected_episode_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn create_backfill_episode_for_reel(
    pool: &PgPool,
    season_id: Uuid,
    episode_number: i32,
    title: &str,
    reel_id: Uuid,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    lock_reel_advisory_tx(&mut tx, reel_id).await?;

    let already: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM studio_episodes WHERE reel_id = $1)",
    )
    .bind(reel_id)
    .fetch_one(&mut *tx)
    .await?;
    if already {
        tx.rollback().await?;
        return Err(sqlx::Error::RowNotFound);
    }

    let row = sqlx::query_as::<_, EpisodeRow>(
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
    .bind(None::<&str>)
    .bind(Some(reel_id))
    .bind(Some(Utc::now()))
    .fetch_one(&mut *tx)
    .await?;

    sync_reel_episode_bridge_tx(&mut tx, reel_id, row.id).await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> Option<PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        let pool = PgPool::connect(&url).await.ok()?;
        let _ = crate::db::run_migrations(&pool).await.ok()?;
        Some(pool)
    }

    async fn seed_reel(pool: &PgPool, reel_id: Uuid, title: &str) {
        sqlx::query(
            r#"
            INSERT INTO reels (id, title, category, status, validated, file_name, video_url)
            VALUES ($1, $2, 'Trending', 'ready', true, $3, $4)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(reel_id)
        .bind(title)
        .bind(format!("{reel_id}.mp4"))
        .bind(format!("/videos/{reel_id}.mp4"))
        .execute(pool)
        .await
        .expect("seed reel");
    }

    async fn seed_series(pool: &PgPool) -> (Uuid, Uuid, Uuid) {
        let project = create_project(pool, "rebind-test-project", None)
            .await
            .expect("project");
        let series = create_series(pool, project.id, "rebind-test-series", None)
            .await
            .expect("series");
        let season = create_season(pool, series.id, 1, Some("Season 1"))
            .await
            .expect("season");
        (project.id, series.id, season.id)
    }

    #[tokio::test]
    async fn rebind_requires_source_when_reel_has_owner() {
        let Some(pool) = pool().await else {
            eprintln!("skip rebind_requires_source_when_reel_has_owner: DATABASE_URL not set");
            return;
        };
        let (_, _, season_id) = seed_series(&pool).await;
        let reel_id = Uuid::new_v4();
        seed_reel(&pool, reel_id, "Reel source-required").await;
        let source = create_episode(&pool, season_id, 1, "source", None, Some(reel_id))
            .await
            .expect("source episode");
        let target = create_episode(&pool, season_id, 2, "target", None, None)
            .await
            .expect("target episode");

        let result = rebind_reel_to_episode(&pool, target.id, reel_id, None)
            .await
            .expect("rebind call");
        assert!(matches!(result, RebindReelOutcome::SourceEpisodeRequired));

        let still_source: Option<Uuid> =
            sqlx::query_scalar("SELECT id FROM studio_episodes WHERE reel_id = $1")
                .bind(reel_id)
                .fetch_optional(&pool)
                .await
                .expect("current owner");
        assert_eq!(still_source, Some(source.id));
    }

    #[tokio::test]
    async fn rebind_rejects_source_mismatch() {
        let Some(pool) = pool().await else {
            eprintln!("skip rebind_rejects_source_mismatch: DATABASE_URL not set");
            return;
        };
        let (_, _, season_id) = seed_series(&pool).await;
        let reel_id = Uuid::new_v4();
        seed_reel(&pool, reel_id, "Reel source-mismatch").await;
        let source = create_episode(&pool, season_id, 11, "source", None, Some(reel_id))
            .await
            .expect("source episode");
        let target = create_episode(&pool, season_id, 12, "target", None, None)
            .await
            .expect("target episode");
        let wrong_source = Uuid::new_v4();

        let result = rebind_reel_to_episode(&pool, target.id, reel_id, Some(wrong_source))
            .await
            .expect("rebind call");
        match result {
            RebindReelOutcome::SourceMismatch { current_episode_id } => {
                assert_eq!(current_episode_id, Some(source.id));
            }
            _ => panic!("expected source mismatch"),
        }
    }

    #[tokio::test]
    async fn rebind_rejects_occupied_target() {
        let Some(pool) = pool().await else {
            eprintln!("skip rebind_rejects_occupied_target: DATABASE_URL not set");
            return;
        };
        let (_, _, season_id) = seed_series(&pool).await;
        let moving_reel = Uuid::new_v4();
        let target_reel = Uuid::new_v4();
        seed_reel(&pool, moving_reel, "moving").await;
        seed_reel(&pool, target_reel, "target").await;
        let source = create_episode(&pool, season_id, 21, "source", None, Some(moving_reel))
            .await
            .expect("source episode");
        let target = create_episode(&pool, season_id, 22, "target", None, Some(target_reel))
            .await
            .expect("target episode");

        let result = rebind_reel_to_episode(&pool, target.id, moving_reel, Some(source.id))
            .await
            .expect("rebind call");
        match result {
            RebindReelOutcome::TargetHasAnotherReel { target_reel_id } => {
                assert_eq!(target_reel_id, target_reel);
            }
            _ => panic!("expected occupied target conflict"),
        }
    }

    #[tokio::test]
    async fn rebind_is_idempotent_for_same_target_and_keeps_bridge_synced() {
        let Some(pool) = pool().await else {
            eprintln!("skip rebind_is_idempotent_for_same_target_and_keeps_bridge_synced: DATABASE_URL not set");
            return;
        };
        let (_, _, season_id) = seed_series(&pool).await;
        let reel_id = Uuid::new_v4();
        seed_reel(&pool, reel_id, "idempotent").await;
        let target = create_episode(&pool, season_id, 31, "target", None, Some(reel_id))
            .await
            .expect("target episode");
        sqlx::query("UPDATE reels SET episode_id = NULL WHERE id = $1")
            .bind(reel_id)
            .execute(&pool)
            .await
            .expect("desync bridge");

        let result = rebind_reel_to_episode(&pool, target.id, reel_id, None)
            .await
            .expect("rebind call");
        match result {
            RebindReelOutcome::Rebound { noop, .. } => assert!(noop),
            _ => panic!("expected noop rebound"),
        }

        let bridge: Option<String> =
            sqlx::query_scalar("SELECT episode_id FROM reels WHERE id = $1")
                .bind(reel_id)
                .fetch_one(&pool)
                .await
                .expect("bridge");
        let target_id = target.id.to_string();
        assert_eq!(bridge.as_deref(), Some(target_id.as_str()));
    }

    #[tokio::test]
    async fn rebind_moves_owner_and_backfill_does_not_recreate_duplicate() {
        let Some(pool) = pool().await else {
            eprintln!("skip rebind_moves_owner_and_backfill_does_not_recreate_duplicate: DATABASE_URL not set");
            return;
        };
        let (_, _, season_id) = seed_series(&pool).await;
        let reel_id = Uuid::new_v4();
        seed_reel(&pool, reel_id, "move-and-backfill").await;
        let source = create_episode(&pool, season_id, 41, "source", None, Some(reel_id))
            .await
            .expect("source");
        let target = create_episode(&pool, season_id, 42, "target", None, None)
            .await
            .expect("target");

        let result = rebind_reel_to_episode(&pool, target.id, reel_id, Some(source.id))
            .await
            .expect("rebind call");
        assert!(matches!(result, RebindReelOutcome::Rebound { noop: false, .. }));

        let owners: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM studio_episodes WHERE reel_id = $1")
                .bind(reel_id)
                .fetch_one(&pool)
                .await
                .expect("owner count");
        assert_eq!(owners, 1);

        let source_reel: Option<Uuid> =
            sqlx::query_scalar("SELECT reel_id FROM studio_episodes WHERE id = $1")
                .bind(source.id)
                .fetch_one(&pool)
                .await
                .expect("source reel");
        assert_eq!(source_reel, None);

        let target_reel: Option<Uuid> =
            sqlx::query_scalar("SELECT reel_id FROM studio_episodes WHERE id = $1")
                .bind(target.id)
                .fetch_one(&pool)
                .await
                .expect("target reel");
        assert_eq!(target_reel, Some(reel_id));

        let bridge: Option<String> =
            sqlx::query_scalar("SELECT episode_id FROM reels WHERE id = $1")
                .bind(reel_id)
                .fetch_one(&pool)
                .await
                .expect("bridge");
        let target_id = target.id.to_string();
        assert_eq!(bridge.as_deref(), Some(target_id.as_str()));

        let _ = backfill_reels_to_hierarchy(&pool).await.expect("backfill");
        let owners_after_backfill: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM studio_episodes WHERE reel_id = $1")
                .bind(reel_id)
                .fetch_one(&pool)
                .await
                .expect("owner count after backfill");
        assert_eq!(owners_after_backfill, 1);
    }
}

async fn apply_default_backfill_monetization(
    pool: &PgPool,
    series_id: Uuid,
) -> Result<(), sqlx::Error> {
    // Scope guard: mutate only series still in the untouched migration defaults.
    // Any explicit monetization configuration remains authoritative.
    sqlx::query(
        r#"
        UPDATE studio_series
        SET access_mode = 'EPISODE_LOCK',
            free_episode_count = 2,
            updated_at = now()
        WHERE id = $1
          AND access_mode = 'FREE'
          AND free_episode_count = 0
        "#,
    )
    .bind(series_id)
    .execute(pool)
    .await?;
    Ok(())
}
