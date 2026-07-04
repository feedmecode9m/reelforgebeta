//! Sole composition authority for ResolvedViewerExperience (RVE).

use chrono::Utc;
use serde_json::{json, Map, Value};
use sqlx::PgPool;
use uuid::Uuid;

use super::contract::{validate_metadata_key, RveValidationError, SCHEMA_VERSION};
use super::hierarchy::{merge_optional_bool, merge_optional_string, winning_attachment};
use super::loader::{load_resolve_bundle, LoaderError, ProfileLayer, ResolveLoadBundle};
use super::platform_defaults::PlatformExperienceDefaultsRow;
use super::profiles::ProfileVersionRow;
use super::provenance::{entry_json, scope_id, ProvenanceEntry, ProvenanceSource};
use super::slots::SlotAssignmentRow;

#[derive(Debug)]
pub enum ResolveError {
    NotFound,
    PinnedDraft,
    Validation { codes: Vec<String>, fields: Vec<String> },
    Database(sqlx::Error),
}

impl From<LoaderError> for ResolveError {
    fn from(e: LoaderError) -> Self {
        match e {
            LoaderError::NotFound => Self::NotFound,
            LoaderError::PinnedDraft => Self::PinnedDraft,
            LoaderError::Database(e) => Self::Database(e),
        }
    }
}

/// Contract validation at the composition kernel boundary (Phase 1b.4).
pub use super::contract::validate_rve;

/// Compose and validate Base RVE for an episode (composition kernel only; RDR-150).
pub async fn resolve_base_rve(pool: &PgPool, episode_id: Uuid) -> Result<Value, ResolveError> {
    let bundle = load_resolve_bundle(pool, episode_id).await?;
    let rve = compose(&bundle)?;

    #[cfg(debug_assertions)]
    eprintln!(
        "[experience_resolve] episode_id={episode_id} query_count={}",
        bundle.query_count
    );

    map_validation_result(validate_rve(&rve), rve)
}

/// Compose RVE for an episode. Validates before return (RDR-150).
pub async fn resolve(pool: &PgPool, episode_id: Uuid) -> Result<Value, ResolveError> {
    resolve_base_rve(pool, episode_id).await
}

/// Stub composition plan emitter (Phase 1b.4 wiring; no Viewer logic).
pub fn emit_composition_plan_stub(
    base_rve: &Value,
    delivered_rve: &Value,
) -> super::cspp::composition_plan::CompositionPlan {
    super::cspp::composition_plan::CompositionPlan::stub_from_rve(base_rve, delivered_rve)
}

fn map_validation_result(
    result: Result<(), RveValidationError>,
    rve: Value,
) -> Result<Value, ResolveError> {
    match result {
        Ok(()) => Ok(rve),
        Err(RveValidationError::Invalid(v)) => Err(ResolveError::Validation {
            codes: vec!["NC-101".into()],
            fields: v,
        }),
        Err(RveValidationError::ReservedMetadataKey(k)) => Err(ResolveError::Validation {
            codes: vec!["NC-104".into()],
            fields: vec![format!("metadata.{k}")],
        }),
    }
}

fn prov_insert(map: &mut Map<String, Value>, path: &str, entry: ProvenanceEntry) {
    map.insert(path.to_string(), serde_json::to_value(entry).unwrap());
}

fn compose(bundle: &ResolveLoadBundle) -> Result<Value, ResolveError> {
    let ctx = &bundle.hierarchy;
    let platform = &bundle.platform;
    let resolved_at = Utc::now();

    let mut provenance: Map<String, Value> = Map::new();

    prov_insert(
        &mut provenance,
        "schema_version",
        entry_json(
            json!(SCHEMA_VERSION),
            ProvenanceSource::Default,
            None,
            None,
        ),
    );

    let resolve_context = json!({
        "episode_id": ctx.episode_id,
        "reel_id": ctx.reel_id,
        "project_id": ctx.project_id,
        "series_id": ctx.series_id,
        "season_id": ctx.season_id,
        "resolved_at": resolved_at,
        "enforce_paywall": false
    });
    prov_insert(
        &mut provenance,
        "resolve_context.project_id",
        entry_json(
            json!(ctx.project_id),
            ProvenanceSource::Episode,
            Some(scope_id("studio_episode", ctx.episode_id)),
            None,
        ),
    );
    prov_insert(
        &mut provenance,
        "resolve_context.enforce_paywall",
        entry_json(json!(false), ProvenanceSource::Default, None, None),
    );

    let labels = build_labels(&bundle.profile_layers, platform, &mut provenance);
    let hero = build_hero(&bundle.profile_layers, platform, &mut provenance);
    let watch_features = build_watch_features(&bundle.profile_layers, platform, &mut provenance);
    let monetization = build_monetization(&bundle.profile_layers, platform, &mut provenance);

    let layout = build_layout(bundle, &mut provenance);
    let theme = build_theme(bundle, &mut provenance);
    let visibility_panels =
        build_visibility_panels(&layout["definition"], &bundle.profile_layers, &mut provenance);

    let visibility = json!({
        "hero": hero,
        "panels": visibility_panels
    });

    let metadata = build_metadata(&bundle.metadata)?;
    for (key, _) in metadata.as_object().unwrap_or(&Map::new()) {
        let path = format!("metadata.{key}");
        prov_insert(
            &mut provenance,
            &path,
            entry_json(
                metadata[key].clone(),
                ProvenanceSource::Episode,
                Some(scope_id("studio_episode", ctx.episode_id)),
                None,
            ),
        );
    }

    let slots = build_slots(&bundle.slots);
    let experience_profile = build_experience_profile(bundle, &mut provenance);

    let mut root = json!({
        "schema_version": SCHEMA_VERSION,
        "resolve_context": resolve_context,
        "layout": layout,
        "theme": theme,
        "labels": labels,
        "metadata": metadata,
        "visibility": visibility,
        "campaigns": [],
        "slots": slots,
        "monetization_presentation": monetization,
        "watch_features": watch_features,
        "provenance": Value::Object(provenance),
    });

    if let Some(ep) = experience_profile {
        root["experience_profile"] = ep;
    }

    Ok(root)
}

fn build_labels(
    layers: &[ProfileLayer],
    platform: &PlatformExperienceDefaultsRow,
    provenance: &mut Map<String, Value>,
) -> Value {
    let (episode_label, ep_src) = {
        let layers_vals = profile_string_layers(layers, |r| &r.episode_label);
        if let Some(v) = merge_optional_string(&layers_vals) {
            (v, label_source_from_layers(&layers_vals, layers))
        } else if !platform.episode_label.is_empty() {
            (
                platform.episode_label.clone(),
                (ProvenanceSource::Platform, None, None),
            )
        } else {
            (
                "Episode".to_string(),
                (ProvenanceSource::Default, None, None),
            )
        }
    };

    let project_label = merge_optional_string(&profile_string_layers(layers, |r| &r.project_label))
        .unwrap_or_else(|| platform.project_label.clone());
    let series_label = merge_optional_string(&profile_string_layers(layers, |r| &r.series_label))
        .unwrap_or_else(|| platform.series_label.clone());
    let season_label = merge_optional_string(&profile_string_layers(layers, |r| &r.season_label))
        .unwrap_or_else(|| platform.season_label.clone());
    let vip_label = merge_optional_string(&profile_string_layers(layers, |r| &r.vip_label))
        .unwrap_or_else(|| platform.vip_label.clone());
    let trailer_label = merge_optional_string(&profile_string_layers(layers, |r| &r.trailer_label))
        .unwrap_or_else(|| platform.trailer_label.clone());
    let bonus_content_label =
        merge_optional_string(&profile_string_layers(layers, |r| &r.bonus_content_label))
            .unwrap_or_else(|| platform.bonus_content_label.clone());

    prov_insert(
        provenance,
        "labels.episode_label",
        entry_json(
            json!(episode_label),
            ep_src.0,
            ep_src.1,
            ep_src.2,
        ),
    );

    json!({
        "project_label": project_label,
        "series_label": series_label,
        "season_label": season_label,
        "episode_label": episode_label,
        "vip_label": vip_label,
        "trailer_label": trailer_label,
        "bonus_content_label": bonus_content_label,
    })
}

fn label_source_from_layers(
    layers_vals: &[Option<String>],
    layers: &[ProfileLayer],
) -> (ProvenanceSource, Option<String>, Option<Uuid>) {
    for (i, val) in layers_vals.iter().enumerate().rev() {
        if val.is_some() {
            let layer = &layers[i];
            return (
                layer.source,
                Some(scope_id(
                    match layer.source {
                        ProvenanceSource::Project => "studio_project",
                        ProvenanceSource::Series => "studio_series",
                        ProvenanceSource::Season => "studio_season",
                        ProvenanceSource::Episode => "studio_episode",
                        _ => "studio",
                    },
                    layer.scope_id,
                )),
                layer.row.as_ref().map(|r| r.id),
            );
        }
    }
    (ProvenanceSource::Default, None, None)
}

fn profile_bool_layers(layers: &[ProfileLayer], field: ProfileBoolField) -> [Option<bool>; 4] {
    [
        layers
            .first()
            .and_then(|l| l.row.as_ref())
            .and_then(|r| field.get(r)),
        layers
            .get(1)
            .and_then(|l| l.row.as_ref())
            .and_then(|r| field.get(r)),
        layers
            .get(2)
            .and_then(|l| l.row.as_ref())
            .and_then(|r| field.get(r)),
        layers
            .get(3)
            .and_then(|l| l.row.as_ref())
            .and_then(|r| field.get(r)),
    ]
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
enum ProfileBoolField {
    HeroEnabled,
    ContinueWatching,
    Recommendations,
    Downloads,
    Comments,
    ContinueWatchingPanel,
    RecommendationsPanel,
    ArtistPanel,
    Credits,
    DownloadsPanel,
    CommentsPanel,
    CastPanel,
    Trivia,
    Timeline,
}

impl ProfileBoolField {
    fn get(self, r: &ProfileVersionRow) -> Option<bool> {
        match self {
            Self::HeroEnabled => r.hero_enabled,
            Self::ContinueWatching => r.continue_watching_enabled,
            Self::Recommendations => r.recommendations_enabled,
            Self::Downloads => r.downloads_enabled,
            Self::Comments => r.comments_enabled,
            Self::ContinueWatchingPanel => r.continue_watching_enabled,
            Self::RecommendationsPanel => r.recommendations_enabled,
            Self::ArtistPanel => r.artist_panel_enabled,
            Self::Credits => r.credits_enabled,
            Self::DownloadsPanel => r.downloads_enabled,
            Self::CommentsPanel => r.comments_enabled,
            Self::CastPanel => r.cast_panel_enabled,
            Self::Trivia => r.trivia_enabled,
            Self::Timeline => r.timeline_enabled,
        }
    }

    fn platform(self, p: &PlatformExperienceDefaultsRow) -> bool {
        match self {
            Self::HeroEnabled => p.hero_enabled,
            Self::ContinueWatching | Self::ContinueWatchingPanel => p.continue_watching_enabled,
            Self::Recommendations | Self::RecommendationsPanel => p.recommendations_enabled,
            Self::Downloads | Self::DownloadsPanel => p.downloads_enabled,
            Self::Comments | Self::CommentsPanel => p.comments_enabled,
            Self::ArtistPanel => p.artist_panel_enabled,
            Self::Credits => p.credits_enabled,
            Self::CastPanel => p.cast_panel_enabled,
            Self::Trivia => p.trivia_enabled,
            Self::Timeline => p.timeline_enabled,
        }
    }
}

fn merge_bool_from_profile_or_platform(
    layers: &[ProfileLayer],
    field: ProfileBoolField,
    platform: &PlatformExperienceDefaultsRow,
) -> bool {
    let vals = profile_bool_layers(layers, field);
    merge_optional_bool(&vals).unwrap_or_else(|| field.platform(platform))
}

fn profile_string_layers(
    layers: &[ProfileLayer],
    field: fn(&ProfileVersionRow) -> &Option<String>,
) -> [Option<String>; 4] {
    [
        layers
            .first()
            .and_then(|l| l.row.as_ref())
            .and_then(|r| field(r).clone()),
        layers
            .get(1)
            .and_then(|l| l.row.as_ref())
            .and_then(|r| field(r).clone()),
        layers
            .get(2)
            .and_then(|l| l.row.as_ref())
            .and_then(|r| field(r).clone()),
        layers
            .get(3)
            .and_then(|l| l.row.as_ref())
            .and_then(|r| field(r).clone()),
    ]
}

fn build_hero(
    layers: &[ProfileLayer],
    platform: &PlatformExperienceDefaultsRow,
    provenance: &mut Map<String, Value>,
) -> Value {
    let enabled = merge_bool_from_profile_or_platform(layers, ProfileBoolField::HeroEnabled, platform);
    let mode_layers = profile_string_layers(layers, |r| &r.hero_mode);
    let mode = merge_optional_string(&mode_layers).unwrap_or_else(|| platform.hero_mode.clone());
    let autoplay_vals = [
        layers.first().and_then(|l| l.row.as_ref().and_then(|r| r.hero_autoplay)),
        layers.get(1).and_then(|l| l.row.as_ref().and_then(|r| r.hero_autoplay)),
        layers.get(2).and_then(|l| l.row.as_ref().and_then(|r| r.hero_autoplay)),
        layers.get(3).and_then(|l| l.row.as_ref().and_then(|r| r.hero_autoplay)),
    ];
    let autoplay = merge_optional_bool(&autoplay_vals).unwrap_or(platform.hero_autoplay);

    let interval_vals = [
        layers.first().and_then(|l| l.row.as_ref().and_then(|r| r.hero_carousel_interval)),
        layers.get(1).and_then(|l| l.row.as_ref().and_then(|r| r.hero_carousel_interval)),
        layers.get(2).and_then(|l| l.row.as_ref().and_then(|r| r.hero_carousel_interval)),
        layers.get(3).and_then(|l| l.row.as_ref().and_then(|r| r.hero_carousel_interval)),
    ];
    let interval = merge_optional_int(&interval_vals)
        .unwrap_or(platform.hero_carousel_interval)
        .clamp(3, 120);

    let overlay_vals = [
        layers.first().and_then(|l| l.row.as_ref().and_then(|r| r.hero_overlay_enabled)),
        layers.get(1).and_then(|l| l.row.as_ref().and_then(|r| r.hero_overlay_enabled)),
        layers.get(2).and_then(|l| l.row.as_ref().and_then(|r| r.hero_overlay_enabled)),
        layers.get(3).and_then(|l| l.row.as_ref().and_then(|r| r.hero_overlay_enabled)),
    ];
    let overlay = merge_optional_bool(&overlay_vals).unwrap_or(platform.hero_overlay_enabled);

    prov_insert(
        provenance,
        "visibility.hero.enabled",
        entry_json(
            json!(enabled),
            if merge_optional_bool(&profile_bool_layers(layers, ProfileBoolField::HeroEnabled)).is_some() {
                ProvenanceSource::Profile
            } else {
                ProvenanceSource::Platform
            },
            None,
            None,
        ),
    );
    prov_insert(
        provenance,
        "visibility.hero.mode",
        entry_json(
            json!(mode),
            if merge_optional_string(&mode_layers).is_some() {
                ProvenanceSource::Profile
            } else {
                ProvenanceSource::Platform
            },
            None,
            None,
        ),
    );

    json!({
        "enabled": enabled,
        "mode": mode,
        "autoplay": autoplay,
        "carousel_interval_seconds": interval,
        "overlay_enabled": overlay
    })
}

fn merge_optional_int(layers: &[Option<i32>]) -> Option<i32> {
    layers.iter().rev().find_map(|v| *v)
}

fn build_watch_features(
    layers: &[ProfileLayer],
    platform: &PlatformExperienceDefaultsRow,
    provenance: &mut Map<String, Value>,
) -> Value {
    let cw = merge_bool_from_profile_or_platform(layers, ProfileBoolField::ContinueWatching, platform);
    let rec = merge_bool_from_profile_or_platform(layers, ProfileBoolField::Recommendations, platform);
    let dl = merge_bool_from_profile_or_platform(layers, ProfileBoolField::Downloads, platform);
    let cm = merge_bool_from_profile_or_platform(layers, ProfileBoolField::Comments, platform);

    prov_insert(
        provenance,
        "watch_features.continue_watching_enabled",
        entry_json(json!(cw), ProvenanceSource::Platform, None, None),
    );

    json!({
        "continue_watching_enabled": cw,
        "recommendations_enabled": rec,
        "downloads_enabled": dl,
        "comments_enabled": cm
    })
}

fn build_monetization(
    layers: &[ProfileLayer],
    platform: &PlatformExperienceDefaultsRow,
    _provenance: &mut Map<String, Value>,
) -> Value {
    let paywall = merge_optional_string(&profile_string_layers(layers, |r| &r.paywall_style));
    let access = merge_optional_string(&profile_string_layers(layers, |r| &r.access_style));
    let cta = merge_optional_string(&profile_string_layers(layers, |r| &r.cta_style));

    json!({
        "paywall_style": paywall.or(platform.paywall_style.clone()),
        "access_style": access.or(platform.access_style.clone()),
        "cta_style": cta.or(platform.cta_style.clone()),
        "premium_cta_style": platform.premium_cta_style
    })
}

fn build_layout(bundle: &ResolveLoadBundle, provenance: &mut Map<String, Value>) -> Value {
    let preset_key = &bundle.layout.preset_key;
    let source = if bundle
        .winning_profile
        .as_ref()
        .and_then(|p| p.layout_preset_id)
        .is_some()
    {
        ProvenanceSource::Profile
    } else if bundle.platform.default_layout_preset_id.is_some() {
        ProvenanceSource::Platform
    } else {
        ProvenanceSource::Default
    };

    prov_insert(
        provenance,
        "layout.preset_key",
        entry_json(json!(preset_key), source, None, None),
    );

    json!({
        "preset_key": preset_key,
        "preset_name": bundle.layout.name,
        "definition": bundle.layout.definition
    })
}

fn build_theme(bundle: &ResolveLoadBundle, _provenance: &mut Map<String, Value>) -> Value {
    let token_set_id = bundle
        .winning_profile
        .as_ref()
        .and_then(|p| p.theme_token_set_id)
        .or(bundle.platform.default_theme_token_set_id);

    let slug = bundle
        .theme_set
        .as_ref()
        .map(|s| s.slug.clone())
        .unwrap_or_else(|| "default-reelforge".to_string());

    json!({
        "token_set_id": token_set_id,
        "token_set_slug": slug,
        "tokens": bundle.theme_tokens
    })
}

fn panel_profile_flag(panel_id: &str, row: &ProfileVersionRow) -> Option<bool> {
    match panel_id {
        "continue_watching" => row.continue_watching_enabled,
        "recommendations" => row.recommendations_enabled,
        "artist_panel" => row.artist_panel_enabled,
        "credits" => row.credits_enabled,
        "downloads" => row.downloads_enabled,
        "comments" => row.comments_enabled,
        "cast_panel" => row.cast_panel_enabled,
        "trivia" => row.trivia_enabled,
        "timeline" => row.timeline_enabled,
        _ => None,
    }
}

fn merged_panel_enabled(layers: &[ProfileLayer], panel_id: &str) -> Option<bool> {
    let vals: [Option<bool>; 4] = [
        layers
            .first()
            .and_then(|l| l.row.as_ref().and_then(|r| panel_profile_flag(panel_id, r))),
        layers
            .get(1)
            .and_then(|l| l.row.as_ref().and_then(|r| panel_profile_flag(panel_id, r))),
        layers
            .get(2)
            .and_then(|l| l.row.as_ref().and_then(|r| panel_profile_flag(panel_id, r))),
        layers
            .get(3)
            .and_then(|l| l.row.as_ref().and_then(|r| panel_profile_flag(panel_id, r))),
    ];
    merge_optional_bool(&vals)
}

fn build_visibility_panels(
    definition: &Value,
    layers: &[ProfileLayer],
    _provenance: &mut Map<String, Value>,
) -> Value {
    let panels_def = definition
        .get("panels")
        .and_then(|p| p.as_object())
        .cloned()
        .unwrap_or_default();

    let mut out = Map::new();
    for (panel_id, panel_def) in panels_def {
        let baseline = panel_def.get("visible").and_then(|v| v.as_bool()).unwrap_or(true);
        let zone = panel_def
            .get("zone")
            .and_then(|z| z.as_str())
            .map(|s| s.to_string());
        let profile_enabled = merged_panel_enabled(layers, &panel_id);
        let effective = baseline && profile_enabled.unwrap_or(true);
        let disabled_by = if effective {
            Value::Null
        } else if !baseline {
            json!("preset")
        } else {
            json!("profile")
        };

        let mut panel = json!({
            "effective_visible": effective,
            "baseline_visible": baseline,
            "profile_enabled": profile_enabled,
            "disabled_by": disabled_by
        });
        if let Some(z) = zone {
            panel["zone"] = json!(z);
        }
        out.insert(panel_id, panel);
    }

    if out.is_empty() {
        out.insert(
            "hero".into(),
            json!({
                "effective_visible": true,
                "baseline_visible": true,
                "profile_enabled": null,
                "zone": "top"
            }),
        );
    }

    Value::Object(out)
}

fn build_metadata(raw: &std::collections::HashMap<String, Value>) -> Result<Value, ResolveError> {
    let mut out = Map::new();
    for (key, value) in raw {
        validate_metadata_key(key).map_err(|e| match e {
            RveValidationError::ReservedMetadataKey(k) => ResolveError::Validation {
                codes: vec!["NC-104".into()],
                fields: vec![format!("metadata.{k}")],
            },
            RveValidationError::Invalid(v) => ResolveError::Validation {
                codes: vec!["NC-104".into()],
                fields: v,
            },
        })?;
        out.insert(key.clone(), value.clone());
    }
    Ok(Value::Object(out))
}

fn build_slots(rows: &[SlotAssignmentRow]) -> Value {
    let mut seen: std::collections::HashMap<(String, String, Option<Uuid>), Value> =
        std::collections::HashMap::new();

    for row in rows {
        let key = (
            row.slot_key.clone(),
            row.scope_type.clone(),
            row.scope_id,
        );
        let slot = json!({
            "slot_key": row.slot_key,
            "campaign_id": row.campaign_id,
            "scope_type": row.scope_type,
            "scope_id": row.scope_id,
            "status": row.status,
            "content_ref": row.content_ref,
            "zone_hint": row.zone_hint
        });
        seen.insert(key, slot);
    }

    Value::Array(seen.into_values().collect())
}

fn build_experience_profile(
    bundle: &ResolveLoadBundle,
    provenance: &mut Map<String, Value>,
) -> Option<Value> {
    let att = winning_attachment(&bundle.hierarchy);
    let profile = bundle.winning_profile.as_ref()?;
    if att.profile_family_id.is_none() {
        return None;
    }

    let status = if profile.status == "ACTIVE" || profile.status == "ARCHIVED" {
        profile.status.clone()
    } else {
        return None;
    };

    prov_insert(
        provenance,
        "experience_profile.profile_version_id",
        entry_json(
            json!(profile.id),
            ProvenanceSource::Profile,
            None,
            Some(profile.id),
        ),
    );
    prov_insert(
        provenance,
        "experience_profile.content_format",
        entry_json(
            json!(profile.content_format),
            ProvenanceSource::Profile,
            None,
            Some(profile.id),
        ),
    );

    let mut section = json!({
        "profile_family_id": profile.profile_family_id,
        "profile_version_id": profile.id,
        "profile_version": profile.version,
        "content_format": profile.content_format,
        "pin_version": att.pin_version,
        "status": status
    });

    if let Some(fam) = &bundle.winning_family {
        section["profile_family_name"] = json!(fam.name);
    }

    Some(section)
}
