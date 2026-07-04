use actix_web::{web, HttpResponse};
use sqlx::PgPool;

use crate::db;
use crate::db::notifications::CreateNotificationInput;

#[derive(Debug, serde::Deserialize)]
pub struct ListNotificationsQuery {
    #[serde(rename = "userId")]
    pub user_id: Option<String>,
    #[serde(rename = "unreadOnly")]
    pub unread_only: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
pub struct MarkAllReadQuery {
    #[serde(rename = "userId")]
    pub user_id: String,
}

fn notification_disabled() -> HttpResponse {
    HttpResponse::NotFound().json(serde_json::json!({
        "error": "Notification API disabled",
        "hint": "Set REELFORGE_NOTIFICATION_API=true to enable"
    }))
}

fn check_notification_enabled() -> Result<(), HttpResponse> {
    if db::notification_api_enabled() {
        Ok(())
    } else {
        Err(notification_disabled())
    }
}

pub async fn notification_status(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_notification_enabled() {
        return resp;
    }
    match db::notifications::count_notifications(pool.get_ref()).await {
        Ok(count) => HttpResponse::Ok().json(serde_json::json!({
            "enabled": true,
            "count": count,
            "types": db::notifications::NOTIFICATION_TYPES
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn list_notifications(
    pool: web::Data<PgPool>,
    query: web::Query<ListNotificationsQuery>,
) -> HttpResponse {
    if let Err(resp) = check_notification_enabled() {
        return resp;
    }
    let user_id = query.user_id.clone().unwrap_or_else(|| "user-owner-1".to_string());
    let unread_only = query.unread_only.unwrap_or(false);
    match db::notifications::list_notifications(pool.get_ref(), &user_id, unread_only).await {
        Ok(rows) => HttpResponse::Ok().json(rows),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn create_notification(
    pool: web::Data<PgPool>,
    body: web::Json<CreateNotificationInput>,
) -> HttpResponse {
    if let Err(resp) = check_notification_enabled() {
        return resp;
    }
    if body.user_id.trim().is_empty() || body.notification_type.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "userId and type are required"
        }));
    }
    if body.message.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "message is required"
        }));
    }
    if !db::notifications::NOTIFICATION_TYPES.contains(&body.notification_type.as_str()) {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Invalid notification type",
            "allowed": db::notifications::NOTIFICATION_TYPES
        }));
    }
    match db::notifications::create_notification(pool.get_ref(), &body).await {
        Ok(row) => HttpResponse::Created().json(row),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn mark_notification_read(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_notification_enabled() {
        return resp;
    }
    let id = path.into_inner();
    match db::notifications::mark_notification_read(pool.get_ref(), &id).await {
        Ok(Some(row)) => HttpResponse::Ok().json(row),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Notification not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn mark_all_notifications_read(
    pool: web::Data<PgPool>,
    query: web::Query<MarkAllReadQuery>,
) -> HttpResponse {
    if let Err(resp) = check_notification_enabled() {
        return resp;
    }
    if query.user_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "userId is required"
        }));
    }
    match db::notifications::mark_all_read(pool.get_ref(), &query.user_id).await {
        Ok(updated) => HttpResponse::Ok().json(serde_json::json!({ "updated": updated })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn unread_count(
    pool: web::Data<PgPool>,
    query: web::Query<ListNotificationsQuery>,
) -> HttpResponse {
    if let Err(resp) = check_notification_enabled() {
        return resp;
    }
    let user_id = query.user_id.clone().unwrap_or_else(|| "user-owner-1".to_string());
    match db::notifications::count_unread(pool.get_ref(), &user_id).await {
        Ok(count) => HttpResponse::Ok().json(serde_json::json!({ "unread": count })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}
