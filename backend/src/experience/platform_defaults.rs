//! Platform experience defaults — RVE platform baseline source.

use chrono::{DateTime, Utc};
use sqlx::PgPool;

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct PlatformExperienceDefaultsRow {
    pub id: i16,
    pub default_theme_token_set_id: Option<uuid::Uuid>,
    pub default_layout_preset_id: Option<uuid::Uuid>,
    pub hero_mode: String,
    pub hero_enabled: bool,
    pub hero_autoplay: bool,
    pub hero_carousel_interval: i32,
    pub hero_overlay_enabled: bool,
    pub continue_watching_enabled: bool,
    pub recommendations_enabled: bool,
    pub artist_panel_enabled: bool,
    pub credits_enabled: bool,
    pub downloads_enabled: bool,
    pub comments_enabled: bool,
    pub cast_panel_enabled: bool,
    pub trivia_enabled: bool,
    pub timeline_enabled: bool,
    pub premium_cta_style: String,
    pub paywall_style: Option<String>,
    pub access_style: Option<String>,
    pub cta_style: Option<String>,
    pub project_label: String,
    pub series_label: String,
    pub season_label: String,
    pub episode_label: String,
    pub vip_label: String,
    pub trailer_label: String,
    pub bonus_content_label: String,
    pub updated_at: DateTime<Utc>,
}

pub async fn get_defaults(pool: &PgPool) -> Result<PlatformExperienceDefaultsRow, sqlx::Error> {
    sqlx::query_as::<_, PlatformExperienceDefaultsRow>(
        "SELECT * FROM platform_experience_defaults WHERE id = 1",
    )
    .fetch_one(pool)
    .await
}
