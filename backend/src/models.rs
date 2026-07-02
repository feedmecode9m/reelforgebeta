use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Reel {
    pub id: Uuid,
    pub title: String,
    pub description: String,
    pub thumbnail_url: Option<String>,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

pub fn placeholder_reels() -> Vec<Reel> {
    let now = Utc::now();
    vec![
        Reel {
            id: Uuid::parse_str("11111111-1111-4111-8111-111111111111").expect("valid uuid"),
            title: "Midnight Heist".into(),
            description: "A neon-lit thriller reel with quick cuts and a cliffhanger ending.".into(),
            thumbnail_url: None,
            status: "placeholder".into(),
            created_at: now,
        },
        Reel {
            id: Uuid::parse_str("22222222-2222-4222-8222-222222222222").expect("valid uuid"),
            title: "Coffee Shop Meet-Cute".into(),
            description: "Rom-com micro-drama optimized for vertical storytelling.".into(),
            thumbnail_url: None,
            status: "placeholder".into(),
            created_at: now,
        },
        Reel {
            id: Uuid::parse_str("33333333-3333-4333-8333-333333333333").expect("valid uuid"),
            title: "The Last Signal".into(),
            description: "Sci-fi suspense reel with AI-generated b-roll and voiceover.".into(),
            thumbnail_url: None,
            status: "placeholder".into(),
            created_at: now,
        },
    ]
}
