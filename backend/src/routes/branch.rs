use axum::{
    extract::{Extension, Path, Json},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::{AppState, models::{Drama, Scene}};

#[derive(Deserialize)]
pub struct ForkRequest {
    pub title: String,
    pub description: String,
}

pub async fn fork_drama(
    Extension(state): Extension<AppState>,
    Path(drama_id): Path<Uuid>,
    Json(payload): Json<ForkRequest>,
    // Auth: user_id from passkey (simplified here)
) -> Result<Json<Drama>, StatusCode> {
    let new_id = Uuid::new_v4();
    let creator_id = Uuid::new_v4(); // ← replace with real user_id from auth

    sqlx::query!(
        r#"INSERT INTO dramas (id, title, description, official, creator_id, forked_from)
           VALUES ($1, $2, $3, false, $4, $5)"#,
        new_id,
        payload.title,
        payload.description,
        creator_id,
        drama_id
    )
    .execute(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(Drama {
        id: new_id,
        title: payload.title,
        description: payload.description,
        official: false,
        creator_id,
        forked_from: Some(drama_id),
        created_at: chrono::Utc::now(),
    }))
}

#[derive(Deserialize)]
pub struct SceneUpload {
    pub scene_number: i32,
    pub title: String,
    pub video_url: String,
    pub transcript: String,
}

pub async fn upload_scene(
    Extension(state): Extension<AppState>,
    Path(drama_id): Path<Uuid>,
    Json(payload): Json<SceneUpload>,
) -> Result<Json<Scene>, StatusCode> {
    let scene_id = Uuid::new_v4();
    let creator_id = Uuid::new_v4(); // ← real user_id

    sqlx::query!(
        r#"INSERT INTO scenes (id, drama_id, scene_number, title, video_url, transcript, creator_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
        scene_id,
        drama_id,
        payload.scene_number,
        payload.title,
        payload.video_url,
        payload.transcript,
        creator_id
    )
    .execute(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(Scene {
        id: scene_id,
        drama_id,
        scene_number: payload.scene_number,
        title: payload.title,
        video_url: payload.video_url,
        transcript: payload.transcript,
        creator_id,
        created_at: chrono::Utc::now(),
    }))
}
