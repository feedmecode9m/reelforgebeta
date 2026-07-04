use actix_web::{web, HttpResponse};
use sqlx::PgPool;

use crate::db;
use crate::db::sync::SyncPushInput;

fn sync_disabled() -> HttpResponse {
    HttpResponse::NotFound().json(serde_json::json!({
        "error": "Studio sync API disabled",
        "hint": "Set REELFORGE_STUDIO_SYNC=true to enable"
    }))
}

fn check_sync_enabled() -> Result<(), HttpResponse> {
    if db::studio_sync_enabled() {
        Ok(())
    } else {
        Err(sync_disabled())
    }
}

pub async fn sync_status(_pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_sync_enabled() {
        return resp;
    }
    HttpResponse::Ok().json(serde_json::json!({
        "enabled": true,
        "strategy": "last-write-wins",
        "domains": [
            "seriesMetadata",
            "workflowTasks",
            "releaseSchedule",
            "publishingState"
        ]
    }))
}

pub async fn get_sync_state(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_sync_enabled() {
        return resp;
    }
    match db::sync::get_sync_state(pool.get_ref(), db::sync::DEFAULT_WORKSPACE_ID).await {
        Ok(row) => HttpResponse::Ok().json(serde_json::json!({
            "workspaceId": row.workspace_id,
            "payload": row.payload,
            "updatedAt": row.updated_at
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

async fn handle_push(
    pool: web::Data<PgPool>,
    body: web::Json<SyncPushInput>,
) -> HttpResponse {
    if let Err(resp) = check_sync_enabled() {
        return resp;
    }

    let workspace_id = body
        .workspace_id
        .as_deref()
        .unwrap_or(db::sync::DEFAULT_WORKSPACE_ID);

    let mut domains = body.domains.clone();
    if let Some(device_id) = &body.device_id {
        domains.insert(
            "_meta".to_string(),
            serde_json::json!({ "deviceId": device_id }),
        );
    }

    match db::sync::merge_sync_state(pool.get_ref(), workspace_id, &domains).await {
        Ok(row) => HttpResponse::Ok().json(serde_json::json!({
            "workspaceId": row.workspace_id,
            "payload": row.payload,
            "updatedAt": row.updated_at,
            "merged": true
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn push_sync_state(
    pool: web::Data<PgPool>,
    body: web::Json<SyncPushInput>,
) -> HttpResponse {
    handle_push(pool, body).await
}

pub async fn push_sync(pool: web::Data<PgPool>, body: web::Json<SyncPushInput>) -> HttpResponse {
    handle_push(pool, body).await
}
