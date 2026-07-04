//! End-to-end composition pipeline wiring (Phase 1b.5).

use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::media::apply_media_semantic_stub;
use crate::viewer_sim::simulate_viewer;

use super::cspp::{self, composition_plan};
use super::experience_resolve::{self, ResolveError};

/// Artifacts emitted by each pipeline stage.
#[derive(Debug, Clone)]
pub struct PipelineArtifacts {
    pub base_rve: Value,
    pub delivered_rve: Value,
    pub delivered_with_media: Value,
    pub composition_plan: composition_plan::CompositionPlan,
}

/// Run full pipeline: resolver → CSPP → media → viewer_sim.
pub async fn run(pool: &PgPool, episode_id: Uuid) -> Result<PipelineArtifacts, ResolveError> {
    let base_rve = experience_resolve::resolve_base_rve(pool, episode_id).await?;
    let delivered_rve = cspp::enrich_with_pool(base_rve.clone(), Some(pool)).await;
    Ok(finish_pipeline(base_rve, delivered_rve))
}

/// Run pipeline stages after Base RVE (harness / fixture path).
pub fn run_from_base_rve(base_rve: Value) -> PipelineArtifacts {
    let delivered_rve = cspp::enrich(base_rve.clone());
    finish_pipeline(base_rve, delivered_rve)
}

fn finish_pipeline(base_rve: Value, delivered_rve: Value) -> PipelineArtifacts {
    let delivered_with_media = apply_media_semantic_stub(delivered_rve.clone());
    let composition_plan = simulate_viewer(&base_rve, &delivered_with_media);

    PipelineArtifacts {
        base_rve,
        delivered_rve,
        delivered_with_media,
        composition_plan,
    }
}
