use actix_web::{web, HttpResponse};
use sqlx::PgPool;

use crate::db;
use crate::db::pipeline::UpdatePipelineInput;

#[derive(Debug, serde::Deserialize)]
pub struct ListPipelineQuery {
    #[serde(rename = "seriesId")]
    pub series_id: Option<String>,
    #[serde(rename = "episodeIds")]
    pub episode_ids: Option<String>,
}

fn pipeline_disabled() -> HttpResponse {
    HttpResponse::NotFound().json(serde_json::json!({
        "error": "Pipeline API disabled",
        "hint": "Set REELFORGE_PIPELINE_API=true to enable"
    }))
}

fn check_pipeline_enabled() -> Result<(), HttpResponse> {
    if db::pipeline_api_enabled() {
        Ok(())
    } else {
        Err(pipeline_disabled())
    }
}

pub async fn pipeline_status(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_pipeline_enabled() {
        return resp;
    }
    match db::pipeline::count_pipeline_rows(pool.get_ref()).await {
        Ok(count) => HttpResponse::Ok().json(serde_json::json!({
            "enabled": true,
            "count": count,
            "stages": db::pipeline::PIPELINE_STAGES
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn list_pipeline(
    pool: web::Data<PgPool>,
    query: web::Query<ListPipelineQuery>,
) -> HttpResponse {
    if let Err(resp) = check_pipeline_enabled() {
        return resp;
    }

    let episode_filter = query.episode_ids.as_ref().map(|raw| {
        raw.split(',')
            .map(|part| part.trim().to_string())
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
    });

    match db::pipeline::list_pipeline(pool.get_ref(), episode_filter.as_deref()).await {
        Ok(rows) => {
            let filtered = if query.series_id.is_some() && episode_filter.is_none() {
                let series_id = query.series_id.as_ref().unwrap();
                rows.into_iter()
                    .filter(|row| episode_belongs_to_series(&row.episode_id, series_id))
                    .collect::<Vec<_>>()
            } else {
                rows
            };
            HttpResponse::Ok().json(filtered)
        }
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

fn episode_belongs_to_series(episode_id: &str, series_id: &str) -> bool {
    let slug = series_id.trim_start_matches("series-");
    episode_id.contains(slug)
        || slug
            .split('-')
            .filter(|part| !part.is_empty())
            .all(|part| episode_id.contains(part))
}

pub async fn update_pipeline(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    body: web::Json<UpdatePipelineInput>,
) -> HttpResponse {
    if let Err(resp) = check_pipeline_enabled() {
        return resp;
    }

    let episode_id = path.into_inner();
    if episode_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "episodeId is required"
        }));
    }

    if let Some(stage) = body.stage.as_ref() {
        if let Err(message) = db::pipeline::validate_stage(stage) {
            return HttpResponse::BadRequest().json(serde_json::json!({ "error": message }));
        }
    }

    match db::pipeline::upsert_pipeline(pool.get_ref(), &episode_id, &body).await {
        Ok(row) => HttpResponse::Ok().json(row),
        Err(sqlx::Error::Protocol(message)) => HttpResponse::BadRequest().json(serde_json::json!({
            "error": message
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}
