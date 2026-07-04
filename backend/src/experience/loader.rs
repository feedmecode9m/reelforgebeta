//! Internal loaders — pub(crate) only; consumed by `experience_resolve.rs`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use super::hierarchy::{load_hierarchy_context, HierarchyResolveContext};
use super::layout_presets::LayoutPresetRow;
use super::metadata_registry::MetadataValueRow;
use super::platform_defaults::PlatformExperienceDefaultsRow;
use super::profiles::{get_active_version, get_family, get_pinned_version, ProfileFamilyRow, ProfileVersionRow};
use super::slots::SlotAssignmentRow;
use super::theme_tokens::ThemeTokenSetRow;

/// Counts loader SQL round-trips (debug instrumentation per RDR-200).
#[derive(Debug, Default)]
pub struct QueryCounter {
    count: AtomicU32,
}

impl QueryCounter {
    pub fn bump(&self) {
        self.count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn total(&self) -> u32 {
        self.count.load(Ordering::Relaxed)
    }
}

/// Profile version resolved at one hierarchy level (merge overlay source).
#[derive(Debug, Clone)]
pub struct ProfileLayer {
    pub source: super::provenance::ProvenanceSource,
    pub scope_id: Uuid,
    pub row: Option<ProfileVersionRow>,
}

/// All read-only inputs for a single episode resolve.
#[derive(Debug)]
pub struct ResolveLoadBundle {
    pub hierarchy: HierarchyResolveContext,
    pub platform: PlatformExperienceDefaultsRow,
    pub profile_layers: Vec<ProfileLayer>,
    pub winning_profile: Option<ProfileVersionRow>,
    pub winning_family: Option<ProfileFamilyRow>,
    pub layout: LayoutPresetRow,
    pub theme_set: Option<ThemeTokenSetRow>,
    pub theme_tokens: HashMap<String, Value>,
    pub metadata: HashMap<String, Value>,
    pub slots: Vec<SlotAssignmentRow>,
    pub query_count: u32,
}

#[derive(Debug)]
pub enum LoaderError {
    NotFound,
    PinnedDraft,
    Database(sqlx::Error),
}

impl From<sqlx::Error> for LoaderError {
    fn from(e: sqlx::Error) -> Self {
        Self::Database(e)
    }
}

/// Resolve profile version row for an attachment (ACTIVE or pinned).
pub(crate) async fn load_profile_for_attachment(
    pool: &PgPool,
    counter: &QueryCounter,
    family_id: Option<Uuid>,
    pin_version: bool,
    version_id: Option<Uuid>,
) -> Result<Option<ProfileVersionRow>, LoaderError> {
    if pin_version {
        if let Some(vid) = version_id {
            counter.bump();
            match get_pinned_version(pool, vid).await? {
                Ok(row) => return Ok(Some(row)),
                Err("pinned profile version cannot be DRAFT") => {
                    return Err(LoaderError::PinnedDraft);
                }
                Err(_) => return Ok(None),
            }
        }
        return Ok(None);
    }
    if let Some(fid) = family_id {
        counter.bump();
        return Ok(get_active_version(pool, fid).await?);
    }
    Ok(None)
}

pub(crate) async fn load_hierarchy(
    pool: &PgPool,
    counter: &QueryCounter,
    episode_id: Uuid,
) -> Result<Option<HierarchyResolveContext>, LoaderError> {
    counter.bump();
    Ok(load_hierarchy_context(pool, episode_id).await?)
}

pub(crate) async fn load_platform_defaults(
    pool: &PgPool,
    counter: &QueryCounter,
) -> Result<PlatformExperienceDefaultsRow, LoaderError> {
    counter.bump();
    Ok(super::platform_defaults::get_defaults(pool).await?)
}

pub(crate) async fn load_layout_by_id(
    pool: &PgPool,
    counter: &QueryCounter,
    id: Uuid,
) -> Result<Option<LayoutPresetRow>, LoaderError> {
    counter.bump();
    Ok(super::layout_presets::get_by_id(pool, id).await?)
}

pub(crate) async fn load_layout_by_key(
    pool: &PgPool,
    counter: &QueryCounter,
    preset_key: &str,
) -> Result<Option<LayoutPresetRow>, LoaderError> {
    counter.bump();
    Ok(super::layout_presets::get_by_key(pool, preset_key).await?)
}

pub(crate) async fn load_theme_set(
    pool: &PgPool,
    counter: &QueryCounter,
    id: Uuid,
) -> Result<Option<ThemeTokenSetRow>, LoaderError> {
    counter.bump();
    Ok(super::theme_tokens::get_set_by_id(pool, id).await?)
}

pub(crate) async fn load_theme_tokens(
    pool: &PgPool,
    counter: &QueryCounter,
    set_id: Uuid,
) -> Result<HashMap<String, Value>, LoaderError> {
    counter.bump();
    Ok(super::theme_tokens::load_tokens_for_set(pool, set_id).await?)
}

pub(crate) async fn load_family(
    pool: &PgPool,
    counter: &QueryCounter,
    id: Uuid,
) -> Result<Option<ProfileFamilyRow>, LoaderError> {
    counter.bump();
    Ok(get_family(pool, id).await?)
}

/// Batched metadata for project → series → season → episode (later scope wins).
pub(crate) async fn load_metadata_chain(
    pool: &PgPool,
    counter: &QueryCounter,
    ctx: &HierarchyResolveContext,
) -> Result<HashMap<String, Value>, LoaderError> {
    counter.bump();
    let rows = sqlx::query_as::<_, MetadataValueRow>(
        r#"
        SELECT v.definition_id, d.field_key, v.value_jsonb
        FROM metadata_values v
        JOIN metadata_definitions d ON d.id = v.definition_id
        WHERE d.status = 'ACTIVE'
          AND (
            (v.scope_type = 'project' AND v.scope_id = $1)
            OR (v.scope_type = 'series' AND v.scope_id = $2)
            OR (v.scope_type = 'season' AND v.scope_id = $3)
            OR (v.scope_type = 'episode' AND v.scope_id = $4)
          )
        ORDER BY CASE v.scope_type
            WHEN 'project' THEN 1
            WHEN 'series' THEN 2
            WHEN 'season' THEN 3
            WHEN 'episode' THEN 4
            ELSE 5
        END
        "#,
    )
    .bind(ctx.project_id)
    .bind(ctx.series_id)
    .bind(ctx.season_id)
    .bind(ctx.episode_id)
    .fetch_all(pool)
    .await?;

    let mut merged = HashMap::new();
    for row in rows {
        merged.insert(row.field_key, row.value_jsonb);
    }
    Ok(merged)
}

/// Batched slots for platform + hierarchy scopes; dedupe in resolver (RDR-122).
pub(crate) async fn load_slots_chain(
    pool: &PgPool,
    counter: &QueryCounter,
    ctx: &HierarchyResolveContext,
) -> Result<Vec<SlotAssignmentRow>, LoaderError> {
    counter.bump();
    let rows = sqlx::query_as::<_, SlotAssignmentRow>(
        r#"
        SELECT * FROM experience_slot_assignments
        WHERE (scope_type = 'platform' AND scope_id IS NULL)
           OR (scope_type = 'project' AND scope_id = $1)
           OR (scope_type = 'series' AND scope_id = $2)
           OR (scope_type = 'season' AND scope_id = $3)
           OR (scope_type = 'episode' AND scope_id = $4)
        ORDER BY CASE scope_type
            WHEN 'platform' THEN 1
            WHEN 'project' THEN 2
            WHEN 'series' THEN 3
            WHEN 'season' THEN 4
            WHEN 'episode' THEN 5
            ELSE 6
        END, slot_key
        "#,
    )
    .bind(ctx.project_id)
    .bind(ctx.series_id)
    .bind(ctx.season_id)
    .bind(ctx.episode_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Load profile overlay rows for project → series → season → episode.
pub(crate) async fn load_profile_layers(
    pool: &PgPool,
    counter: &QueryCounter,
    ctx: &HierarchyResolveContext,
) -> Result<Vec<ProfileLayer>, LoaderError> {
    let levels: [(
        super::provenance::ProvenanceSource,
        Uuid,
        &super::hierarchy::ExperienceAttachment,
    ); 4] = [
        (
            super::provenance::ProvenanceSource::Project,
            ctx.project_id,
            &ctx.project_attachment,
        ),
        (
            super::provenance::ProvenanceSource::Series,
            ctx.series_id,
            &ctx.series_attachment,
        ),
        (
            super::provenance::ProvenanceSource::Season,
            ctx.season_id,
            &ctx.season_attachment,
        ),
        (
            super::provenance::ProvenanceSource::Episode,
            ctx.episode_id,
            &ctx.episode_attachment,
        ),
    ];

    let mut layers = Vec::with_capacity(4);
    for (source, scope_id, att) in levels {
        let row = load_profile_for_attachment(
            pool,
            counter,
            att.profile_family_id,
            att.pin_version,
            att.profile_version_id,
        )
        .await?;
        layers.push(ProfileLayer {
            source,
            scope_id,
            row,
        });
    }
    Ok(layers)
}

/// Single entry point for resolver reads (RDR-001).
pub(crate) async fn load_resolve_bundle(
    pool: &PgPool,
    episode_id: Uuid,
) -> Result<ResolveLoadBundle, LoaderError> {
    let counter = QueryCounter::default();

    let hierarchy = match load_hierarchy(pool, &counter, episode_id).await? {
        Some(h) => h,
        None => return Err(LoaderError::NotFound),
    };

    let platform = load_platform_defaults(pool, &counter).await?;
    let profile_layers = load_profile_layers(pool, &counter, &hierarchy).await?;
    let metadata = load_metadata_chain(pool, &counter, &hierarchy).await?;
    let slots = load_slots_chain(pool, &counter, &hierarchy).await?;

    let winning_att = super::hierarchy::winning_attachment(&hierarchy);
    let winning_profile = load_profile_for_attachment(
        pool,
        &counter,
        winning_att.profile_family_id,
        winning_att.pin_version,
        winning_att.profile_version_id,
    )
    .await?;

    let winning_family = if let Some(ref prof) = winning_profile {
        load_family(pool, &counter, prof.profile_family_id).await?
    } else {
        None
    };

    let layout_preset_id = winning_profile
        .as_ref()
        .and_then(|p| p.layout_preset_id)
        .or(platform.default_layout_preset_id);

    let layout = if let Some(id) = layout_preset_id {
        load_layout_by_id(pool, &counter, id).await?
    } else {
        None
    };
    let layout = match layout {
        Some(l) if l.status == "ACTIVE" => l,
        _ => load_layout_by_key(pool, &counter, "MINIMAL")
            .await?
            .expect("MINIMAL layout preset must exist"),
    };

    let theme_set_id = winning_profile
        .as_ref()
        .and_then(|p| p.theme_token_set_id)
        .or(platform.default_theme_token_set_id);

    let (theme_set, theme_tokens) = if let Some(id) = theme_set_id {
        let set = load_theme_set(pool, &counter, id).await?;
        let tokens = if set.is_some() {
            load_theme_tokens(pool, &counter, id).await?
        } else {
            HashMap::new()
        };
        (set, tokens)
    } else {
        (None, HashMap::new())
    };

    let query_count = counter.total();

    Ok(ResolveLoadBundle {
        hierarchy,
        platform,
        profile_layers,
        winning_profile,
        winning_family,
        layout,
        theme_set,
        theme_tokens,
        metadata,
        slots,
        query_count,
    })
}
