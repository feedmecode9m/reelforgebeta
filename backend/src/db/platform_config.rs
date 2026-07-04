use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct SiteConfigRow {
    pub site_name: String,
    pub site_tagline: String,
    pub site_description: String,
    pub logo_url: Option<String>,
    pub favicon_url: Option<String>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct HeroConfigRow {
    pub hero_enabled: bool,
    pub hero_mode: String,
    pub rotation_seconds: i32,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct FeatureFlagsRow {
    pub studio_hierarchy: bool,
    pub hero_management: bool,
    pub monetization: bool,
    pub watch_tracking: bool,
    pub analytics: bool,
    pub intel: bool,
    pub experience_profiles: bool,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct CampaignRow {
    pub id: Uuid,
    pub campaign_name: String,
    pub campaign_type: String,
    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PlatformConfigBundle {
    pub site: SiteConfigRow,
    pub hero: HeroConfigRow,
    pub features: FeatureFlagsRow,
    pub campaigns: Vec<CampaignRow>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct UpdateSiteConfig {
    pub site_name: Option<String>,
    pub site_tagline: Option<String>,
    pub site_description: Option<String>,
    pub logo_url: Option<String>,
    pub favicon_url: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct UpdateHeroConfig {
    pub hero_enabled: Option<bool>,
    pub hero_mode: Option<String>,
    pub rotation_seconds: Option<i32>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct UpdateFeatureFlags {
    pub studio_hierarchy: Option<bool>,
    pub hero_management: Option<bool>,
    pub monetization: Option<bool>,
    pub watch_tracking: Option<bool>,
    pub analytics: Option<bool>,
    pub intel: Option<bool>,
    pub experience_profiles: Option<bool>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CreateCampaign {
    pub campaign_name: String,
    pub campaign_type: String,
    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct UpdateCampaign {
    pub campaign_name: Option<String>,
    pub campaign_type: Option<String>,
    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,
    pub status: Option<String>,
}

const VALID_HERO_MODES: &[&str] = &[
    "OFF",
    "STATIC",
    "CAROUSEL",
    "FEATURED_SERIES",
    "LATEST_RELEASE",
    "PROMOTED",
];

const VALID_CAMPAIGN_TYPES: &[&str] = &["CONTEST", "PREMIERE", "PROMOTION", "SPONSOR"];

const VALID_CAMPAIGN_STATUSES: &[&str] = &["draft", "scheduled", "active", "ended", "archived"];

pub fn is_valid_hero_mode(mode: &str) -> bool {
    VALID_HERO_MODES.contains(&mode)
}

pub fn is_valid_campaign_type(t: &str) -> bool {
    VALID_CAMPAIGN_TYPES.contains(&t)
}

pub fn is_valid_campaign_status(s: &str) -> bool {
    VALID_CAMPAIGN_STATUSES.contains(&s)
}

async fn ensure_defaults(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO platform_site_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING")
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO platform_hero_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING")
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO platform_feature_flags (id) VALUES (1) ON CONFLICT (id) DO NOTHING")
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_site_config(pool: &PgPool) -> Result<SiteConfigRow, sqlx::Error> {
    ensure_defaults(pool).await?;
    sqlx::query_as::<_, SiteConfigRow>(
        r#"
        SELECT site_name, site_tagline, site_description, logo_url, favicon_url, updated_at
        FROM platform_site_config WHERE id = 1
        "#,
    )
    .fetch_one(pool)
    .await
}

pub async fn get_hero_config(pool: &PgPool) -> Result<HeroConfigRow, sqlx::Error> {
    ensure_defaults(pool).await?;
    sqlx::query_as::<_, HeroConfigRow>(
        r#"
        SELECT hero_enabled, hero_mode, rotation_seconds, updated_at
        FROM platform_hero_config WHERE id = 1
        "#,
    )
    .fetch_one(pool)
    .await
}

pub async fn get_feature_flags(pool: &PgPool) -> Result<FeatureFlagsRow, sqlx::Error> {
    ensure_defaults(pool).await?;
    sqlx::query_as::<_, FeatureFlagsRow>(
        r#"
        SELECT studio_hierarchy, hero_management, monetization, watch_tracking,
               analytics, intel, experience_profiles, updated_at
        FROM platform_feature_flags WHERE id = 1
        "#,
    )
    .fetch_one(pool)
    .await
}

pub async fn list_campaigns(pool: &PgPool) -> Result<Vec<CampaignRow>, sqlx::Error> {
    sqlx::query_as::<_, CampaignRow>(
        r#"
        SELECT id, campaign_name, campaign_type, start_date, end_date, status,
               created_at, updated_at
        FROM platform_campaigns
        ORDER BY created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await
}

pub async fn get_full_config(pool: &PgPool) -> Result<PlatformConfigBundle, sqlx::Error> {
    let site = get_site_config(pool).await?;
    let hero = get_hero_config(pool).await?;
    let features = get_feature_flags(pool).await?;
    let campaigns = list_campaigns(pool).await?;
    Ok(PlatformConfigBundle {
        site,
        hero,
        features,
        campaigns,
    })
}

pub async fn update_site_config(
    pool: &PgPool,
    patch: &UpdateSiteConfig,
) -> Result<SiteConfigRow, sqlx::Error> {
    ensure_defaults(pool).await?;
    let current = get_site_config(pool).await?;
    let site_name = patch
        .site_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(current.site_name.as_str());
    let site_tagline = patch.site_tagline.as_ref().unwrap_or(&current.site_tagline);
    let site_description = patch
        .site_description
        .as_ref()
        .unwrap_or(&current.site_description);
    let logo_url = patch.logo_url.as_ref().or(current.logo_url.as_ref());
    let favicon_url = patch.favicon_url.as_ref().or(current.favicon_url.as_ref());

    sqlx::query_as::<_, SiteConfigRow>(
        r#"
        UPDATE platform_site_config
        SET site_name = $1,
            site_tagline = $2,
            site_description = $3,
            logo_url = $4,
            favicon_url = $5,
            updated_at = now()
        WHERE id = 1
        RETURNING site_name, site_tagline, site_description, logo_url, favicon_url, updated_at
        "#,
    )
    .bind(site_name)
    .bind(site_tagline)
    .bind(site_description)
    .bind(logo_url)
    .bind(favicon_url)
    .fetch_one(pool)
    .await
}

pub async fn update_hero_config(
    pool: &PgPool,
    patch: &UpdateHeroConfig,
) -> Result<Result<HeroConfigRow, &'static str>, sqlx::Error> {
    ensure_defaults(pool).await?;
    let current = get_hero_config(pool).await?;

    let hero_mode = patch
        .hero_mode
        .as_deref()
        .unwrap_or(current.hero_mode.as_str());
    if !is_valid_hero_mode(hero_mode) {
        return Ok(Err("Invalid hero_mode"));
    }

    let rotation = patch.rotation_seconds.unwrap_or(current.rotation_seconds);
    if !(3..=120).contains(&rotation) {
        return Ok(Err("rotation_seconds must be between 3 and 120"));
    }

    let hero_enabled = patch.hero_enabled.unwrap_or(current.hero_enabled);

    let row = sqlx::query_as::<_, HeroConfigRow>(
        r#"
        UPDATE platform_hero_config
        SET hero_enabled = $1,
            hero_mode = $2,
            rotation_seconds = $3,
            updated_at = now()
        WHERE id = 1
        RETURNING hero_enabled, hero_mode, rotation_seconds, updated_at
        "#,
    )
    .bind(hero_enabled)
    .bind(hero_mode)
    .bind(rotation)
    .fetch_one(pool)
    .await?;

    Ok(Ok(row))
}

pub async fn update_feature_flags(
    pool: &PgPool,
    patch: &UpdateFeatureFlags,
) -> Result<FeatureFlagsRow, sqlx::Error> {
    ensure_defaults(pool).await?;
    let current = get_feature_flags(pool).await?;

    sqlx::query_as::<_, FeatureFlagsRow>(
        r#"
        UPDATE platform_feature_flags
        SET studio_hierarchy = $1,
            hero_management = $2,
            monetization = $3,
            watch_tracking = $4,
            analytics = $5,
            intel = $6,
            experience_profiles = $7,
            updated_at = now()
        WHERE id = 1
        RETURNING studio_hierarchy, hero_management, monetization, watch_tracking,
                  analytics, intel, experience_profiles, updated_at
        "#,
    )
    .bind(patch.studio_hierarchy.unwrap_or(current.studio_hierarchy))
    .bind(patch.hero_management.unwrap_or(current.hero_management))
    .bind(patch.monetization.unwrap_or(current.monetization))
    .bind(patch.watch_tracking.unwrap_or(current.watch_tracking))
    .bind(patch.analytics.unwrap_or(current.analytics))
    .bind(patch.intel.unwrap_or(current.intel))
    .bind(
        patch
            .experience_profiles
            .unwrap_or(current.experience_profiles),
    )
    .fetch_one(pool)
    .await
}

pub async fn get_campaign(pool: &PgPool, id: Uuid) -> Result<Option<CampaignRow>, sqlx::Error> {
    sqlx::query_as::<_, CampaignRow>(
        r#"
        SELECT id, campaign_name, campaign_type, start_date, end_date, status,
               created_at, updated_at
        FROM platform_campaigns WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn create_campaign(
    pool: &PgPool,
    body: &CreateCampaign,
) -> Result<Result<CampaignRow, &'static str>, sqlx::Error> {
    let name = body.campaign_name.trim();
    if name.is_empty() {
        return Ok(Err("campaign_name is required"));
    }
    if !is_valid_campaign_type(&body.campaign_type) {
        return Ok(Err("Invalid campaign_type"));
    }
    let status = body.status.as_deref().unwrap_or("draft");
    if !is_valid_campaign_status(status) {
        return Ok(Err("Invalid status"));
    }

    let row = sqlx::query_as::<_, CampaignRow>(
        r#"
        INSERT INTO platform_campaigns (
            campaign_name, campaign_type, start_date, end_date, status
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, campaign_name, campaign_type, start_date, end_date, status,
                  created_at, updated_at
        "#,
    )
    .bind(name)
    .bind(&body.campaign_type)
    .bind(body.start_date)
    .bind(body.end_date)
    .bind(status)
    .fetch_one(pool)
    .await?;

    Ok(Ok(row))
}

pub async fn update_campaign(
    pool: &PgPool,
    id: Uuid,
    patch: &UpdateCampaign,
) -> Result<Result<CampaignRow, &'static str>, sqlx::Error> {
    let current = match get_campaign(pool, id).await? {
        Some(c) => c,
        None => return Ok(Err("Campaign not found")),
    };

    let name = patch
        .campaign_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(current.campaign_name.as_str());
    let campaign_type = patch
        .campaign_type
        .as_deref()
        .unwrap_or(current.campaign_type.as_str());
    if !is_valid_campaign_type(campaign_type) {
        return Ok(Err("Invalid campaign_type"));
    }
    let status = patch.status.as_deref().unwrap_or(current.status.as_str());
    if !is_valid_campaign_status(status) {
        return Ok(Err("Invalid status"));
    }
    let start_date = patch.start_date.or(current.start_date);
    let end_date = patch.end_date.or(current.end_date);

    let row = sqlx::query_as::<_, CampaignRow>(
        r#"
        UPDATE platform_campaigns
        SET campaign_name = $2,
            campaign_type = $3,
            start_date = $4,
            end_date = $5,
            status = $6,
            updated_at = now()
        WHERE id = $1
        RETURNING id, campaign_name, campaign_type, start_date, end_date, status,
                  created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(name)
    .bind(campaign_type)
    .bind(start_date)
    .bind(end_date)
    .bind(status)
    .fetch_one(pool)
    .await?;

    Ok(Ok(row))
}

pub async fn delete_campaign(pool: &PgPool, id: Uuid) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM platform_campaigns WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
