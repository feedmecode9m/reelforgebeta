//! Deterministic asset state evolution for tests only (Phase 1c.4).

use uuid::Uuid;

use super::types::{AssetInventoryRecord, AssetSource, AssetState, AssetType};

/// Harness episode id (aligned with pipeline integration vectors).
pub const HARNESS_EPISODE_ID: &str = "a1000000-0000-4000-8000-000000000001";

/// Primary video asset used across lifecycle scenarios.
pub const PRIMARY_VIDEO_ASSET_ID: &str = "f1000000-0000-4000-8000-000000000101";

/// Secondary video in batch / collision scenarios.
pub const SECONDARY_VIDEO_ASSET_ID: &str = "f4000000-0000-4000-8000-000000000402";

/// Thumbnail image asset (optional READY companion in harness snapshot).
pub const THUMB_ASSET_ID: &str = "f2000000-0000-4000-8000-000000000201";

/// One replayable inventory snapshot in a scenario timeline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioStep {
    pub label: &'static str,
    pub inventory: Vec<AssetInventoryRecord>,
}

/// In-memory, deterministic sequence of catalog snapshots (no I/O).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetScenarioFeed {
    pub scenario_id: &'static str,
    steps: Vec<ScenarioStep>,
}

impl AssetScenarioFeed {
    pub fn step_count(&self) -> usize {
        self.steps.len()
    }

    pub fn step(&self, index: usize) -> &ScenarioStep {
        &self.steps[index]
    }

    pub fn inventory_at(&self, index: usize) -> &[AssetInventoryRecord] {
        &self.steps[index].inventory
    }

    pub fn labels(&self) -> Vec<&'static str> {
        self.steps.iter().map(|s| s.label).collect()
    }

    /// Replay steps in order (deterministic iteration).
    pub fn replay(&self) -> impl Iterator<Item = (usize, &ScenarioStep)> {
        self.steps.iter().enumerate()
    }

    /// `MISSING → PROCESSING → READY → FAILED` on a single primary video.
    pub fn upload_lifecycle_scenario() -> Self {
        let episode = harness_episode();
        let primary = primary_video_asset();
        Self {
            scenario_id: "upload_lifecycle_scenario",
            steps: vec![
                ScenarioStep {
                    label: "missing",
                    inventory: vec![],
                },
                ScenarioStep {
                    label: "processing",
                    inventory: vec![video_record(
                        primary,
                        AssetState::Processing,
                        episode,
                        AssetSource::Upload,
                    )],
                },
                ScenarioStep {
                    label: "ready",
                    inventory: vec![
                        video_record_with_thumb(
                            primary,
                            AssetState::Ready,
                            episode,
                            AssetSource::Upload,
                            Some(Uuid::parse_str(THUMB_ASSET_ID).unwrap()),
                        ),
                        AssetInventoryRecord {
                            asset_id: Uuid::parse_str(THUMB_ASSET_ID).unwrap(),
                            asset_type: AssetType::Image,
                            asset_state: AssetState::Ready,
                            asset_source: AssetSource::Generated,
                            thumbnail_asset_id: None,
                            scope_episode_id: None,
                            scope_reel_id: None,
                        },
                    ],
                },
                ScenarioStep {
                    label: "failed",
                    inventory: vec![video_record(
                        primary,
                        AssetState::Failed,
                        episode,
                        AssetSource::Upload,
                    )],
                },
            ],
        }
    }

    /// Stays in `PROCESSING` across consecutive steps before `READY`.
    pub fn delayed_encoding_scenario() -> Self {
        let episode = harness_episode();
        let primary = primary_video_asset();
        let processing = video_record(
            primary,
            AssetState::Processing,
            episode,
            AssetSource::Ingest,
        );
        Self {
            scenario_id: "delayed_encoding_scenario",
            steps: vec![
                ScenarioStep {
                    label: "missing",
                    inventory: vec![],
                },
                ScenarioStep {
                    label: "encoding_pass_1",
                    inventory: vec![processing.clone()],
                },
                ScenarioStep {
                    label: "encoding_pass_2",
                    inventory: vec![processing],
                },
                ScenarioStep {
                    label: "ready",
                    inventory: vec![video_record(
                        primary,
                        AssetState::Ready,
                        episode,
                        AssetSource::Ingest,
                    )],
                },
            ],
        }
    }

    /// Two scoped videos: both processing, then mixed outcomes, then all failed.
    pub fn partial_failure_batch_scenario() -> Self {
        let episode = harness_episode();
        let primary = primary_video_asset();
        let secondary = secondary_video_asset();
        Self {
            scenario_id: "partial_failure_batch_scenario",
            steps: vec![
                ScenarioStep {
                    label: "batch_processing",
                    inventory: vec![
                        video_record(
                            primary,
                            AssetState::Processing,
                            episode,
                            AssetSource::Ingest,
                        ),
                        video_record(
                            secondary,
                            AssetState::Processing,
                            episode,
                            AssetSource::Ingest,
                        ),
                    ],
                },
                ScenarioStep {
                    label: "partial_ready_partial_failed",
                    inventory: vec![
                        video_record(
                            primary,
                            AssetState::Ready,
                            episode,
                            AssetSource::Ingest,
                        ),
                        video_record(
                            secondary,
                            AssetState::Failed,
                            episode,
                            AssetSource::Ingest,
                        ),
                    ],
                },
                ScenarioStep {
                    label: "batch_failed",
                    inventory: vec![
                        video_record(
                            primary,
                            AssetState::Failed,
                            episode,
                            AssetSource::Ingest,
                        ),
                        video_record(
                            secondary,
                            AssetState::Failed,
                            episode,
                            AssetSource::Ingest,
                        ),
                    ],
                },
            ],
        }
    }

    /// Static multi-record snapshot (Phase 1c.3 `harness()` compatibility).
    pub fn harness_snapshot_scenario() -> Self {
        let episode = harness_episode();
        Self {
            scenario_id: "harness_snapshot",
            steps: vec![ScenarioStep {
                label: "harness_static",
                inventory: vec![
                    video_record(
                        primary_video_asset(),
                        AssetState::Ready,
                        episode,
                        AssetSource::Ingest,
                    ),
                    video_record(
                        Uuid::parse_str("f3000000-0000-4000-8000-000000000301").unwrap(),
                        AssetState::Processing,
                        episode,
                        AssetSource::Ingest,
                    ),
                    video_record(
                        secondary_video_asset(),
                        AssetState::Failed,
                        episode,
                        AssetSource::Ingest,
                    ),
                    AssetInventoryRecord {
                        asset_id: Uuid::parse_str(THUMB_ASSET_ID).unwrap(),
                        asset_type: AssetType::Image,
                        asset_state: AssetState::Ready,
                        asset_source: AssetSource::Generated,
                        thumbnail_asset_id: None,
                        scope_episode_id: None,
                        scope_reel_id: None,
                    },
                ],
            }],
        }
    }
}

fn harness_episode() -> Uuid {
    Uuid::parse_str(HARNESS_EPISODE_ID).unwrap()
}

fn primary_video_asset() -> Uuid {
    Uuid::parse_str(PRIMARY_VIDEO_ASSET_ID).unwrap()
}

fn secondary_video_asset() -> Uuid {
    Uuid::parse_str(SECONDARY_VIDEO_ASSET_ID).unwrap()
}

fn video_record(
    asset_id: Uuid,
    asset_state: AssetState,
    scope_episode_id: Uuid,
    asset_source: AssetSource,
) -> AssetInventoryRecord {
    video_record_with_thumb(asset_id, asset_state, scope_episode_id, asset_source, None)
}

fn video_record_with_thumb(
    asset_id: Uuid,
    asset_state: AssetState,
    scope_episode_id: Uuid,
    asset_source: AssetSource,
    thumbnail_asset_id: Option<Uuid>,
) -> AssetInventoryRecord {
    AssetInventoryRecord {
        asset_id,
        asset_type: AssetType::Video,
        asset_state,
        asset_source,
        thumbnail_asset_id,
        scope_episode_id: Some(scope_episode_id),
        scope_reel_id: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scenario_feed_replay_is_deterministic() {
        let feed = AssetScenarioFeed::upload_lifecycle_scenario();
        let a: Vec<_> = feed
            .replay()
            .map(|(i, s)| (i, s.label, s.inventory.clone()))
            .collect();
        let b: Vec<_> = feed
            .replay()
            .map(|(i, s)| (i, s.label, s.inventory.clone()))
            .collect();
        assert_eq!(a, b);
    }

    #[test]
    fn delayed_encoding_has_stable_processing_steps() {
        let feed = AssetScenarioFeed::delayed_encoding_scenario();
        assert_eq!(feed.inventory_at(1), feed.inventory_at(2));
    }
}
