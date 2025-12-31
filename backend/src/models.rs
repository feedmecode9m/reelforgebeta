use uuid::Uuid;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct Drama {
    pub id: Uuid,
    pub title: String,
    pub description: String,
    pub official: bool,
    pub creator_id: Uuid, // user who owns original
    pub forked_from: Option<Uuid>, // null = original
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize, Deserialize)]
pub struct Scene {
    pub id: Uuid,
    pub drama_id: Uuid,
    pub scene_number: i32,
    pub title: String,
    pub video_url: String,
    pub transcript: String,
    pub creator_id: Uuid,
    pub created_at: chrono::DateTime<chrono::Utc>,
}
