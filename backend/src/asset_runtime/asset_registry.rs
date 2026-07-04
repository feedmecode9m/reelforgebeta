//! Minimal in-memory asset registry for viewer bind-time validation (runtime slice).

use std::collections::HashMap;

/// Runtime catalog row (not RVE; not semantic metadata).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetRecord {
    pub asset_id: String,
    pub asset_type: String,
    pub asset_state: String,
}

/// Read-only asset lookup at bind time.
pub trait AssetRegistry {
    fn get_asset(&self, asset_id: &str) -> Option<AssetRecord>;
}

/// Deterministic hardcoded dataset for tests and local validation only.
#[derive(Debug, Clone, Default)]
pub struct InMemoryAssetRegistry {
    by_id: HashMap<String, AssetRecord>,
}

impl InMemoryAssetRegistry {
    pub fn harness_dataset() -> Self {
        let records = vec![
            AssetRecord {
                asset_id: "f1000000-0000-4000-8000-000000000101".into(),
                asset_type: "video".into(),
                asset_state: "READY".into(),
            },
            AssetRecord {
                asset_id: "f3000000-0000-4000-8000-000000000301".into(),
                asset_type: "video".into(),
                asset_state: "PROCESSING".into(),
            },
            AssetRecord {
                asset_id: "f4000000-0000-4000-8000-000000000401".into(),
                asset_type: "video".into(),
                asset_state: "FAILED".into(),
            },
            AssetRecord {
                asset_id: "f2000000-0000-4000-8000-000000000201".into(),
                asset_type: "image".into(),
                asset_state: "READY".into(),
            },
            AssetRecord {
                asset_id: "00000000-0000-4000-8000-000000009999".into(),
                asset_type: "video".into(),
                asset_state: "READY".into(),
            },
        ];
        Self::from_records(records)
    }

    pub fn from_records(records: Vec<AssetRecord>) -> Self {
        let by_id = records
            .into_iter()
            .map(|r| (r.asset_id.clone(), r))
            .collect();
        Self { by_id }
    }
}

impl AssetRegistry for InMemoryAssetRegistry {
    fn get_asset(&self, asset_id: &str) -> Option<AssetRecord> {
        self.by_id.get(asset_id).cloned()
    }
}

/// Extract `asset:{uuid}` token when present.
pub fn asset_id_from_media_reference(media_reference: Option<&str>) -> Option<String> {
    let reference = media_reference?;
    let id = reference.strip_prefix("asset:")?;
    if id.is_empty() {
        return None;
    }
    Some(id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn harness_dataset_is_deterministic() {
        let a = InMemoryAssetRegistry::harness_dataset();
        let b = InMemoryAssetRegistry::harness_dataset();
        assert_eq!(a.get_asset("f1000000-0000-4000-8000-000000000101"), b.get_asset("f1000000-0000-4000-8000-000000000101"));
    }

    #[test]
    fn missing_asset_returns_none() {
        let reg = InMemoryAssetRegistry::harness_dataset();
        assert!(reg.get_asset("00000000-0000-0000-0000-000000000000").is_none());
    }
}
