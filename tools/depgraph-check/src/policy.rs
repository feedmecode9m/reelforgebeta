use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct LayerEdge {
    pub from: String,
    pub to: String,
}

impl LayerEdge {
    pub fn parse(s: &str) -> Option<Self> {
        let (from, to) = s.split_once("->")?;
        Some(Self {
            from: from.trim().to_string(),
            to: to.trim().to_string(),
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyFile {
    pub version: String,
    pub crate_root: String,
    pub allowed_edges: Vec<String>,
    pub forbidden_edges: Vec<String>,
    pub test_only_paths: Vec<String>,
    pub path_layers: Vec<PathLayerRule>,
    pub exception_rules: Vec<ExceptionRule>,
    #[allow(dead_code)]
    pub boundary_types: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PathLayerRule {
    pub layer: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ExceptionRule {
    pub from: String,
    pub to: String,
    pub files: Vec<String>,
    pub reason: String,
}

pub struct Policy {
    pub version: String,
    pub crate_root: PathBuf,
    pub allowed: HashSet<LayerEdge>,
    pub forbidden: HashSet<LayerEdge>,
    pub test_only_paths: Vec<String>,
    pub path_layers: Vec<PathLayerRule>,
    pub exceptions: Vec<ExceptionRule>,
}

impl Policy {
    pub fn load(path: &Path) -> Result<Self, String> {
        let raw = std::fs::read_to_string(path)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        let file: PolicyFile =
            toml::from_str(&raw).map_err(|e| format!("parse policy TOML: {e}"))?;
        Ok(Self::from_file(file, path))
    }

    fn from_file(file: PolicyFile, policy_path: &Path) -> Self {
        let repo_root = policy_path
            .parent()
            .and_then(|p| p.parent())
            .unwrap_or_else(|| Path::new("."));
        let crate_root = repo_root.join(&file.crate_root);

        let allowed = file
            .allowed_edges
            .iter()
            .filter_map(|s| LayerEdge::parse(s))
            .collect();
        let forbidden = file
            .forbidden_edges
            .iter()
            .filter_map(|s| LayerEdge::parse(s))
            .collect();

        Self {
            version: file.version,
            crate_root,
            allowed,
            forbidden,
            test_only_paths: file.test_only_paths,
            path_layers: file.path_layers,
            exceptions: file.exception_rules,
        }
    }

    pub fn layer_for_file(&self, rel: &str) -> Option<String> {
        let norm = rel.replace('\\', "/");
        for rule in &self.path_layers {
            for prefix in &rule.paths {
                if norm == *prefix || norm.starts_with(prefix) {
                    return Some(rule.layer.clone());
                }
            }
        }
        None
    }

    pub fn is_test_only_file(&self, rel: &str) -> bool {
        let norm = rel.replace('\\', "/");
        self.test_only_paths
            .iter()
            .any(|p| norm.contains(p.trim_start_matches('/')))
    }

    pub fn is_exception(&self, from: &str, to: &str, rel: &str) -> Option<&str> {
        let norm = rel.replace('\\', "/");
        for ex in &self.exceptions {
            if ex.from == from && ex.to == to && ex.files.iter().any(|f| norm.ends_with(f)) {
                return Some(ex.reason.as_str());
            }
        }
        None
    }

    pub fn layer_for_crate_path(&self, segments: &[&str]) -> Option<String> {
        if segments.is_empty() {
            return None;
        }
        let rel = match segments[0] {
            "experience" => segments.join("/"),
            "media" => segments.join("/"),
            "viewer_sim" => segments.join("/"),
            "asset_resolution" => segments.join("/"),
            "ingestion" => segments.join("/"),
            _ => return None,
        };
        self.layer_for_file(&rel)
    }

    pub fn rule_description(&self, edge: &LayerEdge) -> String {
        let descriptions: HashMap<(&str, &str), &str> = HashMap::from([
            (
                ("resolver", "asset_resolution"),
                "Resolver must not access Asset Layer (RES-5 / INV-AS-4)",
            ),
            (
                ("resolver", "ingestion"),
                "Resolver must not access ingestion (INV-ING-1)",
            ),
            (
                ("cspp", "asset_resolution"),
                "CSPP must not access Asset Layer (CSPP-6)",
            ),
            (
                ("media_semantic", "asset_resolution"),
                "Media semantic must not access adapter or catalog (MED-5)",
            ),
            (
                ("viewer_sim", "cspp"),
                "Viewer must not influence upstream semantic layers (VIEW-2 / FEP-9)",
            ),
            (
                ("asset_resolution", "resolver"),
                "Adapter must not call resolver (INV-ADP-4)",
            ),
            (
                ("ingestion", "resolver"),
                "Ingestion is external to semantic pipeline (FEP-1)",
            ),
            (
                ("scenario", "resolver"),
                "Scenario system is test-only (INV-SCN-2)",
            ),
            (
                ("resolver", "scenario"),
                "Production code must not import scenario_feed or mock_registry",
            ),
        ]);
        descriptions
            .get(&(edge.from.as_str(), edge.to.as_str()))
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                format!(
                    "Forbidden cross-layer dependency: {} → {}",
                    edge.from, edge.to
                )
            })
    }

    pub fn fix_hint(&self, edge: &LayerEdge) -> String {
        match (edge.from.as_str(), edge.to.as_str()) {
            ("cspp", "asset_resolution") | ("media_semantic", "asset_resolution") => {
                "Move logic to AssetResolutionAdapter; pass via SemanticMediaBinding only".into()
            }
            ("ingestion", "resolver")
            | ("ingestion", "cspp")
            | ("ingestion", "media_semantic")
            | ("ingestion", "viewer_sim") => {
                "Emit catalog events only; never call compose_pipeline or experience_resolve".into()
            }
            ("asset_resolution", "resolver")
            | ("asset_resolution", "cspp")
            | ("asset_resolution", "media_semantic") => {
                "Adapter is read-time only; return binding types without calling pipeline modules".into()
            }
            ("resolver", "scenario") | ("cspp", "scenario") | ("orchestrator", "scenario") => {
                "Import scenario_feed only from #[cfg(test)] modules".into()
            }
            ("viewer_sim", "cspp") => {
                "Use boundary types only, or add a documented exception_rules entry".into()
            }
            _ => "Remove the import or request a formal architecture amendment (PHASE_1C7 §6.3)".into(),
        }
    }
}
