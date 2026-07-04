//! Studio hierarchy context and experience attachments (read for resolver).

use sqlx::PgPool;
use uuid::Uuid;

/// Per-level profile attachment (contract §8.2 / §5.1 hierarchy walk).
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ExperienceAttachment {
    pub profile_family_id: Option<Uuid>,
    pub pin_version: bool,
    pub profile_version_id: Option<Uuid>,
}

/// Episode → project chain with attachments at each level.
#[derive(Debug, Clone, serde::Serialize)]
pub struct HierarchyResolveContext {
    pub episode_id: Uuid,
    pub reel_id: Option<Uuid>,
    pub season_id: Uuid,
    pub series_id: Uuid,
    pub project_id: Uuid,
    pub project_attachment: ExperienceAttachment,
    pub series_attachment: ExperienceAttachment,
    pub season_attachment: ExperienceAttachment,
    pub episode_attachment: ExperienceAttachment,
}

#[derive(sqlx::FromRow)]
struct EpisodeChainRow {
    episode_id: Uuid,
    reel_id: Option<Uuid>,
    season_id: Uuid,
    series_id: Uuid,
    project_id: Uuid,
    project_family_id: Option<Uuid>,
    project_pin: bool,
    project_version_id: Option<Uuid>,
    series_family_id: Option<Uuid>,
    series_pin: bool,
    series_version_id: Option<Uuid>,
    season_family_id: Option<Uuid>,
    season_pin: bool,
    season_version_id: Option<Uuid>,
    episode_family_id: Option<Uuid>,
    episode_pin: bool,
    episode_version_id: Option<Uuid>,
}

pub async fn load_hierarchy_context(
    pool: &PgPool,
    episode_id: Uuid,
) -> Result<Option<HierarchyResolveContext>, sqlx::Error> {
    let row = sqlx::query_as::<_, EpisodeChainRow>(
        r#"
        SELECT
            e.id AS episode_id,
            e.reel_id,
            s.id AS season_id,
            sr.id AS series_id,
            p.id AS project_id,
            p.experience_profile_family_id AS project_family_id,
            p.experience_profile_pin_version AS project_pin,
            p.experience_profile_version_id AS project_version_id,
            sr.experience_profile_family_id AS series_family_id,
            sr.experience_profile_pin_version AS series_pin,
            sr.experience_profile_version_id AS series_version_id,
            s.experience_profile_family_id AS season_family_id,
            s.experience_profile_pin_version AS season_pin,
            s.experience_profile_version_id AS season_version_id,
            e.experience_profile_family_id AS episode_family_id,
            e.experience_profile_pin_version AS episode_pin,
            e.experience_profile_version_id AS episode_version_id
        FROM studio_episodes e
        JOIN studio_seasons s ON s.id = e.season_id
        JOIN studio_series sr ON sr.id = s.series_id
        JOIN studio_projects p ON p.id = sr.project_id
        WHERE e.id = $1
        "#,
    )
    .bind(episode_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| HierarchyResolveContext {
        episode_id: r.episode_id,
        reel_id: r.reel_id,
        season_id: r.season_id,
        series_id: r.series_id,
        project_id: r.project_id,
        project_attachment: ExperienceAttachment {
            profile_family_id: r.project_family_id,
            pin_version: r.project_pin,
            profile_version_id: r.project_version_id,
        },
        series_attachment: ExperienceAttachment {
            profile_family_id: r.series_family_id,
            pin_version: r.series_pin,
            profile_version_id: r.series_version_id,
        },
        season_attachment: ExperienceAttachment {
            profile_family_id: r.season_family_id,
            pin_version: r.season_pin,
            profile_version_id: r.season_version_id,
        },
        episode_attachment: ExperienceAttachment {
            profile_family_id: r.episode_family_id,
            pin_version: r.episode_pin,
            profile_version_id: r.episode_version_id,
        },
    }))
}

/// Merge nullable string fields: later levels override earlier (child wins).
pub fn merge_optional_string(layers: &[Option<String>]) -> Option<String> {
    layers
        .iter()
        .rev()
        .find_map(|v| v.as_ref().map(|s| s.clone()))
}

/// Merge nullable bool: last explicit Some wins walking from parent to child.
pub fn merge_optional_bool(layers: &[Option<bool>]) -> Option<bool> {
    layers
        .iter()
        .rev()
        .find_map(|v| *v)
}

/// Winning attachment for profile resolution: episode → season → series → project.
pub fn winning_attachment(ctx: &HierarchyResolveContext) -> ExperienceAttachment {
    for att in [
        &ctx.episode_attachment,
        &ctx.season_attachment,
        &ctx.series_attachment,
        &ctx.project_attachment,
    ] {
        if att.profile_family_id.is_some() {
            return att.clone();
        }
    }
    ExperienceAttachment::default()
}
