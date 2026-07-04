//! Render tree struct definitions and mechanical builders (Phase 1b.5).

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Render tree — structural mapping only, no pixel rendering.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RenderTree {
    pub nodes: Vec<RenderNode>,
}

/// Single render node bound to a surface or slot zone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderNode {
    pub surface_id: String,
    pub zone_hint: Option<String>,
    pub slot_key: Option<String>,
    pub campaign_id: Option<String>,
}

impl RenderTree {
    pub fn from_mapping(nodes: Vec<RenderNode>) -> Self {
        Self { nodes }
    }
}

/// Map admitted surfaces and active slots to render nodes (no merge logic).
pub fn build_render_tree(base_rve: &Value, delivered_rve: &Value) -> RenderTree {
    let mut nodes = Vec::new();

    if admit_hero(base_rve) {
        nodes.push(RenderNode {
            surface_id: "HERO".into(),
            zone_hint: layout_zone(base_rve, "hero"),
            slot_key: None,
            campaign_id: None,
        });
    }

    if admit_theater(base_rve) {
        nodes.push(RenderNode {
            surface_id: "THEATER".into(),
            zone_hint: layout_zone(base_rve, "theater"),
            slot_key: None,
            campaign_id: None,
        });
    }

    if admit_continue_watching(base_rve) {
        nodes.push(RenderNode {
            surface_id: "CONTINUE_WATCHING".into(),
            zone_hint: panel_zone(base_rve, "continue_watching"),
            slot_key: None,
            campaign_id: None,
        });
    }

    if admit_card_shelf(base_rve) {
        nodes.push(RenderNode {
            surface_id: "CARD".into(),
            zone_hint: None,
            slot_key: None,
            campaign_id: None,
        });
    }

    if let Some(slots) = delivered_rve.get("slots").and_then(|s| s.as_array()) {
        for slot in slots {
            let status = slot.get("status").and_then(|s| s.as_str()).unwrap_or("");
            if status != "active" {
                continue;
            }
            let slot_key = slot
                .get("slot_key")
                .and_then(|k| k.as_str())
                .unwrap_or("")
                .to_string();
            let surface_id = slot_key_to_surface(&slot_key);
            if !surface_visible(base_rve, &surface_id) {
                continue;
            }
            nodes.push(RenderNode {
                surface_id,
                zone_hint: slot
                    .get("zone_hint")
                    .and_then(|z| z.as_str())
                    .map(str::to_string),
                slot_key: Some(slot_key),
                campaign_id: slot
                    .get("campaign_id")
                    .and_then(|c| c.as_str())
                    .map(str::to_string),
            });
        }
    }

    RenderTree::from_mapping(nodes)
}

pub fn admitted_surfaces(base_rve: &Value) -> Vec<String> {
    let mut surfaces = Vec::new();
    if admit_hero(base_rve) {
        surfaces.push("HERO".into());
    }
    if admit_theater(base_rve) {
        surfaces.push("THEATER".into());
    }
    if admit_continue_watching(base_rve) {
        surfaces.push("CONTINUE_WATCHING".into());
    }
    if admit_card_shelf(base_rve) {
        surfaces.push("CARD".into());
    }
    surfaces
}

fn admit_hero(base: &Value) -> bool {
    panel_visible(base, "hero")
        && base
            .get("visibility")
            .and_then(|v| v.get("hero"))
            .and_then(|h| h.get("enabled"))
            .and_then(|e| e.as_bool())
            .unwrap_or(false)
        && base
            .get("visibility")
            .and_then(|v| v.get("hero"))
            .and_then(|h| h.get("mode"))
            .and_then(|m| m.as_str())
            .map(|m| m != "OFF")
            .unwrap_or(false)
}

fn admit_theater(base: &Value) -> bool {
    panel_visible(base, "theater")
}

fn admit_continue_watching(base: &Value) -> bool {
    panel_visible(base, "continue_watching")
        && base
            .get("watch_features")
            .and_then(|w| w.get("continue_watching_enabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
}

fn admit_card_shelf(base: &Value) -> bool {
    base.get("layout")
        .and_then(|l| l.get("definition"))
        .and_then(|d| d.get("shelf_order"))
        .and_then(|s| s.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false)
        || panel_visible(base, "vault")
        || panel_visible(base, "shelf")
}

fn panel_visible(base: &Value, panel_id: &str) -> bool {
    base.get("visibility")
        .and_then(|v| v.get("panels"))
        .and_then(|p| p.get(panel_id))
        .and_then(|panel| panel.get("effective_visible"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn surface_visible(base: &Value, surface_id: &str) -> bool {
    match surface_id {
        "HERO" => admit_hero(base),
        "THEATER" => admit_theater(base),
        "CONTINUE_WATCHING" => admit_continue_watching(base),
        "CARD" => admit_card_shelf(base),
        _ => false,
    }
}

fn slot_key_to_surface(slot_key: &str) -> String {
    match slot_key {
        "hero_promo" => "HERO".into(),
        "theater_overlay" => "THEATER".into(),
        "shelf_featured" | "shelf_badge" => "CARD".into(),
        key if key.starts_with("custom.") => "CARD".into(),
        _ => "CARD".into(),
    }
}

fn layout_zone(base: &Value, panel: &str) -> Option<String> {
    base.get("layout")
        .and_then(|l| l.get("definition"))
        .and_then(|d| d.get("panels"))
        .and_then(|p| p.get(panel))
        .and_then(|panel| panel.get("zone"))
        .and_then(|z| z.as_str())
        .map(str::to_string)
}

fn panel_zone(base: &Value, panel: &str) -> Option<String> {
    layout_zone(base, panel)
}
