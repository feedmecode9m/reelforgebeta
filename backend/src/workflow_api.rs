use actix_web::{web, HttpResponse};
use serde::Deserialize;
use sqlx::PgPool;

use crate::db;
use crate::db::workflow::{CreateWorkflowTaskInput, UpdateWorkflowTaskInput};

#[derive(Debug, Deserialize)]
pub struct ListTasksQuery {
    #[serde(rename = "seriesId")]
    pub series_id: Option<String>,
}

fn workflow_disabled() -> HttpResponse {
    HttpResponse::NotFound().json(serde_json::json!({
        "error": "Workflow API disabled",
        "hint": "Set REELFORGE_WORKFLOW_API=true to enable"
    }))
}

fn check_workflow_enabled() -> Result<(), HttpResponse> {
    if db::workflow_api_enabled() {
        Ok(())
    } else {
        Err(workflow_disabled())
    }
}

pub async fn workflow_status(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_workflow_enabled() {
        return resp;
    }
    match db::workflow::count_workflow_tasks(pool.get_ref()).await {
        Ok(count) => HttpResponse::Ok().json(serde_json::json!({
            "enabled": true,
            "count": count
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn list_tasks(
    pool: web::Data<PgPool>,
    query: web::Query<ListTasksQuery>,
) -> HttpResponse {
    if let Err(resp) = check_workflow_enabled() {
        return resp;
    }

    let series_filter = query.series_id.as_deref();
    match db::workflow::list_workflow_tasks(pool.get_ref(), series_filter).await {
        Ok(tasks) => HttpResponse::Ok().json(tasks),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn create_task(pool: web::Data<PgPool>, body: web::Json<CreateWorkflowTaskInput>) -> HttpResponse {
    if let Err(resp) = check_workflow_enabled() {
        return resp;
    }

    if body.series_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "seriesId is required"
        }));
    }
    if body.task_type.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "taskType is required"
        }));
    }

    match db::workflow::create_workflow_task(pool.get_ref(), &body).await {
        Ok(task) => HttpResponse::Created().json(task),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn update_task(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    body: web::Json<UpdateWorkflowTaskInput>,
) -> HttpResponse {
    if let Err(resp) = check_workflow_enabled() {
        return resp;
    }

    let id = path.into_inner();
    if id.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Task id is required"
        }));
    }

    match db::workflow::update_workflow_task(pool.get_ref(), &id, &body).await {
        Ok(Some(task)) => HttpResponse::Ok().json(task),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Task not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn delete_task(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_workflow_enabled() {
        return resp;
    }

    let id = path.into_inner();
    if id.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Task id is required"
        }));
    }

    match db::workflow::delete_workflow_task(pool.get_ref(), &id).await {
        Ok(true) => HttpResponse::Ok().json(serde_json::json!({ "deleted": true, "id": id })),
        Ok(false) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Task not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}
