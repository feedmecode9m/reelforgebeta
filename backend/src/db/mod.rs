pub mod jobs;
pub mod monetization;
pub mod platform_config;
pub mod reels;
pub mod series;
pub mod studio;
pub mod sync;
pub mod analytics;
pub mod notifications;
pub mod pipeline;
pub mod teams;
pub mod watch_events;
pub mod security_events;
pub mod revenue;
pub mod workflow;

use sqlx::PgPool;

pub fn watch_tracking_enabled() -> bool {
    std::env::var("REELFORGE_WATCH_TRACKING")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub fn monetization_enabled() -> bool {
    std::env::var("REELFORGE_MONETIZATION")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub fn platform_config_enabled() -> bool {
    std::env::var("REELFORGE_PLATFORM_CONFIG")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub fn experience_profiles_enabled() -> bool {
    std::env::var("REELFORGE_EXPERIENCE_PROFILES")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub fn studio_hierarchy_enabled() -> bool {
    std::env::var("REELFORGE_STUDIO_HIERARCHY")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub fn series_api_enabled() -> bool {
    std::env::var("REELFORGE_SERIES_API")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true)
}

pub fn studio_sync_enabled() -> bool {
    std::env::var("REELFORGE_STUDIO_SYNC")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true)
}

pub fn workflow_api_enabled() -> bool {
    std::env::var("REELFORGE_WORKFLOW_API")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true)
}

pub fn analytics_api_enabled() -> bool {
    std::env::var("REELFORGE_ANALYTICS_API")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true)
}

pub fn team_api_enabled() -> bool {
    std::env::var("REELFORGE_TEAM_API")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true)
}

pub fn notification_api_enabled() -> bool {
    std::env::var("REELFORGE_NOTIFICATION_API")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true)
}

pub fn security_events_api_enabled() -> bool {
    std::env::var("REELFORGE_SECURITY_EVENTS_API")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true)
}

pub fn revenue_api_enabled() -> bool {
    std::env::var("REELFORGE_REVENUE_API")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true)
}

pub fn pipeline_api_enabled() -> bool {
    std::env::var("REELFORGE_PIPELINE_API")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true)
}

pub fn ingestion_v2_enabled() -> bool {
    std::env::var("REELFORGE_INGESTION_V2")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true)
}

pub fn startup_reconcile_enabled() -> bool {
    std::env::var("REELFORGE_STARTUP_RECONCILE")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true)
}

pub fn reconcile_exclude_filenames() -> Vec<String> {
    let mut names = vec!["hero-background.mp4".to_string()];
    if let Ok(raw) = std::env::var("REELFORGE_RECONCILE_EXCLUDE") {
        for part in raw.split(',') {
            let s = part.trim().to_string();
            if !s.is_empty() {
                names.push(s);
            }
        }
    }
    names
}

pub fn media_public_base() -> String {
    std::env::var("MEDIA_PUBLIC_BASE")
        .unwrap_or_else(|_| {
            format!(
                "http://localhost:{}",
                std::env::var("PORT").unwrap_or_else(|_| "8080".to_string())
            )
        })
        .trim_end_matches('/')
        .to_string()
}

/// Sole backend public URL resolver — maps relative `/videos/` and `/thumbs/` paths to absolute URLs.
pub fn canonical_media_url(path: &str) -> String {
    let base = media_public_base();
    let p = path.trim();
    if p.is_empty() {
        return String::new();
    }
    if p.starts_with("http://") || p.starts_with("https://") {
        return p.to_string();
    }
    let rel = if p.starts_with('/') {
        p.to_string()
    } else {
        format!("/{}", p)
    };
    format!("{}{}", base, rel)
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}
